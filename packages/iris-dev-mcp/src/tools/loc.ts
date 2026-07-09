/**
 * Lines-of-code counter tool for the IRIS Development MCP server
 * (Epic 22, Story 22.0).
 *
 * Provides {@link locCountTool} — `iris_loc_count` — a thin wrapper over the
 * custom REST endpoint `GET /api/executemcp/v2/dev/loc`, which delegates to the
 * ObjectScript library `ExecuteMCPv2.Loc.*` (research decisions D1-D7). The
 * counter enumerates the NAMESPACE's document dictionary (decision D1 — not a
 * filesystem), buckets every line into blank / source code / source comment /
 * test code / test comment, and reports aggregate metrics + percentages plus a
 * capped top-N largest-documents list (decision D5).
 *
 * The `format` parameter is CLIENT-side rendering only (never sent to the
 * server): `summary` (default) renders the reference `cos_loc_counter.sh`
 * ASCII table; `csv` renders the reference tool's `metric,value` CSV rows
 * (snake_case keys, byte parity with its `--csv` output). `structuredContent`
 * is always the endpoint result object VERBATIM (object, never array).
 *
 * Read-only (`mutates: "read"` — Rule #28), scope NS. Wire-explicit defaults
 * per Rule #10: `includeGenerated` and `topN` are always sent.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

/** One per-document entry in the top-N largest-documents list (decision D5). */
interface LocTopDocument {
  name: string;
  type: string;
  totalLines: number;
  codeLoc: number;
  commentLoc: number;
  isTest: boolean;
}

/** Endpoint result shape (decisions D4 + D5). */
interface LocCountResult {
  filesParsed: number;
  totalLines: number;
  blankLines: number;
  sourceCodeLoc: number;
  sourceCommentLoc: number;
  testCodeLoc: number;
  testCommentLoc: number;
  codePct: number;
  sourceCodePct: number;
  testCodePct: number;
  commentPct: number;
  whitespacePct: number;
  topDocuments: LocTopDocument[];
  truncatedTopN: boolean;
}

/** One `| label | value |` row of the reference tool's ASCII table. */
function tableRow(label: string, value: string): string {
  return `| ${label.padEnd(25)} | ${value.padStart(9)} |`;
}

/**
 * Render one percentage at the reference tool's fixed one-decimal shape.
 * `Number(v ?? 0)` guards a malformed envelope (missing/non-numeric field)
 * from crashing the renderer with a TypeError — the same defensive posture as
 * diagram.ts's `result.diagrams ?? []` (CR 22.0-6). Well-formed values render
 * byte-identically to a direct `.toFixed(1)`.
 */
function fmtPct(v: number | undefined): string {
  const n = Number(v ?? 0);
  return (Number.isFinite(n) ? n : 0).toFixed(1);
}

/**
 * Render the reference tool's ASCII summary table (same labels, widths, and
 * separator shape as `cos_loc_counter.sh`).
 */
function renderSummaryTable(r: LocCountResult): string {
  const sep = "+---------------------------+-----------+";
  return [
    sep,
    tableRow("Metric", "Value"),
    sep,
    tableRow("Files Parsed", String(r.filesParsed)),
    tableRow("Total Lines (Raw)", String(r.totalLines)),
    tableRow("Blank Lines", String(r.blankLines)),
    tableRow("Source Code LOC", String(r.sourceCodeLoc)),
    tableRow("Source Comment LOC", String(r.sourceCommentLoc)),
    tableRow("Test Code LOC", String(r.testCodeLoc)),
    tableRow("Test Comment LOC", String(r.testCommentLoc)),
    sep,
    tableRow("Code %", `${fmtPct(r.codePct)}%`),
    tableRow("  Source Code %", `${fmtPct(r.sourceCodePct)}%`),
    tableRow("  Test Code %", `${fmtPct(r.testCodePct)}%`),
    tableRow("Comment %", `${fmtPct(r.commentPct)}%`),
    tableRow("Whitespace %", `${fmtPct(r.whitespacePct)}%`),
    sep,
  ].join("\n");
}

/**
 * Render the reference tool's `--csv` output: `metric,value` rows with the
 * reference snake_case metric keys.
 */
function renderCsv(r: LocCountResult): string {
  return [
    "metric,value",
    `files_parsed,${r.filesParsed}`,
    `total_lines,${r.totalLines}`,
    `blank_lines,${r.blankLines}`,
    `source_code_loc,${r.sourceCodeLoc}`,
    `source_comment_loc,${r.sourceCommentLoc}`,
    `test_code_loc,${r.testCodeLoc}`,
    `test_comment_loc,${r.testCommentLoc}`,
    `code_pct,${fmtPct(r.codePct)}`,
    `source_code_pct,${fmtPct(r.sourceCodePct)}`,
    `test_code_pct,${fmtPct(r.testCodePct)}`,
    `comment_pct,${fmtPct(r.commentPct)}`,
    `whitespace_pct,${fmtPct(r.whitespacePct)}`,
  ].join("\n");
}

