/**
 * Integration tests for iris-data-mcp tools against a real IRIS instance.
 *
 * These tests exercise DocDB lifecycle, analytics, and REST management
 * tools end-to-end. They are skipped automatically when the required
 * IRIS APIs are not reachable (see integration-setup.ts).
 *
 * DocDB lifecycle: create database -> create property -> create index ->
 *   insert document -> get document -> update document -> find with filter ->
 *   delete document -> drop database.
 *
 * Analytics: list cubes (may be empty), MDX error handling.
 * REST management: list REST applications.
 */

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import {
  IrisHttpClient,
  loadConfig,
  negotiateVersion,
  buildToolContext,
  type ToolContext,
  type IrisConnectionConfig,
} from "@iris-mcp/shared";

import {
  docdbManageTool,
  docdbDocumentTool,
  docdbFindTool,
  docdbPropertyTool,
} from "../tools/docdb.js";
import { analyticsCubesTool, analyticsMdxTool } from "../tools/analytics.js";
import { restManageTool } from "../tools/rest.js";

// ── Globals set by integration-setup.ts ──────────────────────────────

declare global {
  var __IRIS_AVAILABLE__: boolean;
  var __ATELIER_VERSION__: number;
  var __CUSTOM_REST_AVAILABLE__: boolean;
  var __DOCDB_AVAILABLE__: boolean;
}

const IRIS_OK = globalThis.__IRIS_AVAILABLE__;
const REST_OK = globalThis.__CUSTOM_REST_AVAILABLE__;
const DOCDB_OK = globalThis.__DOCDB_AVAILABLE__;

// ── Test constants ────────────────────────────────────────────────────

const TEST_DB = "MCPDataTest_DocDB";

// ── Shared state ──────────────────────────────────────────────────────

let client: IrisHttpClient;
let config: IrisConnectionConfig;
let ctx: ToolContext;

/** Track the inserted document ID for cleanup. */
let insertedDocId: string | undefined;

// ── Helpers ──────────────────────────────────────────────────────────

function getConfig(): IrisConnectionConfig {
  return loadConfig({
    IRIS_HOST: process.env.IRIS_HOST ?? "localhost",
    IRIS_PORT: process.env.IRIS_PORT ?? "52773",
    IRIS_USERNAME: process.env.IRIS_USERNAME ?? "_SYSTEM",
    IRIS_PASSWORD: process.env.IRIS_PASSWORD ?? "SYS",
    IRIS_NAMESPACE: process.env.IRIS_NAMESPACE ?? "HSCUSTOM",
    IRIS_HTTPS: process.env.IRIS_HTTPS ?? "false",
  });
}

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

// ══════════════════════════════════════════════════════════════════════
// DocDB Lifecycle Tests
// ══════════════════════════════════════════════════════════════════════

describe.skipIf(!IRIS_OK || !DOCDB_OK)("DocDB lifecycle integration", () => {
  beforeAll(async () => {
    config = getConfig();
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

  it("creates an index on the property", async () => {
    const result = await docdbPropertyTool.handler(
      { action: "index", database: TEST_DB, property: "category" },
      ctx,
    );

    expect(result.content[0]?.text).toBeDefined();
    expect(result.isError).toBeFalsy();
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
      // DocDB typically returns the ID in various fields
      insertedDocId = String(
        structured._id ?? structured.id ?? structured.ID ?? "",
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
    if (!insertedDocId) return;

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
    if (!insertedDocId) return;

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
    const result = await docdbFindTool.handler(
      {
        database: TEST_DB,
        filter: { category: { $eq: "test" } },
      },
      ctx,
    );

    expect(result.content[0]?.text).toBeDefined();
    expect(result.isError).toBeFalsy();
  });

  // ── 8. Delete document by ID ───────────────────────────────────

  it("deletes the document by ID", async () => {
    if (!insertedDocId) return;

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
  });
});

// ══════════════════════════════════════════════════════════════════════
// Analytics Tests
// ══════════════════════════════════════════════════════════════════════

describe.skipIf(!IRIS_OK || !REST_OK)("Analytics integration", () => {
  beforeAll(async () => {
    config = getConfig();
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

    // Should return an error response (not throw) since the cube doesn't exist
    expect(result.content[0]?.text).toBeDefined();
    // The response is expected to be an error (isError: true) or contain
    // an error message in the text, since the cube doesn't exist
    const text = result.content[0]?.text ?? "";
    const isErrorResponse = result.isError === true || text.toLowerCase().includes("error");
    expect(isErrorResponse).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// REST Management Tests
// ══════════════════════════════════════════════════════════════════════

describe.skipIf(!IRIS_OK)("REST management integration", () => {
  beforeAll(async () => {
    config = getConfig();
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
