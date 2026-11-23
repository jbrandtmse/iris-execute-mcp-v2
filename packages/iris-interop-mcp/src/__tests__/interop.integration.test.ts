/**
 * Integration tests for iris-interop-mcp tools against a real IRIS instance.
 *
 * These tests exercise every interoperability tool end-to-end via the custom
 * ExecuteMCPv2 REST service. They run only when armed (`IRIS_REQUIRE_LIVE`
 * plus the five `IRIS_*` target variables) and IRIS is reachable, and skip
 * otherwise (see integration-setup.ts).
 *
 * Resources are created in dependency order and cleaned up in reverse
 * dependency order to avoid conflicts. All test resources use the
 * "MCPInteropTest" prefix for easy identification.
 *
 * NOTE: Interop tools operate in the TARGET namespace, not %SYS.
 * Production lifecycle has strict ordering: create -> start -> test -> stop -> delete.
 */

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import {
  IrisHttpClient,
  negotiateVersion,
  buildToolContext,
  type ToolContext,
  type IrisConnectionConfig,
} from "@iris-mcp/shared";
import { getIntegrationConfig } from "@iris-mcp/shared/test-helpers/integration-config";

import {
  productionManageTool,
  productionControlTool,
  productionStatusTool,
  productionSummaryTool,
} from "../tools/production.js";
import {
  productionItemTool,
  productionAutostartTool,
} from "../tools/item.js";
import {
  productionLogsTool,
  productionQueuesTool,
  productionMessagesTool,
  productionAdaptersTool,
} from "../tools/monitor.js";
import {
  credentialManageTool,
  credentialListTool,
} from "../tools/credential.js";
import {
  lookupManageTool,
  lookupTransferTool,
} from "../tools/lookup.js";
import {
  ruleListTool,
} from "../tools/rule.js";
import {
  transformListTool,
} from "../tools/transform.js";

// ── Globals set by integration-setup.ts ──────────────────────────────

const IRIS_OK = globalThis.__IRIS_AVAILABLE__;
const REST_OK = globalThis.__CUSTOM_REST_AVAILABLE__;

// ── Test constants ────────────────────────────────────────────────────

const TEST_PRODUCTION = "MCPInteropTest.TestProduction";
const TEST_CREDENTIAL = "MCPInteropTestCred";
const TEST_LOOKUP_TABLE = "MCPInteropTestTable";
const TEST_LOOKUP_KEY = "testKey";
const TEST_LOOKUP_VALUE = "testValue";

// ── Shared state ──────────────────────────────────────────────────────

let client: IrisHttpClient;
let config: IrisConnectionConfig;
let ctx: ToolContext;

/**
 * Track what was successfully created (isError was NOT set on the response).
 * A later test asserts its flag (Story 44.5): it never returns early without it.
 */
const created = {
  production: false,
  productionStarted: false,
  credential: false,
  lookupEntry: false,
};

/**
 * Track what was attempted (regardless of success) for cleanup.
 */
const attempted = {
  production: false,
  productionStarted: false,
  credential: false,
  lookupEntry: false,
};

// ── Setup / Teardown ─────────────────────────────────────────────────

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

