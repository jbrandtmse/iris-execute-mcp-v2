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

import {
  atelierDocRequest,
  atelierDocStatusError,
  atelierPath,
  documentLines,
  droppedStorageDefinitions,
  formatNumberedLines,
  IrisApiError,
  isClassDocument,
  linesInRange,
  REFUSAL_CODES,
  refusalResult,
  splitLines,
  storageDroppedRefusal,
  stripLeadingBom,
  stripLeadingBomFromLines,
  type AtelierEnvelope,
  type ToolDefinition,
  type ToolResult,
} from "@iris-mcp/shared";
import { z } from "zod";
import { booleanParam } from "./zod-helpers.js";

/**
 * Validate a document name to prevent path traversal attacks.
 *
 * Rejects names containing `..` (directory traversal) or starting with
 * `/` (absolute path). Returns an error ToolResult when invalid.
 */
export function validateDocName(name: string): string | undefined {
  if (name.includes("..")) {
    return `Invalid document name '${name}': must not contain '..' (path traversal)`;
  }
  if (name.startsWith("/")) {
    return `Invalid document name '${name}': must not start with '/'`;
  }
  return undefined;
}

/**
 * Extract a list of items from an Atelier API response `result` payload.
 *
 * Atelier endpoints that return document lists (`/docnames/{cat}/{type}`)
 * nest the array inside a `content` field:
 * `{ status, console, result: { content: [...] } }`. Older unit-test
 * fixtures sometimes passed the array directly as `result: [...]`, so
 * this helper accepts both shapes for backwards compatibility.
 */
export function extractAtelierContentArray(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const wrapped = (result as { content?: unknown })?.content;
  return Array.isArray(wrapped) ? wrapped : [];
}

// ── iris_doc_get ────────────────────────────────────────────────────

