/**
 * Journal, mirror, and audit monitoring tools.
 *
 * Provides three read-only tools for IRIS system administration:
 * - {@link journalInfoTool} — Journal file status and directory info
 * - {@link mirrorStatusTool} — Mirror configuration and membership status
 * - {@link auditEventsTool} — Audit log events with optional filters
 *
 * All tools call the custom REST service at `/api/executemcp/v2/monitor`.
 * Scope is NONE — handlers switch to %SYS internally.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris_journal_info ───────────────────────────────────────

export const journalInfoTool: ToolDefinition = {
  name: "iris_journal_info",
  title: "Journal Info",
  description:
    "Returns IRIS journal file information including current journal file path, " +
    "primary and alternate directories, file count, current offset, free space, " +
    "and journaling state. No parameters required.",
  inputSchema: z.object({}),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NONE",
  handler: async (_args, ctx) => {
    const path = `${BASE_URL}/monitor/journal`;

    try {
      const response = await ctx.http.get(path);
      const result = response.result as {
        currentFile: string;
        primaryDirectory: string;
        alternateDirectory: string;
        fileCount: number;
        currentOffset: number;
        freeSpaceBytes: number;
        state: string;
      };

      // Format journal info for display
      const freeGB = (result.freeSpaceBytes / (1024 * 1024 * 1024)).toFixed(1);
      const lines: string[] = [];
      lines.push("Journal Status:");
      lines.push(`  State: ${result.state}`);
      lines.push(`  Current File: ${result.currentFile}`);
      lines.push(`  Primary Directory: ${result.primaryDirectory}`);
      lines.push(`  Alternate Directory: ${result.alternateDirectory}`);
      lines.push(`  File Count: ${result.fileCount}`);
      lines.push(`  Current Offset: ${result.currentOffset}`);
      lines.push(`  Free Space: ${freeGB} GB`);

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
              text: `Error retrieving journal info: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris_mirror_status ──────────────────────────────────────

export const mirrorStatusTool: ToolDefinition = {
  name: "iris_mirror_status",
  title: "Mirror Status",
  description:
    "Returns IRIS mirror configuration, membership, and synchronization status. " +
    "Includes mirror name, member type (Primary/Backup/Async/Not Member), " +
    "role flags, and overall mirror status. Gracefully reports when mirroring " +
    "is not configured. No parameters required.",
  inputSchema: z.object({}),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NONE",
  handler: async (_args, ctx) => {
    const path = `${BASE_URL}/monitor/mirror`;

    try {
      const response = await ctx.http.get(path);
      const result = response.result as {
        isMember: boolean;
        mirrorName: string;
        memberType: string;
        isPrimary: boolean;
        isBackup: boolean;
        isAsyncMember: boolean;
        status: string;
      };

      // Format mirror status for display
      const lines: string[] = [];
      lines.push("Mirror Status:");
      lines.push(`  Is Member: ${result.isMember ? "Yes" : "No"}`);
      if (result.isMember) {
        lines.push(`  Mirror Name: ${result.mirrorName}`);
        lines.push(`  Member Type: ${result.memberType}`);
        lines.push(`  Is Primary: ${result.isPrimary ? "Yes" : "No"}`);
        lines.push(`  Is Backup: ${result.isBackup ? "Yes" : "No"}`);
        lines.push(`  Is Async: ${result.isAsyncMember ? "Yes" : "No"}`);
        lines.push(`  Status: ${result.status}`);
      } else {
        lines.push(`  Status: ${result.status}`);
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
              text: `Error retrieving mirror status: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris_audit_events ───────────────────────────────────────

export const auditEventsTool: ToolDefinition = {
  name: "iris_audit_events",
  title: "Audit Events",
  description:
    "Returns matching IRIS audit log events with optional filters. " +
    "Each event includes timestamp, username, event source, event type, " +
    "event name, description, client IP, and namespace. " +
    "Results are limited by maxRows (default 100, max 1000).",
  inputSchema: z.object({
    beginDate: z
      .string()
      .optional()
      .describe("Start date/time filter (YYYY-MM-DD HH:MM:SS)"),
    endDate: z
      .string()
      .optional()
      .describe("End date/time filter (YYYY-MM-DD HH:MM:SS)"),
    username: z
      .string()
      .optional()
      .describe("Username filter (default: * = all users)"),
    eventType: z
      .string()
      .optional()
      .describe("Event type filter (default: * = all types)"),
    maxRows: z
      .number()
      .optional()
      .describe("Maximum rows to return (default: 100, max: 1000)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NONE",
  handler: async (args, ctx) => {
    const { beginDate, endDate, username, eventType, maxRows } = args as {
      beginDate?: string;
      endDate?: string;
      username?: string;
      eventType?: string;
      maxRows?: number;
    };

    const params = new URLSearchParams();
    if (beginDate) params.set("beginDate", beginDate);
    if (endDate) params.set("endDate", endDate);
    if (username) params.set("username", username);
    if (eventType) params.set("eventType", eventType);
    if (maxRows !== undefined) params.set("maxRows", String(maxRows));

    const qs = params.toString();
    const path = `${BASE_URL}/monitor/audit${qs ? `?${qs}` : ""}`;

    try {
      const response = await ctx.http.get(path);
      const result = response.result as {
        events: Array<{
          timestamp: string;
          username: string;
          eventSource: string;
          eventType: string;
          event: string;
          description: string;
          clientIPAddress: string;
          namespace: string;
        }>;
        count: number;
        maxRows: number;
      };

      // Format audit events for display
      const lines: string[] = [];
      lines.push(
        `Audit Events (${result.count} event(s), maxRows=${result.maxRows}):`,
      );
      if (Array.isArray(result.events) && result.events.length > 0) {
        for (const evt of result.events) {
          lines.push("");
          lines.push(`  [${evt.timestamp}] ${evt.eventSource}/${evt.eventType}/${evt.event}`);
          lines.push(`    User: ${evt.username} | IP: ${evt.clientIPAddress || "(local)"} | NS: ${evt.namespace || "(none)"}`);
          if (evt.description) {
            lines.push(`    ${evt.description}`);
          }
        }
      } else {
        lines.push("\nNo audit events found matching the criteria.");
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
              text: `Error retrieving audit events: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
