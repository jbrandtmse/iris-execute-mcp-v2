/**
 * Code intelligence tools for the IRIS Development MCP server.
 *
 * Provides three read-only tools for inspecting and searching IRIS code:
 * - {@link docIndexTool} — Retrieve class structure (methods, properties, parameters, superclasses)
 * - {@link docSearchTool} — Search across code with regex, wildcard, and case options
 * - {@link macroInfoTool} — Look up macro definitions, source locations, and expanded values
 *
 * All tools use the Atelier REST API via the shared {@link IrisHttpClient}.
 */

import {
  atelierPath,
  requireMinVersion,
  type ToolDefinition,
} from "@iris-mcp/shared";
import { z } from "zod";

// ── iris.doc.index ─────────────────────────────────────────────────

export const docIndexTool: ToolDefinition = {
  name: "iris.doc.index",
  title: "Document Index",
  description:
    "Retrieve the structure of an ObjectScript class, including its methods, properties, " +
    "parameters, and superclasses. Each member includes its type, signature, and relevant metadata.",
  inputSchema: z.object({
    name: z
      .string()
      .describe("Document name (e.g., 'MyApp.Service.cls')"),
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
    const { name, namespace } = args as {
      name: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    const path = atelierPath(ctx.atelierVersion, ns, "action/index");

    // Atelier actionIndex expects POST with array of document names
    const response = await ctx.http.post(path, [name]);

    const result = response.result;
    return {
      content: [
        { type: "text", text: JSON.stringify(result, null, 2) },
      ],
      structuredContent: result,
    };
  },
};

// ── iris.doc.search ────────────────────────────────────────────────

export const docSearchTool: ToolDefinition = {
  name: "iris.doc.search",
  title: "Search Documents",
  description:
    "Search across ObjectScript documents for text or regex patterns. " +
    "Supports regex, wildcard, word-match, and case-sensitive options. " +
    "Returns matching documents and locations, or an empty array when no results are found.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("Search query text or regex pattern"),
    regex: z
      .boolean()
      .optional()
      .describe("Treat query as a regular expression (default: false)"),
    word: z
      .boolean()
      .optional()
      .describe("Match whole words only (default: false)"),
    case: z
      .boolean()
      .optional()
      .describe("Case-sensitive search (default: false)"),
    wild: z
      .boolean()
      .optional()
      .describe("Enable wildcard matching (default: false)"),
    files: z
      .string()
      .optional()
      .describe("File pattern filter (e.g., '*.cls,*.mac'). Default: '*.cls,*.mac,*.int,*.inc'"),
    sys: z
      .boolean()
      .optional()
      .describe("Include system items (default: false)"),
    gen: z
      .boolean()
      .optional()
      .describe("Include generated items (default: false)"),
    max: z
      .number()
      .optional()
      .describe("Maximum number of results to return"),
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
    const {
      query,
      regex,
      word,
      case: caseSensitive,
      wild,
      files,
      sys,
      gen,
      max,
      namespace,
    } = args as {
      query: string;
      regex?: boolean;
      word?: boolean;
      case?: boolean;
      wild?: boolean;
      files?: string;
      sys?: boolean;
      gen?: boolean;
      max?: number;
      namespace?: string;
    };

    requireMinVersion(ctx.atelierVersion, 2, "iris.doc.search");

    const ns = ctx.resolveNamespace(namespace);

    // Atelier actionSearch is a GET with query params (v2+)
    const params = new URLSearchParams();
    params.set("query", query);
    if (regex !== undefined) params.set("regex", String(regex));
    if (word !== undefined) params.set("word", String(word));
    if (caseSensitive !== undefined) params.set("case", String(caseSensitive));
    if (wild !== undefined) params.set("wild", String(wild));
    if (files !== undefined) params.set("files", files);
    if (sys !== undefined) params.set("sys", String(sys));
    if (gen !== undefined) params.set("gen", String(gen));
    if (max !== undefined) params.set("max", String(max));

    const qs = params.toString();
    const path = atelierPath(ctx.atelierVersion, ns, "action/search") + (qs ? `?${qs}` : "");

    const response = await ctx.http.get(path);

    // AC #4: empty results return empty array, not error
    const result = response.result ?? [];
    return {
      content: [
        { type: "text", text: JSON.stringify(result, null, 2) },
      ],
      structuredContent: result,
    };
  },
};

// ── iris.macro.info ────────────────────────────────────────────────

export const macroInfoTool: ToolDefinition = {
  name: "iris.macro.info",
  title: "Macro Info",
  description:
    "Look up a macro definition, including its expanded value and source location. " +
    "Requires a document context and optionally a list of include files to resolve the macro.",
  inputSchema: z.object({
    name: z
      .string()
      .describe("Macro name to look up (e.g., 'OK', 'ISERR')"),
    document: z
      .string()
      .optional()
      .describe("Document context for resolving the macro (e.g., 'MyApp.Service.cls'). Default: empty"),
    includes: z
      .array(z.string())
      .optional()
      .describe("List of include files for macro resolution (e.g., ['%occStatus'])"),
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
    const { name, document, includes, namespace } = args as {
      name: string;
      document?: string;
      includes?: string[];
      namespace?: string;
    };

    requireMinVersion(ctx.atelierVersion, 2, "iris.macro.info");

    const ns = ctx.resolveNamespace(namespace);

    const docname = document ?? "";
    const includeList = includes ?? [];

    // Fetch both definition and location in parallel
    const definitionPath = atelierPath(ctx.atelierVersion, ns, "action/getmacrodefinition");
    const locationPath = atelierPath(ctx.atelierVersion, ns, "action/getmacrolocation");

    const body = { docname, macroname: name, includes: includeList };

    const [definitionResponse, locationResponse] = await Promise.all([
      ctx.http.post(definitionPath, body),
      ctx.http.post(locationPath, body),
    ]);

    const result = {
      name,
      definition: definitionResponse.result,
      location: locationResponse.result,
    };

    return {
      content: [
        { type: "text", text: JSON.stringify(result, null, 2) },
      ],
      structuredContent: result,
    };
  },
};
