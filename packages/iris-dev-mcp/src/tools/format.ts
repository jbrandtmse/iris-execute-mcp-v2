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
  droppedStorageNames,
  requireMinVersion,
  storageDefinitionNames,
  storageDrop,
  storageDropsRefusal,
  xmlClassStorageNames,
  type StorageDrop,
  type ToolDefinition,
} from "@iris-mcp/shared";
import { z } from "zod";
import { currentClassLines, storageDropsNote } from "./doc.js";

/**
 * Story 35.6 (AC 35.6.2): guarantee the `c` (compile) qualifier is EFFECTIVE
 * in an Atelier load-flags string. `LoadXMLFiles` (irislib
 * `%Api/Atelier/v7.cls:346`) passes `flags` straight to
 * `$SYSTEM.OBJ.LoadStream`, and `c` is the qualifier that compiles after load
 * (live-probed on IRIS 2026.1, 2026-08-18: `flags=ck`/`flags=c`/`flags=C`
 * compile; `flags=k` alone does not).
 *
 * Live-pinned qualifier semantics (IRIS 2026.1, code-review probe, 2026-08-19):
 * qualifier letters are CASE-INSENSITIVE (`C` alone compiles); `-` NEGATES the
 * immediately following letter (`-c` loads WITHOUT compiling); and where
 * multiple c-occurrences conflict the LAST one wins (`c-c` does NOT compile,
 * `-cc` DOES). The fold therefore inspects the LAST c/C occurrence: absent →
 * prepend `c`; negated → append an overriding `c`; otherwise pass through
 * unchanged. Every emitted string was live-proven to compile (`-c`→`-cc`,
 * `c-c`→`c-cc`, `-C`→`-Cc`, `k-c`→`k-cc`, `C`→`C`, `cku`→`cku`).
 */
function foldCompileFlag(flags: string | undefined): string {
  const userFlags = flags ?? "";
  const lastC = Math.max(userFlags.lastIndexOf("c"), userFlags.lastIndexOf("C"));
  if (lastC === -1) return `c${userFlags}`;
  if (lastC > 0 && userFlags[lastC - 1] === "-") return `${userFlags}c`;
  return userFlags;
}

/** What an import refused for a Storage drop did not do, without a closing period. */
function importStorageOpening(namespace: string): string {
  return `The XML was not imported into namespace '${namespace}' and nothing was stored`;
}

/** The closing sentence of the refusal for an import that would drop Storage definitions. */
const IMPORT_STORAGE_REMEDY =
  "Keep each class's Storage elements in the XML (export the classes with iris_doc_xml_export first), " +
  "or pass allowStorageRegeneration: true to let IRIS regenerate the storage.";

// ── iris_doc_convert ──────────────────────────────────────────────────

