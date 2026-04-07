/**
 * Document Database (DocDB) tools for the IRIS Data & Analytics MCP server.
 *
 * Provides four tools for managing IRIS document databases:
 * - {@link docdbManageTool} — Create, drop, or list document databases
 * - {@link docdbDocumentTool} — Insert, get, update, or delete documents
 * - {@link docdbFindTool} — Query documents with filter criteria
 * - {@link docdbPropertyTool} — Create, drop, or index properties
 *
 * All tools call the IRIS built-in DocDB REST API at
 * `/api/docdb/v1/{namespace}/...`. No custom ObjectScript handler
 * is required.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the IRIS DocDB REST API. */
const BASE_DOCDB_URL = "/api/docdb/v1";

/**
 * Extract the usable result from a DocDB API response.
 *
 * The {@link IrisHttpClient} casts every JSON response to
 * `AtelierEnvelope<T>`, but the DocDB API returns plain JSON
 * (no `{status, console, result}` wrapper). When the response
 * lacks the Atelier envelope, `.result` is `undefined` and the
 * actual data sits at the top level of the parsed object.
 *
 * @param response - The parsed response from `ctx.http.*`.
 * @returns The actual data payload.
 */
export function extractResult(response: unknown): unknown {
  if (
    response !== null &&
    typeof response === "object" &&
    "result" in (response as Record<string, unknown>) &&
    (response as Record<string, unknown>).result !== undefined
  ) {
    return (response as Record<string, unknown>).result;
  }
  return response;
}

/**
 * Ensure a value is a record suitable for MCP `structuredContent`.
 * MCP requires structuredContent to be a JSON object (record), not an array.
 * Arrays are wrapped in `{ items, count }`.
 */
export function toStructured(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return { items: value, count: value.length };
  }
  if (value !== null && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return { value };
}

// ── iris.docdb.manage ──────────────────────────────────────────

export const docdbManageTool: ToolDefinition = {
  name: "iris.docdb.manage",
  title: "Manage Document Database",
  description:
    "Create, drop, or list IRIS document databases. " +
    "'list' returns all DocDB databases in the namespace. " +
    "'create' creates a new document database with optional property definitions. " +
    "'drop' permanently removes a document database and all its data.",
  inputSchema: z.object({
    action: z
      .enum(["list", "create", "drop"])
      .describe("Action to perform: 'list', 'create', or 'drop'"),
    database: z
      .string()
      .min(1)
      .optional()
      .describe("Database name (required for 'create' and 'drop')"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured namespace)"),
  }),
  annotations: {
    destructiveHint: true,
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { action, database, namespace } = args as {
      action: string;
      database?: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);

    try {
      let response: unknown;

      if (action === "list") {
        response = await ctx.http.get(
          `${BASE_DOCDB_URL}/${encodeURIComponent(ns)}`,
        );
      } else if (action === "create") {
        if (!database) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'database' is required for 'create' action",
              },
            ],
            isError: true,
          };
        }
        response = await ctx.http.post(
          `${BASE_DOCDB_URL}/${encodeURIComponent(ns)}/db/${encodeURIComponent(database)}`,
          {},
        );
      } else {
        // drop
        if (!database) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'database' is required for 'drop' action",
              },
            ],
            isError: true,
          };
        }
        response = await ctx.http.delete(
          `${BASE_DOCDB_URL}/${encodeURIComponent(ns)}/db/${encodeURIComponent(database)}`,
        );
      }

      const result = extractResult(response);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: toStructured(result),
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error managing DocDB database: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.docdb.document ────────────────────────────────────────

