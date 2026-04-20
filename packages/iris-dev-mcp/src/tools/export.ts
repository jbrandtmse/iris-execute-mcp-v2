/**
 * Bulk document export tool for the IRIS Development MCP server.
 *
 * Provides {@link docExportTool} — the inverse of {@link docLoadTool}.
 * Enumerates documents in an IRIS namespace via Atelier
 * `GET /docnames/{cat}/{type}` (or `/modified/{ts}`), fetches each
 * matching document's content, and writes it to a local directory
 * tree where dotted package segments become subdirectories.
 *
 * Design highlights
 * - Bounded concurrency (4 workers) — per-file writes stream to disk,
 *   no full-batch in-memory buffering.
 * - Overwrite tri-state (`never`/`ifDifferent`/`always`) for cheap
 *   re-syncs.
 * - Windows MAX_PATH workaround via `useShortPaths`.
 * - Manifest written once at the end (`.manifest.json.tmp` →
 *   `manifest.json`), including any skipped items and an optional
 *   `shortPathMap` for round-trip recovery.
 * - Path-traversal hard guard on both `destinationDir` and each
 *   resolved file path.
 * - Cancellation detachment: by default the loop does not check
 *   `ctx.signal` between workers, so already-in-progress exports run
 *   to completion. Note that the underlying `IrisHttpClient` may still
 *   attach its own cancellation semantics — the loop itself just
 *   refuses to propagate the external signal into its polling check.
 *   Set `continueDownloadOnTimeout: false` to honor the signal and
 *   return a partial manifest.
 * - Progress notifications (best-effort — emitted only if the
 *   context exposes a `sendProgress` hook; silent fallthrough
 *   otherwise).
 */

import { promises as fsp } from "node:fs";
import * as path from "node:path";
import {
  atelierPath,
  IrisApiError,
  type ToolContext,
  type ToolDefinition,
} from "@iris-mcp/shared";
import { z } from "zod";
import { booleanParam } from "./zod-helpers.js";
import { docNameToFilePath } from "./load.js";
import { extractAtelierContentArray } from "./doc.js";

// ── Constants ─────────────────────────────────────────────────────────

/** Bounded concurrency for per-doc `GET /doc/{name}` fetches. */
const CONCURRENCY = 4;

/** Windows MAX_PATH threshold. */
const WINDOWS_MAX_PATH = 260;

/** Progress throttling: emit at most every N files. */
const PROGRESS_EMIT_INTERVAL_FILES = 50;

/** Progress throttling: emit at most every N milliseconds. */
const PROGRESS_EMIT_INTERVAL_MS = 2000;

/**
 * Cap on the number of `skippedItems[]` entries emitted in the response
 * envelope. When more entries than this are skipped, the response carries
 * only the first {@link RESPONSE_SKIPPED_CAP} entries and a
 * `skippedItemsTruncated: true` signal. The on-disk `manifest.json` is
 * authoritative and stays uncapped.
 *
 * Rationale: an unfiltered `%SYS` export can skip 2,000+ items (each CSP
 * static-asset 404 surfaces as a skip), producing a 500+ KB response
 * envelope that exceeds the MCP token cap. The manifest on disk still
 * carries the full list for forensic use.
 */
const RESPONSE_SKIPPED_CAP = 50;

// ── Types ─────────────────────────────────────────────────────────────

interface SkippedItem {
  docName: string;
  reason: string;
  hint?: string;
}

interface ManifestFile {
  docName: string;
  localPath: string;
  bytes: number;
  modifiedOnServer?: string;
}

interface Manifest {
  namespace: string;
  exportedAt: string;
  filtersApplied: Record<string, unknown>;
  files: ManifestFile[];
  skipped: SkippedItem[];
  shortPathMap: Record<string, string> | null;
  aborted?: boolean;
  partial?: boolean;
}

