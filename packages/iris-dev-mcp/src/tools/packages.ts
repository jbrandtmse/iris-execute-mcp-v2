/**
 * Package listing tool for the IRIS Development MCP server.
 *
 * Provides {@link packageListTool} to list ObjectScript packages in a
 * namespace with depth-based rollup, prefix narrowing, and the same
 * category/type/generated/system/modifiedSince filters as
 * {@link docListTool}. Unlike `iris_doc_list`, this tool returns a
 * bounded structural summary (one row per package) rather than one row
 * per document.
 *
 * Implementation walks the Atelier `/docnames/{cat}/{type}` (or
 * `/modified/{ts}`) endpoint and aggregates client-side. No IRIS-side
 * class is involved.
 */

import { atelierPath, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";
import { booleanParam } from "./zod-helpers.js";
import { extractAtelierContentArray } from "./doc.js";

/**
 * Maximum number of package rows returned. Beyond this, the response is
 * truncated and `truncated: true` / `limit: PACKAGE_ROW_LIMIT` is set.
 */
export const PACKAGE_ROW_LIMIT = 1000;

/**
 * Regex matching the file-extension suffix on an Atelier document name.
 *
 * Atelier returns document names including their extension
 * (e.g., `"Foo.Bar.Baz.cls"`). To roll up by dotted package segments we
 * must strip the extension first, otherwise `"cls"` would be counted as
 * a terminal segment.
 */
const DOC_EXTENSION_RE = /\.(cls|mac|int|inc|bas|mvi|mvb|csp|csr)$/i;

/**
 * Strip the Atelier document extension (if any) from a document name.
 *
 * @example
 *   stripDocExtension("Foo.Bar.Baz.cls")  // => "Foo.Bar.Baz"
 *   stripDocExtension("Foo.Bar.Baz.CLS")  // => "Foo.Bar.Baz"
 *   stripDocExtension("NoExtension")       // => "NoExtension"
 */
export function stripDocExtension(name: string): string {
  return name.replace(DOC_EXTENSION_RE, "");
}

/**
 * Synthetic bucket name for documents that are not dotted ObjectScript
 * packages (e.g., CSP pages named with forward-slash paths like
 * `/csp/user/menu.csp`). Returned from {@link rollupPackage} whenever the
 * stem contains `/`, so these documents are counted but do not pollute
 * the rollup with one row per filesystem-style path.
 */
export const NON_CLASS_BUCKET = "(csp)";

/**
 * Roll a document name up to its first `depth` dotted segments.
 *
 * The extension is stripped before splitting; segments beyond `depth`
 * are discarded. If the stem has fewer than `depth` segments, the full
 * stem is returned (so a one-segment document at depth 3 still rolls up
 * to itself).
 *
 * Documents whose stem contains `/` (CSP pages, file-path-style names)
 * are bucketed under {@link NON_CLASS_BUCKET} instead of being split on
 * `.`. This prevents `/csp/user/menu.csp`-style names from each
 * producing their own single-doc package row in the output.
 *
 * @example
 *   rollupPackage("EnsLib.HTTP.Service.cls", 1) // => "EnsLib"
 *   rollupPackage("EnsLib.HTTP.Service.cls", 2) // => "EnsLib.HTTP"
 *   rollupPackage("EnsLib.HTTP.Service.cls", 3) // => "EnsLib.HTTP.Service"
 *   rollupPackage("Top.cls", 3)                  // => "Top"
 *   rollupPackage("/csp/user/menu.csp", 1)       // => "(csp)"
 */
export function rollupPackage(docName: string, depth: number): string {
  const stem = stripDocExtension(docName);
  if (stem.includes("/")) return NON_CLASS_BUCKET;
  const parts = stem.split(".");
  if (parts.length <= depth) return stem;
  return parts.slice(0, depth).join(".");
}

// ── iris_package_list ───────────────────────────────────────────────

export const packageListTool: ToolDefinition = {
  name: "iris_package_list",
  title: "List Packages",
  description:
    "List ObjectScript packages in a namespace, rolled up to a chosen dotted depth. " +
    "Use iris_package_list when you want a structural overview (what packages exist, " +
    "how many documents each contains); use iris_doc_list when you want individual " +
    "document names. Supports prefix narrowing, system-package tri-state, category/type " +
    "filters, and modifiedSince — the same filtering surface as iris_doc_list, aggregated " +
    "client-side into one row per package.",
  inputSchema: z.object({
    depth: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "How many dotted segments to roll up at (default: 1). depth=1 returns " +
        "top-level packages (e.g., 'EnsLib', 'Ens'); depth=3 returns e.g. " +
        "'EnsLib.HTTP.Service' as a single package row. When combined with " +
        "prefix, depth counts TOTAL segments (not segments past the prefix): " +
        "prefix='EnsLib', depth=2 returns 'EnsLib.HTTP', 'EnsLib.JMS', etc.",
      ),
    prefix: z
      .string()
      .optional()
      .describe(
        "Narrow results to packages starting with this dotted prefix " +
        "(e.g., 'EnsLib'). Matches documents whose name starts with " +
        "'<prefix>.' (and the prefix itself if a document is named exactly " +
        "that). Applied client-side — Atelier's filter param is SQL LIKE " +
        "substring, not prefix, so cannot be used here.",
      ),
    category: z
      .enum(["CLS", "RTN", "CSP", "OTH", "*"])
      .optional()
      .describe(
        "Document category filter. CLS = ObjectScript classes (.cls). " +
        "RTN = routines (.mac / .int / .inc / .bas / .mvi / .mvb). " +
        "CSP = CSP/ZEN pages and other web-facing files under /csp/. " +
        "OTH = other Studio document types. * = all categories (default).",
      ),
    type: z
      .string()
      .optional()
      .describe(
        "Document type filter within category — the file extension without " +
        "the dot (e.g., 'cls' for CLS, 'mac' or 'inc' for RTN). Default: " +
        "all types within the chosen category.",
      ),
    generated: booleanParam
      .optional()
      .describe("Include generated documents (default: false)"),
    system: z
      .enum(["true", "false", "only"])
      .optional()
      .describe(
        "System-package tri-state: 'false' (default) excludes '%*' packages; " +
        "'true' includes both system and user packages; 'only' returns only " +
        "'%*' system packages.",
      ),
    modifiedSince: z
      .string()
      .optional()
      .describe(
        "ISO 8601 timestamp — when provided, only documents modified since " +
        "this time contribute to the package rollup (uses the Atelier " +
        "/modified/ endpoint instead of /docnames/).",
      ),
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
      depth: depthArg,
      prefix,
      category,
      type,
      generated,
      system: systemArg,
      modifiedSince,
      namespace,
    } = args as {
      depth?: number;
      prefix?: string;
      category?: string;
      type?: string;
      generated?: boolean;
      system?: "true" | "false" | "only";
      modifiedSince?: string;
      namespace?: string;
    };

    const depth = depthArg ?? 1;
    const system = systemArg ?? "false";
    const ns = ctx.resolveNamespace(namespace);

    // ── Build the Atelier request path ────────────────────────────
    let fullPath: string;
    if (modifiedSince) {
      fullPath = atelierPath(
        ctx.atelierVersion,
        ns,
        `modified/${encodeURIComponent(modifiedSince)}`,
      );
    } else {
      const cat = category ?? "*";
      const typ = type ?? "*";
      const base = atelierPath(ctx.atelierVersion, ns, `docnames/${cat}/${typ}`);
      const params = new URLSearchParams();
      if (generated !== undefined) {
        params.set("generated", String(generated ? 1 : 0));
      }
      const queryString = params.toString();
      fullPath = queryString ? `${base}?${queryString}` : base;
    }

    const response = await ctx.http.get(fullPath);
    const allDocs = extractAtelierContentArray(response.result);

    // ── Client-side filtering + rollup ────────────────────────────
    // Apply prefix and system filters, then roll up remaining docs
    // into a Map<package, count>.
    const packageCounts = new Map<string, number>();
    let totalDocs = 0;

    for (const doc of allDocs) {
      const docName =
        typeof doc === "string" ? doc : (doc as { name?: unknown })?.name;
      if (typeof docName !== "string" || docName.length === 0) continue;

      // System-package tri-state on the first segment (pre-extension).
      const isSystem = docName.startsWith("%");
      if (system === "false" && isSystem) continue;
      if (system === "only" && !isSystem) continue;
      // system === "true" → include both.

      // Prefix filter: match <prefix>.* or exactly <prefix> (rare).
      if (prefix) {
        const stem = stripDocExtension(docName);
        if (stem !== prefix && !stem.startsWith(prefix + ".")) continue;
      }

      totalDocs += 1;
      const pkg = rollupPackage(docName, depth);
      packageCounts.set(pkg, (packageCounts.get(pkg) ?? 0) + 1);
    }

    // ── Sort: docCount desc, name asc ─────────────────────────────
    const sorted = Array.from(packageCounts.entries())
      .map(([name, docCount]) => ({ name, docCount, depth }))
      .sort((a, b) => {
        if (b.docCount !== a.docCount) return b.docCount - a.docCount;
        return a.name.localeCompare(b.name);
      });

    // ── Cap at PACKAGE_ROW_LIMIT ──────────────────────────────────
    const truncated = sorted.length > PACKAGE_ROW_LIMIT;
    const packages = truncated ? sorted.slice(0, PACKAGE_ROW_LIMIT) : sorted;

    // `totalDocs` is the number of documents that passed the prefix and
    // system filters and were fed into the rollup. It is NOT the raw
    // Atelier response size (that would include docs excluded by
    // client-side filtering). Summing every package row's `docCount`
    // will always equal `totalDocs`.
    const result: {
      packages: Array<{ name: string; docCount: number; depth: number }>;
      count: number;
      namespace: string;
      depth: number;
      prefix: string | null;
      totalDocs: number;
      truncated?: boolean;
      limit?: number;
    } = {
      packages,
      count: packages.length,
      namespace: ns,
      depth,
      prefix: prefix ?? null,
      totalDocs,
    };

    if (truncated) {
      result.truncated = true;
      result.limit = PACKAGE_ROW_LIMIT;
    }

    return {
      content: [
        { type: "text", text: JSON.stringify(result, null, 2) },
      ],
      structuredContent: result,
    };
  },
};