export const docdbDocumentTool: ToolDefinition = {
  name: "iris.docdb.document",
  title: "Manage Document",
  description:
    "Insert, get, update, or delete a document in an IRIS document database. " +
    "'insert' adds a new document and returns its generated ID. " +
    "'get' retrieves a document by ID. " +
    "'update' replaces a document by ID. " +
    "'delete' removes a document by ID.",
  inputSchema: z.object({
    action: z
      .enum(["insert", "get", "update", "delete"])
      .describe("Action to perform: 'insert', 'get', 'update', or 'delete'"),
    database: z.string().min(1).describe("Document database name"),
    id: z
      .string()
      .min(1)
      .optional()
      .describe("Document ID (required for 'get', 'update', 'delete')"),
    document: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Document content as JSON (required for 'insert' and 'update')"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured namespace)"),
  }),
  annotations: {
    destructiveHint: true,
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { action, database, id, document, namespace } = args as {
      action: string;
      database: string;
      id?: string;
      document?: Record<string, unknown>;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    const dbPath = `${BASE_DOCDB_URL}/${encodeURIComponent(ns)}/doc/${encodeURIComponent(database)}`;

    try {
      let response: unknown;

      if (action === "insert") {
        if (!document) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'document' is required for 'insert' action",
              },
            ],
            isError: true,
          };
        }
        response = await ctx.http.post(`${dbPath}/`, document);
      } else if (action === "get") {
        if (!id) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'id' is required for 'get' action",
              },
            ],
            isError: true,
          };
        }
        response = await ctx.http.get(
          `${dbPath}/${encodeURIComponent(id)}`,
        );
      } else if (action === "update") {
        if (!id) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'id' is required for 'update' action",
              },
            ],
            isError: true,
          };
        }
        if (!document) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'document' is required for 'update' action",
              },
            ],
            isError: true,
          };
        }
        response = await ctx.http.put(
          `${dbPath}/${encodeURIComponent(id)}`,
          document,
        );
      } else {
        // delete
        if (!id) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'id' is required for 'delete' action",
              },
            ],
            isError: true,
          };
        }
        response = await ctx.http.delete(
          `${dbPath}/${encodeURIComponent(id)}`,
        );
      }

      const result = extractResult(response);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: toStructured(result),
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error managing document: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.docdb.find ────────────────────────────────────────────

export const docdbFindTool: ToolDefinition = {
  name: "iris.docdb.find",
  title: "Find Documents",
  description:
    "Query documents in an IRIS document database using filter criteria. " +
    "Supports comparison operators ($eq, $lt, $gt, $ne, $lte, $gte) " +
    "and returns matching documents.",
  inputSchema: z.object({
    database: z.string().min(1).describe("Document database name"),
    filter: z
      .record(z.string(), z.unknown())
      .describe(
        "Filter criteria as JSON with comparison operators (e.g., { \"age\": { \"$gt\": 21 } })",
      ),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured namespace)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { database, filter, namespace } = args as {
      database: string;
      filter: Record<string, unknown>;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);

    try {
      const response = await ctx.http.post(
        `${BASE_DOCDB_URL}/${encodeURIComponent(ns)}/find/${encodeURIComponent(database)}`,
        filter,
      );

      const result = extractResult(response);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: toStructured(result),
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error querying documents: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.docdb.property ────────────────────────────────────────

export const docdbPropertyTool: ToolDefinition = {
  name: "iris.docdb.property",
  title: "Manage Document Property",
  description:
    "Create, drop, or index a property on an IRIS document database. " +
    "'create' defines a new property with a specified type. " +
    "'drop' removes a property definition. " +
    "'index' creates an index on a property for faster queries.",
  inputSchema: z.object({
    action: z
      .enum(["create", "drop", "index"])
      .describe("Action to perform: 'create', 'drop', or 'index'"),
    database: z.string().min(1).describe("Document database name"),
    property: z.string().min(1).describe("Property name"),
    type: z
      .string()
      .optional()
      .describe("Property type (required for 'create', e.g., '%String', '%Integer')"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured namespace)"),
  }),
  annotations: {
    destructiveHint: true,
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { action, database, property, type, namespace } = args as {
      action: string;
      database: string;
      property: string;
      type?: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    const propPath = `${BASE_DOCDB_URL}/${encodeURIComponent(ns)}/prop/${encodeURIComponent(database)}/${encodeURIComponent(property)}`;

    try {
      let response: unknown;

      if (action === "create") {
        if (!type) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'type' is required for 'create' action",
              },
            ],
            isError: true,
          };
        }
        response = await ctx.http.post(propPath, { type });
      } else if (action === "drop") {
        response = await ctx.http.delete(propPath);
      } else {
        // index
        response = await ctx.http.post(propPath, { index: true });
      }

      const result = extractResult(response);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: toStructured(result),
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error managing property '${property}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
