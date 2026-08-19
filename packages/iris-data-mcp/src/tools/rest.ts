/**
 * REST API management tools for the IRIS Data & Analytics MCP server.
 *
 * Provides one tool for managing IRIS REST API dispatch classes:
 * - {@link restManageTool} — List, get details, or delete REST applications
 *
 * Most operations call the IRIS built-in Management API at
 * `/api/mgmnt/v2/{namespace}/...`.
 *
 * FEAT-2 (BREAKING, pre-release): `scope` values renamed:
 *   - `"spec-first"` (default) — Mgmnt v2 API, spec-first apps only
 *   - `"legacy"` (was `"all"`) — hand-written %CSP.REST subclasses only
 *   - `"all"` (new) — union of spec-first + legacy
 *
 * FEAT-6: `action:"get"` gains `fullSpec: boolean` (default false).
 *   Summary mode returns condensed swaggerSpec metadata; full mode returns raw blob.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";
import { extractResult, toStructured } from "./docdb.js";

/** Base URL for the IRIS Management REST API (spec-first apps only). */
const BASE_MGMNT_URL = "/api/mgmnt/v2";
/** Base URL for the custom ExecuteMCPv2 REST service (covers all %CSP.REST apps). */
const BASE_EXECUTEMCP_URL = "/api/executemcp/v2";

// ── Shared helpers ────────────────────────────────────────────

import type { ToolContext } from "@iris-mcp/shared";

/**
 * Fetch legacy (hand-written %CSP.REST) apps from ExecuteMCPv2 webapp endpoint.
 *
 * Filters for entries with a non-empty `dispatchClass` and normalizes
 * to the Mgmnt API response shape {name, dispatchClass, namespace, swaggerSpec: null}.
 *
 * Used by scope:"legacy" and scope:"all" (FEAT-2).
 */
async function fetchLegacyApps(
  ctx: ToolContext,
  ns: string,
): Promise<Array<{ name: unknown; dispatchClass: unknown; namespace: unknown; swaggerSpec: null }>> {
  const webappPath = `${BASE_EXECUTEMCP_URL}/security/webapp?namespace=${encodeURIComponent(ns)}`;
  const webappResponse = await ctx.http.get(webappPath);
  const rawWebapps = (webappResponse as { result?: unknown }).result;
  const webapps: Array<Record<string, unknown>> = Array.isArray(rawWebapps)
    ? (rawWebapps as Array<Record<string, unknown>>)
    : [];
  return webapps
    .filter((w) => {
      const dc = w.dispatchClass;
      return typeof dc === "string" && dc.length > 0;
    })
    .map((w) => ({
      name: w.name,
      dispatchClass: w.dispatchClass,
      namespace: w.namespace,
      swaggerSpec: null as null,
    }));
}

/**
 * Story 35.6 (AC 35.6.4): look up an application name in the legacy
 * (hand-written %CSP.REST) webapp list.
 *
 * Matching is EXACT and case-sensitive: webapp names are case-sensitive IRIS
 * configuration names, and `list` returns the exact registered name, so a
 * name the tool itself surfaced always matches byte-for-byte. Normalizing
 * case would risk resolving to a DIFFERENT registered webapp.
 *
 * The result distinguishes ABSENCE from LOOKUP FAILURE (code review, Story
 * 35.6): a failing fallback must never mask the accurate not-found message,
 * but a swallowed lookup failure must not be REPORTED as proven absence
 * either — that would be the same misdirection class this story removes.
 */
type LegacyLookup =
  | { ok: true; match: { name: unknown; dispatchClass: unknown; namespace: unknown; swaggerSpec: null } | null }
  | { ok: false; reason: string };

async function findLegacyApp(
  ctx: ToolContext,
  ns: string,
  application: string,
): Promise<LegacyLookup> {
  try {
    const legacyApps = await fetchLegacyApps(ctx, ns);
    return { ok: true, match: legacyApps.find((a) => a.name === application) ?? null };
  } catch (lookupError: unknown) {
    // Status-driven reason, never the embedded message text (Rule #8/#13): a
    // failing endpoint's prose can itself carry the misleading gateway 404
    // wording this story exists to remove.
    const reason =
      lookupError instanceof IrisApiError
        ? `HTTP ${lookupError.statusCode}`
        : lookupError instanceof Error
          ? lookupError.message
          : String(lookupError);
    return { ok: false, reason };
  }
}

