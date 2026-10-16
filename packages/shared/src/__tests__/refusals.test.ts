/**
 * Story 38.3 (AC-9) - the refusal-code catalog.
 *
 * Two describes:
 *
 *  1. The catalog itself: the codes are unique, each value equals its key, each is UPPER_SNAKE_CASE,
 *     and `refusalResult` builds the one refusal shape.
 *  2. The governance denial, which the catalog generalizes: its serialized result is pinned as a
 *     literal. The literals were captured on the UNMODIFIED tree (baseline commit 2e9114e, before
 *     `server-base.ts` read its code from the catalog) by running this describe against the real
 *     `McpServerBase` call path; they are never edited to match the new code (Rule #36).
 *
 * The harness mirrors `governance-enforcement.test.ts`: a mocked `bootstrap`, a `fetchMock` for the
 * default profile's startup HEAD and GET, and hermetic env save/restore.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { BootstrapResult } from "../bootstrap.js";
import { REFUSAL_CODES, refusalResult, type RefusalCode } from "../refusals.js";

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

const { McpServerBase } = await import("../server-base.js");
type ToolDefinition = import("../tool-types.js").ToolDefinition;

describe("the refusal-code catalog (Story 38.3, AC-9)", () => {
  const entries = Object.entries(REFUSAL_CODES);

  it("holds exactly the codes the suite returns today, and the two Story 38.5 adds", () => {
    expect(Object.keys(REFUSAL_CODES).sort()).toEqual([
      "DOCUMENT_CONFLICT",
      "GOVERNANCE_DISABLED",
      "SQL_READ_ONLY",
      "SQL_ROWS_AFFECTED_CAP",
      "STALE_CONTENT",
      "STORAGE_DROPPED",
    ]);
  });

  it("every value equals its key", () => {
    for (const [key, value] of entries) expect(value, key).toBe(key);
  });

  it("every value is UPPER_SNAKE_CASE", () => {
    for (const [, value] of entries) expect(value).toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/);
  });

  it("the values are unique", () => {
    const values = entries.map(([, value]) => value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("refusalResult builds {content, structuredContent: {code, ...fields}, isError: true} with code first", () => {
    const result = refusalResult(REFUSAL_CODES.STORAGE_DROPPED, "Text. Do this.", {
      name: "A.cls",
      namespace: "USER",
      droppedStorage: ["Default"],
    });

    expect(result).toEqual({
      content: [{ type: "text", text: "Text. Do this." }],
      structuredContent: { code: "STORAGE_DROPPED", name: "A.cls", namespace: "USER", droppedStorage: ["Default"] },
      isError: true,
    });
    expect(Object.keys(result)).toEqual(["content", "structuredContent", "isError"]);
    expect(Object.keys(result.structuredContent)).toEqual(["code", "name", "namespace", "droppedStorage"]);
  });

  it("refusalResult with no fields carries the code alone, and a code key in the fields never replaces it", () => {
    expect(refusalResult(REFUSAL_CODES.DOCUMENT_CONFLICT, "T.").structuredContent).toEqual({
      code: "DOCUMENT_CONFLICT",
    });
    const result = refusalResult(REFUSAL_CODES.DOCUMENT_CONFLICT, "T.", { code: "OTHER", name: "A.cls" });
    expect(result.structuredContent).toEqual({ code: "DOCUMENT_CONFLICT", name: "A.cls" });
    const code: RefusalCode = result.structuredContent.code;
    expect(code).toBe("DOCUMENT_CONFLICT");
  });
});

// ---------------------------------------------------------------------------
// The governance denial: byte-identical to the baseline (AC-9).
// ---------------------------------------------------------------------------

function versionResponse(): Response {
  return new Response(
    JSON.stringify({ status: { errors: [] }, console: [], result: { version: "8.0.0" } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/** A NEW single-operation write tool: seeded disabled, so every call is denied. */
