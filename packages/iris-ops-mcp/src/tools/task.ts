/**
 * Task scheduling tools for the IRIS Operations MCP server.
 *
 * Provides four tools for managing IRIS scheduled tasks:
 * - {@link taskManageTool} — Create, modify, or delete a scheduled task
 * - {@link taskListTool} — List all scheduled tasks with details
 * - {@link taskRunTool} — Run a task immediately (async trigger)
 * - {@link taskHistoryTool} — View task execution history
 *
 * All tools call the custom REST service at `/api/executemcp/v2/task`.
 * Scope is NONE — handlers switch to %SYS internally.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris.task.manage ────────────────────────────────────────

export const taskManageTool: ToolDefinition = {
  name: "iris.task.manage",
  title: "Manage Task",
  description:
    "Create, modify, or delete an IRIS scheduled task. " +
    "For 'create', name, taskClass, and namespace are required. " +
    "For 'modify', id is required and only provided fields are updated. " +
    "For 'delete', only id is needed.",
  inputSchema: z.object({
    action: z
      .enum(["create", "modify", "delete"])
      .describe("Action to perform on the task"),
    id: z
      .union([z.string(), z.number()])
      .optional()
      .describe("Task ID (required for modify/delete)"),
    name: z
      .string()
      .optional()
      .describe("Task name (required for create)"),
    taskClass: z
      .string()
      .optional()
      .describe(
        "ObjectScript class implementing %SYS.Task.Definition (required for create)",
      ),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace for task execution (required for create)"),
    description: z.string().optional().describe("Task description"),
    suspended: z
      .boolean()
      .optional()
      .describe("Whether the task is suspended"),
  }),
  annotations: {
    destructiveHint: true,
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NONE",
  handler: async (args, ctx) => {
    const { action, id, name, taskClass, namespace, description, suspended } =
      args as {
        action: string;
        id?: string | number;
        name?: string;
        taskClass?: string;
        namespace?: string;
        description?: string;
        suspended?: boolean;
      };

    const body: Record<string, unknown> = { action };
    if (id !== undefined) body.id = id;
    if (name !== undefined) body.name = name;
    if (taskClass !== undefined) body.taskClass = taskClass;
    if (namespace !== undefined) body.namespace = namespace;
    if (description !== undefined) body.description = description;
    if (suspended !== undefined) body.suspended = suspended;

    const path = `${BASE_URL}/task/manage`;

    try {
      const response = await ctx.http.post(path, body);
      const result = response.result as {
        action: string;
        id?: string | number;
        name?: string;
      };

      const lines: string[] = [];
      lines.push(`Task ${result.action}:`);
      if (result.id !== undefined) lines.push(`  ID: ${result.id}`);
      if (result.name) lines.push(`  Name: ${result.name}`);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error managing task: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.task.list ──────────────────────────────────────────

export const taskListTool: ToolDefinition = {
  name: "iris.task.list",
  title: "List Tasks",
  description:
    "List all IRIS scheduled tasks with schedule, status, and configuration details. " +
    "Each task includes name, task class, namespace, suspended status, priority, " +
    "run interval, next scheduled date/time, last started/finished, and last status/result. " +
    "No parameters required.",
  inputSchema: z.object({}),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NONE",
  handler: async (_args, ctx) => {
    const path = `${BASE_URL}/task/list`;

    try {
      const response = await ctx.http.get(path);
      const result = response.result as {
        tasks: Array<{
          id: number;
          name: string;
          description: string;
          taskClass: string;
          namespace: string;
          suspended: string;
          priority: string;
          runInterval: string;
          nextScheduledDate: string;
          nextScheduledTime: string;
          lastStarted: string;
          lastFinished: string;
          lastStatus: string;
          lastResult: string;
        }>;
        count: number;
      };

      const lines: string[] = [];
      lines.push(`Scheduled Tasks (${result.count} task(s)):`);
      if (Array.isArray(result.tasks) && result.tasks.length > 0) {
        for (const task of result.tasks) {
          lines.push("");
          lines.push(`  [${task.id}] ${task.name}:`);
          if (task.description) {
            lines.push(`    Description: ${task.description}`);
          }
          lines.push(`    Class: ${task.taskClass}`);
          lines.push(`    Namespace: ${task.namespace}`);
          lines.push(
            `    Suspended: ${task.suspended === "1" ? "Yes" : "No"}`,
          );
          lines.push(`    Priority: ${task.priority}`);
          lines.push(`    Run Interval: ${task.runInterval}`);
          if (task.nextScheduledDate) {
            lines.push(
              `    Next Run: ${task.nextScheduledDate} ${task.nextScheduledTime}`,
            );
          }
          if (task.lastStarted) {
            lines.push(`    Last Started: ${task.lastStarted}`);
            lines.push(`    Last Finished: ${task.lastFinished}`);
            lines.push(
              `    Last Status: ${task.lastStatus} (${task.lastResult})`,
            );
          }
        }
      } else {
        lines.push("\nNo scheduled tasks found.");
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error retrieving task list: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.task.run ───────────────────────────────────────────

export const taskRunTool: ToolDefinition = {
  name: "iris.task.run",
  title: "Run Task",
  description:
    "Trigger immediate execution of an IRIS scheduled task by ID. " +
    "The task runs asynchronously — this tool confirms the trigger was sent " +
    "but does not wait for completion. Check task history for results.",
  inputSchema: z.object({
    id: z
      .union([z.string(), z.number()])
      .describe("Task ID to run immediately"),
  }),
  annotations: {
    destructiveHint: false,
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NONE",
  handler: async (args, ctx) => {
    const { id } = args as { id: string | number };

    const body = { id };
    const path = `${BASE_URL}/task/run`;

    try {
      const response = await ctx.http.post(path, body);
      const result = response.result as {
        triggered: boolean;
        id: string | number;
        message: string;
      };

      const lines: string[] = [];
      lines.push(`Task Run Triggered:`);
      lines.push(`  ID: ${result.id}`);
      lines.push(`  ${result.message}`);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error running task: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.task.history ───────────────────────────────────────

export const taskHistoryTool: ToolDefinition = {
  name: "iris.task.history",
  title: "Task History",
  description:
    "View execution history for IRIS scheduled tasks. " +
    "Optionally filter by task ID. Each entry includes task name, start time, " +
    "completion time, status, result, namespace, and username.",
  inputSchema: z.object({
    taskId: z
      .union([z.string(), z.number()])
      .optional()
      .describe("Task ID to filter history (omit for all tasks)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NONE",
  handler: async (args, ctx) => {
    const { taskId } = args as { taskId?: string | number };

    let path = `${BASE_URL}/task/history`;
    if (taskId !== undefined) {
      path += `?taskId=${encodeURIComponent(String(taskId))}`;
    }

    try {
      const response = await ctx.http.get(path);
      const result = response.result as {
        history: Array<{
          taskName: string;
          lastStart: string;
          completed: string;
          status: string;
          result: string;
          namespace: string;
          username: string;
          taskId: string;
        }>;
        count: number;
      };

      const lines: string[] = [];
      lines.push(`Task History (${result.count} entries):`);
      if (Array.isArray(result.history) && result.history.length > 0) {
        for (const entry of result.history) {
          lines.push("");
          lines.push(`  ${entry.taskName} (Task ${entry.taskId}):`);
          lines.push(`    Started: ${entry.lastStart}`);
          lines.push(`    Completed: ${entry.completed}`);
          lines.push(`    Status: ${entry.status}`);
          lines.push(`    Result: ${entry.result}`);
          lines.push(`    Namespace: ${entry.namespace}`);
          if (entry.username) {
            lines.push(`    User: ${entry.username}`);
          }
        }
      } else {
        lines.push("\nNo task history found.");
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error retrieving task history: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