/**
 * Story 35.6: accurate not-found text naming BOTH scopes checked — replaces
 * the Mgmnt API's misleading "Check the IRIS web server configuration" text
 * (an HTTP-status-driven branch, never message-text matching: Rule #8/#13).
 */
function notFoundBothScopes(application: string, ns: string): string {
  return (
    `Error managing REST application: '${application}' was not found in namespace '${ns}' ` +
    `as a spec-first REST application (IRIS Mgmnt API, /api/mgmnt/v2) or as a legacy ` +
    `%CSP.REST application (ExecuteMCPv2 webapp list — the names 'list' with scope ` +
    `'legacy' or 'all' returns).`
  );
}

/**
 * Story 35.6 (code review): the Mgmnt 404 fired but the legacy lookup itself
 * FAILED — the legacy scope was never actually consulted, so say that instead
 * of asserting absence in it.
 */
function notFoundLegacyUnchecked(application: string, ns: string, reason: string): string {
  return (
    `Error managing REST application: '${application}' was not found in namespace '${ns}' ` +
    `as a spec-first REST application (IRIS Mgmnt API, /api/mgmnt/v2), and the legacy ` +
    `%CSP.REST scope could not be checked — the ExecuteMCPv2 webapp list query failed ` +
    `(${reason}).`
  );
}

// ── iris_rest_manage ──────────────────────────────────────────

