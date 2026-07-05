/**
 * Story 22.0 — full-TS-stack end-to-end tests for `iris_loc_count`
 * (QA e2e stage; AC 22.0.7 wire/envelope contract).
 *
 * Unlike `loc.test.ts` (which drives the handler with a MOCKED ToolContext,
 * bypassing the shared HTTP client), these tests boot the REAL `McpServerBase`
 * and invoke the tool through the SDK-registered callback (`handleToolCall`
 * path), so the request flows through the REAL governance gate, the REAL
 * profile-resolved `ToolContext` (`resolveNamespace`), and the REAL
 * `IrisHttpClient` envelope parsing — with `fetch` mocked at the network
 * boundary to replay envelopes CAPTURED VERBATIM from the live
 * `GET /api/executemcp/v2/dev/loc` endpoint on 2026-07-03 (HSCUSTOM,
 * spec `ExecuteMCPv2.Loc.*.cls`). This pins the endpoint↔tool contract:
 * if the shared client's envelope handling or the tool's parsing drifts from
 * what the deployed endpoint actually returns, these tests fail.
 *
 * Runs in the DEFAULT vitest suite — no live IRIS required.
 * Harness mirrors `loc-governance.test.ts` / `sqlAnalyze-governance.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerBase } from "@iris-mcp/shared";
import type { McpServerBaseOptions } from "@iris-mcp/shared";
import { locCountTool } from "../tools/loc.js";

// ── Live-captured fixtures (frozen — do NOT regenerate from a mock) ──

/**
 * Success envelope captured verbatim from the live endpoint
 * (`?namespace=HSCUSTOM&spec=ExecuteMCPv2.Loc.*.cls&includeGenerated=false&topN=20`).
 * Bucket invariant holds: 36 + 410 + 152 + 0 + 0 === 598.
 */
const LIVE_SUCCESS_RESULT = {
  filesParsed: 3,
  totalLines: 598,
  blankLines: 36,
  sourceCodeLoc: 410,
  sourceCommentLoc: 152,
  testCodeLoc: 0,
  testCommentLoc: 0,
  codePct: 68.6,
  sourceCodePct: 68.6,
  testCodePct: 0,
  commentPct: 25.4,
  whitespacePct: 6,
  topDocuments: [
    {
      name: "ExecuteMCPv2.Loc.Classifier.cls",
      type: "cls",
      totalLines: 313,
      codeLoc: 213,
      commentLoc: 81,
      isTest: false,
    },
    {
      name: "ExecuteMCPv2.Loc.Generate.cls",
      type: "cls",
      totalLines: 179,
      codeLoc: 132,
      commentLoc: 35,
      isTest: false,
    },
    {
      name: "ExecuteMCPv2.Loc.Scanner.cls",
      type: "cls",
      totalLines: 106,
      codeLoc: 65,
      commentLoc: 36,
      isTest: false,
    },
  ],
  truncatedTopN: false,
};

/**
 * Error envelope captured verbatim from the live endpoint for a bad
 * namespace (`?namespace=ZZZNOSUCHNS&spec=*.cls`). Note: the live endpoint
 * returns HTTP 200 with the error carried in `status.errors` — exactly what
 * is replayed here.
 */
