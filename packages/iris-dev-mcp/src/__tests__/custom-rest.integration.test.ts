/**
 * Integration tests for custom REST tools (global, execute, tests) against
 * a real IRIS instance with the ExecuteMCPv2 REST service deployed.
 *
 * These tests exercise the tools that call `/api/executemcp/v2/*` endpoints.
 * They are skipped when IRIS is not reachable OR when the custom REST
 * service is not available (e.g. web app not registered).
 *
 * Test globals use the prefix `ExecuteMCPv2Test` to avoid collisions.
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import {
  IrisHttpClient,
  loadConfig,
  negotiateVersion,
  buildToolContext,
  type ToolContext,
  type IrisConnectionConfig,
} from "@iris-mcp/shared";

import {
  globalGetTool,
  globalSetTool,
  globalKillTool,
  globalListTool,
} from "../tools/global.js";
import {
  executeCommandTool,
  executeClassMethodTool,
  executeTestsTool,
} from "../tools/execute.js";

// ── Globals set by integration-setup.ts ──────────────────────────────

declare global {
  var __IRIS_AVAILABLE__: boolean;
  var __CUSTOM_REST_AVAILABLE__: boolean;
}

const IRIS_OK = globalThis.__IRIS_AVAILABLE__;
const CUSTOM_REST_OK = globalThis.__CUSTOM_REST_AVAILABLE__ ?? false;

// ── Helpers ──────────────────────────────────────────────────────────

const TEST_GLOBAL = "ExecuteMCPv2TestInteg";

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

// ── Shared state ─────────────────────────────────────────────────────

let client: IrisHttpClient;
let ctx: ToolContext;

/** Kill the test global, ignoring errors if it does not exist. */
async function cleanupTestGlobal(): Promise<void> {
  try {
    await globalKillTool.handler({ global: TEST_GLOBAL }, ctx);
  } catch {
    // Ignore — global may not exist
  }
}

// ── Test suite ───────────────────────────────────────────────────────

describe.skipIf(!IRIS_OK || !CUSTOM_REST_OK)(
  "custom REST integration",
  () => {
    beforeAll(async () => {
      const config = getConfig();
      client = new IrisHttpClient(config);
      const version = await negotiateVersion(client);
      ctx = buildToolContext("NS", config, client, version);
    });

    afterEach(async () => {
      await cleanupTestGlobal();
    });

    afterAll(() => {
      client?.destroy();
    });

    // ── Global tools ──────────────────────────────────────────────

    describe("global tools", () => {
      it("set → get → verify value → kill → verify gone", async () => {
        // Set
        const setResult = await globalSetTool.handler(
          { global: TEST_GLOBAL, value: "integration-test-value" },
          ctx,
        );
        expect(setResult.isError).toBeUndefined();

        // Get
        const getResult = await globalGetTool.handler(
          { global: TEST_GLOBAL },
          ctx,
        );
        expect(getResult.isError).toBeUndefined();
        const getData = getResult.structuredContent as Record<string, unknown>;
        expect(getData.value).toBe("integration-test-value");
        expect(getData.defined).toBe(true);

        // Kill
        const killResult = await globalKillTool.handler(
          { global: TEST_GLOBAL },
          ctx,
        );
        expect(killResult.isError).toBeUndefined();

        // Verify gone
        const afterKill = await globalGetTool.handler(
          { global: TEST_GLOBAL },
          ctx,
        );
        const afterData = afterKill.structuredContent as Record<string, unknown>;
        expect(afterData.defined).toBe(false);
      });

      it("iris.global.list returns at least one global", async () => {
        const result = await globalListTool.handler({}, ctx);
        expect(result.isError).toBeUndefined();
        const data = result.structuredContent as Record<string, unknown>;
        // The list endpoint returns globals array or similar
        const text = result.content[0]?.text ?? "";
        expect(text.length).toBeGreaterThan(2); // not just "[]"
      });
    });

    // ── Execute tools ─────────────────────────────────────────────

    describe("execute tools", () => {
      it("iris.execute.command with Write captures output", async () => {
        const result = await executeCommandTool.handler(
          { command: 'Write "hello"' },
          ctx,
        );
        expect(result.isError).toBeUndefined();
        const text = result.content[0]?.text ?? "";
        expect(text).toContain("hello");
      });

      it("iris.execute.classmethod calls %SYSTEM.Version:GetVersion", async () => {
        const result = await executeClassMethodTool.handler(
          {
            className: "%SYSTEM.Version",
            methodName: "GetVersion",
          },
          ctx,
        );
        expect(result.isError).toBeUndefined();
        const text = result.content[0]?.text ?? "";
        // IRIS version string contains "IRIS" or a version number pattern
        expect(text).toMatch(/IRIS|20\d{2}\.\d/i);
      });
    });

    // ── Test execution tool ───────────────────────────────────────

    describe("test execution tool", () => {
      it("iris.execute.tests runs ExecuteMCPv2.Tests.UtilsTest with structured results", async () => {
        const result = await executeTestsTool.handler(
          {
            target: "ExecuteMCPv2.Tests.UtilsTest",
            level: "class",
          },
          ctx,
        );
        expect(result.isError).toBeUndefined();
        const data = result.structuredContent as Record<string, unknown>;
        // The test runner returns summary counts
        const text = result.content[0]?.text ?? "";
        expect(text.length).toBeGreaterThan(5);
        // Verify the result includes passed count > 0 (structured or in text)
        if (typeof data.passed === "number") {
          expect(data.passed).toBeGreaterThan(0);
        } else {
          // Accept as long as the response includes recognizable test output
          expect(text).toMatch(/pass|success|total/i);
        }
      });
    });
  },
);