interface ExportResult {
  destinationDir: string;
  namespace: string;
  filtersApplied: Record<string, unknown>;
  total: number;
  exported: number;
  skipped: number;
  skippedItems: SkippedItem[];
  /**
   * Present (and always `true`) when `skippedItems[]` was capped at
   * {@link RESPONSE_SKIPPED_CAP} in the response envelope. Absent when
   * the skipped list fit within the cap. The on-disk `manifest.json`
   * always carries the full list.
   */
  skippedItemsTruncated?: true;
  manifest?: string;
  durationMs: number;
  partial?: boolean;
  aborted?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Normalise the content payload returned by Atelier's `GET /doc/{name}`
 * into a UTF-8 byte Buffer we can write to disk.
 *
 * Atelier returns `{ name, content: [line, line, …] }` (array of lines)
 * for source files. We rejoin with `\n`. For XML-format responses the
 * `content` may be a single string; handle that gracefully.
 */
function contentToBuffer(result: unknown): Buffer {
  const r = result as { content?: unknown };
  const c = r?.content;
  if (Array.isArray(c)) {
    return Buffer.from((c as unknown[]).map((x) => String(x)).join("\n"), "utf-8");
  }
  if (typeof c === "string") {
    return Buffer.from(c, "utf-8");
  }
  return Buffer.from("", "utf-8");
}

/** Pull a doc name (string) out of an Atelier /docnames or /modified entry. */
function extractDocName(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  const name = (entry as { name?: unknown })?.name;
  return typeof name === "string" ? name : undefined;
}

/** Pull the server-modified timestamp out of an Atelier entry, if any. */
function extractServerTimestamp(entry: unknown): string | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const ts = (entry as { ts?: unknown; db?: unknown; upd?: unknown }).ts;
  return typeof ts === "string" ? ts : undefined;
}

/**
 * Hard-reject any user-supplied path that contains `..` segments or
 * that does not resolve to an absolute location on disk.
 *
 * Returns an error message string, or `undefined` if the path is safe.
 */
function validateDestinationDir(destinationDir: string): string | undefined {
  if (typeof destinationDir !== "string" || destinationDir.length === 0) {
    return "destinationDir must be a non-empty string";
  }
  // Reject if the raw input contains traversal syntax.
  const norm = destinationDir.replace(/\\/g, "/");
  if (norm.split("/").some((seg) => seg === "..")) {
    return `destinationDir '${destinationDir}' must not contain '..' (path traversal)`;
  }
  if (!path.isAbsolute(destinationDir)) {
    return `destinationDir '${destinationDir}' must be an absolute path`;
  }
  return undefined;
}

/**
 * Assert that a resolved local path stays inside the destinationDir
 * root. Throws on escape (returned as a hard error — not a skip —
 * because this would indicate a server-controlled doc name trying to
 * write outside the caller's chosen sandbox).
 */
function assertInsideRoot(resolvedPath: string, root: string): void {
  const rootResolved = path.resolve(root);
  const rootWithSep = rootResolved.endsWith(path.sep)
    ? rootResolved
    : rootResolved + path.sep;
  if (resolvedPath !== rootResolved && !resolvedPath.startsWith(rootWithSep)) {
    throw new Error(
      `Refusing to write '${resolvedPath}': resolves outside destinationDir '${rootResolved}'`,
    );
  }
}

/**
 * Best-effort progress emitter. The MCP SDK may or may not expose a
 * progress hook on the tool context — if not, this is a silent no-op.
 */
function emitProgress(ctx: ToolContext, progress: number, total: number): void {
  // The shared ToolContext interface doesn't declare sendProgress, but
  // individual transports may attach one. Probe via a safe cast so we
  // don't block Story 10.2 on MCP SDK changes.
  const hook = (ctx as unknown as {
    sendProgress?: (arg: { progress: number; total: number }) => void;
  }).sendProgress;
  if (typeof hook === "function") {
    try {
      hook({ progress, total });
    } catch {
      // Deliberately swallow — progress is best-effort only.
    }
  }
}

// ── iris_doc_export ───────────────────────────────────────────────────

