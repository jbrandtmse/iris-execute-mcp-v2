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

import { atelierPath, type ToolContext, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";
import {
  checkCouldNotRunText,
  isCheckableClass,
  isCheckableRoutine,
  notConfirmedText,
  unconfirmedDocuments,
} from "./compile-check.js";
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

// ── Compile check (Story 44.7, DW-754) ─────────────────────────────

/** True when a document name carries a wildcard that IRIS expands (`*` any run, `?` one character). */
function hasWildcard(name: string): boolean {
  return /[*?]/.test(name);
}

/** An anchored, case-insensitive regex for a document name or wildcard pattern: `*` is any run, `?` one character. */
function wildcardRegex(pattern: string): RegExp {
  const source = [...pattern]
    .map((ch) => (ch === "*" ? ".*" : ch === "?" ? "." : ch.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${source}$`, "i");
}

/** The most documents the wildcard patterns of one compile may expand to for the check; a pattern past it is not expanded. */
export const MAX_EXPANDED_DOCUMENTS = 1000;

/** What the check covers: the documents it judges, and the wildcard patterns whose matches it leaves to IRIS's answer. */
interface Coverage {
  documents: string[];
  unchecked: string[];
}

/** The note a result carries when wildcard patterns were not expanded for the check. */
function uncheckedNote(patterns: readonly string[]): string {
  return (
    `the compile check did not judge the documents matched by ${patterns.join(", ")}: a wildcard with no literal prefix, one ` +
    `in the extension, or one that matches more than ${MAX_EXPANDED_DOCUMENTS} documents, is not expanded, so IRIS's answer ` +
    "alone decided them. Name the documents, or use a pattern with a package prefix and a .cls or .mac extension, to have " +
    "them checked."
  );
}

/**
 * The documents the compile of `docs` covers, for the check: concrete `.cls` and `.mac` names as given, and each `.cls` or `.mac`
 * wildcard pattern expanded through `docnames` (IRIS expands it for the compile itself, so the tool has to know what it matched).
 * `GET docnames/CLS|RTN?filter=<literal prefix>` is a "name contains" read, so the entries are kept only when the whole name
 * matches the pattern, and generated documents are skipped. A name with a leading `'` is an exclusion: what it matches is
 * removed. Other documents (`.inc`, `.int`, ...) are not checked. A pattern that matches nothing adds nothing.
 *
 * Bounded (Rule #38): a pattern with no literal prefix (`*.cls`) would list the whole namespace, so it is never listed; and a
 * pattern whose matches would take the expanded total past {@link MAX_EXPANDED_DOCUMENTS} is not expanded. A pattern with a
 * wildcard in its extension (`Pkg.*`) names no extension the check can judge. All three are returned in `unchecked`, and the
 * explicitly named documents are checked either way.
 */
async function documentsCovered(ctx: ToolContext, ns: string, docs: readonly string[]): Promise<Coverage> {
  const included: string[] = [];
  const excluded: RegExp[] = [];
  const unchecked: string[] = [];
  let expanded = 0;
  for (const raw of docs) {
    const isExclusion = raw.startsWith("'");
    const name = isExclusion ? raw.slice(1) : raw;
    if (!isExclusion && hasWildcard(name.slice(name.lastIndexOf(".") + 1))) {
      // `Pkg.*` or `*`: IRIS compiles classes and routines alike, and the pattern names no extension the check can judge.
      unchecked.push(name);
      continue;
    }
    if (!isCheckableClass(name) && !isCheckableRoutine(name)) continue;
    if (isExclusion) {
      excluded.push(wildcardRegex(name));
      continue;
    }
    if (!hasWildcard(name)) {
      included.push(name);
      continue;
    }
    const prefix = name.slice(0, name.search(/[*?]/));
    if (prefix === "") {
      unchecked.push(name);
      continue;
    }
    const listed = await ctx.http.get<{ content?: Array<{ name?: unknown; gen?: unknown }> }>(
      atelierPath(ctx.atelierVersion, ns, `docnames/${isCheckableClass(name) ? "CLS" : "RTN"}?filter=${encodeURIComponent(prefix)}`),
    );
    const entries = listed.result?.content;
    const pattern = wildcardRegex(name);
    const matches: string[] = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (entry.gen === true || typeof entry.name !== "string") continue;
      if (pattern.test(entry.name)) matches.push(entry.name);
    }
    if (expanded + matches.length > MAX_EXPANDED_DOCUMENTS) {
      unchecked.push(name);
      continue;
    }
    expanded += matches.length;
    included.push(...matches);
  }
  const seen = new Set<string>();
  const documents = included.filter((name) => {
    const key = name.toLowerCase();
    if (seen.has(key) || excluded.some((rx) => rx.test(name))) return false;
    seen.add(key);
    return true;
  });
  return { documents, unchecked };
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
      .describe(
        "When true, queue asynchronous compilation and return immediately with " +
          "`{mode: \"async\", docs, response}` — NOT a job ID for polling; there is no companion poll " +
          "route on this tool today (unlike iris_execute_tests' async work-queue contract). Use this " +
          "only to avoid a synchronous Web Gateway timeout on a very large package; the caller has no " +
          "built-in way to learn when compilation finishes or whether it succeeded.",
      ),
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

    // Story 44.7 (DW-754 and DW-759, AD-14): an HTTP 200 with no error listed is not proof that every document compiled.
    // IRIS answers so when one class or routine fails in a compile that also writes a persistent class's Storage, so the
    // class dictionary and IRIS's up-to-date flag decide for a class (`verifyCompiled`) and the flag for a `.mac` routine
    // (`verifyRoutinesCompiled`); neither reads localized text. Only a compile that listed no error is checked: one that
    // listed errors already fails, and a check that cannot run fails it too, never passes it.
    let checkNote: string | undefined;
    if (allErrors.length === 0) {
      try {
        const covered = await documentsCovered(ctx, ns, docs);
        if (covered.unchecked.length > 0) checkNote = uncheckedNote(covered.unchecked);
        for (const document of await unconfirmedDocuments(ctx.http, ns, ctx.atelierVersion, covered.documents)) {
          allErrors.push({ document, error: notConfirmedText(document) });
        }
      } catch (error: unknown) {
        allErrors.push({ document: "*", error: checkCouldNotRunText(error) });
      }
    }

    const hasErrors = allErrors.length > 0;

    const result = {
      success: !hasErrors,
      documents: docs,
      compilationTime: `${elapsed}ms`,
      ...(hasErrors ? { errors: allErrors } : {}),
      ...(checkNote !== undefined ? { checkNote } : {}),
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
