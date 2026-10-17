/**
 * Story 39.1 - governance proof for `iris_message_search`, through the REAL `McpServerBase` call path.
 *
 * Its three action keys (`headers`, `body`, `searchTable`) are new post-foundation keys, all classified
 * `read`, so the default seed enables them. This suite proves, with a real server (a stubbed `fetch`
 * for the default profile's startup only):
 *
 *   - the keys are enabled under an empty `IRIS_GOVERNANCE` and under the `read-only` preset, as the
 *     effective policy `iris_server_profiles` reports it;
 *   - an operator's `{"global": {"iris_message_search:headers": false}}` denies `headers` with
 *     `GOVERNANCE_DISABLED` before the handler runs, while `searchTable` still reaches its own
 *     validation (it is not governed away);
 *   - the audit trail records the derived `action` and the closed `outcome` domain: `ok` for a search,
 *     `error` for a refusal, `denied` for the governance denial;
 *   - (Stories 39.3 and 39.4) a body or searchTable call through the real handler audits its `dataPolicy`
 *     and, under `IRIS_AUDIT_LOG_PARAMS`, its `filters` as `"[REDACTED]"` under `redact` and `block`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServerBase } from "@iris-mcp/shared";
import type { ToolDefinition } from "@iris-mcp/shared";
import { auditLines, callTool, effectivePolicy, makeEnvHarness, stageDefaultStartup } from "@iris-mcp/shared/test-helpers";
import { messageSearchTool } from "../tools/message-search.js";

const KEYS = [
  "iris_message_search:headers",
  "iris_message_search:body",
  "iris_message_search:searchTable",
] as const;

const WINDOW = { from: "2001-02-03T06:00:00Z", to: "2001-02-03T18:00:00Z" };

/** A tool whose handler is a spy; everything governance reads (name, schema, `mutates`) is the real tool's. */
function spiedTool(spy: ReturnType<typeof vi.fn>): ToolDefinition {
  return { ...messageSearchTool, handler: spy };
}

function makeServer(tool: ToolDefinition): McpServerBase {
  return new McpServerBase({ name: "@iris-mcp/interop", version: "0.0.0", tools: [tool], needsCustomRest: true });
}

