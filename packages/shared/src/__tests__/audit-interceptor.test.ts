import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

// Partial-mock `node:fs/promises` so `appendFile` calls are observable while
// still delegating to the real implementation (AC 29.0.4 requires a spy that
// proves NO fs write is attempted when auditing is off, and exactly one entry
// line lands on disk when it's on).
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    appendFile: vi.fn(actual.appendFile),
  };
});

import { appendFile } from "node:fs/promises";
import { McpServerBase } from "../server-base.js";
import type { McpServerBaseOptions } from "../server-base.js";
import type { ToolDefinition } from "../tool-types.js";
import type { IrisConnectionConfig } from "../config.js";
import { waitForAuditLines } from "./test-helpers.js";
import type { AuditRecord } from "./test-helpers.js";

const appendFileMock = appendFile as unknown as ReturnType<typeof vi.fn>;

// ── Helpers ─────────────────────────────────────────────────────────

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

function makeGetDocTool(): ToolDefinition {
  return {
    name: "iris_doc_get",
    title: "Get Document",
    description: "Retrieve a document by name.",
    inputSchema: z.object({
      name: z.string().describe("Document name"),
      namespace: z.string().optional().describe("Target namespace"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    scope: "NS",
    handler: async (_args, ctx) => ({
      content: [{ type: "text" as const, text: `ns=${ctx.resolveNamespace()}` }],
    }),
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

/** The wait for the audit file, in milliseconds. */
const AUDIT_WAIT_MS = 2000;

// ── Tests ───────────────────────────────────────────────────────────

describe("audit interceptor (Epic 29, Story 29.0)", () => {
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
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    exitMock = vi
      .spyOn(process, "exit")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((() => {}) as any);
    delete process.env.IRIS_AUDIT_LOG;
    delete process.env.IRIS_AUDIT_LOG_MAX_MB;
    delete process.env.IRIS_AUDIT_LOG_PARAMS;
    appendFileMock.mockClear();
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

  it("AC 29.0.4 (negative): IRIS_AUDIT_LOG unset -> pure pass-through, zero fs writes", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());

    const server = new McpServerBase(
      makeServerOpts([makeGetDocTool()], makeConfig()),
    );
    await server.start("stdio");

    const result = await invokeTool(server, "iris_doc_get", { name: "Foo.cls" });

    // Byte-for-byte the shape `dispatchToolCall`'s success path produces
    // (Rule #19 mechanical proof) — auditing being present-but-off must not
    // perturb it.
    expect(result).toEqual({
      content: [{ type: "text", text: "ns=HSCUSTOM" }],
      isError: undefined,
    });
    expect(appendFileMock).not.toHaveBeenCalled();
  });

  it("AC 29.0.4 (positive): IRIS_AUDIT_LOG set -> exactly one entry line after the header", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iris-audit-interceptor-test-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());

    const server = new McpServerBase(
      makeServerOpts([makeGetDocTool()], makeConfig()),
    );
    await server.start("stdio");

    const result = await invokeTool(server, "iris_doc_get", { name: "Foo.cls" });
    expect(result.isError).toBeFalsy();

    const lines = await waitForAuditLines(auditPath, 2, AUDIT_WAIT_MS);
    expect(lines).toHaveLength(2);

    const header = lines[0] as AuditRecord;
    expect(header.type).toBe("sessionStart");
    expect(header.serverPkg).toBe("test-server");
    expect(header.version).toBe("1.0.0");

    const entry = lines[1] as AuditRecord;
    expect(entry.tool).toBe("iris_doc_get");
    expect(entry.action).toBeNull();
    expect(entry.profile).toBe("default");
    // Story 31.3, AC 31.3.2: attribution ONLY, copied from the resolved
    // profile's `source` field — the reserved default is always "env".
    expect(entry.profileSource).toBe("env");
    expect(entry.namespace).toBe("HSCUSTOM");
    expect(entry.outcome).toBe("ok");
    expect(entry.paramKeys).toEqual(["name"]);
    expect(entry.seq).toBe(1);
    expect(typeof entry.durationMs).toBe("number");
    expect(appendFileMock).toHaveBeenCalled();

    rmSync(dir, { recursive: true, force: true });
  });

  // Code review 2026-07-25 (Story 31.3): the README and tool_support.md
  // originally said `profileSource` is "omitted, meaning `env`" for an
  // `IRIS_*`/`IRIS_PROFILES` profile. That is false — the test above proves
  // env profiles emit `"env"` explicitly. The docs were corrected to state the
  // real contract: the field is present for every call that resolves a REAL
  // registry profile, and absent ONLY when the `server` parameter named a
  // profile that does not exist, so absence means "no profile resolved" and
  // must never be read as `"env"`. This pins that one absence case, which is
  // the ambiguous one an audit consumer would otherwise mis-classify.
  it("Story 31.3 (code review): profileSource is ABSENT — not \"env\" — when `server` names an unknown profile", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iris-audit-interceptor-unknown-"));
    const auditPath = join(dir, "audit.log");
    process.env.IRIS_AUDIT_LOG = auditPath;

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());

    const server = new McpServerBase(
      makeServerOpts([makeGetDocTool()], makeConfig()),
    );
    await server.start("stdio");

    const result = await invokeTool(server, "iris_doc_get", {
      name: "Foo.cls",
      server: "no-such-profile",
    });
    expect(result.isError).toBe(true);

    const lines = await waitForAuditLines(auditPath, 2, AUDIT_WAIT_MS);
    const entry = lines[1] as AuditRecord;
    expect(entry.profile).toBe("no-such-profile");
    // The distinguishing assertion: absent, NOT "env".
    expect(Object.prototype.hasOwnProperty.call(entry, "profileSource")).toBe(false);
    expect(entry.profileSource).toBeUndefined();

    rmSync(dir, { recursive: true, force: true });
  });

  it("AC 29.0.1: fails fast (process.exit(1)) when the IRIS_AUDIT_LOG directory is not writable", async () => {
    const bogusDir = join(tmpdir(), `iris-audit-does-not-exist-${Date.now()}`);
    process.env.IRIS_AUDIT_LOG = join(bogusDir, "audit.log");

    // Fail-fast must happen BEFORE any IRIS connectivity is attempted.
    fetchMock.mockImplementation(() => {
      throw new Error("fetch should not be called: audit fail-fast must exit first");
    });

    const server = new McpServerBase(makeServerOpts([], makeConfig()));
    await server.start("stdio");

    expect(exitMock).toHaveBeenCalledWith(1);
    expect(appendFileMock).not.toHaveBeenCalled();
  });

  it("AC 29.0.1: fails fast naming IRIS_AUDIT_LOG_MAX_MB on a malformed value", async () => {
    process.env.IRIS_AUDIT_LOG = join(tmpdir(), "iris-audit-badmax-test", "audit.log");
    process.env.IRIS_AUDIT_LOG_MAX_MB = "not-a-number";

    // Fail-fast must happen BEFORE any IRIS connectivity is attempted.
    fetchMock.mockImplementation(() => {
      throw new Error("fetch should not be called: config parse must fail first");
    });

    const server = new McpServerBase(makeServerOpts([], makeConfig()));
    await server.start("stdio");

    expect(exitMock).toHaveBeenCalledWith(1);
    expect(appendFileMock).not.toHaveBeenCalled();
  });

  // Story 42.10 (DW-654, DW-667, AD-19), with IRIS_AUDIT_LOG_PARAMS unset: a SYS-scoped tool always runs in %SYS, so its
  // entry's `namespace` says so whatever its `namespace` argument holds, and `targetNamespace` carries that argument when it
  // is a non-empty string. Every other scope keeps the argument-or-profile derivation and never has `targetNamespace`.
  describe("the audit namespace follows the tool's scope (Story 42.10, DW-654)", () => {
    /** A tool of `scope` that takes an optional `namespace`; `mutates: "write"` makes it default-disabled (a denial). */
    function makeScopedTool(scope: ToolDefinition["scope"], mutates: "read" | "write" = "read"): ToolDefinition {
      return {
        name: `iris_scope_${scope.toLowerCase()}_${mutates}`,
        title: `${scope} ${mutates}`,
        description: `A ${scope}-scoped ${mutates} tool.`,
        inputSchema: z.object({ namespace: z.string().optional().describe("Target namespace") }),
        annotations: { readOnlyHint: mutates === "read", destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope,
        mutates,
        handler: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
      };
    }

    /** Run the `calls` against a started server with auditing on, and return the tool-call entries in call order. */
    async function auditedEntries(tool: ToolDefinition, calls: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
      const dir = mkdtempSync(join(tmpdir(), "iris-audit-scope-test-"));
      const auditPath = join(dir, "audit.log");
      process.env.IRIS_AUDIT_LOG = auditPath;
      try {
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
        fetchMock.mockResolvedValueOnce(versionResponse());
        const server = new McpServerBase(makeServerOpts([tool], makeConfig()));
        await server.start("stdio");
        for (const args of calls) await invokeTool(server, tool.name, args);
        const lines = await waitForAuditLines(auditPath, calls.length + 1, AUDIT_WAIT_MS);
        return lines.filter((entry) => entry.tool === tool.name);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    it("a SYS-scoped call records %SYS, with and without a namespace argument, and the argument as targetNamespace", async () => {
      const entries = await auditedEntries(makeScopedTool("SYS"), [{}, { namespace: "USER" }, { namespace: "" }]);
      expect(entries.map((entry) => [entry.outcome, entry.namespace, entry.targetNamespace])).toEqual([
        ["ok", "%SYS", undefined],
        ["ok", "%SYS", "USER"],
        ["ok", "%SYS", undefined],
      ]);
      expect(entries.map((entry) => "targetNamespace" in entry), "no key without a non-empty argument").toEqual([false, true, false]);
      // The argument is still named in `paramKeys`; its value is in `targetNamespace`, not in `params`.
      expect(entries.map((entry) => entry.paramKeys)).toEqual([[], ["namespace"], ["namespace"]]);
      expect(entries.map((entry) => "params" in entry)).toEqual([false, false, false]);
      // `targetNamespace` follows `namespace` in the entry.
      const keys = Object.keys(entries[1]!);
      expect(keys.indexOf("targetNamespace")).toBe(keys.indexOf("namespace") + 1);
    });

    it("a denied SYS-scoped call records %SYS and its namespace argument as targetNamespace", async () => {
      const entries = await auditedEntries(makeScopedTool("SYS", "write"), [{ namespace: "USER" }, {}]);
      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({ outcome: "denied", denyReason: "GOVERNANCE_DISABLED", namespace: "%SYS", targetNamespace: "USER" });
      expect(entries[1]).toMatchObject({ outcome: "denied", namespace: "%SYS" });
      expect(entries[1]).not.toHaveProperty("targetNamespace");
    });

    it("a SYS-scoped call that fails its schema records %SYS, and no targetNamespace for a namespace that is not a string", async () => {
      const entries = await auditedEntries(makeScopedTool("SYS"), [{ namespace: 5 }]);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ outcome: "error", namespace: "%SYS" });
      expect(entries[0]).not.toHaveProperty("targetNamespace");
    });

    it.each(["NS", "BOTH", "NONE"] as const)("a %s-scoped call records its namespace argument, else the profile's default (as before), and never targetNamespace", async (scope) => {
      const entries = await auditedEntries(makeScopedTool(scope), [{}, { namespace: "USER" }]);
      expect(entries.map((entry) => [entry.outcome, entry.namespace])).toEqual([
        ["ok", "HSCUSTOM"],
        ["ok", "USER"],
      ]);
      for (const entry of entries) expect(entry).not.toHaveProperty("targetNamespace");
    });

    it.each(["NS", "BOTH", "NONE"] as const)("a denied %s-scoped call records its namespace argument (as before), and never targetNamespace", async (scope) => {
      const entries = await auditedEntries(makeScopedTool(scope, "write"), [{ namespace: "USER" }]);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ outcome: "denied", namespace: "USER" });
      expect(entries[0]).not.toHaveProperty("targetNamespace");
    });
  });
});
