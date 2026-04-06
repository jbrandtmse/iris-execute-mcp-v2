/**
 * Document format conversion and XML export/import tools for the IRIS Development MCP server.
 *
 * Provides two tools:
 * - {@link docConvertTool} — Convert a document between UDL and XML formats
 * - {@link docXmlExportTool} — Export, import, or list documents in legacy XML format
 *
 * All tools use the Atelier REST API via the shared {@link IrisHttpClient}.
 * XML operations require Atelier API v7+.
 */

import {
  atelierPath,
  requireMinVersion,
  type ToolDefinition,
} from "@iris-mcp/shared";
import { z } from "zod";

// ── iris.doc.convert ──────────────────────────────────────────────────

export const docConvertTool: ToolDefinition = {
  name: "iris.doc.convert",
  title: "Convert Document Format",
  description:
    "Convert an ObjectScript document between UDL and XML formats. " +
    "Retrieves the document in the specified target format using the Atelier API format parameter.",
  inputSchema: z.object({
    name: z
      .string()
      .describe("Document name (e.g., 'MyApp.Service.cls')"),
    targetFormat: z
      .enum(["udl", "xml"])
      .describe("Target format to convert the document to"),
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
    const { name, targetFormat, namespace } = args as {
      name: string;
      targetFormat: "udl" | "xml";
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);

    // Use the Atelier doc endpoint with ?format= query parameter
    const params = new URLSearchParams();
    params.set("format", targetFormat);
    const path =
      atelierPath(ctx.atelierVersion, ns, `doc/${name}`) +
      `?${params.toString()}`;

    const response = await ctx.http.get(path);

    return {
      content: [
        { type: "text", text: JSON.stringify(response.result, null, 2) },
      ],
      structuredContent: response.result,
    };
  },
};

// ── iris.doc.xml_export ───────────────────────────────────────────────

export const docXmlExportTool: ToolDefinition = {
  name: "iris.doc.xml_export",
  title: "XML Export/Import",
  description:
    "Export, import, or list ObjectScript documents in legacy XML format. " +
    'Use action "export" to export documents to XML, "import" to import from XML content, ' +
    'or "list" to list documents contained in XML without importing.',
  inputSchema: z.object({
    action: z
      .enum(["export", "import", "list"])
      .describe('Action to perform: "export", "import", or "list"'),
    docs: z
      .array(z.string())
      .optional()
      .describe(
        'Document names to export (required for action "export", e.g., [\'MyApp.Service.cls\'])',
      ),
    content: z
      .string()
      .optional()
      .describe(
        'XML content for import or list actions (required for action "import" and "list")',
      ),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
  }),
  annotations: {
    // Use most restrictive annotations since import is destructive
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { action, docs, content, namespace } = args as {
      action: "export" | "import" | "list";
      docs?: string[];
      content?: string;
      namespace?: string;
    };

    requireMinVersion(ctx.atelierVersion, 7, "iris.doc.xml_export");

    const ns = ctx.resolveNamespace(namespace);

    switch (action) {
      case "export": {
        if (!docs || docs.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: 'No documents specified for export. Provide a "docs" array with document names.',
              },
            ],
            isError: true,
          };
        }

        // POST /action/xml/export with array of document names
        const path = atelierPath(ctx.atelierVersion, ns, "action/xml/export");
        const response = await ctx.http.post(path, docs);

        return {
          content: [
            { type: "text", text: JSON.stringify(response.result, null, 2) },
          ],
          structuredContent: response.result,
        };
      }

      case "import": {
        if (!content) {
          return {
            content: [
              {
                type: "text",
                text: 'No XML content provided for import. Provide "content" with XML data.',
              },
            ],
            isError: true,
          };
        }

        // POST /action/xml/load with file/content payload
        const path = atelierPath(ctx.atelierVersion, ns, "action/xml/load");
        const lines = content.split(/\r?\n/);
        const body = [{ file: "import.xml", content: lines }];
        const response = await ctx.http.post(path, body);

        return {
          content: [
            { type: "text", text: JSON.stringify(response.result, null, 2) },
          ],
          structuredContent: response.result,
        };
      }

      case "list": {
        if (!content) {
          return {
            content: [
              {
                type: "text",
                text: 'No XML content provided for listing. Provide "content" with XML data.',
              },
            ],
            isError: true,
          };
        }

        // POST /action/xml/list with file/content payload
        const path = atelierPath(ctx.atelierVersion, ns, "action/xml/list");
        const lines = content.split(/\r?\n/);
        const body = [{ file: "import.xml", content: lines }];
        const response = await ctx.http.post(path, body);

        return {
          content: [
            { type: "text", text: JSON.stringify(response.result, null, 2) },
          ],
          structuredContent: response.result,
        };
      }

      default: {
        // Exhaustive guard — Zod validation should prevent reaching here
        const _exhaustive: never = action;
        return {
          content: [
            { type: "text", text: `Unknown action: ${_exhaustive as string}` },
          ],
          isError: true,
        };
      }
    }
  },
};
