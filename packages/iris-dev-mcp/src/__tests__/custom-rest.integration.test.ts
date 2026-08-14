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

      it("iris_global_list returns at least one global", async () => {
        const result = await globalListTool.handler({}, ctx);
        expect(result.isError).toBeUndefined();
        // The list endpoint returns a globals array or similar
        const text = result.content[0]?.text ?? "";
        expect(text.length).toBeGreaterThan(2); // not just "[]"
      });
    });

    // ── Execute tools ─────────────────────────────────────────────

    describe("execute tools", () => {
      it("iris_execute_command with Write captures output", async () => {
        const result = await executeCommandTool.handler(
          { command: 'Write "hello"' },
          ctx,
        );
        expect(result.isError).toBeUndefined();
        const text = result.content[0]?.text ?? "";
        expect(text).toContain("hello");
      });

      it("iris_execute_classmethod calls %SYSTEM.Version:GetVersion", async () => {
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

      // ── Story 34.3: endpoint-level regression for ClassMethod()'s own response
      // shape (closes ledger item 34-2-R9 — the prior 48+ %UnitTest methods all
      // drove Utils.InvokeWithArgs directly, never the real REST handler's own
      // redirect setup/teardown and envelope assembly over real HTTP). ─────────

      const FIXTURE = "ExecuteMCPv2.Tests.ClassMethodArgsFixture";

      it("Rule #19 back-compat pin: a plain-scalar call's returnValue/argCount over real HTTP are unchanged by the additive fields", async () => {
        const result = await executeClassMethodTool.handler(
          {
            className: "%SYSTEM.Encryption",
            methodName: "Base64Encode",
            args: ["hello"],
          },
          ctx,
        );
        expect(result.isError).toBeUndefined();
        const structured = result.structuredContent as {
          returnValue: string;
          argCount: number;
          output: string;
          byRefValues: Record<string, unknown>;
          truncated: boolean;
        };
        // Pre-Story-34.2 shape, byte-identical semantics.
        expect(structured.returnValue).toBe(Buffer.from("hello").toString("base64"));
        expect(structured.argCount).toBe(1);
        // Additive-only: present, but empty/false for a plain-scalar call.
        expect(structured.output).toBe("");
        expect(structured.byRefValues).toEqual({});
        expect(structured.truncated).toBe(false);
      });

      it("a Write-per-item narrating target returns captured output with no wrapper class (bug repro 1 shape)", async () => {
        const result = await executeClassMethodTool.handler(
          { className: FIXTURE, methodName: "TargetWriteTwoLines" },
          ctx,
        );
        expect(result.isError).toBeUndefined();
        const structured = result.structuredContent as { returnValue: string; output: string };
        expect(structured.returnValue).toBe("wrote");
        expect(structured.output).toBe("line1\nline2");
      });

      it("an Output-param method returns its post-call value via byRefValues (AC 34.3.4b)", async () => {
        const result = await executeClassMethodTool.handler(
          {
            className: FIXTURE,
            methodName: "TargetOutput",
            args: [{ byRef: true }],
          },
          ctx,
        );
        expect(result.isError).toBeUndefined();
        const structured = result.structuredContent as {
          byRefValues: Record<string, unknown>;
        };
        // wasUndef=1 confirms the Output parameter arrived genuinely undefined-in.
        expect(structured.byRefValues["0"]).toBe("output-set-wasUndef1");
      });

      it("a 20-argument call dispatches and reads back every position (AC 34.3.4c)", async () => {
        const markers = Array.from({ length: 20 }, (_, i) => ({
          byRef: true,
          value: `v${i}`,
        }));
        const result = await executeClassMethodTool.handler(
          { className: FIXTURE, methodName: "Target20", args: markers },
          ctx,
        );
        expect(result.isError).toBeUndefined();
        const structured = result.structuredContent as {
          returnValue: string;
          byRefValues: Record<string, unknown>;
        };
        expect(structured.returnValue).toBe("20-ok");
        expect(structured.byRefValues["0"]).toBe("v0-m");
        expect(structured.byRefValues["19"]).toBe("v19-m");
      });

      it("a Write-narrating target that ZNs mid-execution captures output across the namespace switch with no wrapper class (bug repro 3 shape)", async () => {
        const result = await executeClassMethodTool.handler(
          {
            className: FIXTURE,
            methodName: "TargetZNWriteByRef",
            args: [{ byRef: true, value: "start" }],
          },
          ctx,
        );
        expect(result.isError).toBeUndefined();
        const structured = result.structuredContent as {
          returnValue: string;
          output: string;
          byRefValues: Record<string, unknown>;
        };
        expect(structured.returnValue).toBe("zn-ok");
        expect(structured.output).toBe(`before-zn:${ctx.resolveNamespace()}\nafter-zn:USER`);
        expect(structured.byRefValues["0"]).toBe("start-zn-mutated");
      });

      it("surfaces a clear isError for a rejected non-marker object arg over real HTTP (AC 34.3.2)", async () => {
        const result = await executeClassMethodTool.handler(
          {
            className: FIXTURE,
            methodName: "TargetPlainReadOnly",
            args: [{ notAMarker: true }],
          },
          ctx,
        );
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toContain("without a 'byRef' key");
      });

      it("iris_execute_classmethod works in a second, genuinely different namespace (Rule #34)", async () => {
        const result = await executeClassMethodTool.handler(
          {
            className: "%SYSTEM.Version",
            methodName: "GetVersion",
            namespace: "USER",
          },
          ctx,
        );
        expect(result.isError).toBeUndefined();
        const text = result.content[0]?.text ?? "";
        expect(text).toMatch(/IRIS|20\d{2}\.\d/i);
      });
    });

    // ── Test execution tool ───────────────────────────────────────

    describe("test execution tool", () => {
      it("iris_execute_tests runs ExecuteMCPv2.Tests.UtilsTest with structured results", async () => {
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
