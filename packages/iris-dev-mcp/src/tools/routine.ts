/**
 * Routine lookup tools for the IRIS Development MCP server.
 *
 * Provides {@link routineIntermediateTool} — resolve a class name to its
 * compiled-intermediate routine (the macro-expanded form IRIS actually
 * executes at runtime). Tries `.1.int` first (IRIS's standard compilation
 * output) then `.int` as a fallback.
 *
 * Uses the Atelier REST API via the shared {@link IrisHttpClient}.
 */

import { atelierPath, IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";
import { validateDocName } from "./doc.js";

/**
 * Build the ordered list of Atelier doc candidates for a bare class name.
 *
 * Strips an optional trailing `.cls` suffix (case-insensitive) and returns
 * `[<Name>.1.int, <Name>.int]`. Candidate order matters — `.1.int` is the
 * macro-expanded intermediate IRIS emits during normal class compilation;
 * `.int` is only emitted in legacy or generator-produced cases.
 *
 * `.mac` is intentionally excluded — that's the pre-expansion source
 * routine, which callers can fetch via `iris_doc_get` with an explicit
 * `.mac` name.
 */
export function buildRoutineCandidates(inputName: string): string[] {
  const trimmed = inputName.trim();
  const base = trimmed.replace(/\.cls$/i, "");
  return [`${base}.1.int`, `${base}.int`];
}

// ── iris_routine_intermediate ───────────────────────────────────────

export const routineIntermediateTool: ToolDefinition = {
  name: "iris_routine_intermediate",
  title: "Routine Intermediate",
  description:
    "Given a class name, fetch the compiled-intermediate routine — the macro-expanded form IRIS actually executes at runtime. " +
    "Auto-resolves the class name to the `.1.int` / `.int` candidate IRIS emits during compilation; " +
    "use `iris_doc_get` when you need a specific doc by exact name with extension. " +
    "Use `iris_macro_info` when you need individual macro definitions and source locations rather than the expanded routine body.",
  inputSchema: z.object({
    name: z
      .string()
      .min(1)
      .describe(
        "Class name, with or without the `.cls` suffix (e.g., 'Ens.Director', 'Ens.Director.cls', 'MyApp.Service')",
      ),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
    format: z
      .enum(["udl", "xml"])
      .optional()
      .describe("Atelier document format for returned content (default: server default)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { name, namespace, format } = args as {
      name: string;
      namespace?: string;
      format?: "udl" | "xml";
    };

    // Validate raw input BEFORE stripping `.cls` so `"../foo.cls"` is
    // rejected on the raw input, not on the post-strip `../foo`.
    const nameError = validateDocName(name);
    if (nameError) {
      return {
        content: [{ type: "text" as const, text: nameError }],
        isError: true,
      };
    }

    const ns = ctx.resolveNamespace(namespace);
    const candidates = buildRoutineCandidates(name);
    const candidatesTried: string[] = [];

    for (const candidate of candidates) {
      candidatesTried.push(candidate);

      const encoded = encodeURIComponent(candidate);
      const params = new URLSearchParams();
      if (format) params.set("format", format);
      const qs = params.toString();
      const path = atelierPath(ctx.atelierVersion, ns, `doc/${encoded}`) + (qs ? `?${qs}` : "");

      try {
        const response = await ctx.http.get(path);
        // Atelier doc responses: { result: { name, cat, content: string[] } }
        const docResult = response.result as { name?: string; cat?: string; content?: string[] } | undefined;
        const lines = Array.isArray(docResult?.content) ? docResult.content : [];
        const content = lines.join("\n");

        const structured = {
          name,
          resolvedDoc: candidate,
          namespace: ns,
          content,
          candidatesTried,
        };

        const header = `[IRIS routine] name=${docResult?.name ?? candidate} cat=${docResult?.cat ?? "unknown"}`;
        const textBlob = content.length > 0 ? `${header}\n${content}` : header;

        return {
          content: [{ type: "text" as const, text: textBlob }],
          structuredContent: structured,
        };
      } catch (error: unknown) {
        if (error instanceof IrisApiError && error.statusCode === 404) {
          // Fall through to next candidate
          continue;
        }
        if (
          error instanceof IrisApiError &&
          (error.statusCode === 401 || error.statusCode === 403)
        ) {
          // Auth fail-fast — no point trying next candidate, it will
          // also fail with the same status.
          const authStructured = {
            name,
            namespace: ns,
            candidatesTried,
            statusCode: error.statusCode,
            message: `Authentication or authorization failed (HTTP ${error.statusCode}) while fetching routine for '${name}' in namespace '${ns}'.`,
          };
          return {
            content: [
              {
                type: "text" as const,
                text: authStructured.message,
              },
            ],
            structuredContent: authStructured,
            isError: true,
          };
        }
        // 5xx / other IrisApiError / non-IrisApiError (network misconfig) — re-throw.
        throw error;
      }
    }

    // All candidates 404.
    const notFoundStructured = {
      name,
      namespace: ns,
      candidatesTried,
      hint:
        "No compiled intermediate routine found. The class may not be compiled in this namespace — try iris_doc_compile first.",
    };
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(notFoundStructured, null, 2),
        },
      ],
      structuredContent: notFoundStructured,
      isError: true,
    };
  },
};
