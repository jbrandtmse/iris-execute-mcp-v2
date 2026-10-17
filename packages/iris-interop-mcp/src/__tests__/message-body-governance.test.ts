/**
 * Story 39.5 - governance and audit proof for `iris_message_body`, through the REAL `McpServerBase` call path.
 *
 * Its one key is new (absent from the frozen baseline) and classified `read`, so the default seed enables it.
 * This suite proves, with a real server (a stubbed `fetch` for startup and for the route's answer):
 *
 *   - the key is enabled under an empty `IRIS_GOVERNANCE` and under the `read-only` preset, as the effective
 *     policy `iris_server_profiles` reports it;
 *   - an operator's `{"global": {"iris_message_body": false}}` denies the call with `GOVERNANCE_DISABLED` before
 *     the handler runs, and the route is never called;
 *   - Zod validation runs before the handler and makes no request;
 *   - the audit entry of a read carries `dataPolicy` with the policy and the counts the response reported
 *     (AD-19), `outcome` stays in its closed domain, `params.headerIds` is logged (it is not PHI), and no body
 *     value reaches the audit file or the log under any policy, `allow` included.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServerBase } from "@iris-mcp/shared";
import { callTool, makeEnvHarness, stageDefaultStartup } from "@iris-mcp/shared/test-helpers";
import { messageBodyTool } from "../tools/message-body.js";

const KEY = "iris_message_body";

function makeServer(): McpServerBase {
  return new McpServerBase({ name: "@iris-mcp/interop", version: "0.0.0", tools: [messageBodyTool], needsCustomRest: true });
}

/** The effective policy `iris_server_profiles` reports for the default profile. */
async function effectivePolicy(server: McpServerBase): Promise<Record<string, boolean>> {
  const result = await callTool(server, "iris_server_profiles", {});
  return (result.structuredContent as { governance: { policy: Record<string, boolean> } }).governance.policy;
}