function writeTool(): ToolDefinition {
  return {
    name: "iris_new_write",
    title: "Governed write",
    description: "A NEW single-op write action (seed-disabled).",
    inputSchema: z.object({ value: z.string().optional() }),
    annotations: { readOnlyHint: false },
    scope: "NS",
    mutates: "write",
    handler: async () => ({ content: [{ type: "text" as const, text: "should not run" }] }),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(server: any, name: string, args: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry = (server.server as any)._registeredTools[name];
  return (entry.callback ?? entry.handler ?? entry.cb)(args);
}

/**
 * Every variable `McpServerBase` and its profile loader read that can change whether or why a call is
 * denied, where it is audited, or whether `start()` succeeds (the Server Manager source is off when
 * `IRIS_SERVER_MANAGER` is unset).
 */
const CLEARED_ENV = [
  "IRIS_SERVER_MANAGER",
  "IRIS_SM_SERVERS",
  "IRIS_SM_SETTINGS_PATHS",
  "IRIS_SM_WORKSPACE",
  "IRIS_CREDENTIAL_HELPER",
  "IRIS_PROFILES",
  "IRIS_GOVERNANCE",
  "IRIS_GOVERNANCE_FILE",
  "IRIS_GOVERNANCE_PRESET",
  "IRIS_TOOLS_DISABLE",
  "IRIS_TOOLS_ENABLE",
  "IRIS_TOOLS_PRESET",
  "IRIS_AUDIT_LOG",
  "IRIS_AUDIT_LOG_MAX_MB",
  "IRIS_AUDIT_LOG_PARAMS",
] as const;

describe("the GOVERNANCE_DISABLED denial is byte-identical to the baseline (Story 38.3, AC-9)", () => {
  const originalFetch = globalThis.fetch;
  const savedEnv: Record<string, string | undefined> = Object.fromEntries(
    [...CLEARED_ENV, "IRIS_USERNAME", "IRIS_PASSWORD", "IRIS_HOST", "IRIS_NAMESPACE"].map((name) => [name, process.env[name]]),
  );

  beforeEach(() => {
    bootstrapSpy.mockClear();
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());
    globalThis.fetch = fetchMock;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const name of CLEARED_ENV) delete process.env[name];
    process.env.IRIS_USERNAME = "u";
    process.env.IRIS_PASSWORD = "p";
    process.env.IRIS_HOST = "default.example.com";
    process.env.IRIS_NAMESPACE = "DEFAULTNS";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("a denial by the default seed serializes to the baseline literal (no presetApplied)", async () => {
    const server = new McpServerBase({ name: "test-server", version: "1.0.0", tools: [writeTool()], needsCustomRest: false });
    await server.start("stdio");

    const result = await callTool(server, "iris_new_write", { value: "x" });

    expect(JSON.stringify(result)).toBe(
      '{"content":[{"type":"text","text":"action \'iris_new_write\' is disabled by governance policy for server \'default\'"}],"structuredContent":{"code":"GOVERNANCE_DISABLED","action":"iris_new_write","server":"default"},"isError":true}',
    );
    expect(result.structuredContent.code).toBe(REFUSAL_CODES.GOVERNANCE_DISABLED);
  });

  it("a denial caused by the preset serializes to the baseline literal (presetApplied last)", async () => {
    process.env.IRIS_GOVERNANCE_PRESET = "read-only";
    const server = new McpServerBase({ name: "test-server", version: "1.0.0", tools: [writeTool()], needsCustomRest: false });
    await server.start("stdio");

    const result = await callTool(server, "iris_new_write", { value: "x" });

    expect(JSON.stringify(result)).toBe(
      '{"content":[{"type":"text","text":"action \'iris_new_write\' is disabled by governance policy for server \'default\'"}],"structuredContent":{"code":"GOVERNANCE_DISABLED","action":"iris_new_write","server":"default","presetApplied":"read-only"},"isError":true}',
    );
  });
});
