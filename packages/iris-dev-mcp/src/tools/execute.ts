/**
 * ObjectScript execution tools for the IRIS Development MCP server.
 *
 * Provides two tools for executing ObjectScript code on IRIS:
 * - {@link executeCommandTool} — Execute an ObjectScript command with I/O capture
 * - {@link executeClassMethodTool} — Invoke a class method by name with positional arguments
 *
 * All tools call the custom REST service at `/api/executemcp/v2/command` and
 * `/api/executemcp/v2/classmethod`, NOT the Atelier API.
 */

import { IrisApiError, atelierPath, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris.execute.command ────────────────────────────────────────

export const executeCommandTool: ToolDefinition = {
  name: "iris.execute.command",
  title: "Execute Command",
  description:
    "Execute an ObjectScript command on IRIS with captured I/O output. " +
    "Write statements and other output are captured and returned in the response.",
  inputSchema: z.object({
    command: z
      .string()
      .describe("ObjectScript command to execute (e.g., 'Write \"Hello\"')"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { command, namespace } = args as {
      command: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);

    const body = {
      command,
      namespace: ns,
    };

    const path = `${BASE_URL}/command`;

    try {
      const response = await ctx.http.post(path, body);
      const result = response.result;
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text",
              text: `Error executing command: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.execute.tests ─────────────────────────────────────────

/** Maximum time to wait for test results (ms). */
const TEST_POLL_TIMEOUT = 120_000;
/** Delay between poll requests (ms). */
const TEST_POLL_INTERVAL = 200;

/** Result structure from the Atelier async unittest endpoint. */
interface AtelierTestResult {
  class: string;
  method?: string;
  status: number; // 0 = Failed, 1 = Passed, 2 = Skipped
  duration: number;
  failures: { message: string }[];
  error?: string;
}

/**
 * Discover test classes in a package by querying the class dictionary.
 * Returns an array of `{ class: string }` objects for use in the
 * Atelier async unittest request.
 */
async function discoverPackageTests(
  ctx: { http: InstanceType<typeof import("@iris-mcp/shared").IrisHttpClient>; atelierVersion: number },
  ns: string,
  packageName: string,
): Promise<{ class: string }[]> {
  const sqlPath = atelierPath(ctx.atelierVersion, ns, "action/query");
  const query =
    "SELECT Name FROM %Dictionary.ClassDefinition " +
    "WHERE Name %STARTSWITH ? AND Abstract = 0 AND " +
    "Name IN (SELECT Name FROM %Dictionary.ClassDefinitionQuery_SubclassOf('%UnitTest.TestCase'))";
  const resp = await ctx.http.post<Record<string, unknown>>(sqlPath, { query, parameters: [packageName + "."] });
  const result = resp.result as Record<string, unknown>;
  const rows = (result?.content ?? result) as unknown[];
  const tests: { class: string }[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = (row as Record<string, string>).Name ?? (row as Record<string, string>).name;
    if (name) tests.push({ class: name });
  }
  return tests;
}

export const executeTestsTool: ToolDefinition = {
  name: "iris.execute.tests",
  title: "Execute Tests",
  description:
    "Run ObjectScript unit tests at package, class, or method level with structured results. " +
    "Uses the Atelier async work queue for reliable execution. " +
    "Returns total, passed, failed, skipped counts and per-test details.",
  inputSchema: z.object({
    target: z
      .string()
      .describe(
        "Test target: package name (e.g., 'MyApp.Tests'), class name (e.g., 'MyApp.Tests.UtilsTest'), " +
          "or class:method (e.g., 'MyApp.Tests.UtilsTest:TestSomething')",
      ),
    level: z
      .enum(["package", "class", "method"])
      .describe("Granularity of test execution"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { target, level, namespace } = args as {
      target: string;
      level: "package" | "class" | "method";
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);

    try {
      // Build the tests array for the Atelier async unittest request
      let tests: { class: string; methods?: string[] }[];

      if (level === "package") {
        // Discover all %UnitTest.TestCase subclasses in the package
        tests = await discoverPackageTests(ctx, ns, target);
        if (tests.length === 0) {
          return {
            content: [
              { type: "text", text: JSON.stringify({ total: 0, passed: 0, failed: 0, skipped: 0, details: [], error: `No test classes found in package '${target}'` }, null, 2) },
            ],
          };
        }
      } else if (level === "class") {
        tests = [{ class: target }];
      } else {
        // method level: "ClassName:MethodName"
        const [className, methodName] = target.split(":");
        const testEntry: { class: string; methods?: string[] } = { class: className! };
        if (methodName) testEntry.methods = [methodName];
        tests = [testEntry];
      }

      // Queue the async unittest request via Atelier work endpoint
      const workPath = atelierPath(ctx.atelierVersion, ns, "work");
      const queueResp = await ctx.http.post<Record<string, unknown>>(workPath, {
        request: "unittest",
        tests,
        console: false,
      });

      const queueResult = queueResp.result as Record<string, unknown>;
      const jobId = (queueResult?.location ?? (queueResult?.content as Record<string, unknown>)?.location) as string | undefined;
      if (!jobId) {
        return {
          content: [{ type: "text", text: "Error: Failed to queue test execution — no job ID returned" }],
          isError: true,
        };
      }

      // Poll for results with timeout
      const pollPath = atelierPath(ctx.atelierVersion, ns, `work/${jobId}`);
      const deadline = Date.now() + TEST_POLL_TIMEOUT;
      let testResults: AtelierTestResult[] | undefined;

      while (Date.now() < deadline) {
        const pollResp = await ctx.http.get<unknown>(pollPath);
        const pollResult = pollResp.result;
        const pollEnvelope = pollResp as unknown as Record<string, unknown>;

        if (Array.isArray(pollResult)) {
          // Tests finished — result is the array of test results
          testResults = pollResult as AtelierTestResult[];
          break;
        }

        if (!pollEnvelope.retryafter) {
          // No retryafter and no array result — check if result has content array
          const resultObj = pollResult as Record<string, unknown> | undefined;
          if (Array.isArray(resultObj?.content)) {
            testResults = resultObj!.content as AtelierTestResult[];
            break;
          }
          // Unexpected response shape — treat as done with no results
          testResults = [];
          break;
        }

        // Wait before polling again
        await new Promise((resolve) => setTimeout(resolve, TEST_POLL_INTERVAL));
      }

      if (!testResults) {
        return {
          content: [{ type: "text", text: "Error: Test execution timed out" }],
          isError: true,
        };
      }

      // Transform Atelier results into our structured format
      const statusMap: Record<number, string> = { 0: "failed", 1: "passed", 2: "skipped" };
      let total = 0, passed = 0, failed = 0, skipped = 0;
      const details: { class: string; method: string; status: string; duration: number; message: string }[] = [];

      for (const r of testResults) {
        if (r.method) {
          // Method-level result
          total++;
          const status = statusMap[r.status] ?? "unknown";
          if (r.status === 1) passed++;
          else if (r.status === 0) failed++;
          else skipped++;

          const messages: string[] = [];
          if (r.error) messages.push(r.error);
          for (const f of r.failures ?? []) {
            if (f.message) messages.push(f.message);
          }

          details.push({
            class: r.class,
            method: r.method,
            status,
            duration: r.duration,
            message: messages.join("; "),
          });
        }
        // Class-level results are summary — we only report method-level details
      }

      const result = { total, passed, failed, skipped, details };
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text",
              text: `Error executing tests for '${target}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.execute.classmethod ────────────────────────────────────

export const executeClassMethodTool: ToolDefinition = {
  name: "iris.execute.classmethod",
  title: "Execute Class Method",
  description:
    "Invoke an ObjectScript class method by name with optional positional arguments. " +
    "Returns the method's return value. Supports up to 10 arguments.",
  inputSchema: z.object({
    className: z
      .string()
      .describe("Fully qualified class name (e.g., 'MyPackage.MyClass')"),
    methodName: z
      .string()
      .describe("Name of the class method to invoke"),
    args: z
      .array(z.any())
      .optional()
      .describe("Positional arguments to pass to the method (max 10)"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { className, methodName, args: methodArgs, namespace } = args as {
      className: string;
      methodName: string;
      args?: unknown[];
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);

    const body: Record<string, unknown> = {
      className,
      methodName,
      namespace: ns,
    };
    if (methodArgs && methodArgs.length > 0) {
      body.args = methodArgs;
    }

    const path = `${BASE_URL}/classmethod`;

    try {
      const response = await ctx.http.post(path, body);
      const result = response.result;
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text",
              text: `Error executing class method '${className}.${methodName}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