/** Poll (bounded) until the audit file has at least `minLines` non-empty lines. */
async function auditLines(filePath: string, minLines: number): Promise<Array<Record<string, unknown>>> {
  const deadline = Date.now() + 3000;
  for (;;) {
    if (existsSync(filePath)) {
      const lines = readFileSync(filePath, "utf-8")
        .split("\n")
        .filter((line) => line.trim().length > 0);
      if (lines.length >= minLines) return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${minLines} line(s) in ${filePath}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** The route's answer for two headers: an HL7 v2 body (with its text) and a stream body. The live route's shape. */
function bodyResponse(): Response {
  const result = {
    interopEnabled: true,
    count: 2,
    items: [
      {
        id: 1,
        found: true,
        bodyClassName: "EnsLib.HL7.Message",
        bodyId: "1",
        bodyKind: "hl7v2",
        bodyAvailable: true,
        bodyText: "MSH|^~\\&|SYNTHPHI-APP|SYNTHPHI-FAC|||20010203090001||ADT^A01^ADT_A01|SYNTHPHI-CTL1|P|2.5.1\rPID|1||SYNTHPHI-MRN\r",
        bodyTextComplete: true,
      },
      {
        id: 3,
        found: true,
        bodyClassName: "%Stream.GlobalCharacter",
        bodyId: "1",
        bodyKind: "stream",
        bodyAvailable: true,
        bodyText: "SYNTHPHI-S1 stream text",
        bodyTextComplete: true,
      },
    ],
  };
  return new Response(JSON.stringify({ status: { errors: [], summary: "" }, console: [], result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("iris_message_body governance (Story 39.5)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("enables the key under an empty IRIS_GOVERNANCE", async () => {
    stageDefaultStartup(env.fetchMock);
    const server = makeServer();
    await server.start("stdio");

    expect((await effectivePolicy(server))[KEY]).toBe(true);
  });

  it("leaves the key enabled under the read-only preset", async () => {
    process.env.IRIS_GOVERNANCE_PRESET = "read-only";
    stageDefaultStartup(env.fetchMock);
    const server = makeServer();
    await server.start("stdio");

    expect((await effectivePolicy(server))[KEY]).toBe(true);
  });

  it("runs the handler under empty config", async () => {
    stageDefaultStartup(env.fetchMock);
    const spy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { items: [], count: 0 },
    }));
    const server = new McpServerBase({
      name: "@iris-mcp/interop",
      version: "0.0.0",
      tools: [{ ...messageBodyTool, handler: spy }],
      needsCustomRest: true,
    });
    await server.start("stdio");

    const result = await callTool(server, KEY, { headerIds: [1] });

    expect(result.isError).toBeFalsy();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("denies the call with GOVERNANCE_DISABLED when an operator disables the key, and calls nothing", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { [KEY]: false } });
    stageDefaultStartup(env.fetchMock);
    const server = makeServer();
    await server.start("stdio");
    const callsAfterStart = env.fetchMock.mock.calls.length;

    const denied = await callTool(server, KEY, { headerIds: [1] });

    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toEqual({ code: "GOVERNANCE_DISABLED", action: KEY, server: "default" });
    expect(env.fetchMock.mock.calls.length).toBe(callsAfterStart);
  });

  it("rejects an invalid input before the handler, with no request", async () => {
    stageDefaultStartup(env.fetchMock);
    const server = makeServer();
    await server.start("stdio");
    const callsAfterStart = env.fetchMock.mock.calls.length;

    for (const args of [
      { headerIds: [] },
      { headerIds: Array.from({ length: 21 }, (_, i) => i + 1) },
      { headerIds: ["0"] },
      { headerIds: [1.5] },
      { headerIds: [1], maxChars: 0 },
      { headerIds: [1], maxChars: 1048577 },
      { headerIds: [1], dataPolicy: "open" },
    ]) {
      const result = await callTool(server, KEY, args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
    }
    expect(env.fetchMock.mock.calls.length).toBe(callsAfterStart);
  });
});

describe("iris_message_body: the audit trail of the real handler (AD-19)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  /** Start a real server, answer the route, make the call, and return the result, the audit entry and the raw log. */
  async function auditedCall(policy: string | undefined, args: Record<string, unknown> = {}) {
    const dir = mkdtempSync(join(tmpdir(), "iris-message-body-audit-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;
    process.env.IRIS_AUDIT_LOG_PARAMS = "true";
    process.env.LOG_LEVEL = "DEBUG";
    if (policy !== undefined) process.env.IRIS_DATA_POLICY = policy;
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      logged.push(parts.map(String).join(" "));
    });
    try {
      stageDefaultStartup(env.fetchMock);
      const server = makeServer();
      await server.start("stdio");
      env.fetchMock.mockImplementation(async (input: unknown) =>
        String(input).endsWith("/interop/message/body") ? bodyResponse() : new Response(null, { status: 200 }),
      );
      const result = await callTool(server, KEY, { headerIds: [1, 3], ...args });
      const entries = await auditLines(auditPath, 2);
      const entry = entries.find((candidate) => candidate.tool === KEY) as Record<string, unknown>;
      return { result, entry, raw: readFileSync(auditPath, "utf-8"), log: logged.join("\n") };
    } finally {
      spy.mockRestore();
      delete process.env.IRIS_AUDIT_LOG;
      delete process.env.IRIS_AUDIT_LOG_PARAMS;
      delete process.env.LOG_LEVEL;
      delete process.env.IRIS_DATA_POLICY;
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("under redact the entry carries the policy and the response's counts, and no body value is logged anywhere", async () => {
    const { result, entry, raw, log } = await auditedCall(undefined);

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.dataPolicy).toEqual({ policy: "redact", redacted: 1, blocked: 1 });
    expect(entry).toMatchObject({ tool: KEY, outcome: "ok", dataPolicy: { policy: "redact", redacted: 1, blocked: 1 } });
    expect((entry.params as Record<string, unknown>).headerIds).toEqual([1, 3]);
    expect(raw).not.toContain("SYNTHPHI");
    expect(log).not.toContain("SYNTHPHI");
    expect(JSON.stringify(result)).not.toContain("SYNTHPHI");
  });

  it("under block the entry carries the policy and counts, and nothing is shown", async () => {
    const { result, entry, raw, log } = await auditedCall("block");

    expect(result.structuredContent.dataPolicy).toEqual({ policy: "block", redacted: 0, blocked: 2 });
    expect(entry).toMatchObject({ outcome: "ok", dataPolicy: { policy: "block", redacted: 0, blocked: 2 } });
    expect(raw).not.toContain("SYNTHPHI");
    expect(log).not.toContain("SYNTHPHI");
    expect(JSON.stringify(result)).not.toContain("SYNTHPHI");
  });

  it("under allow the result shows the bodies and the audit file and log still hold none: the positive control", async () => {
    const { result, entry, raw, log } = await auditedCall("allow");

    expect(entry).toMatchObject({ outcome: "ok", dataPolicy: { policy: "allow", redacted: 0, blocked: 0 } });
    expect(JSON.stringify(result), "the result shows the body").toContain("SYNTHPHI-S1 stream text");
    expect(raw).not.toContain("SYNTHPHI");
    expect(log).not.toContain("SYNTHPHI");
  });

  it("a caller dataPolicy that tightens is what the entry records", async () => {
    const { result, entry } = await auditedCall("allow", { dataPolicy: "redact" });

    expect(result.structuredContent.dataPolicy).toEqual({ policy: "redact", redacted: 1, blocked: 1 });
    expect(entry).toMatchObject({ dataPolicy: { policy: "redact", redacted: 1, blocked: 1 } });
  });
});
