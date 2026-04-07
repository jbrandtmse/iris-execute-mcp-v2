/**
 * Database, license, and ECP infrastructure monitoring tools.
 *
 * Provides three read-only tools for IRIS infrastructure health:
 * - {@link databaseCheckTool} — Database status including mounted, encrypted, journal, size
 * - {@link licenseInfoTool} — License type, capacity, usage, and expiration
 * - {@link ecpStatusTool} — ECP connection status (or "not configured")
 *
 * All tools call the custom REST service at `/api/executemcp/v2/monitor`.
 * Scope is NONE — handlers switch to %SYS internally where needed.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris.database.check ─────────────────────────────────────

export const databaseCheckTool: ToolDefinition = {
  name: "iris.database.check",
  title: "Database Check",
  description:
    "Returns IRIS database status for all databases or a specific database. " +
    "Each database entry includes mounted status, read-only flag, encryption status, " +
    "journal state, size in MB, and max size. This is a status check, not a full " +
    "integrity scan.",
  inputSchema: z.object({
    name: z
      .string()
      .optional()
      .describe("Database name to check (omit for all databases)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NONE",
  handler: async (args, ctx) => {
    const { name } = args as { name?: string };

    let path = `${BASE_URL}/monitor/database`;
    if (name) {
      path += `?name=${encodeURIComponent(name)}`;
    }

    try {
      const response = await ctx.http.get(path);
      const result = response.result as {
        databases: Array<{
          name: string;
          directory: string;
          mounted: boolean;
          readOnly: boolean;
          encrypted: boolean;
          journalState: number;
          sizeMB: number;
          maxSizeMB: number;
          error?: string;
        }>;
        count: number;
      };

      // Format database info for display
      const lines: string[] = [];
      lines.push(`Database Status (${result.count} database(s)):`);
      if (Array.isArray(result.databases) && result.databases.length > 0) {
        for (const db of result.databases) {
          lines.push("");
          lines.push(`  ${db.name}:`);
          lines.push(`    Directory: ${db.directory}`);
          if (db.error) {
            lines.push(`    Error: ${db.error}`);
          } else {
            lines.push(`    Mounted: ${db.mounted ? "Yes" : "No"}`);
            lines.push(`    Read-Only: ${db.readOnly ? "Yes" : "No"}`);
            lines.push(`    Encrypted: ${db.encrypted ? "Yes" : "No"}`);
            lines.push(`    Journal State: ${db.journalState}`);
            lines.push(`    Size: ${db.sizeMB} MB`);
            lines.push(
              `    Max Size: ${db.maxSizeMB === 0 ? "Unlimited" : `${db.maxSizeMB} MB`}`,
            );
          }
        }
      } else {
        lines.push("\nNo databases found.");
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
              text: `Error retrieving database status: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.license.info ───────────────────────────────────────

export const licenseInfoTool: ToolDefinition = {
  name: "iris.license.info",
  title: "License Info",
  description:
    "Returns IRIS license information including customer name, license capacity, " +
    "expiration date, connection and user limits, cores/CPUs licensed, and " +
    "current CSP user count. No parameters required.",
  inputSchema: z.object({}),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NONE",
  handler: async (_args, ctx) => {
    const path = `${BASE_URL}/monitor/license`;

    try {
      const response = await ctx.http.get(path);
      const result = response.result as {
        customerName: string;
        licenseCapacity: string;
        expirationDate: string;
        connectionLimit: number;
        userLimit: number;
        coresLicensed: number;
        cpusLicensed: number;
        currentCSPUsers: number;
      };

      // Format license info for display
      const lines: string[] = [];
      lines.push("License Information:");
      lines.push(`  Customer: ${result.customerName}`);
      lines.push(`  Capacity: ${result.licenseCapacity}`);
      lines.push(`  Expiration: ${result.expirationDate}`);
      lines.push(
        `  Connection Limit: ${result.connectionLimit === 0 ? "Unlimited" : result.connectionLimit}`,
      );
      lines.push(`  User Limit: ${result.userLimit}`);
      lines.push(`  Cores Licensed: ${result.coresLicensed}`);
      lines.push(`  CPUs Licensed: ${result.cpusLicensed}`);
      lines.push(`  Current CSP Users: ${result.currentCSPUsers}`);

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
              text: `Error retrieving license info: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.ecp.status ─────────────────────────────────────────

export const ecpStatusTool: ToolDefinition = {
  name: "iris.ecp.status",
  title: "ECP Status",
  description:
    "Returns ECP (Enterprise Cache Protocol) connection status. Reports whether " +
    "ECP is configured on this instance and, if so, the connection health. " +
    "Gracefully returns 'ECP not configured' when ECP is not in use. " +
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
    const path = `${BASE_URL}/monitor/ecp`;

    try {
      const response = await ctx.http.get(path);
      const result = response.result as {
        configured: boolean;
        status: string;
        clientIndex?: number;
      };

      // Format ECP status for display
      const lines: string[] = [];
      lines.push("ECP Status:");
      lines.push(`  Configured: ${result.configured ? "Yes" : "No"}`);
      lines.push(`  Status: ${result.status}`);
      if (result.configured && result.clientIndex !== undefined) {
        lines.push(`  Client Index: ${result.clientIndex}`);
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
              text: `Error retrieving ECP status: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