const LIVE_ERROR_ENVELOPE = {
  status: {
    errors: [
      {
        error: "ERROR #5001: ObjectScript error: <NAMESPACE>SwitchNamespace",
        code: 5001,
        domain: "%ObjectErrors",
        id: "GeneralError",
        params: ["ObjectScript error: &lt;NAMESPACE&gt;SwitchNamespace"],
      },
    ],
    summary: "ERROR #5001: ObjectScript error: &lt;NAMESPACE&gt;SwitchNamespace",
  },
  console: [],
  result: {},
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Atelier version-negotiation response body (major 8). */
function versionResponse(): Response {
  return jsonResponse({
    status: { errors: [] },
    console: [],
    result: { version: "8.0.0" },
  });
}

// ── Harness (mirrors loc-governance.test.ts) ────────────────────────

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
    name: "@iris-mcp/dev",
    version: "0.0.0",
    tools: [locCountTool],
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

/** Stage the default profile's startup HEAD (health) + GET (version). */
function stageDefaultStartup(fetchMock: ReturnType<typeof vi.fn>): void {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
  fetchMock.mockResolvedValueOnce(versionResponse());
}

async function startServerWithLocTool(): Promise<unknown> {
  const server = new McpServerBase(makeServerOpts());
  await server.start("stdio");
  return server;
}

// ════════════════════════════════════════════════════════════════════
// Full-stack round trip: SDK callback → governance gate → real handler
// → real IrisHttpClient → fetch (live-captured envelope).
// ════════════════════════════════════════════════════════════════════

describe("iris_loc_count full-stack e2e (live-captured envelope contract)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("round-trips the live-captured success envelope: real wire URL, rendered summary, structuredContent verbatim", async () => {
    stageDefaultStartup(env.fetchMock);
    const server = await startServerWithLocTool();

    env.fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: { errors: [], summary: "" },
        console: [],
        result: LIVE_SUCCESS_RESULT,
      }),
    );

    const result = await callTool(server, "iris_loc_count", {
      spec: "ExecuteMCPv2.Loc.*.cls",
    });

    // The REAL context resolved the profile default namespace and the REAL
    // client issued the wire-explicit-default query (Rule #10) — asserted on
    // the fetch boundary, not a mocked ToolContext.
    expect(env.fetchMock).toHaveBeenCalledTimes(3);
    const toolCallUrl = env.fetchMock.mock.calls[2]?.[0] as string;
    expect(toolCallUrl.endsWith(
      "/api/executemcp/v2/dev/loc?namespace=DEFAULTNS&spec=ExecuteMCPv2.Loc.*.cls&includeGenerated=false&topN=20",
    )).toBe(true);

    // The live numbers flowed through the real envelope parse into the
    // rendered summary table…
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text as string;
    expect(text).toContain("| Files Parsed              |         3 |");
    expect(text).toContain("| Total Lines (Raw)         |       598 |");

    // …and structuredContent is the endpoint result object VERBATIM.
    expect(result.structuredContent).toEqual(LIVE_SUCCESS_RESULT);
    expect(Array.isArray(result.structuredContent)).toBe(false);
  });

  it("surfaces a live-captured server rejection (HTTP 200 + status.errors) as an isError envelope with the server's text", async () => {
    stageDefaultStartup(env.fetchMock);
    const server = await startServerWithLocTool();

    // The live endpoint reports failures as HTTP 200 + envelope errors; the
    // REAL IrisHttpClient must convert that into an IrisApiError which the
    // tool renders as an isError result carrying the server's error text.
    env.fetchMock.mockResolvedValueOnce(jsonResponse(LIVE_ERROR_ENVELOPE));

    const result = await callTool(server, "iris_loc_count", {
      spec: "*.cls",
      namespace: "ZZZNOSUCHNS",
    });

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text as string;
    expect(text).toContain("Error counting lines of code:");
    expect(text).toContain("SwitchNamespace");
  });

  it("surfaces a non-JSON response body as an isError envelope (client-side Rule #7 counterpart)", async () => {
    stageDefaultStartup(env.fetchMock);
    const server = await startServerWithLocTool();

    // The historical Epic 11 Bug #1 failure class: the endpoint replies with
    // something that is not the JSON envelope (e.g. an HTML error page).
    env.fetchMock.mockResolvedValueOnce(
      new Response("<html><body>Login required</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const result = await callTool(server, "iris_loc_count", {
      spec: "ExecuteMCPv2.Loc.*.cls",
    });

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text as string;
    expect(text).toContain("Error counting lines of code:");
    expect(text).toContain("non-JSON");
  });
});