export const restManageTool: ToolDefinition = {
  name: "iris_rest_manage",
  title: "Manage REST API",
  description:
    "List, get details, or delete REST API dispatch classes on IRIS. " +
    "\n\n'list' returns REST application dispatch classes in the namespace. " +
    "scope values:\n" +
    "  - 'spec-first' (default): OpenAPI-spec-first apps only, via IRIS Mgmnt API " +
    "(/api/mgmnt/v2/{ns}/). These have a .spec companion class.\n" +
    "  - 'legacy': hand-written %CSP.REST subclasses only (no .spec class), " +
    "via ExecuteMCPv2 webapp endpoint. swaggerSpec is null for these.\n" +
    "  - 'all': union of both — spec-first + legacy combined into one response.\n\n" +
    "BREAKING (pre-release): old scope:'all' behavior is now scope:'legacy'.\n\n" +
    "'get' returns REST application details (dispatch class, URL map, swagger spec) for a named application. " +
    "Use fullSpec:false (default) for a compact summary; fullSpec:true for the full 50KB+ swagger blob. " +
    "'get' resolves EVERY name 'list' returns: for a legacy %CSP.REST name (a Mgmnt API 404) it falls back " +
    "to the legacy webapp list and returns {name, dispatchClass, namespace, swaggerSpec: null} plus an " +
    "'explanation' field — legacy apps have no OpenAPI spec by design, so swaggerSpec stays null and " +
    "fullSpec has no effect. A name in neither scope fails with an accurate not-found naming BOTH scopes " +
    "checked (never a 'web server configuration' misdirection).\n\n" +
    "'delete' removes a SPEC-FIRST REST application only (Mgmnt API scope). A legacy %CSP.REST name " +
    "fails with an explanation pointing at iris_webapp_manage:delete, which is the correct tool for " +
    "removing a legacy web application.",
  inputSchema: z.object({
    action: z
      .enum(["list", "get", "delete"])
      .describe("Action to perform: 'list', 'get', or 'delete'"),
    scope: z
      .enum(["spec-first", "legacy", "all"])
      .optional()
      .default("spec-first")
      .describe(
        "For 'list' action only. " +
          "'spec-first' (default): OpenAPI-spec-first apps via IRIS Mgmnt API. " +
          "'legacy': hand-written %CSP.REST dispatch classes (was 'all' before Story 12.5 — BREAKING). " +
          "'all': union of spec-first + legacy.",
      ),
    application: z
      .string()
      .min(1)
      .optional()
      .describe(
        "REST application path (required for 'get' and 'delete', e.g., '/api/myapp')",
      ),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured namespace)"),
    fullSpec: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "For 'get' action only. When false (default) returns a compact summary " +
          "{name, dispatchClass, namespace, swaggerSpec:{basePath,pathCount,definitionCount,description,title,version}} " +
          "to avoid 50KB+ responses. When true, returns the full swagger spec blob. " +
          "Has no effect for legacy %CSP.REST apps — no spec exists, swaggerSpec stays null.",
      ),
  }),
  annotations: {
    destructiveHint: true,
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { action, scope, application, namespace, fullSpec } = args as {
      action: string;
      scope?: "spec-first" | "legacy" | "all";
      application?: string;
      namespace?: string;
      fullSpec?: boolean;
    };

    const ns = ctx.resolveNamespace(namespace);
    // Zod `.default("spec-first")` only fires when inputs are parsed through
    // Zod. The tool registry typically passes raw args, so the `scope` may be
    // `undefined` at runtime — fall back here to preserve the contract.
    const effectiveScope: "spec-first" | "legacy" | "all" = scope ?? "spec-first";
    // FEAT-6: default fullSpec to false (summary mode)
    const useFullSpec: boolean = fullSpec ?? false;

    try {
      let response: unknown;

      if (action === "list") {
        if (effectiveScope === "legacy") {
          // FEAT-2: "legacy" (was "all" before Story 12.5) — hand-written %CSP.REST
          // dispatch classes only. %REST.API.GetAllRESTApps filters these out by design.
          // Use ExecuteMCPv2 webapp endpoint, filter for non-empty dispatchClass.
          const legacyApps = await fetchLegacyApps(ctx, ns);
          const structured = { items: legacyApps, count: legacyApps.length };
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(structured, null, 2),
              },
            ],
            structuredContent: structured,
          };
        } else if (effectiveScope === "all") {
          // FEAT-2: "all" = union of spec-first + legacy
          const [specFirstResponse, legacyApps] = await Promise.all([
            ctx.http.get(`${BASE_MGMNT_URL}/${encodeURIComponent(ns)}/`),
            fetchLegacyApps(ctx, ns),
          ]);
          const rawSpecFirst = extractResult(specFirstResponse);
          const specFirstItems: Array<Record<string, unknown>> = Array.isArray(rawSpecFirst)
            ? (rawSpecFirst as Array<Record<string, unknown>>)
            : [];
          // Merge: spec-first items first, then legacy. Deduplicate by name.
          const seen = new Set<string>();
          const merged: Array<Record<string, unknown>> = [];
          for (const item of specFirstItems) {
            const key = String(item.name ?? "");
            if (!seen.has(key)) {
              seen.add(key);
              merged.push(item);
            }
          }
          for (const item of legacyApps) {
            const key = String(item.name ?? "");
            if (!seen.has(key)) {
              seen.add(key);
              merged.push(item);
            }
          }
          const structured = { items: merged, count: merged.length };
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(structured, null, 2),
              },
            ],
            structuredContent: structured,
          };
        }
        // effectiveScope === "spec-first" (default)
        response = await ctx.http.get(
          `${BASE_MGMNT_URL}/${encodeURIComponent(ns)}/`,
        );
      } else if (action === "get") {
        if (!application) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'application' is required for 'get' action",
              },
            ],
            isError: true,
          };
        }
        try {
          response = await ctx.http.get(
            `${BASE_MGMNT_URL}/${encodeURIComponent(ns)}/${encodeURIComponent(application)}`,
          );
        } catch (error: unknown) {
          // Story 35.6 (AC 35.6.4): the Mgmnt API covers SPEC-FIRST apps only
          // (Rule #12), so a 404 here may simply be a legacy hand-written
          // %CSP.REST app that 'list' scope 'legacy'/'all' returns. Resolve it
          // via the legacy webapp list instead of surfacing the CSP gateway's
          // misleading "Check the IRIS web server configuration" 404 text.
          // Branch on the HTTP STATUS, never the message text (Rule #8/#13).
          if (error instanceof IrisApiError && error.statusCode === 404) {
            const legacyLookup = await findLegacyApp(ctx, ns, application);
            if (legacyLookup.ok && legacyLookup.match) {
              const legacyMatch = legacyLookup.match;
              const detail = {
                name: legacyMatch.name,
                dispatchClass: legacyMatch.dispatchClass,
                namespace: legacyMatch.namespace ?? ns,
                swaggerSpec: null,
                explanation:
                  "Legacy hand-written %CSP.REST application — resolved via the ExecuteMCPv2 " +
                  "webapp list because the IRIS Mgmnt API (/api/mgmnt/v2) covers spec-first " +
                  "apps only. No OpenAPI spec exists for a legacy app by design, so " +
                  "swaggerSpec is null and fullSpec has no effect.",
              };
              return {
                content: [
                  { type: "text" as const, text: JSON.stringify(detail, null, 2) },
                ],
                structuredContent: detail,
              };
            }
            return {
              content: [
                {
                  type: "text" as const,
                  text: legacyLookup.ok
                    ? notFoundBothScopes(application, ns)
                    : notFoundLegacyUnchecked(application, ns, legacyLookup.reason),
                },
              ],
              isError: true,
            };
          }
          throw error;
        }
      } else {
        // delete
        if (!application) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'application' is required for 'delete' action",
              },
            ],
            isError: true,
          };
        }
        try {
          response = await ctx.http.delete(
            `${BASE_MGMNT_URL}/${encodeURIComponent(ns)}/${encodeURIComponent(application)}`,
          );
        } catch (error: unknown) {
          // Story 35.6: same by-design scope boundary as 'get'. Deleting a
          // legacy app is deliberately NOT routed anywhere here — that is
          // iris_webapp_manage:delete's job (it deletes the web application;
          // there are no spec classes to remove).
          if (error instanceof IrisApiError && error.statusCode === 404) {
            const legacyLookup = await findLegacyApp(ctx, ns, application);
            if (legacyLookup.ok && legacyLookup.match) {
              const legacyMatch = legacyLookup.match;
              // fetchLegacyApps filters to non-empty dispatchClass, so a match
              // always carries a real class name — no empty-parenthetical guard.
              return {
                content: [
                  {
                    type: "text" as const,
                    text:
                      `Error managing REST application: '${application}' is a legacy ` +
                      `hand-written %CSP.REST application (dispatch class ${String(legacyMatch.dispatchClass)}). ` +
                      `iris_rest_manage:delete removes spec-first REST applications only ` +
                      `(IRIS Mgmnt API scope). To remove a legacy web application, use ` +
                      `iris_webapp_manage:delete.`,
                  },
                ],
                isError: true,
              };
            }
            return {
              content: [
                {
                  type: "text" as const,
                  text: legacyLookup.ok
                    ? notFoundBothScopes(application, ns)
                    : notFoundLegacyUnchecked(application, ns, legacyLookup.reason),
                },
              ],
              isError: true,
            };
          }
          throw error;
        }
      }

      const result = extractResult(response);

      // FEAT-6: summary mode for get action (default)
      if (action === "get" && !useFullSpec && result && typeof result === "object") {
        const raw = result as Record<string, unknown>;
        // The Mgmnt API `get` returns the swagger spec at the TOP LEVEL of the
        // result (keys like `swagger`/`info`/`paths`/`basePath`), NOT nested under
        // a `swaggerSpec` field the way the `list` rows are. Accept either shape:
        // prefer a nested `swaggerSpec` object if present, otherwise treat the
        // result itself as the spec when it carries swagger/openapi markers.
        // (Previously this only read `raw.swaggerSpec`, so the summary was always
        // null for spec-first apps even though the full spec was clearly present.)
        let swaggerRaw = raw.swaggerSpec as Record<string, unknown> | null | undefined;
        if (
          (!swaggerRaw || typeof swaggerRaw !== "object") &&
          (raw.swagger !== undefined ||
            raw.openapi !== undefined ||
            raw.info !== undefined ||
            raw.paths !== undefined)
        ) {
          swaggerRaw = raw;
        }
        let swaggerSummary: Record<string, unknown> | null = null;
        if (swaggerRaw && typeof swaggerRaw === "object") {
          // Count paths and definitions to avoid sending the full blob
          const paths = swaggerRaw.paths as Record<string, unknown> | undefined;
          const definitions = swaggerRaw.definitions as Record<string, unknown> | undefined;
          const info = swaggerRaw.info as Record<string, unknown> | undefined;
          swaggerSummary = {
            basePath: swaggerRaw.basePath ?? null,
            pathCount: paths ? Object.keys(paths).length : 0,
            definitionCount: definitions ? Object.keys(definitions).length : 0,
            description: info?.description ?? null,
            title: info?.title ?? null,
            version: info?.version ?? null,
          };
        }
        // The `get` spec body carries no name/dispatchClass/namespace of its own,
        // so fall back to the requested application path and resolved namespace.
        const summarized = {
          name: raw.name ?? application,
          dispatchClass: raw.dispatchClass ?? null,
          namespace: raw.namespace ?? ns,
          swaggerSpec: swaggerSummary,
        };
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(summarized, null, 2) },
          ],
          structuredContent: summarized,
        };
      }

      const structured = toStructured(result);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(structured, null, 2) },
        ],
        structuredContent: structured,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error managing REST application: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
