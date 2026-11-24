/**
 * Integration tests for iris-data-mcp tools against a real IRIS instance.
 *
 * These tests exercise DocDB lifecycle, analytics, and REST management
 * tools end-to-end. They run only when armed (`IRIS_REQUIRE_LIVE` plus the
 * five `IRIS_*` target variables) and the required IRIS APIs are reachable,
 * and skip otherwise (see integration-setup.ts).
 *
 * DocDB lifecycle: create database -> create property -> create index ->
 *   insert document -> get document -> update document -> find with filter ->
 *   delete document -> drop database.
 *   CI runs this lifecycle (Story 44.5, DW-726): the throwaway job enables
 *   %Service_DocDB after the Epic 35 F5 gate and before this suite, and the
 *   suite allowlists no skip, so a skipped lifecycle test fails it. A step
 *   that fails leaves the next one asserting its precondition, so the chain
 *   fails loudly instead of returning early.
 *
 * Analytics: list cubes (may be empty), MDX error handling.
 * REST management: list REST applications.
 */

import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import {
  IrisHttpClient,
  negotiateVersion,
  buildToolContext,
  type ToolContext,
  type IrisConnectionConfig,
} from "@iris-mcp/shared";
import { getIntegrationConfig } from "@iris-mcp/shared/test-helpers/integration-config";

import {
  docdbManageTool,
  docdbDocumentTool,
  docdbFindTool,
  docdbPropertyTool,
} from "../tools/docdb.js";
import { analyticsCubesTool, analyticsMdxTool } from "../tools/analytics.js";
import { restManageTool } from "../tools/rest.js";

// ── Globals set by integration-setup.ts ──────────────────────────────

const IRIS_OK = globalThis.__IRIS_AVAILABLE__;
const REST_OK = globalThis.__CUSTOM_REST_AVAILABLE__;
const DOCDB_OK = globalThis.__DOCDB_AVAILABLE__;

// ── Test constants ────────────────────────────────────────────────────

const TEST_DB = "MCPDataTestDocDB";

// ── Shared state ──────────────────────────────────────────────────────

let client: IrisHttpClient;
let config: IrisConnectionConfig;
let ctx: ToolContext;

/** Track the inserted document ID for cleanup. */
let insertedDocId: string | undefined;

// ── Helpers ──────────────────────────────────────────────────────────

/** Safely attempt a tool call, ignoring errors. */
async function safeCall(
  tool: { handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown> },
  args: Record<string, unknown>,
  toolCtx: ToolContext,
): Promise<void> {
  try {
    await tool.handler(args, toolCtx);
  } catch {
    // Ignore — resource may not exist
  }
}

/**
 * The live `GET /security/docdb` answer for `name` in the test namespace:
 * `{exists, registered, ...}` (Story 44.1).
 */
async function recordState(name: string): Promise<Record<string, unknown>> {
  const response = await client.get(
    `/api/executemcp/v2/security/docdb?name=${encodeURIComponent(name)}` +
      `&namespace=${encodeURIComponent(ctx.resolveNamespace(undefined))}`,
  );
  return (response as { result: Record<string, unknown> }).result;
}

// ══════════════════════════════════════════════════════════════════════
// DocDB Lifecycle Tests
// ══════════════════════════════════════════════════════════════════════