export const docConvertTool: ToolDefinition = {
  name: "iris_doc_convert",
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
      atelierPath(ctx.atelierVersion, ns, `doc/${encodeURIComponent(name)}`) +
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

// ── iris_doc_xml_export ───────────────────────────────────────────────

export const docXmlExportTool: ToolDefinition = {
  name: "iris_doc_xml_export",
  title: "XML Export/Import",
  description:
    "Export, import, or list ObjectScript documents in legacy XML format. " +
    'Use action "export" to export documents to XML, "import" to import from XML content, ' +
    'or "list" to list documents contained in XML without importing. ' +
    "By default an import LOADS definitions WITHOUT compiling them — an imported class " +
    "is not usable until compiled (pass compile: true to compile in the same call, or use " +
    "iris_doc_compile afterwards). When compile is not requested the response states " +
    "plainly that the documents are uncompiled. Non-empty per-file status text reported by " +
    "IRIS (e.g. a compile error) is surfaced in the response. " +
    "An import that would drop one of the Storage definitions a class has now (its XML lacks that definition) " +
    "is refused with STORAGE_DROPPED and nothing is loaded, because IRIS would generate new storage at the next " +
    "compile, which can change how existing rows are read; allowStorageRegeneration (default false) lets it " +
    "through, and the result names the dropped definitions.",
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
    compile: z
      .boolean()
      .optional()
      .describe(
        'For action "import" only. When true, compile the imported documents in the same call ' +
          "via the Atelier load flags (the 'c' qualifier). Default false: documents are loaded " +
          "but NOT compiled, and the response says so.",
      ),
    flags: z
      .string()
      .optional()
      .describe(
        'For action "import" only. Atelier load/compile flags (e.g., \'ck\', \'cku\'). Only used ' +
          "when compile is true; the 'c' (compile) qualifier is folded in automatically when absent " +
          "or explicitly negated (e.g. '-c' becomes '-cc' — IRIS qualifier negation, last c wins).",
      ),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
    allowStorageRegeneration: z
      .boolean()
      .optional()
      .describe(
        'For action "import" only. Boolean (true/false), default false. When false, an import is refused ' +
          "(STORAGE_DROPPED, nothing loaded) if the XML of a class lacks one of the Storage definitions that " +
          "class has now; changing a definition's content is allowed. When true, the import goes ahead, IRIS " +
          "generates new storage at the next compile (which can change how existing rows are read), and the " +
          "result's storageDrops names the dropped definitions. No effect on a new class or on other document types.",
      ),
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
    const { action, docs, content, compile, flags, namespace, allowStorageRegeneration } = args as {
      action: "export" | "import" | "list";
      docs?: string[];
      content?: string;
      compile?: boolean;
      flags?: string;
      namespace?: string;
      allowStorageRegeneration?: boolean;
    };

    requireMinVersion(ctx.atelierVersion, 7, "iris_doc_xml_export");

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

        const lines = content.split(/\r?\n/);

        // The Storage guard: each `<Class>` of the XML is compared with the class the namespace has
        // now. A drop refuses the whole import before its one POST, unless allowStorageRegeneration
        // lets it through; then the drops are named in the result. A read that fails throws, and
        // nothing is posted.
        const drops: StorageDrop[] = [];
        for (const [className, keptNames] of xmlClassStorageNames(lines)) {
          const docName = `${className}.cls`;
          const existing = await currentClassLines(ctx.http, ctx.atelierVersion, ns, docName);
          if (existing === undefined) continue;
          const dropped = droppedStorageNames(storageDefinitionNames(existing), keptNames);
          if (dropped.length > 0) drops.push(storageDrop(docName, dropped));
        }
        if (drops.length > 0 && allowStorageRegeneration !== true) {
          return storageDropsRefusal(importStorageOpening(ns), drops, IMPORT_STORAGE_REMEDY, {
            namespace: ns,
          });
        }

        // POST /action/xml/load with file/content payload.
        // Story 35.6: `compile: true` sends the native Atelier `flags` query
        // param with the `c` qualifier folded in (see foldCompileFlag), so the
        // load compiles in the same call. When compile is not requested the
        // request is byte-identical to the pre-35.6 behavior — NO flags param
        // at all (Rule #19 pin) — and an additive note states plainly that the
        // documents were NOT compiled.
        const shouldCompile = compile === true;
        let path = atelierPath(ctx.atelierVersion, ns, "action/xml/load");
        if (shouldCompile) {
          const params = new URLSearchParams();
          params.set("flags", foldCompileFlag(flags));
          path += `?${params.toString()}`;
        }
        const body = [{ file: "import.xml", content: lines }];
        const response = await ctx.http.post(path, body);

        const contentBlocks: Array<{ type: "text"; text: string }> = [
          { type: "text", text: JSON.stringify(response.result, null, 2) },
        ];
        if (!shouldCompile) {
          contentBlocks.push({
            type: "text",
            text:
              "Note: imported documents are NOT compiled (compile was not " +
              "requested — Atelier action/xml/load loads definitions without " +
              "compiling). They are not usable until compiled — re-run with " +
              "compile: true, or compile them afterwards with iris_doc_compile.",
          });
        }
        // Surface non-empty per-file status text: a load that fails to compile
        // still answers HTTP 200 with an empty status.errors — the error text
        // appears ONLY in the per-file `status` field (live-pinned broken-XML
        // oracle, Story 35.6 Task 1). structuredContent is the untouched API
        // result either way, except that an allowed Storage drop adds storageDrops.
        const resultObj = response.result as
          | { content?: Array<{ file?: unknown; status?: unknown }> }
          | undefined;
        const fileEntries = Array.isArray(resultObj?.content)
          ? resultObj.content
          : [];
        for (const entry of fileEntries) {
          if (
            entry &&
            typeof entry.status === "string" &&
            entry.status.trim() !== ""
          ) {
            const fileName =
              typeof entry.file === "string" ? entry.file : "import.xml";
            contentBlocks.push({
              type: "text",
              text: `Per-file status (${fileName}): ${entry.status}`,
            });
          }
        }

        if (drops.length > 0) {
          contentBlocks.push({ type: "text", text: storageDropsNote(drops) });
          return {
            content: contentBlocks,
            structuredContent: { ...(response.result as Record<string, unknown>), storageDrops: drops },
          };
        }

        return {
          content: contentBlocks,
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
