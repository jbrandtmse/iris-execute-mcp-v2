/**
 * Document CRUD tools for the IRIS Development MCP server.
 *
 * Provides four tools for managing ObjectScript documents on IRIS:
 * - {@link docGetTool} — Retrieve a document by name (UDL or XML format)
 * - {@link docPutTool} — Create or update a document
 * - {@link docDeleteTool} — Delete one or more documents
 * - {@link docListTool} — List documents in a namespace with optional filters
 *
 * All tools use the Atelier REST API via the shared {@link IrisHttpClient}.
 */

import { atelierPath, IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

// ── iris.doc.get ────────────────────────────────────────────────────

export const docGetTool: ToolDefinition = {
  name: "iris.doc.get",
  title: "Get Document",
  description:
    "Retrieve an ObjectScript class, routine, CSP page, or include file by name. " +
    "Use metadataOnly to check existence and get the last-modified timestamp without downloading content.",
  inputSchema: z.object({
    name: z
      .string()
      .describe("Document name (e.g., 'MyApp.Service.cls')"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
    format: z
      .enum(["udl", "xml"])
      .optional()
      .describe("Output format (default: udl)"),
    metadataOnly: z
      .boolean()
      .optional()
      .describe(
        "When true, only check existence and return metadata (Last-Modified timestamp) without downloading content",
      ),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { name, namespace, format, metadataOnly } = args as {
      name: string;
      namespace?: string;
      format?: "udl" | "xml";
      metadataOnly?: boolean;
    };

    const ns = ctx.resolveNamespace(namespace);

    // ── Metadata-only mode: HEAD request ──────────────────────────
    if (metadataOnly) {
      const path = atelierPath(ctx.atelierVersion, ns, `doc/${name}`);
      try {
        const headResp = await ctx.http.head(path);
        const lastModified = headResp.headers.get("Last-Modified") ?? undefined;
        const etag = headResp.headers.get("ETag") ?? undefined;
        const metadata = { exists: true, name, timestamp: lastModified, etag };
        return {
          content: [
            { type: "text", text: JSON.stringify(metadata, null, 2) },
          ],
          structuredContent: metadata,
        };
      } catch (error: unknown) {
        if (error instanceof IrisApiError && error.statusCode === 404) {
          const metadata = { exists: false, name };
          return {
            content: [
              { type: "text", text: JSON.stringify(metadata, null, 2) },
            ],
            structuredContent: metadata,
            isError: false,
          };
        }
        throw error;
      }
    }

    // ── Full document retrieval: GET request ──────────────────────
    const params = new URLSearchParams();
    if (format) params.set("format", format);
    const qs = params.toString();
    const path = atelierPath(ctx.atelierVersion, ns, `doc/${name}`) + (qs ? `?${qs}` : "");

    try {
      const response = await ctx.http.get(path);
      return {
        content: [
          { type: "text", text: JSON.stringify(response.result, null, 2) },
        ],
        structuredContent: response.result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError && error.statusCode === 404) {
        return {
          content: [
            {
              type: "text",
              text: `Document '${name}' not found in namespace '${ns}'`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.doc.put ────────────────────────────────────────────────────

export const docPutTool: ToolDefinition = {
  name: "iris.doc.put",
  title: "Put Document",
  description:
    "Create or update an ObjectScript class, routine, CSP page, or include file.",
  inputSchema: z.object({
    name: z
      .string()
      .describe("Document name (e.g., 'MyApp.Service.cls')"),
    content: z
      .union([z.string(), z.array(z.string())])
      .describe("Document content as a string or array of lines"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
    ignoreConflict: z
      .boolean()
      .optional()
      .describe("If true, overwrite even when the server copy is newer"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { name, content, namespace, ignoreConflict } = args as {
      name: string;
      content: string | string[];
      namespace?: string;
      ignoreConflict?: boolean;
    };

    const ns = ctx.resolveNamespace(namespace);
    const lines = Array.isArray(content) ? content : content.split(/\r?\n/);
    const params = new URLSearchParams();
    if (ignoreConflict) params.set("ignoreConflict", "1");
    const qs = params.toString();
    const path =
      atelierPath(ctx.atelierVersion, ns, `doc/${name}`) + (qs ? `?${qs}` : "");

    const body = { enc: false, content: lines };
    const response = await ctx.http.put(path, body);

    return {
      content: [
        {
          type: "text",
          text: `Document '${name}' saved successfully in namespace '${ns}'.`,
        },
      ],
      structuredContent: response.result,
    };
  },
};

// ── iris.doc.delete ─────────────────────────────────────────────────

export const docDeleteTool: ToolDefinition = {
  name: "iris.doc.delete",
  title: "Delete Document",
  description: "Delete one or more ObjectScript documents from IRIS.",
  inputSchema: z.object({
    name: z
      .union([z.string(), z.array(z.string())])
      .describe(
        "Document name or array of names to delete (e.g., 'MyApp.Service.cls')",
      ),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { name, namespace } = args as {
      name: string | string[];
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    const names = Array.isArray(name) ? name : [name];

    if (names.length === 0) {
      return {
        content: [{ type: "text", text: "No documents specified for deletion." }],
      };
    }

    const deleted: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];

    for (const docName of names) {
      try {
        const path = atelierPath(ctx.atelierVersion, ns, `doc/${docName}`);
        await ctx.http.delete(path);
        deleted.push(docName);
      } catch (error: unknown) {
        // For single-doc deletes, propagate directly for consistent error handling
        if (names.length === 1) throw error;
        failed.push({
          name: docName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const parts: string[] = [];
    if (deleted.length === 1 && failed.length === 0) {
      parts.push(`Document '${deleted[0]}' deleted from namespace '${ns}'.`);
    } else if (deleted.length > 0) {
      parts.push(
        `${deleted.length} document(s) deleted from namespace '${ns}': ${deleted.join(", ")}`,
      );
    }
    if (failed.length > 0) {
      parts.push(
        `${failed.length} document(s) failed to delete: ${failed.map((f) => `${f.name} (${f.error})`).join(", ")}`,
      );
    }

    const result: { content: Array<{ type: "text"; text: string }>; isError?: boolean } = {
      content: [{ type: "text", text: parts.join(" ") }],
    };
    if (failed.length > 0) {
      result.isError = true;
    }
    return result;
  },
};

// ── iris.doc.list ───────────────────────────────────────────────────

export const docListTool: ToolDefinition = {
  name: "iris.doc.list",
  title: "List Documents",
  description:
    "List ObjectScript documents in a namespace with optional category and type filters. " +
    "Use modifiedSince to find documents changed after a given timestamp.",
  inputSchema: z.object({
    category: z
      .enum(["CLS", "RTN", "CSP", "OTH", "*"])
      .optional()
      .describe("Document category filter (default: all)"),
    type: z
      .string()
      .optional()
      .describe("Document type filter within category (default: all)"),
    filter: z
      .string()
      .optional()
      .describe("Name filter pattern (e.g., 'MyApp.*.cls')"),
    generated: z
      .boolean()
      .optional()
      .describe("Include generated documents (default: false)"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
    modifiedSince: z
      .string()
      .optional()
      .describe(
        "ISO 8601 timestamp — when provided, only documents modified since this time are returned " +
        "(uses the Atelier /modified/ endpoint instead of /docnames/)",
      ),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { category, type, filter, generated, namespace, modifiedSince } = args as {
      category?: string;
      type?: string;
      filter?: string;
      generated?: boolean;
      namespace?: string;
      modifiedSince?: string;
    };

    const ns = ctx.resolveNamespace(namespace);

    // ── Modified-since mode: use /modified/{timestamp} endpoint ───
    if (modifiedSince) {
      const path = atelierPath(ctx.atelierVersion, ns, `modified/${encodeURIComponent(modifiedSince)}`);
      const response = await ctx.http.get(path);
      const docs = response.result;
      return {
        content: [
          { type: "text", text: JSON.stringify(docs, null, 2) },
        ],
        structuredContent: docs,
      };
    }

    // ── Standard listing: use /docnames/ endpoint ────────────────
    const cat = category ?? "*";
    const typ = type ?? "*";
    const path = atelierPath(ctx.atelierVersion, ns, `docnames/${cat}/${typ}`);

    // Build query parameters
    const params = new URLSearchParams();
    if (filter) params.set("filter", filter);
    if (generated !== undefined) params.set("generated", String(generated ? 1 : 0));
    const queryString = params.toString();
    const fullPath = queryString ? `${path}?${queryString}` : path;

    const response = await ctx.http.get(fullPath);

    // result.content contains the document list from Atelier
    const docs = response.result;

    return {
      content: [
        { type: "text", text: JSON.stringify(docs, null, 2) },
      ],
      structuredContent: docs,
    };
  },
};