// ── iris_loc_count ───────────────────────────────────────────

export const locCountTool: ToolDefinition = {
  name: "iris_loc_count",
  title: "Count Lines of Code",
  description:
    "Count lines of code in the namespace's ObjectScript documents (CLS, MAC, INT, INC), " +
    "bucketing every line as blank, source code, source comment, test code, or test " +
    "comment — with comment-density and test-footprint percentages plus the top-N " +
    "largest documents. Test code is detected via transitive %UnitTest.TestCase " +
    "inheritance and Test*/lifecycle method scoping; embedded-python method bodies " +
    "honor '#' comments. 'spec' is REQUIRED: a comma-delimited document spec with " +
    "*/? wildcards (e.g. 'MyPkg.*.cls,*.mac'). Scanning the WHOLE namespace requires " +
    "an explicit '*' and risks the ~60s REST gateway timeout on large namespaces — " +
    "prefer package-scoped specs. Compiler-generated documents (e.g. the .int code " +
    "generated from a class) are EXCLUDED by default because they double-count their " +
    "source; pass includeGenerated: true to count them. System (%-prefixed) documents " +
    "are excluded from wildcard scans; name them explicitly (e.g. '%Z*.cls') to count " +
    "them. Use non-overlapping spec parts: an exact document name listed before a " +
    "wildcard part that also matches it can drop documents (an IRIS StudioOpenDialog " +
    "spec quirk). This is an ALL-OR-NOTHING scan: if a matched document is deleted or " +
    "renamed between enumeration and retrieval (a rare TOCTOU race on a namespace " +
    "being edited concurrently), the whole call fails with an error naming the " +
    "vanished document rather than skipping it and returning partial results -- rerun " +
    "the call once the namespace is quiescent.",
  inputSchema: z.object({
    spec: z
      .string()
      .min(1)
      .describe(
        "Document spec to scan (REQUIRED; comma-delimited, */? wildcards; e.g. " +
          "'MyPkg.*.cls,*.mac'). Whole-namespace scans require an explicit '*' and " +
          "accept the gateway-timeout risk.",
      ),
    namespace: z
      .string()
      .optional()
      .describe(
        "Target namespace. Defaults to the server's configured namespace; pass an " +
          "explicit value to scan a different namespace per call without changing " +
          "the connection default.",
      ),
    includeGenerated: z
      .boolean()
      .optional()
      .describe(
        "Include compiler-generated documents such as the .int code generated from " +
          "a class (default: false — generated code double-counts its source)",
      ),
    topN: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe(
        "How many of the largest documents to list in topDocuments " +
          "(default: 20, max: 100)",
      ),
    format: z
      .enum(["summary", "csv"])
      .optional()
      .describe(
        "Text rendering: 'summary' (default) = the reference ASCII metrics table; " +
          "'csv' = metric,value rows. Client-side only — structuredContent always " +
          "carries the full result object.",
      ),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  // Governance (Rule #28): new post-foundation key — classification is mandatory
  // even for a pure read. Read → default-ENABLED via defaultSeed.
  mutates: "read",
  handler: async (args, ctx) => {
    const { spec, namespace, includeGenerated, topN, format } = args as {
      spec: string;
      namespace?: string;
      includeGenerated?: boolean;
      topN?: number;
      format?: "summary" | "csv";
    };

    // Client-side guard (mirrors sqlAnalyze's query.trim() guard): Zod's .min(1)
    // rejects the empty string, but a whitespace-only spec would otherwise reach
    // the server just to be refused there.
    if (spec.trim() === "") {
      return {
        content: [
          {
            type: "text" as const,
            text: "'spec' must be a non-empty document spec (e.g. 'MyPkg.*.cls,*.mac').",
          },
        ],
        isError: true,
      };
    }

    const ns = ctx.resolveNamespace(namespace);
    const params = new URLSearchParams();
    params.set("namespace", ns);
    params.set("spec", spec.trim());
    // Rule #10: send the documented defaults explicitly on the wire.
    params.set("includeGenerated", String(includeGenerated ?? false));
    params.set("topN", String(topN ?? 20));

    const path = `${BASE_URL}/dev/loc?${params}`;

    try {
      const response = await ctx.http.get(path);
      const result = response.result as LocCountResult;
      const text =
        (format ?? "summary") === "csv"
          ? renderCsv(result)
          : renderSummaryTable(result);
      return {
        content: [{ type: "text" as const, text }],
        // The endpoint result OBJECT verbatim (object, never array).
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error counting lines of code: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
