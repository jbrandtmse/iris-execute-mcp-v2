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

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
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

export const executeTestsTool: ToolDefinition = {
  name: "iris.execute.tests",
  title: "Execute Tests",
  description:
    "Run ObjectScript unit tests at package, class, or method level with structured results. " +
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

    const body: Record<string, unknown> = {
      target,
      level,
      namespace: ns,
    };

    const path = `${BASE_URL}/tests`;

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