export const docExportTool: ToolDefinition = {
  name: "iris_doc_export",
  title: "Bulk Export Documents to Local Files",
  description:
    "Download every document matching a filter from an IRIS namespace to a local " +
    "directory. Dots in dotted class names become subdirectories " +
    "('EnsLib.HTTP.GenericService.cls' → '<destinationDir>/EnsLib/HTTP/GenericService.cls'). " +
    "CSP paths keep their forward slashes. Writes a manifest.json recording every file " +
    "and every skipped item with a reason. Supports prefix/category/type filters, " +
    "system/generated tri-states, modifiedSince incremental exports, overwrite policies " +
    "(never/ifDifferent/always), Windows long-path workaround via useShortPaths, " +
    "bounded concurrency, and cancellation tolerance. Inverse of iris_doc_load. " +
    "Note: some namespaces include CSP static assets (e.g., /csp/.../*.css) in docnames " +
    "but return 404 on fetch — pass category: \"CLS\" or \"RTN\" to exclude them.",
  inputSchema: z.object({
    destinationDir: z
      .string()
      .describe(
        "Absolute local directory to write files into (e.g., 'C:/dev/iris-export' " +
        "or '/home/alice/iris-export'). Created recursively if it does not exist. " +
        "Must NOT contain '..'. Path traversal attempts are rejected.",
      ),
    prefix: z
      .string()
      .optional()
      .describe(
        "Narrow results to documents whose dotted name starts with this value " +
        "(e.g., 'EnsLib', 'MyApp.Services'). Matches 'prefix.*' and 'prefix' itself. " +
        "Applied client-side — Atelier's filter param is SQL LIKE substring, " +
        "not prefix, so cannot be used here.",
      ),
    category: z
      .enum(["CLS", "RTN", "CSP", "OTH", "*"])
      .optional()
      .describe(
        "Document category. CLS = classes (.cls). RTN = routines " +
        "(.mac/.int/.inc/.bas/.mvi/.mvb). CSP = CSP/ZEN pages. " +
        "OTH = other Studio document types. * = all (default).",
      ),
    type: z
      .string()
      .optional()
      .describe(
        "Document type within category — the file extension without the dot " +
        "(e.g., 'cls', 'mac', 'inc'). Default: all types in the chosen category.",
      ),
    generated: z
      .enum(["true", "false", "both"])
      .optional()
      .describe(
        "Generated-documents tri-state: 'false' (default) returns only source " +
        "documents; 'true' returns only generated; 'both' returns everything.",
      ),
    system: z
      .enum(["true", "false", "only"])
      .optional()
      .describe(
        "System-package tri-state: 'false' (default) excludes '%*'; " +
        "'true' includes both user and system; 'only' returns only '%*'.",
      ),
    modifiedSince: z
      .string()
      .optional()
      .describe(
        "ISO 8601 timestamp (e.g., '2026-04-05T00:00:00Z'). When provided, only " +
        "documents modified since this time are exported (uses Atelier /modified/ " +
        "endpoint).",
      ),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
    includeManifest: booleanParam
      .optional()
      .describe(
        "When true (default), write a manifest.json into destinationDir listing " +
        "every file exported and every skipped item with its reason.",
      ),
    ignoreErrors: booleanParam
      .optional()
      .describe(
        "When true (default), per-document failures are logged to skippedItems " +
        "and the batch continues. When false, the first error aborts the run " +
        "with isError: true, partial: true.",
      ),
    useShortPaths: booleanParam
      .optional()
      .describe(
        "When true (Windows only; ignored on non-Windows), each package segment is " +
        "truncated to its first 8 characters to stay under MAX_PATH (260 chars). " +
        "The manifest records the original-to-short mapping for round-tripping.",
      ),
    overwrite: z
      .enum(["never", "ifDifferent", "always"])
      .optional()
      .describe(
        "Overwrite policy for files that already exist at the target path: " +
        "'never' (skip with reason 'exists'), 'ifDifferent' (default; byte-compare " +
        "and skip unchanged files), 'always' (rewrite unconditionally).",
      ),
    continueDownloadOnTimeout: booleanParam
      .optional()
      .describe(
        "When true (default), the download loop ignores the MCP request's " +
        "AbortSignal — already-written files stay on disk and the manifest is " +
        "written at the end even if the client cancels. When false, cancellation " +
        "aborts immediately and returns partial: true with aborted: true in the manifest.",
      ),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const startedAt = Date.now();
    const a = args as {
      destinationDir: string;
      prefix?: string;
      category?: string;
      type?: string;
      generated?: "true" | "false" | "both";
      system?: "true" | "false" | "only";
      modifiedSince?: string;
      namespace?: string;
      includeManifest?: boolean;
      ignoreErrors?: boolean;
      useShortPaths?: boolean;
      overwrite?: "never" | "ifDifferent" | "always";
      continueDownloadOnTimeout?: boolean;
    };

    // ── Argument normalisation with defaults ──────────────────────
    const destinationDir = a.destinationDir;
    const prefix = a.prefix;
    const category = a.category ?? "*";
    const type = a.type ?? "*";
    const generated = a.generated ?? "false";
    const system = a.system ?? "false";
    const modifiedSince = a.modifiedSince;
    const includeManifest = a.includeManifest !== false; // default true
    const ignoreErrors = a.ignoreErrors !== false; // default true
    const useShortPaths = a.useShortPaths === true; // default false
    const overwrite = a.overwrite ?? "ifDifferent";
    const continueDownloadOnTimeout = a.continueDownloadOnTimeout !== false; // default true

    const ns = ctx.resolveNamespace(a.namespace);

    // ── Validate destinationDir (path-traversal hard guard) ───────
    const validationError = validateDestinationDir(destinationDir);
    if (validationError) {
      return {
        content: [{ type: "text", text: validationError }],
        isError: true,
      };
    }

    const rootAbs = path.resolve(destinationDir);
    const useShort = useShortPaths && process.platform === "win32";

    const filtersApplied: Record<string, unknown> = {
      ...(prefix !== undefined ? { prefix } : {}),
      category,
      type,
      generated,
      system,
      ...(modifiedSince !== undefined ? { modifiedSince } : {}),
    };

    // ── Enumerate docs via Atelier ────────────────────────────────
    let fullPath: string;
    if (modifiedSince) {
      fullPath = atelierPath(
        ctx.atelierVersion,
        ns,
        `modified/${encodeURIComponent(modifiedSince)}`,
      );
    } else {
      const base = atelierPath(ctx.atelierVersion, ns, `docnames/${category}/${type}`);
      const params = new URLSearchParams();
      // generated: "both" → omit param; "true"/"false" → 1/0
      if (generated !== "both") {
        params.set("generated", generated === "true" ? "1" : "0");
      }
      const queryString = params.toString();
      fullPath = queryString ? `${base}?${queryString}` : base;
    }

    const listResponse = await ctx.http.get(fullPath);
    const enumerated = extractAtelierContentArray(listResponse.result);

    // ── Client-side filtering ─────────────────────────────────────
    // Prefix (string match on stem; applied to full docName) and
    // system tri-state (same logic as packages.ts).
    const matches: Array<{ docName: string; serverTs?: string }> = [];
    for (const entry of enumerated) {
      const docName = extractDocName(entry);
      if (!docName) continue;

      // System tri-state
      const isSystem = docName.startsWith("%");
      if (system === "false" && isSystem) continue;
      if (system === "only" && !isSystem) continue;

      // Prefix filter (match "prefix.*" or "prefix" exactly)
      if (prefix !== undefined && prefix.length > 0) {
        if (docName !== prefix && !docName.startsWith(prefix + ".")) {
          continue;
        }
      }

      const serverTs = extractServerTimestamp(entry);
      matches.push({ docName, ...(serverTs !== undefined ? { serverTs } : {}) });
    }

    const total = matches.length;

    // ── Early-exit: empty result ──────────────────────────────────
    if (total === 0) {
      const durationMs = Date.now() - startedAt;
      const result: ExportResult = {
        destinationDir: rootAbs,
        namespace: ns,
        filtersApplied,
        total: 0,
        exported: 0,
        skipped: 0,
        skippedItems: [],
        durationMs,
      };
      return {
        content: [
          { type: "text", text: `No documents matched — nothing to export from namespace '${ns}'.` },
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: result,
      };
    }

    // ── Create destinationDir ──────────────────────────────────────
    await fsp.mkdir(rootAbs, { recursive: true });

    // ── Shared mutable state across workers ───────────────────────
    const exportedFiles: ManifestFile[] = [];
    const skippedItems: SkippedItem[] = [];
    const shortPathMap = new Map<string, string>();
    // Reserved absolute paths → the docName that claimed them first.
    // Protects against `useShortPaths` 8-char truncation collisions
    // (e.g., "ReallyLongFoo.MyClass.cls" and "ReallyLongBar.MyClass.cls"
    // both map to "<root>/ReallyLo/MyClass.cls" — the second one would
    // silently overwrite the first without this check).
    const reservedPaths = new Map<string, string>();
    let exportedCount = 0;
    let aborted = false;
    let hardError: Error | undefined;

    // Cancellation handling. When continueDownloadOnTimeout is true,
    // we detach from ctx.signal. When false, we honor it.
    // NOTE: The shared ToolContext interface does not currently expose
    // an AbortSignal — this probe is defensive for future transports.
    const externalSignal = (ctx as unknown as { signal?: AbortSignal }).signal;
    let honorSignal = false;
    if (!continueDownloadOnTimeout && externalSignal instanceof AbortSignal) {
      honorSignal = true;
    }

    // Progress throttling state
    let lastEmitAt = 0;
    let emittedSinceLast = 0;

    const maybeEmitProgress = (force = false): void => {
      emittedSinceLast += 1;
      const now = Date.now();
      const shouldEmit =
        force ||
        emittedSinceLast >= PROGRESS_EMIT_INTERVAL_FILES ||
        (now - lastEmitAt) >= PROGRESS_EMIT_INTERVAL_MS;
      if (shouldEmit) {
        emitProgress(ctx, exportedCount + skippedItems.length, total);
        lastEmitAt = now;
        emittedSinceLast = 0;
      }
    };

    // ── Per-document worker ───────────────────────────────────────
    const processOne = async (match: { docName: string; serverTs?: string }): Promise<void> => {
      const { docName, serverTs } = match;

      if (honorSignal && externalSignal?.aborted) {
        aborted = true;
        return;
      }
      if (aborted || hardError) return;

      // Compute local path
      const relPath = docNameToFilePath(docName, "", useShort ? { useShortPaths: true } : undefined)
        .replace(/^\/+/, "");
      const absPath = path.resolve(rootAbs, relPath);

      // Path-traversal guard — hard error if we would escape the sandbox.
      try {
        assertInsideRoot(absPath, rootAbs);
      } catch (err: unknown) {
        hardError = err instanceof Error ? err : new Error(String(err));
        return;
      }

      // Windows MAX_PATH check (applies always on win32 regardless of useShort)
      if (process.platform === "win32" && absPath.length >= WINDOWS_MAX_PATH) {
        skippedItems.push({
          docName,
          reason: "ENAMETOOLONG: local path exceeds 260 characters on Windows",
          hint: "Rerun with useShortPaths: true, or enable Windows long-path support in the registry (LongPathsEnabled).",
        });
        maybeEmitProgress();
        return;
      }

      // Short-path collision detection: if another docName has already
      // reserved this absolute path (only possible when useShort truncates
      // different package prefixes to the same 8-char stub), skip this one
      // rather than silently overwriting the first. We reserve synchronously
      // here — the `fsp.writeFile` below is the commit step, but the
      // reservation in the shared map prevents two workers from both
      // deciding to write to the same path concurrently. Node's single-
      // threaded event loop guarantees the get/set pair is atomic relative
      // to other workers since no `await` separates them.
      const existingClaim = reservedPaths.get(absPath);
      if (existingClaim !== undefined && existingClaim !== docName) {
        skippedItems.push({
          docName,
          reason: `short-path collision: resolves to same local path as '${existingClaim}'`,
          hint: "Disable useShortPaths (requires long-path support) or filter the exports to avoid the collision.",
        });
        maybeEmitProgress();
        return;
      }
      reservedPaths.set(absPath, docName);

      // If useShortPaths produced a different local path, record the mapping.
      if (useShort) {
        const fullRelPath = docNameToFilePath(docName, "").replace(/^\/+/, "");
        if (fullRelPath !== relPath) {
          shortPathMap.set(fullRelPath, relPath);
        }
      }

      // Fetch doc content
      let buf: Buffer;
      try {
        const encodedName = encodeURIComponent(docName);
        const apiPath = atelierPath(ctx.atelierVersion, ns, `doc/${encodedName}`);
        const response = await ctx.http.get(apiPath);
        buf = contentToBuffer(response.result);
      } catch (err: unknown) {
        const msg =
          err instanceof IrisApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        if (ignoreErrors) {
          skippedItems.push({ docName, reason: `fetch failed: ${msg}` });
          maybeEmitProgress();
          return;
        }
        hardError = err instanceof Error ? err : new Error(msg);
        return;
      }

      // Overwrite policy
      try {
        const parent = path.dirname(absPath);
        await fsp.mkdir(parent, { recursive: true });

        let existing: Buffer | undefined;
        try {
          existing = await fsp.readFile(absPath);
        } catch {
          existing = undefined;
        }

        if (existing !== undefined) {
          if (overwrite === "never") {
            skippedItems.push({ docName, reason: "exists" });
            maybeEmitProgress();
            return;
          }
          if (overwrite === "ifDifferent" && existing.equals(buf)) {
            // Unchanged — counted as exported (on-disk state is correct).
            const relForManifest = path.relative(rootAbs, absPath).replace(/\\/g, "/");
            exportedFiles.push({
              docName,
              localPath: relForManifest,
              bytes: buf.length,
              ...(serverTs ? { modifiedOnServer: serverTs } : {}),
            });
            exportedCount += 1;
            maybeEmitProgress();
            return;
          }
        }

        await fsp.writeFile(absPath, buf);
        const relForManifest = path.relative(rootAbs, absPath).replace(/\\/g, "/");
        exportedFiles.push({
          docName,
          localPath: relForManifest,
          bytes: buf.length,
          ...(serverTs ? { modifiedOnServer: serverTs } : {}),
        });
        exportedCount += 1;
        maybeEmitProgress();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (ignoreErrors) {
          skippedItems.push({ docName, reason: `write failed: ${msg}` });
          maybeEmitProgress();
          return;
        }
        hardError = err instanceof Error ? err : new Error(msg);
      }
    };

    // ── Pool runner: 4 workers pulling from the matches queue ─────
    // We deliberately don't propagate ctx.signal into the worker
    // polling check when continueDownloadOnTimeout is true; the loop
    // runs to completion even if the MCP client has given up.
    // (The HTTP layer may still apply its own cancellation; this
    // loop does not opt in to or out of that behavior.)
    let cursor = 0;
    const runWorker = async (): Promise<void> => {
      while (true) {
        if (aborted || hardError) return;
        if (honorSignal && externalSignal?.aborted) {
          aborted = true;
          return;
        }
        const idx = cursor;
        if (idx >= matches.length) return;
        cursor = idx + 1;
        const match = matches[idx];
        if (!match) return;
        await processOne(match);
      }
    };

    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(CONCURRENCY, matches.length); i++) {
      workers.push(runWorker());
    }
    await Promise.allSettled(workers);

    // Final progress emit (100%)
    emitProgress(ctx, exportedCount + skippedItems.length, total);

    // ── Hard error (ignoreErrors: false path) ─────────────────────
    if (hardError) {
      const durationMs = Date.now() - startedAt;
      const isPartialSkippedTruncated = skippedItems.length > RESPONSE_SKIPPED_CAP;
      const partialResult: ExportResult = {
        destinationDir: rootAbs,
        namespace: ns,
        filtersApplied,
        total,
        exported: exportedCount,
        skipped: skippedItems.length,
        skippedItems: isPartialSkippedTruncated
          ? skippedItems.slice(0, RESPONSE_SKIPPED_CAP)
          : skippedItems,
        ...(isPartialSkippedTruncated ? { skippedItemsTruncated: true } : {}),
        durationMs,
        partial: true,
      };

      // Still write a manifest so the caller can recover. Flag
      // `partial: true` so the on-disk manifest is self-describing —
      // a caller reading manifest.json alone can tell this run did
      // not complete cleanly.
      if (includeManifest) {
        try {
          const manifestPath = await writeManifest({
            rootAbs,
            namespace: ns,
            filtersApplied,
            exportedFiles,
            skippedItems,
            shortPathMap,
            useShort,
            aborted: false,
            partial: true,
          });
          partialResult.manifest = manifestPath;
        } catch {
          // Don't let manifest-write failure obscure the underlying error.
        }
      }

      return {
        content: [
          { type: "text", text: `Export failed: ${hardError.message}` },
          { type: "text", text: JSON.stringify(partialResult, null, 2) },
        ],
        structuredContent: partialResult,
        isError: true,
      };
    }

    // ── Write manifest ─────────────────────────────────────────────
    let manifestPath: string | undefined;
    if (includeManifest) {
      manifestPath = await writeManifest({
        rootAbs,
        namespace: ns,
        filtersApplied,
        exportedFiles,
        skippedItems,
        shortPathMap,
        useShort,
        aborted,
      });
    }

    const durationMs = Date.now() - startedAt;
    const isSkippedTruncated = skippedItems.length > RESPONSE_SKIPPED_CAP;
    const result: ExportResult = {
      destinationDir: rootAbs,
      namespace: ns,
      filtersApplied,
      total,
      exported: exportedCount,
      skipped: skippedItems.length,
      skippedItems: isSkippedTruncated
        ? skippedItems.slice(0, RESPONSE_SKIPPED_CAP)
        : skippedItems,
      ...(isSkippedTruncated ? { skippedItemsTruncated: true } : {}),
      ...(manifestPath ? { manifest: manifestPath } : {}),
      durationMs,
      ...(aborted ? { partial: true, aborted: true } : {}),
    };

    const skipSuffix = isSkippedTruncated
      ? `${skippedItems.length} skipped items; showing first ${RESPONSE_SKIPPED_CAP}. Full list in manifest.json. `
      : "";
    const summary =
      skipSuffix +
      `Exported ${exportedCount}/${total} document(s) from namespace '${ns}' to '${rootAbs}'` +
      (skippedItems.length > 0 && !isSkippedTruncated
        ? ` (${skippedItems.length} skipped)`
        : "") +
      (aborted ? " — aborted before completion" : "") +
      ".";

    return {
      content: [
        { type: "text", text: summary },
        { type: "text", text: JSON.stringify(result, null, 2) },
      ],
      structuredContent: result,
      ...(aborted ? { isError: true } : {}),
    };
  },
};

// ── Manifest helpers ──────────────────────────────────────────────────

/**
 * Write the manifest JSON atomically:
 *   1. Serialize the Manifest object.
 *   2. Write to `<root>/.manifest.json.tmp`.
 *   3. fs.rename → `<root>/manifest.json`.
 *
 * Returns the final absolute path to `manifest.json`.
 */
async function writeManifest(opts: {
  rootAbs: string;
  namespace: string;
  filtersApplied: Record<string, unknown>;
  exportedFiles: ManifestFile[];
  skippedItems: SkippedItem[];
  shortPathMap: Map<string, string>;
  useShort: boolean;
  aborted: boolean;
  partial?: boolean;
}): Promise<string> {
  const manifest: Manifest = {
    namespace: opts.namespace,
    exportedAt: new Date().toISOString(),
    filtersApplied: opts.filtersApplied,
    files: opts.exportedFiles,
    skipped: opts.skippedItems,
    shortPathMap: opts.useShort
      ? Object.fromEntries(opts.shortPathMap.entries())
      : null,
    ...(opts.aborted ? { aborted: true } : {}),
    ...(opts.partial ? { partial: true } : {}),
  };

  const tmpPath = path.join(opts.rootAbs, ".manifest.json.tmp");
  const finalPath = path.join(opts.rootAbs, "manifest.json");

  await fsp.writeFile(tmpPath, JSON.stringify(manifest, null, 2), "utf-8");
  await fsp.rename(tmpPath, finalPath);

  return finalPath;
}