describe.skipIf(!IRIS_OK || !DOCDB_OK)("DocDB lifecycle integration", () => {
  beforeAll(async () => {
    config = getIntegrationConfig();
    client = new IrisHttpClient(config);
    const version = await negotiateVersion(client);
    ctx = buildToolContext("NS", config, client, version);

    // Pre-cleanup: drop test database in case a previous run left it behind
    await safeCall(docdbManageTool, { action: "drop", database: TEST_DB }, ctx);
  });

  afterAll(async () => {
    // Safety-net cleanup: delete document, then drop database
    if (insertedDocId) {
      await safeCall(
        docdbDocumentTool,
        { action: "delete", database: TEST_DB, id: insertedDocId },
        ctx,
      );
    }
    await safeCall(docdbManageTool, { action: "drop", database: TEST_DB }, ctx);
    client?.destroy();
  });

  // ── 1. Create test database ────────────────────────────────────

  it("creates a test database", async () => {
    const result = await docdbManageTool.handler(
      { action: "create", database: TEST_DB },
      ctx,
    );

    expect(result.content[0]?.text).toBeDefined();
    expect(result.isError).toBeFalsy();

    // Story 44.1: create registers the Security.DocDBs record that IRIS
    // requires for every other call on the database (live GET, not the
    // tool's own claim).
    expect((result.structuredContent as Record<string, unknown>).registered).toBe(true);
    expect(await recordState(TEST_DB)).toMatchObject({ exists: true, registered: true });
  });

  // ── 2. Create a property ───────────────────────────────────────

  it("creates a property on the test database", async () => {
    const result = await docdbPropertyTool.handler(
      { action: "create", database: TEST_DB, property: "category", type: "%String" },
      ctx,
    );

    expect(result.content[0]?.text).toBeDefined();
    expect(result.isError).toBeFalsy();
  });

  // ── 3. Create an index on the property ─────────────────────────

  it("reports the created property as indexed and writes nothing", async () => {
    // Story 44.7 (DW-723): DocDB indexes every property when it creates it and has no
    // index-only route, so 'index' on an existing property reads it (it used to POST
    // and answer #5805). The reply says so, and the tool sends no POST.
    const posts = vi.spyOn(client, "post");
    try {
      const result = await docdbPropertyTool.handler(
        { action: "index", database: TEST_DB, property: "category" },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      expect(result.structuredContent, result.content[0]?.text).toMatchObject({ indexed: true, created: false });
      expect(posts).not.toHaveBeenCalled();
    } finally {
      posts.mockRestore();
    }
  });

  it("creates a property that does not exist yet when it is indexed", async () => {
    // Story 44.7 (DW-723): a missing property is created (and so indexed) at the default path.
    const result = await docdbPropertyTool.handler(
      { action: "index", database: TEST_DB, property: "label" },
      ctx,
    );

    expect(result.isError, result.content[0]?.text).toBeFalsy();
    expect(result.structuredContent, result.content[0]?.text).toMatchObject({ indexed: true, created: true });

    // Read it back from DocDB itself, not from the tool's own claim.
    const readBack = (await client.get(
      `/api/docdb/v1/${encodeURIComponent(ctx.resolveNamespace(undefined))}/prop/${encodeURIComponent(TEST_DB)}/label`,
    )) as { content?: { Name?: string } };
    expect(readBack.content?.Name).toBe("label");
  });

  // ── 4. Insert a document ───────────────────────────────────────

  it("inserts a test document", async () => {
    const result = await docdbDocumentTool.handler(
      {
        action: "insert",
        database: TEST_DB,
        document: { category: "test", value: 42, label: "integration" },
      },
      ctx,
    );

    expect(result.content[0]?.text).toBeDefined();
    expect(result.isError).toBeFalsy();

    // Extract document ID from response
    const structured = result.structuredContent as Record<string, unknown> | undefined;
    if (structured) {
      // The insert answer is {"content":{"_documentID":"1","content":{...}}}
      // (captured live, IRIS 2026.2).
      const inner = structured.content as Record<string, unknown> | undefined;
      insertedDocId = String(
        inner?._documentID ?? structured._documentID ?? structured._id ?? structured.id ?? structured.ID ?? "",
      );
    }
    // Fallback: try parsing from text
    if (!insertedDocId) {
      const text = result.content[0]?.text ?? "";
      const idMatch = text.match(/(?:_id|"id"|ID)[:\s]*"?(\d+)"?/);
      if (idMatch) {
        insertedDocId = idMatch[1];
      }
    }
    expect(insertedDocId).toBeTruthy();
  });

  // ── 5. Get document by ID ──────────────────────────────────────

  it("gets the document by ID and verifies content", async () => {
    expect(insertedDocId, "the insert test must have returned the document id").toBeTruthy();

    const result = await docdbDocumentTool.handler(
      { action: "get", database: TEST_DB, id: insertedDocId },
      ctx,
    );

    expect(result.content[0]?.text).toBeDefined();
    expect(result.isError).toBeFalsy();

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("test");
    expect(text).toContain("42");
  });

  // ── 6. Update document ─────────────────────────────────────────

  it("updates the document and verifies changes", async () => {
    expect(insertedDocId, "the insert test must have returned the document id").toBeTruthy();

    const result = await docdbDocumentTool.handler(
      {
        action: "update",
        database: TEST_DB,
        id: insertedDocId,
        document: { category: "test", value: 99, label: "updated" },
      },
      ctx,
    );

    expect(result.content[0]?.text).toBeDefined();
    expect(result.isError).toBeFalsy();

    // Verify the update by getting the document again
    const getResult = await docdbDocumentTool.handler(
      { action: "get", database: TEST_DB, id: insertedDocId },
      ctx,
    );

    const text = getResult.content[0]?.text ?? "";
    expect(text).toContain("99");
    expect(text).toContain("updated");
  });

  // ── 7. Find documents with filter ──────────────────────────────

  it("finds documents with filter", async () => {
    expect(insertedDocId, "the insert test must have returned the document id").toBeTruthy();

    const result = await docdbFindTool.handler(
      {
        database: TEST_DB,
        filter: { category: { $eq: "test" } },
      },
      ctx,
    );

    expect(result.isError, result.content[0]?.text).toBeFalsy();
    // Story 44.7 (DW-724): the property was created with no path, and a property with
    // no path is never filled in, so this find matched nothing. The create now defaults
    // to `$.category`, so the inserted document is returned. The answer is
    // {"content":{"sqlcode":100,"content":[{"%Doc":...,"%DocumentId":"2"}]}} (captured live).
    const answer = result.structuredContent as { content?: { content?: Array<Record<string, unknown>> } };
    const rows = answer?.content?.content ?? [];
    expect(
      rows.map((row) => String(row["%DocumentId"])),
      result.content[0]?.text,
    ).toContain(String(insertedDocId));
  });

  // ── 8. Delete document by ID ───────────────────────────────────

  it("deletes the document by ID", async () => {
    expect(insertedDocId, "the insert test must have returned the document id").toBeTruthy();

    const result = await docdbDocumentTool.handler(
      { action: "delete", database: TEST_DB, id: insertedDocId },
      ctx,
    );

    expect(result.content[0]?.text).toBeDefined();
    expect(result.isError).toBeFalsy();

    // Mark as cleaned up so afterAll doesn't try again
    insertedDocId = undefined;
  });

  // ── 9. Drop test database ─────────────────────────────────────

  it("drops the test database", async () => {
    const result = await docdbManageTool.handler(
      { action: "drop", database: TEST_DB },
      ctx,
    );

    expect(result.content[0]?.text).toBeDefined();
    expect(result.isError).toBeFalsy();

    // Dropping the database removes its record too: none is left behind.
    expect(await recordState(TEST_DB)).toMatchObject({ exists: false, registered: false });
  });
});

// ══════════════════════════════════════════════════════════════════════
// Analytics Tests
// ══════════════════════════════════════════════════════════════════════

describe.skipIf(!IRIS_OK || !REST_OK)("Analytics integration", () => {
  beforeAll(async () => {
    config = getIntegrationConfig();
    client = new IrisHttpClient(config);
    const version = await negotiateVersion(client);
    ctx = buildToolContext("NS", config, client, version);
  });

  afterAll(async () => {
    client?.destroy();
  });

  // ── 1. List cubes (may return empty array) ─────────────────────

  it("lists cubes (may return empty array)", async () => {
    const result = await analyticsCubesTool.handler(
      { action: "list" },
      ctx,
    );

    expect(result.content[0]?.text).toBeDefined();
    expect(result.isError).toBeFalsy();
  });

  // ── 2. Execute MDX on nonexistent cube — verify error handling ─

  it("handles MDX query on nonexistent cube gracefully", async () => {
    const result = await analyticsMdxTool.handler(
      { query: "SELECT FROM [NonexistentCube]" },
      ctx,
    );

    // Should return an error response (not throw) since the cube doesn't exist.
    // The response is expected to be an error (isError: true) or contain
    // an error message in the text, since the cube doesn't exist.
    // (Story 44.7, DW-758: the bare `toBeDefined()` on the text was dropped; the
    // outcome assertion below is the real one.)
    const text = result.content[0]?.text ?? "";
    const isErrorResponse = result.isError === true || text.toLowerCase().includes("error");
    expect(isErrorResponse, text).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// REST Management Tests
// ══════════════════════════════════════════════════════════════════════

describe.skipIf(!IRIS_OK)("REST management integration", () => {
  beforeAll(async () => {
    config = getIntegrationConfig();
    client = new IrisHttpClient(config);
    const version = await negotiateVersion(client);
    ctx = buildToolContext("NS", config, client, version);
  });

  afterAll(async () => {
    client?.destroy();
  });

  // ── 1. List REST applications ──────────────────────────────────

  it("lists REST applications in namespace", async () => {
    const result = await restManageTool.handler(
      { action: "list" },
      ctx,
    );

    expect(result.content[0]?.text).toBeDefined();
    expect(result.isError).toBeFalsy();
  });
});
