/**
 * Bulk document load tool for the IRIS Development MCP server.
 *
 * Provides {@link docLoadTool} to upload multiple ObjectScript files
 * from a local directory into IRIS via the Atelier PUT /doc endpoint,
 * with optional compilation of all successfully uploaded documents.
 *
 * File paths are mapped to IRIS document names by stripping the
 * directory prefix and replacing path separators with dots.
 */

import { readFileSync, globSync } from "node:fs";
import * as path from "node:path";
import { atelierPath, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";
import { booleanParam } from "./zod-helpers.js";

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Convert a filesystem path to an IRIS document name.
 *
 * Strips the base directory prefix, replaces path separators with dots,
 * and preserves the file extension.
 *
 * @example
 *   filePathToDocName("c:/projects/src/MyPkg/Sub/MyClass.cls", "c:/projects/src")
 *   // => "MyPkg.Sub.MyClass.cls"
 */
export function filePathToDocName(filePath: string, baseDir: string): string {
  // Normalise to forward slashes for consistent handling
  const normFile = filePath.replace(/\\/g, "/");
  const normBase = baseDir.replace(/\\/g, "/").replace(/\/+$/, "");

  // Strip the base directory prefix
  let relative = normFile.startsWith(normBase + "/")
    ? normFile.slice(normBase.length + 1)
    : normFile;

  // Separate extension from the path
  const ext = path.extname(relative);
  const stem = relative.slice(0, relative.length - ext.length);

  // Replace remaining path separators with dots
  const docName = stem.replace(/\//g, ".") + ext;
  return docName;
}

/**
 * Extract the base directory from a glob pattern.
 *
 * Walks the pattern segments until a glob metacharacter is found,
 * and returns the directory prefix up to that point.
 *
 * @example
 *   extractBaseDir("c:/projects/src/**\/*.cls")
 *   // => "c:/projects/src"
 */
export function extractBaseDir(globPattern: string): string {
  const normalised = globPattern.replace(/\\/g, "/");
  const segments = normalised.split("/");
  const dirParts: string[] = [];

  for (const seg of segments) {
    if (seg.includes("*") || seg.includes("?") || seg.includes("{") || seg.includes("[")) {
      break;
    }
    dirParts.push(seg);
  }

  return dirParts.join("/");
}

// ── Types ─────────────────────────────────────────────────────────────

interface UploadFailure {
  file: string;
  docName: string;
  error: string;
}

interface CompilationResult {
  success: boolean;
  documents: string[];
  errors?: Array<{
    document: string;
    error: string;
    line?: number;
    char?: number;
  }>;
  console?: string[];
}

// ── iris_doc_load ─────────────────────────────────────────────────────

export const docLoadTool: ToolDefinition = {
  name: "iris_doc_load",
  title: "Bulk Load Documents",
  description:
    "Upload multiple ObjectScript files from a local directory into IRIS. " +
    "Accepts a glob pattern to match files. File paths are mapped to IRIS document names " +
    "(path separators become dots). Optionally compiles all uploaded documents afterward. " +
    "This is the preferred way to deploy ObjectScript classes to IRIS — always create or edit .cls files on disk first, " +
    "then use this tool to upload and compile. This ensures all code is source-controlled and reviewable.",
  inputSchema: z.object({
    path: z
      .string()
      .describe(
        "Glob pattern for files to upload (e.g., 'c:/projects/src/**/*.cls'). " +
        "The directory prefix before the first glob metacharacter is used as the base for document name mapping.",
      ),
    compile: booleanParam
      .optional()
      .describe("When true, compile all successfully uploaded documents after upload (default: false)"),
    flags: z
      .string()
      .optional()
      .describe("Compilation flags (e.g., 'ck', 'cku'). Only used when compile is true"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
    ignoreConflict: booleanParam
      .optional()
      .describe("If true (default), overwrite server copies even when newer"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const {
      path: globPattern,
      compile: shouldCompile,
      flags,
      namespace,
      ignoreConflict,
    } = args as {
      path: string;
      compile?: boolean;
      flags?: string;
      namespace?: string;
      ignoreConflict?: boolean;
    };

    const ns = ctx.resolveNamespace(namespace);
    const baseDir = extractBaseDir(globPattern);

    // Resolve ignore-conflict default (true)
    const ignoreConflictFlag = ignoreConflict !== false;

    // Find matching files
    const files = globSync(globPattern.replace(/\\/g, "/"), { withFileTypes: false });

    if (files.length === 0) {
      const result = { total: 0, uploaded: 0, failed: 0, failures: [] };
      return {
        content: [
          { type: "text", text: `No files matched pattern '${globPattern}'.` },
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: result,
      };
    }

    const uploaded: string[] = [];
    const failures: UploadFailure[] = [];

    // Upload each file via Atelier PUT /doc
    for (const filePath of files) {
      const docName = filePathToDocName(String(filePath), baseDir);

      try {
        const fileContent = readFileSync(String(filePath), "utf-8");
        const lines = fileContent.split(/\r?\n/);

        const encodedName = encodeURIComponent(docName);
        const params = new URLSearchParams();
        if (ignoreConflictFlag) params.set("ignoreConflict", "1");
        const qs = params.toString();
        const apiPath =
          atelierPath(ctx.atelierVersion, ns, `doc/${encodedName}`) +
          (qs ? `?${qs}` : "");

        const body = { enc: false, content: lines };
        await ctx.http.put(apiPath, body);
        uploaded.push(docName);
      } catch (error: unknown) {
        failures.push({
          file: String(filePath),
          docName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Optionally compile all uploaded documents
    let compilationResult: CompilationResult | undefined;

    if (shouldCompile && uploaded.length > 0) {
      const compileParams = new URLSearchParams();
      if (flags) compileParams.set("flags", flags);
      const compileQs = compileParams.toString();
      const compilePath =
        atelierPath(ctx.atelierVersion, ns, "action/compile") +
        (compileQs ? `?${compileQs}` : "");

      try {
        const response = await ctx.http.post(compilePath, uploaded);
        const syncResult = response.result as { content?: Array<{ name: string; errors?: Array<{ error: string; line?: number; char?: number }> }> } | undefined;
        const docResults = syncResult?.content ?? [];
        const consoleOutput = response.console ?? [];

        const allErrors: Array<{ document: string; error: string; line?: number; char?: number }> = [];

        for (const docResult of docResults) {
          if (docResult.errors && docResult.errors.length > 0) {
            for (const err of docResult.errors) {
              const entry: { document: string; error: string; line?: number; char?: number } = {
                document: docResult.name,
                error: err.error,
              };
              if (err.line !== undefined) entry.line = err.line;
              if (err.char !== undefined) entry.char = err.char;
              allErrors.push(entry);
            }
          }
        }

        compilationResult = {
          success: allErrors.length === 0,
          documents: uploaded,
          ...(allErrors.length > 0 ? { errors: allErrors } : {}),
          ...(consoleOutput.length > 0 ? { console: consoleOutput } : {}),
        };
      } catch (error: unknown) {
        compilationResult = {
          success: false,
          documents: uploaded,
          errors: [
            {
              document: "*",
              error: error instanceof Error ? error.message : String(error),
            },
          ],
        };
      }
    }

    const result = {
      total: files.length,
      uploaded: uploaded.length,
      failed: failures.length,
      ...(failures.length > 0 ? { failures } : {}),
      ...(compilationResult ? { compilationResult } : {}),
    };

    const parts: string[] = [];
    parts.push(
      `Loaded ${uploaded.length}/${files.length} document(s) into namespace '${ns}'.`,
    );
    if (failures.length > 0) {
      parts.push(`${failures.length} file(s) failed to upload.`);
    }
    if (compilationResult) {
      parts.push(
        compilationResult.success
          ? `Compilation successful for ${uploaded.length} document(s).`
          : `Compilation completed with errors.`,
      );
    }

    return {
      content: [
        { type: "text", text: parts.join(" ") },
        { type: "text", text: JSON.stringify(result, null, 2) },
      ],
      structuredContent: result,
      isError: failures.length > 0 && uploaded.length === 0,
    };
  },
};