/** An argument error from a line-range read: `isError: true`, no structured code, nothing read or changed. */
function rangeError(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** The pieces of a `GET /doc` result that a line-range read uses. */
export interface DocGetResult {
  ts: string;
  enc?: boolean;
  status?: unknown;
  content?: unknown;
}

/** A `GET /doc` result read as text: the document's lines (see {@link documentLines}) and its version token. */
export type TextDocumentRead =
  | { kind: "text"; lines: string[]; ts: string }
  | { kind: "unreadable"; reason: string }
  | { kind: "binary" };

/**
 * Read a `GET /doc` result as a text document.
 *
 * A document is `unreadable` when IRIS reports a soft error in `status` (HTTP 200 with a non-empty
 * `status`) or returns no line array, and `binary` when `enc` is true. Otherwise the result is the
 * document's lines, numbered as {@link documentLines} defines, with the `ts` IRIS returned.
 */
export function readTextDocument(result: DocGetResult | undefined): TextDocumentRead {
  const unreadable = atelierDocStatusError(result);
  if (unreadable !== undefined || !Array.isArray(result?.content)) {
    return { kind: "unreadable", reason: unreadable ?? "IRIS returned no line content" };
  }
  if (result.enc === true) return { kind: "binary" };
  return { kind: "text", lines: documentLines(result.content as string[]), ts: result.ts };
}

/** The error text for a document that cannot be read: `<name>` could not be read in `<ns>`, with IRIS's `reason`. */
export function unreadableDocumentText(name: string, ns: string, reason: string): string {
  return `Document '${name}' could not be read in namespace '${ns}': ${reason}. Check the document name and namespace, then retry.`;
}

/**
 * Build the ranged-read result from the `GET /doc` result: the numbered lines
 * `startLine`..`endLine` (an omitted bound defaults to the first or last line,
 * and `endLine` is clamped to the last line), `totalLines` and the version
 * token `ts`. Returns an error result when the document cannot be read as text
 * or `startLine` is past its last line.
 */
function readLineRange(
  name: string,
  ns: string,
  result: DocGetResult | undefined,
  startLine: number | undefined,
  endLine: number | undefined,
): ToolResult {
  const document = readTextDocument(result);
  if (document.kind === "unreadable") {
    return rangeError(unreadableDocumentText(name, ns, document.reason));
  }
  if (document.kind === "binary") {
    return rangeError(
      `Document '${name}' is a binary document, and line ranges apply only to text. Omit startLine and endLine to read it whole.`,
    );
  }

  const { lines } = document;
  const totalLines = lines.length;
  const firstLine = startLine ?? 1;
  if (firstLine > totalLines) {
    return rangeError(
      `startLine ${firstLine} is past the end of document '${name}', which has ${totalLines} lines. Pass a startLine from 1 to ${totalLines}, or omit startLine and endLine to read the whole document.`,
    );
  }
  const lastLine = Math.min(endLine ?? totalLines, totalLines);
  const selected = linesInRange(lines, firstLine, lastLine);
  const header = `Document '${name}' in namespace '${ns}': lines ${firstLine}-${lastLine} of ${totalLines} (ts ${document.ts})`;

  return {
    content: [{ type: "text", text: `${header}\n${formatNumberedLines(selected, firstLine)}` }],
    structuredContent: {
      name,
      ts: document.ts,
      startLine: firstLine,
      endLine: lastLine,
      totalLines,
      lines: selected,
    },
  };
}

export const docGetTool: ToolDefinition = {
  name: "iris_doc_get",
  title: "Get Document",
  description:
    "Retrieve an ObjectScript class, routine, CSP page, or include file by name. " +
    "Pass startLine and/or endLine (1-based, inclusive) to read part of a UDL text document: " +
    "use a range for large classes, and to read the exact lines before changing them with `iris_doc_edit`, " +
    "which uses the same line numbers. " +
    "A ranged read returns the lines numbered (`cat -n` layout: the number right-aligned in 6 columns, a tab, then the line exactly), " +
    "plus totalLines and the document's version timestamp `ts`; an endLine past the end is clamped to the last line. " +
    "Use metadataOnly to check existence and get the version timestamp (`etag`) without downloading content. " +
    "To pull many documents at once, see `iris_doc_export`. " +
    "To fetch the macro-expanded compiled intermediate of a class by its bare name, see `iris_routine_intermediate`.",
  inputSchema: z.object({
    name: z
      .string()
      .describe("Full document name with extension (e.g., 'MyApp.Service.cls', '%UnitTest.TestCase.cls')"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
    format: z
      .enum(["udl", "xml"])
      .optional()
      .describe("Output format (default: udl)"),
    metadataOnly: booleanParam
      .optional()
      .describe(
        "Boolean (true/false). When true, only check existence and return metadata (the version timestamp, as `etag`) without downloading content",
      ),
    startLine: z
      .coerce.number()
      .int()
      .min(1)
      .optional()
      .describe(
        "First line to return, 1-based and inclusive (default: 1 when only endLine is given). " +
          "Line 1 is the first element of the document's line array; a class's last line is often empty. " +
          "Not allowed with metadataOnly or format xml.",
      ),
    endLine: z
      .coerce.number()
      .int()
      .min(1)
      .optional()
      .describe(
        "Last line to return, 1-based and inclusive (default: the last line when only startLine is given). " +
          "A value past the end is clamped to the last line.",
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
    const { name, namespace, format, metadataOnly, startLine, endLine } = args as {
      name: string;
      namespace?: string;
      format?: "udl" | "xml";
      metadataOnly?: boolean;
      startLine?: number;
      endLine?: number;
    };

    const nameError = validateDocName(name);
    if (nameError) {
      return {
        content: [{ type: "text" as const, text: nameError }],
        isError: true,
      };
    }

    const ns = ctx.resolveNamespace(namespace);

    // Line range: the checks that need no document, before any request.
    const hasRange = startLine !== undefined || endLine !== undefined;
    if (hasRange) {
      if (metadataOnly) {
        return rangeError(
          "startLine and endLine cannot be combined with metadataOnly. Omit metadataOnly to read lines, or omit startLine and endLine to read only the metadata.",
        );
      }
      if (format === "xml") {
        return rangeError(
          'Line ranges apply only to UDL text, not to format "xml". Omit format (or pass "udl") to read a line range.',
        );
      }
      if (startLine !== undefined && endLine !== undefined && startLine > endLine) {
        return rangeError(
          `startLine ${startLine} is after endLine ${endLine}. Pass a startLine that is less than or equal to endLine.`,
        );
      }
    }

    // URL-encode the document name so %-prefixed system classes are handled
    const encodedName = encodeURIComponent(name);

    // ── Metadata-only mode: HEAD request ──────────────────────────
    if (metadataOnly) {
      const path = atelierPath(ctx.atelierVersion, ns, `doc/${encodedName}`);
      try {
        const headResp = await ctx.http.head(path);
        const etag = headResp.headers.get("ETag") ?? undefined;
        const metadata = { exists: true, name, etag };
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
    const path = atelierPath(ctx.atelierVersion, ns, `doc/${encodedName}`) + (qs ? `?${qs}` : "");

    try {
      // A document name IRIS refuses is answered HTTP 400 with the reason in `result.status`; it is read below.
      const response = await atelierDocRequest(() => ctx.http.get(path));
      if (hasRange) {
        return readLineRange(name, ns, response.result as DocGetResult | undefined, startLine, endLine);
      }
      // A soft error (HTTP 200 with a non-empty result.status) is a failed read, never data.
      const unreadable = atelierDocStatusError(response.result);
      if (unreadable !== undefined) {
        return rangeError(unreadableDocumentText(name, ns, unreadable));
      }
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

// ── iris_doc_put ────────────────────────────────────────────────────

/** The closing sentence of the refusal for a put that drops Storage definitions. */
const PUT_STORAGE_REMEDY =
  "Keep the Storage definitions in the content (read the class with iris_doc_get first), " +
  "or pass allowStorageRegeneration: true to let IRIS regenerate the storage.";

/** What a document's current version looks like in the 409 that Atelier answers a put to an existing document with. */
export interface CurrentDocument {
  /** The document's current lines (in the input's format: XML text for XML content). */
  content: string[];
  /** The version token to send as `If-None-Match`. */
  ts: string;
}

/**
 * The current document carried by an Atelier 409, or `undefined` when `error` is not a 409 or the
 * document is unreadable (no line array, no string `ts`, or a non-empty `status`).
 *
 * Without `If-None-Match`, Atelier answers a put to an existing document with HTTP 409 and the
 * document as it is now, and writes nothing.
 */
export function currentDocument(error: unknown): CurrentDocument | undefined {
  if (!(error instanceof IrisApiError) || error.statusCode !== 409) return undefined;
  const result = error.result as { content?: unknown; ts?: unknown } | null | undefined;
  if (result === null || typeof result !== "object") return undefined;
  if (atelierDocStatusError(result) !== undefined) return undefined;
  if (!Array.isArray(result.content) || typeof result.ts !== "string") return undefined;
  return { content: result.content as string[], ts: result.ts };
}

export const docPutTool: ToolDefinition = {
  name: "iris_doc_put",
  title: "Put Document",
  description:
    "**Debug/scratch tool** — for production code, use iris_doc_load to ensure source control and review. " +
    "This tool writes content directly to IRIS without creating a file on disk, and is intended for one-off " +
    "inspection, quick reproductions, or throwaway test classes only. A leading byte-order mark is " +
    "stripped from the content before it is sent, and a write IRIS refuses (a non-empty result.status " +
    "inside an HTTP 200 response) is returned as an error carrying IRIS's text; nothing is stored then. " +
    "An existing document is saved only if it has not changed since this tool read its current version; " +
    "ignoreConflict skips that check. " +
    "For an existing class, a put whose content drops one of the class's Storage definitions is refused and " +
    "nothing is stored, because IRIS would generate new storage at the next compile, which can change how " +
    "existing rows are read; allowStorageRegeneration (default false) lets it through, and changing a Storage " +
    "definition's content is always allowed.",
  inputSchema: z.object({
    name: z
      .string()
      .describe("Document name (e.g., 'MyApp.Service.cls')"),
    content: z
      .union([z.string(), z.array(z.string())])
      .describe("Document content. Pass as a single string with newlines (preferred) or a JSON array of lines. The full class/routine source including 'Class ... {' header."),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
    ignoreConflict: booleanParam
      .optional()
      .describe(
        "Boolean (true/false), default false. Not needed to replace an existing document: without it the tool reads the " +
          "document's current version and saves only if it is still that version. When true, IRIS skips that version check.",
      ),
    allowStorageRegeneration: booleanParam
      .optional()
      .describe(
        "Boolean (true/false), default false. When false, a put to an existing class whose content drops one of the class's " +
          "Storage definitions is refused and nothing is stored; changing a Storage definition's content is allowed. " +
          "When true, the put goes ahead and IRIS generates new storage at the next compile, which can change how existing " +
          "rows are read. No effect on a new class or on other document types.",
      ),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { name, content, namespace, ignoreConflict, allowStorageRegeneration } = args as {
      name: string;
      content: string | string[];
      namespace?: string;
      ignoreConflict?: boolean;
      allowStorageRegeneration?: boolean;
    };

    const nameError = validateDocName(name);
    if (nameError) {
      return {
        content: [{ type: "text" as const, text: nameError }],
        isError: true,
      };
    }

    const ns = ctx.resolveNamespace(namespace);
    // A leading BOM makes IRIS reject the first line as an illegal header and
    // store nothing, so it never reaches the wire. A caller-supplied array is
    // copied, never mutated.
    const lines = Array.isArray(content)
      ? stripLeadingBomFromLines(content)
      : splitLines(stripLeadingBom(content));
    const path = atelierPath(ctx.atelierVersion, ns, `doc/${encodeURIComponent(name)}`);
    const ignoreConflictPath = `${path}?ignoreConflict=1`;
    const body = { enc: false, content: lines };

    // A class's Storage definitions are guarded unless the caller allows regeneration.
    const guardsStorage = isClassDocument(name) && allowStorageRegeneration !== true;

    let response: AtelierEnvelope;
    // A document name IRIS refuses is answered HTTP 400 with the reason in `result.status`; it is read below.
    if (ignoreConflict && !guardsStorage) {
      response = await atelierDocRequest(() => ctx.http.put(ignoreConflictPath, body));
    } else {
      // The first request carries no version token. A new document is created by it. For an existing
      // document Atelier refuses it with HTTP 409 and writes nothing, and the refusal carries the
      // document as it is now: the guard's read, and the version the save is checked against.
      try {
        response = await atelierDocRequest(() => ctx.http.put(path, body));
      } catch (error: unknown) {
        const current = currentDocument(error);
        if (current === undefined) throw error;

        if (guardsStorage) {
          const dropped = droppedStorageDefinitions(current.content, lines);
          if (dropped.length > 0) {
            return storageDroppedRefusal(name, ns, dropped, PUT_STORAGE_REMEDY);
          }
        }

        if (ignoreConflict) {
          response = await ctx.http.put(ignoreConflictPath, body);
        } else {
          try {
            response = await ctx.http.put(path, body, { headers: { "If-None-Match": current.ts } });
          } catch (saveError: unknown) {
            if (saveError instanceof IrisApiError && saveError.statusCode === 409) {
              return refusalResult(
                REFUSAL_CODES.DOCUMENT_CONFLICT,
                `Document '${name}' was not saved in namespace '${ns}': it changed on the server while this tool was saving it. ` +
                  "Nothing was stored. Run iris_doc_put again to replace the current version.",
                { name, namespace: ns },
              );
            }
            throw saveError;
          }
        }
      }
    }

    // IRIS can refuse a document inside an HTTP 200 envelope with an empty
    // `status.errors`, reporting the reason only as a string `result.status`
    // while storing nothing.
    const refusal = atelierDocStatusError(response.result);
    if (refusal !== undefined) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Document '${name}' was not saved in namespace '${ns}': ${refusal}. Nothing was stored; correct the document text and retry.`,
          },
        ],
        structuredContent: response.result,
        isError: true,
      };
    }

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

// ── iris_doc_delete ─────────────────────────────────────────────────

export const docDeleteTool: ToolDefinition = {
  name: "iris_doc_delete",
  title: "Delete Document",
  description: "Delete one or more ObjectScript documents from IRIS.",
  inputSchema: z.object({
    name: z
      .union([z.string(), z.array(z.string())])
      .describe(
        "Document name(s) to delete. Pass a single string (e.g., 'MyApp.Service.cls') or a JSON array for multiple (e.g., [\"A.cls\", \"B.cls\"]).",
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

    // Validate all names before processing
    for (const docName of names) {
      const nameError = validateDocName(docName);
      if (nameError) {
        return {
          content: [{ type: "text" as const, text: nameError }],
          isError: true,
        };
      }
    }

    if (names.length === 0) {
      return {
        content: [{ type: "text", text: "No documents specified for deletion." }],
      };
    }

    const deleted: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];

    for (const docName of names) {
      try {
        const path = atelierPath(ctx.atelierVersion, ns, `doc/${encodeURIComponent(docName)}`);
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

// ── iris_doc_list ───────────────────────────────────────────────────

/** The description of the `modifiedSince` parameter of the document-listing tools, which refuse it. */
export const MODIFIED_SINCE_DESCRIPTION =
  "Not supported: IRIS cannot filter documents by modification time, so a call that sets it is refused " +
  "and changes nothing; compare the ts of the documents iris_doc_list returns instead.";

/**
 * The description of the `type` parameter of `iris_doc_list`, `iris_package_list` and `iris_doc_export`.
 * Every example is a value Atelier's `docnames/<category>/<type>` route accepts: RTN takes the routine
 * extensions or a comma list of them, CLS answers HTTP 400 to any type but `*`, and category `*` takes
 * any extension.
 */
export const DOC_TYPE_DESCRIPTION =
  "Document type filter within the category: the file extension without the dot. " +
  "RTN takes 'mac', 'int', 'inc', 'bas', 'mvi' or 'mvb', or a comma list such as 'mac,inc'. " +
  "CLS takes no type filter (leave it unset). " +
  "With category '*', 'cls' lists only classes. " +
  "Default: all types within the chosen category.";

/**
 * The refusal for a non-empty `modifiedSince` on `iris_doc_list`, `iris_doc_export` and `iris_package_list`
 * (`verb` is what the tool did not do: listed, exported or counted). It is an argument error: `isError: true`,
 * no structured code, and no request is sent, because Atelier's change list works from an opaque per-database
 * hash with no time semantics, and calling it writes journal bookkeeping.
 */
export function modifiedSinceUnsupported(verb: "listed" | "exported" | "counted"): ToolResult {
  return rangeError(
    `modifiedSince is not supported, so nothing was ${verb}: IRIS has no way to list documents changed since a timestamp ` +
      "(its change list works from a database hash). " +
      "Omit modifiedSince; to find recent changes, list the documents with iris_doc_list and compare each one's ts.",
  );
}

export const docListTool: ToolDefinition = {
  name: "iris_doc_list",
  title: "List Documents",
  description:
    "List ObjectScript documents in a namespace with optional category and type filters. " +
    "WARNING: Without a filter, this returns ALL documents including system classes — use the filter parameter or category to limit results. " +
    "For a structural overview at package granularity, see `iris_package_list`. To pull many documents at once, see `iris_doc_export`.",
  inputSchema: z.object({
    category: z
      .enum(["CLS", "RTN", "CSP", "OTH", "*"])
      .optional()
      .describe(
        "Document category filter. CLS = ObjectScript classes (.cls). " +
        "RTN = routines (.mac / .int / .inc / .bas / .mvi / .mvb — includes " +
        "include files where macros are defined). CSP = CSP/ZEN pages and " +
        "other web-facing files under /csp/. OTH = other Studio document " +
        "types (e.g., BPL, DTL, custom studio document classes). * = all " +
        "categories (default).",
      ),
    type: z.string().optional().describe(DOC_TYPE_DESCRIPTION),
    filter: z
      .string()
      .optional()
      .describe(
        "Case-insensitive plain substring filter on document names. Just pass the substring — " +
        "no wildcards needed. Example: 'MyApp' matches every document whose name contains 'MyApp' " +
        "(including 'MyApp.Service.cls', 'MyApp.Utils.cls', etc.). Applied server-side by the " +
        "Atelier API as `Name LIKE '%<filter>%'`. Do NOT wrap the value in '*' or '?' — those " +
        "characters are matched literally and will cause the filter to return zero results. " +
        "SQL LIKE wildcards '%' (multi-char) and '_' (single-char) can be included inside the " +
        "filter value if you need more control.",
      ),
    generated: booleanParam
      .optional()
      .describe("Include generated documents (default: false)"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
    modifiedSince: z.string().optional().describe(MODIFIED_SINCE_DESCRIPTION),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor from a previous response's nextCursor field"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { category, type, filter, generated, namespace, modifiedSince, cursor } = args as {
      category?: string;
      type?: string;
      filter?: string;
      generated?: boolean;
      namespace?: string;
      modifiedSince?: string;
      cursor?: string;
    };

    const ns = ctx.resolveNamespace(namespace);

    // modifiedSince is refused before any request.
    if (modifiedSince) return modifiedSinceUnsupported("listed");

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

    // Atelier /docnames returns { result: { content: [...] } }
    const allDocs: unknown[] = extractAtelierContentArray(response.result);
    const { page, nextCursor } = ctx.paginate(allDocs, cursor);
    const result = { items: page, ...(nextCursor ? { nextCursor } : {}) };

    return {
      content: [
        { type: "text", text: JSON.stringify(result, null, 2) },
      ],
      structuredContent: result,
    };
  },
};
