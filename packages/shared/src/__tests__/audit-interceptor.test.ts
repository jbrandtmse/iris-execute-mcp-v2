import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

    const lines = await waitForLineCount(auditPath, 2);
    expect(lines).toHaveLength(2);

    const header = JSON.parse(lines[0] as string);
    expect(header.type).toBe("sessionStart");
    expect(header.serverPkg).toBe("test-server");
    expect(header.version).toBe("1.0.0");

    const entry = JSON.parse(lines[1] as string);
    expect(entry.tool).toBe("iris_doc_get");
    expect(entry.action).toBeNull();
    expect(entry.profile).toBe("default");
    expect(entry.namespace).toBe("HSCUSTOM");
    expect(entry.outcome).toBe("ok");
    expect(entry.paramKeys).toEqual(["name"]);
    expect(entry.seq).toBe(1);
    expect(typeof entry.durationMs).toBe("number");
    expect(appendFileMock).toHaveBeenCalled();

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
});