describe("iris_message_search governance (Story 39.1)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("enables all three keys under an empty IRIS_GOVERNANCE", async () => {
    stageDefaultStartup(env.fetchMock);
    const server = makeServer(messageSearchTool);
    await server.start("stdio");

    const policy = await effectivePolicy(server);

    for (const key of KEYS) expect(policy[key], key).toBe(true);
  });

  it("leaves all three keys enabled under the read-only preset", async () => {
    process.env.IRIS_GOVERNANCE_PRESET = "read-only";
    stageDefaultStartup(env.fetchMock);
    const server = makeServer(messageSearchTool);
    await server.start("stdio");

    const policy = await effectivePolicy(server);

    for (const key of KEYS) expect(policy[key], key).toBe(true);
  });

  it("runs the handler for headers under empty config", async () => {
    stageDefaultStartup(env.fetchMock);
    const spy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { action: "headers", rows: [], hasMore: false },
    }));
    const server = makeServer(spiedTool(spy));
    await server.start("stdio");

    const result = await callTool(server, "iris_message_search", { action: "headers", ...WINDOW });

    expect(result.isError).toBeFalsy();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("denies headers with GOVERNANCE_DISABLED when an operator disables it, while searchTable still reaches its own validation", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { "iris_message_search:headers": false } });
    stageDefaultStartup(env.fetchMock);
    const server = makeServer(messageSearchTool);
    await server.start("stdio");
    const callsAfterStart = env.fetchMock.mock.calls.length;

    const denied = await callTool(server, "iris_message_search", { action: "headers", ...WINDOW });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_message_search:headers",
      server: "default",
    });
    // The real handler would POST to IRIS; a denied call makes no request at all.
    expect(env.fetchMock.mock.calls.length).toBe(callsAfterStart);

    // No searchTableClass: the real handler's validation error (not a governance denial), with no request.
    const invalid = await callTool(server, "iris_message_search", { action: "searchTable", ...WINDOW });
    expect(invalid.isError).toBe(true);
    expect(invalid.structuredContent).toBeUndefined();
    expect(invalid.content[0].text).toContain("'searchTableClass' is required for the searchTable action");
    expect(env.fetchMock.mock.calls.length).toBe(callsAfterStart);
  });

  it("records the derived action and the closed outcome domain in the audit trail", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iris-message-search-audit-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;
    try {
      // A server where headers is enabled (spied handler) and body is the real refusal.
      stageDefaultStartup(env.fetchMock);
      const spy = vi.fn(async () => ({
        content: [{ type: "text" as const, text: "ran" }],
        structuredContent: { action: "headers", rows: [], hasMore: false },
      }));
      const okServer = makeServer({
        ...messageSearchTool,
        handler: (args, ctx) =>
          (args as { action: string }).action === "headers" ? spy() : messageSearchTool.handler(args, ctx),
      });
      await okServer.start("stdio");
      await callTool(okServer, "iris_message_search", { action: "headers", ...WINDOW });
      await callTool(okServer, "iris_message_search", { action: "body", ...WINDOW });
      await callTool(okServer, "iris_message_search", { action: "searchTable", ...WINDOW });

      const entries = await auditLines(auditPath, 4);
      const calls = entries.filter((entry) => entry.tool === "iris_message_search");
      expect(calls.map((entry) => [entry.action, entry.outcome])).toEqual([
        ["headers", "ok"],
        ["body", "error"],
        ["searchTable", "error"],
      ]);
    } finally {
      delete process.env.IRIS_AUDIT_LOG;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("audits a governance denial of headers as denied", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iris-message-search-audit-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;
    process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { "iris_message_search:headers": false } });
    try {
      stageDefaultStartup(env.fetchMock);
      const server = makeServer(messageSearchTool);
      await server.start("stdio");
      await callTool(server, "iris_message_search", { action: "headers", ...WINDOW });

      const entries = await auditLines(auditPath, 2);
      const call = entries.find((entry) => entry.tool === "iris_message_search");
      expect(call).toMatchObject({ action: "headers", outcome: "denied" });
    } finally {
      delete process.env.IRIS_AUDIT_LOG;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** An IRIS route answer for a body or searchTable search that matched one header: the live route's envelope shape. */
function bodySearchResponse(action: "body" | "searchTable" = "body"): Response {
  const row = {
    id: 1,
    sessionId: 393001,
    type: "Request",
    status: "Completed",
    isError: false,
    sourceItem: "Story393.Source",
    targetItem: "Story393.Target",
    bodyClassName: "Story393.Body",
    bodyId: "1",
    timeCreated: "2001-02-03 08:00:00",
    timeProcessed: "",
    correspondingMessageId: "",
  };
  const result = {
    action,
    limit: 100,
    from: "2001-02-03 06:00:00",
    to: "2001-02-03 18:00:00",
    interopEnabled: true,
    ...(action === "searchTable" ? { searchTablesConfigured: true } : {}),
    rows: [{ ...row, correspondingMessageId: null }],
    hasMore: false,
  };
  return new Response(JSON.stringify({ status: { errors: [], summary: "" }, console: [], result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("iris_message_search body and searchTable: the audit trail of the real handler (Stories 39.3 and 39.4, AD-19)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  const FILTERS = [{ property: "Code", op: "eq", value: "SYNTHPHI393" }];
  const SEARCH_TABLE_FILTERS = [{ property: "PatientID", op: "eq", value: "SYNTHPHI394-MRN-1" }];

  /** The call a body search makes: the arguments `auditedCall` sends on top of the window. */
  const BODY_CALL = { action: "body", bodyClass: "Story393.Body", filters: FILTERS } as const;
  const SEARCH_TABLE_CALL = {
    action: "searchTable",
    searchTableClass: "EnsLib.HL7.SearchTable",
    filters: SEARCH_TABLE_FILTERS,
  } as const;

  const auditedBodyCall = (policy: string | undefined, args: Record<string, unknown> = {}) =>
    auditedCall(BODY_CALL, policy, args);
  const auditedSearchTableCall = (policy: string | undefined, args: Record<string, unknown> = {}) =>
    auditedCall(SEARCH_TABLE_CALL, policy, args);

  /** Start a real server, answer the route from the staged envelope, make `call`, and return the audit entry. */
  async function auditedCall(
    call: typeof BODY_CALL | typeof SEARCH_TABLE_CALL,
    policy: string | undefined,
    args: Record<string, unknown> = {},
  ) {
    const dir = mkdtempSync(join(tmpdir(), "iris-message-search-body-audit-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;
    process.env.IRIS_AUDIT_LOG_PARAMS = "true";
    if (policy !== undefined) process.env.IRIS_DATA_POLICY = policy;
    try {
      stageDefaultStartup(env.fetchMock);
      const server = makeServer(messageSearchTool);
      await server.start("stdio");
      env.fetchMock.mockImplementation(async (input: unknown) =>
        String(input).endsWith("/interop/message/search")
          ? bodySearchResponse(call.action)
          : new Response(null, { status: 200 }),
      );
      const result = await callTool(server, "iris_message_search", { ...WINDOW, ...call, ...args });
      const entries = await auditLines(auditPath, 2);
      const entry = entries.find((candidate) => candidate.tool === "iris_message_search") as Record<string, unknown>;
      return { result, entry, raw: readFileSync(auditPath, "utf-8") };
    } finally {
      delete process.env.IRIS_AUDIT_LOG;
      delete process.env.IRIS_AUDIT_LOG_PARAMS;
      delete process.env.IRIS_DATA_POLICY;
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("under redact records dataPolicy and logs the filters as [REDACTED]", async () => {
    const { result, entry, raw } = await auditedBodyCall(undefined);

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.dataPolicy).toEqual({ policy: "redact", redacted: 0, blocked: 0 });
    expect(entry).toMatchObject({ action: "body", outcome: "ok", dataPolicy: { policy: "redact", redacted: 0, blocked: 0 } });
    expect((entry.params as Record<string, unknown>).filters).toBe("[REDACTED]");
    expect(raw).not.toContain("SYNTHPHI393");
  });

  it("under block records the refusal as error with the policy, and still logs the filters as [REDACTED]", async () => {
    const { result, entry, raw } = await auditedBodyCall("block");

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ code: "DATA_POLICY_BLOCKED", action: "body", policy: "block" });
    expect(entry).toMatchObject({ action: "body", outcome: "error", dataPolicy: { policy: "block", redacted: 0, blocked: 0 } });
    expect((entry.params as Record<string, unknown>).filters).toBe("[REDACTED]");
    expect(raw).not.toContain("SYNTHPHI393");
    // The refusal made no route call: only startup traffic reached the mocked fetch.
    const searchCalls = env.fetchMock.mock.calls.filter((call: unknown[]) => String(call[0]).endsWith("/interop/message/search"));
    expect(searchCalls).toHaveLength(0);
  });

  it("under allow logs the filters, the positive control that the redaction above can vary", async () => {
    const { entry, raw } = await auditedBodyCall("allow");

    expect(entry).toMatchObject({ action: "body", outcome: "ok", dataPolicy: { policy: "allow", redacted: 0, blocked: 0 } });
    expect((entry.params as Record<string, unknown>).filters).toEqual(FILTERS);
    expect(raw).toContain("SYNTHPHI393");
  });

  it("searchTable under redact records dataPolicy and logs the filters as [REDACTED]", async () => {
    const { result, entry, raw } = await auditedSearchTableCall(undefined);

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.dataPolicy).toEqual({ policy: "redact", redacted: 0, blocked: 0 });
    expect(entry).toMatchObject({ action: "searchTable", outcome: "ok", dataPolicy: { policy: "redact", redacted: 0, blocked: 0 } });
    expect((entry.params as Record<string, unknown>).filters).toBe("[REDACTED]");
    expect(raw).not.toContain("SYNTHPHI394");
  });

  it("searchTable under block records the refusal as error with the policy, and still logs the filters as [REDACTED]", async () => {
    const { result, entry, raw } = await auditedSearchTableCall("block");

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ code: "DATA_POLICY_BLOCKED", action: "searchTable", policy: "block" });
    expect(entry).toMatchObject({ action: "searchTable", outcome: "error", dataPolicy: { policy: "block", redacted: 0, blocked: 0 } });
    expect((entry.params as Record<string, unknown>).filters).toBe("[REDACTED]");
    expect(raw).not.toContain("SYNTHPHI394");
    const searchCalls = env.fetchMock.mock.calls.filter((call: unknown[]) => String(call[0]).endsWith("/interop/message/search"));
    expect(searchCalls, "the refusal made no route call").toHaveLength(0);
  });

  it("searchTable under allow logs the filters, the positive control that the redaction above can vary", async () => {
    const { entry, raw } = await auditedSearchTableCall("allow");

    expect(entry).toMatchObject({ action: "searchTable", outcome: "ok", dataPolicy: { policy: "allow", redacted: 0, blocked: 0 } });
    expect((entry.params as Record<string, unknown>).filters).toEqual(SEARCH_TABLE_FILTERS);
    expect(raw).toContain("SYNTHPHI394");
  });

  it("a Zod-invalid call whose op holds the marker reaches neither the audit file, the result nor the log", async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      logged.push(parts.map(String).join(" "));
    });
    try {
      const { result, raw } = await auditedBodyCall(undefined, {
        filters: [{ property: "Code", op: "SYNTHPHI393", value: "SYNTHPHI393" }],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("filters.0.op");
      expect(JSON.stringify(result)).not.toContain("SYNTHPHI393");
      expect(raw).not.toContain("SYNTHPHI393");
      expect(logged.join("\n")).not.toContain("SYNTHPHI393");
    } finally {
      spy.mockRestore();
    }
  });
});