describe.skipIf(!IRIS_OK || !REST_OK)("iris-interop-mcp integration", () => {
  beforeAll(async () => {
    config = getIntegrationConfig();
    client = new IrisHttpClient(config);
    const version = await negotiateVersion(client);
    ctx = buildToolContext("NS", config, client, version);
  });

  afterAll(async () => {
    // Cleanup in reverse dependency order:
    // 1. Delete lookup entries
    if (attempted.lookupEntry) {
      await safeCall(
        lookupManageTool,
        { action: "delete", tableName: TEST_LOOKUP_TABLE, key: TEST_LOOKUP_KEY },
        ctx,
      );
    }

    // 2. Delete credentials
    if (attempted.credential) {
      await safeCall(
        credentialManageTool,
        { action: "delete", id: TEST_CREDENTIAL },
        ctx,
      );
    }

    // 3. Stop production
    if (attempted.productionStarted) {
      await safeCall(
        productionControlTool,
        { action: "stop", timeout: 30, force: true },
        ctx,
      );
    }

    // 4. Delete production
    if (attempted.production) {
      await safeCall(
        productionManageTool,
        { action: "delete", name: TEST_PRODUCTION },
        ctx,
      );
    }

    client?.destroy();
  });

  // ── 1. Production create & verify status (AC1) ──────────────────

  describe("production lifecycle", () => {
    it("creates a test production", async () => {
      attempted.production = true;
      const result = await productionManageTool.handler(
        { action: "create", name: TEST_PRODUCTION },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      created.production = true;
    });

    it("verifies production status after creation", async () => {
      const result = await productionStatusTool.handler({}, ctx);

      // Story 44.7 (DW-758): the probed reply on the CI image is
      // `{name:"",state:"Stopped",stateCode:2}`. Which production is "current"
      // depends on IRIS state, so assert the shape, not the name.
      expect(result.isError, result.content[0]?.text).toBeFalsy();
      const status = result.structuredContent as { state?: unknown };
      expect(typeof status?.state, result.content[0]?.text).toBe("string");
    });

    it("gets production summary across namespaces", async () => {
      const result = await productionSummaryTool.handler({}, ctx);

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      const structured = result.structuredContent as {
        productions: unknown[];
        count: number;
      };
      expect(structured.count).toBeGreaterThanOrEqual(0);
    });
  });

  // ── 2. Production start & verify running (AC2) ──────────────────

  describe("production control", () => {
    it("starts the test production", async () => {
      expect(created.production, "the create test must have created the production").toBe(true);

      attempted.productionStarted = true;
      const result = await productionControlTool.handler(
        { action: "start", name: TEST_PRODUCTION },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      created.productionStarted = true;
    });

    it("verifies production is running via status", async () => {
      expect(created.productionStarted, "the start test must have started the production").toBe(true);

      const result = await productionStatusTool.handler(
        { detail: true },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      const text = result.content[0]?.text ?? "";
      // Production should show a state
      expect(text.length).toBeGreaterThan(0);
    });
  });

  // ── 3. Config items (AC3) ────────────────────────────────────────

  describe("production item management", () => {
    it("reports a config item that the empty production does not have", async () => {
      expect(created.productionStarted, "the start test must have started the production").toBe(true);

      // Story 44.7 (DW-758, Rule #56): the test production has no items, so the
      // documented outcome is an error that names the item
      // ("ERROR #5001: Config item 'NonExistentItem' not found").
      const result = await productionItemTool.handler(
        { action: "get", itemName: "NonExistentItem" },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBe(true);
      expect(result.content[0]?.text ?? "").toContain("NonExistentItem");
    });
  });

  // ── 4. Auto-start (AC4) ─────────────────────────────────────────

  describe("production auto-start", () => {
    it("gets current auto-start setting", async () => {
      const result = await productionAutostartTool.handler(
        { action: "get" },
        ctx,
      );

      // Story 44.7 (DW-758): the probed reply is `{action:"get",autoStart:"",enabled:false}`.
      expect(result.isError, result.content[0]?.text).toBeFalsy();
      const current = result.structuredContent as { autoStart?: unknown; enabled?: unknown };
      expect(typeof current?.autoStart, result.content[0]?.text).toBe("string");
      expect(typeof current?.enabled, result.content[0]?.text).toBe("boolean");
    });

    it("sets auto-start to the test production and restores the original value", async () => {
      expect(created.production, "the create test must have created the production").toBe(true);

      // Story 44.7 (DW-758): read the original, set the test production, check
      // the change, then restore the original and check the restore. The
      // restore runs even when an assertion above it fails.
      const readAutoStart = async (): Promise<{ autoStart: string; enabled: boolean }> => {
        const got = await productionAutostartTool.handler({ action: "get" }, ctx);
        expect(got.isError, got.content[0]?.text).toBeFalsy();
        const body = got.structuredContent as { autoStart: string; enabled: boolean };
        expect(typeof body?.autoStart, got.content[0]?.text).toBe("string");
        return body;
      };

      const original = await readAutoStart();
      try {
        const setResult = await productionAutostartTool.handler(
          { action: "set", productionName: TEST_PRODUCTION },
          ctx,
        );
        expect(setResult.isError, setResult.content[0]?.text).toBeFalsy();
        expect(setResult.structuredContent, setResult.content[0]?.text).toMatchObject({
          autoStart: TEST_PRODUCTION,
          enabled: true,
        });

        const afterSet = await readAutoStart();
        expect(afterSet).toMatchObject({ autoStart: TEST_PRODUCTION, enabled: true });
      } finally {
        const restoreResult = await productionAutostartTool.handler(
          { action: "set", productionName: original.autoStart },
          ctx,
        );
        expect(restoreResult.isError, restoreResult.content[0]?.text).toBeFalsy();
      }

      const afterRestore = await readAutoStart();
      expect(afterRestore.autoStart).toBe(original.autoStart);
      expect(afterRestore.enabled).toBe(original.enabled);
    });
  });

  // ── 5. Event logs (AC5) ─────────────────────────────────────────

  describe("production logs", () => {
    it("queries event logs", async () => {
      const result = await productionLogsTool.handler(
        { count: 10 },
        ctx,
      );

      // Story 44.7 (DW-758): the probed reply is `{entries:[{type:4,…}]}`. The
      // list may be empty when no logs exist yet; the field must still be an array.
      expect(result.isError, result.content[0]?.text).toBeFalsy();
      const logs = result.structuredContent as { entries?: unknown };
      expect(Array.isArray(logs?.entries), result.content[0]?.text).toBe(true);
    });

    it("queries event logs filtered by type", async () => {
      const result = await productionLogsTool.handler(
        { type: "Info", count: 5 },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      const logs = result.structuredContent as { entries?: Array<{ type: number }> };
      expect(Array.isArray(logs?.entries), result.content[0]?.text).toBe(true);
      // The "Info" display name maps to its stored number, 4 (DW-585).
      for (const entry of logs.entries ?? []) {
        expect(entry.type).toBe(4);
      }
    });
  });

  // ── 6. Queue status (AC6) ───────────────────────────────────────

  describe("production queues", () => {
    it("queries queue status", async () => {
      const result = await productionQueuesTool.handler({}, ctx);

      // Story 44.7 (DW-758): the probed reply is `{queues:[…],count:3}`.
      expect(result.isError, result.content[0]?.text).toBeFalsy();
      const queues = result.structuredContent as { queues?: unknown[]; count?: number };
      expect(Array.isArray(queues?.queues), result.content[0]?.text).toBe(true);
      expect(queues.count).toBe(queues.queues?.length);
    });
  });

  // ── 7. Adapters (AC7) ──────────────────────────────────────────

  describe("production adapters", () => {
    it("lists available adapters", async () => {
      const result = await productionAdaptersTool.handler({}, ctx);

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      // Adapters should return some built-in adapters
      const text = result.content[0]?.text ?? "";
      expect(text.length).toBeGreaterThan(2); // at least "[]" or more
    });
  });

  // ── 8. Credentials (AC8) ────────────────────────────────────────

  describe("credential management", () => {
    it("creates a test credential", async () => {
      attempted.credential = true;
      const result = await credentialManageTool.handler(
        {
          action: "create",
          id: TEST_CREDENTIAL,
          username: "testuser",
          password: "testpass123",
        },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      created.credential = true;
    });

    it("verifies credential in credential list (no passwords)", async () => {
      expect(created.credential, "the create test must have created the credential").toBe(true);
      const result = await credentialListTool.handler({}, ctx);

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      const text = result.content[0]?.text ?? "";
      expect(text).toContain(TEST_CREDENTIAL);
      // Passwords must never be exposed
      expect(text).not.toContain("testpass123");
    });
  });

  // ── 9. Lookup tables (AC9) ──────────────────────────────────────

  describe("lookup table management", () => {
    it("sets a lookup table entry", async () => {
      attempted.lookupEntry = true;
      const result = await lookupManageTool.handler(
        {
          action: "set",
          tableName: TEST_LOOKUP_TABLE,
          key: TEST_LOOKUP_KEY,
          value: TEST_LOOKUP_VALUE,
        },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      created.lookupEntry = true;
    });

    it("gets the lookup table entry to verify", async () => {
      expect(created.lookupEntry, "the set test must have created the lookup entry").toBe(true);

      const result = await lookupManageTool.handler(
        {
          action: "get",
          tableName: TEST_LOOKUP_TABLE,
          key: TEST_LOOKUP_KEY,
        },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      const text = result.content[0]?.text ?? "";
      expect(text).toContain(TEST_LOOKUP_VALUE);
    });
  });

  // ── 10. Lookup transfer (AC10) ──────────────────────────────────

  describe("lookup table transfer", () => {
    it("exports a lookup table as XML", async () => {
      expect(created.lookupEntry, "the set test must have created the lookup entry").toBe(true);

      const result = await lookupTransferTool.handler(
        {
          action: "export",
          tableName: TEST_LOOKUP_TABLE,
        },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      // XML export should contain the table name
      const text = result.content[0]?.text ?? "";
      expect(text.length).toBeGreaterThan(0);
    });

    it("re-imports the lookup table", async () => {
      expect(created.lookupEntry, "the set test must have created the lookup entry").toBe(true);

      // Simple import test: re-import the same table
      // The import tool requires XML content; we export first then import
      const exportResult = await lookupTransferTool.handler(
        {
          action: "export",
          tableName: TEST_LOOKUP_TABLE,
        },
        ctx,
      );

      expect(exportResult.isError, exportResult.content[0]?.text).toBeFalsy();

      // Extract XML from export result
      const structured = exportResult.structuredContent as { xml?: string; content?: string };
      const xml = structured?.xml ?? structured?.content ?? exportResult.content[0]?.text ?? "";

      expect(xml, "the export must return the table's XML").toBeTruthy();

      const importResult = await lookupTransferTool.handler(
        {
          action: "import",
          tableName: TEST_LOOKUP_TABLE,
          xml,
        },
        ctx,
      );

      expect(importResult.isError, importResult.content[0]?.text).toBeFalsy();
      // An import of XML that holds no entry also succeeds (with 0), so the count is what shows the table's entry came back in.
      const imported = importResult.structuredContent as { entryCount?: number };
      expect(imported?.entryCount, importResult.content[0]?.text).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 11. Rules and transforms (AC11) ─────────────────────────────

  describe("rules and transforms", () => {
    it("lists business rules (may be empty in test namespace)", async () => {
      const result = await ruleListTool.handler({}, ctx);

      // Story 44.7 (DW-758): the probed reply is `{rules:[],count:0,total:0}`. An
      // empty list is valid for the test namespace; the field must be an array.
      expect(result.isError, result.content[0]?.text).toBeFalsy();
      const rules = result.structuredContent as { rules?: unknown };
      expect(Array.isArray(rules?.rules), result.content[0]?.text).toBe(true);
    });

    it("lists data transformations (may be empty in test namespace)", async () => {
      const result = await transformListTool.handler({}, ctx);

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      const transforms = result.structuredContent as { transforms?: unknown };
      expect(Array.isArray(transforms?.transforms), result.content[0]?.text).toBe(true);
    });
  });

  // ── 12. Production messages (additional coverage) ────────────────

  describe("production messages", () => {
    it("traces messages (may return empty for test production)", async () => {
      const result = await productionMessagesTool.handler(
        { sessionId: "1" },
        ctx,
      );

      // Story 44.7 (DW-758): the probed reply is `{messages:[{sessionId:1,…}],count:1}`.
      // A namespace with no traffic answers an empty list, so every returned
      // message is checked against the session asked for.
      expect(result.isError, result.content[0]?.text).toBeFalsy();
      const trace = result.structuredContent as { messages?: Array<{ sessionId: number }> };
      expect(Array.isArray(trace?.messages), result.content[0]?.text).toBe(true);
      for (const message of trace.messages ?? []) {
        expect(message.sessionId).toBe(1);
      }
    });
  });
});
