/**
 * Compilation tool for the IRIS Development MCP server.
 *
 * Provides {@link docCompileTool} to compile one or more ObjectScript
 * documents via the Atelier REST API. Supports synchronous and
 * asynchronous compilation modes, optional compilation flags, and
 * detailed error reporting with line/character positions.
 *
 * Compilation errors (bad ObjectScript code) are returned as
 * successful tool results with structured error details; only
 * transport/connection failures set `isError: true`.
 */

import { atelierPath, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";
import { booleanParam } from "./zod-helpers.js";

// ── Types ──────────────────────────────────────────────────────────

/** A single compilation error reported by the Atelier API. */
interface CompilationError {
  error: string;
  line?: number;
  char?: number;
}

/** Per-document compilation result from the Atelier API. */
interface CompilationDocResult {
  name: string;
  status?: string;
  errors?: CompilationError[];
}

/** Shape of the `result.content` array in the Atelier compile response. */
interface CompileResultContent {
  content?: CompilationDocResult[];
}

// ── iris_doc_compile ───────────────────────────────────────────────

export const docCompileTool: ToolDefinition = {
  name: "iris_doc_compile",
  title: "Compile Document",
  description:
    "Compile one or more ObjectScript classes, routines, or include files. " +
    "Returns detailed compilation errors with line/character positions when compilation fails. " +
    "Use async mode for large packages to avoid timeouts.",
  inputSchema: z.object({
    doc: z
      .union([z.string(), z.array(z.string())])
      .describe("Document name(s) to compile. Pass a single string for one doc (e.g., 'MyApp.Service.cls') or a JSON array for multiple (e.g., [\"A.cls\", \"B.cls\"]). Each name must include the file extension."),
    flags: z
      .string()
      .optional()
      .describe("Compilation flags (e.g., 'ck', 'cku'). Default: server default"),
    async: booleanParam
      .optional()
      .describe("When true, queue asynchronous compilation and return a job ID for polling"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { doc, flags, async: asyncMode, namespace } = args as {
      doc: string | string[];
      flags?: string;
      async?: boolean;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    const docs = Array.isArray(doc) ? doc : [doc];

    if (docs.length === 0) {
      return {
        content: [{ type: "text", text: "No documents specified for compilation." }],
        isError: false,
      };
    }

    // Build query parameters
    const params = new URLSearchParams();
    if (flags) params.set("flags", flags);
    if (asyncMode) params.set("async", "1");
    const qs = params.toString();

    const path =
      atelierPath(ctx.atelierVersion, ns, "action/compile") +
      (qs ? `?${qs}` : "");

    const startTime = Date.now();
    // Use a broad type: sync mode returns CompileResultContent, async mode
    // returns an opaque tracking object — we narrow after the branch.
    const response = await ctx.http.post<CompileResultContent | unknown>(path, docs);
    const elapsed = Date.now() - startTime;

    // ── Async mode: return job ID ──────────────────────────────
    if (asyncMode) {
      // The Atelier async compile returns the result in the envelope;
      // the job/tracking info is in the response itself.
      const asyncConsole = response.console ?? [];
      const result = {
        mode: "async",
        docs: docs,
        response: response.result,
        ...(asyncConsole.length > 0 ? { console: asyncConsole } : {}),
      };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        structuredContent: result,
        isError: false,
      };
    }

    // ── Synchronous mode: parse compilation results ────────────
    const syncResult = response.result as CompileResultContent | undefined;
    const docResults = syncResult?.content ?? [];
    const consoleOutput = response.console ?? [];

    // Collect all errors across documents
    const allErrors: Array<{
      document: string;
      error: string;
      line?: number;
      char?: number;
    }> = [];

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

    const hasErrors = allErrors.length > 0;

    const result = {
      success: !hasErrors,
      documents: docs,
      compilationTime: `${elapsed}ms`,
      ...(hasErrors ? { errors: allErrors } : {}),
      ...(consoleOutput.length > 0 ? { console: consoleOutput } : {}),
    };

    const summary = hasErrors
      ? `Compilation failed for ${docs.join(", ")} with ${allErrors.length} error(s) in ${elapsed}ms`
      : `Successfully compiled ${docs.join(", ")} in ${elapsed}ms`;

    // Per AC #4: compilation errors use isError: false — the tool
    // executed successfully; the compiled code had issues.
    return {
      content: [
        { type: "text", text: summary },
        { type: "text", text: JSON.stringify(result, null, 2) },
      ],
      structuredContent: result,
      isError: false,
    };
  },
};
