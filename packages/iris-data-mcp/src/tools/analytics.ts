/**
 * Analytics tools for the IRIS Data & Analytics MCP server.
 *
 * Provides two tools for IRIS DeepSee analytics:
 * - {@link analyticsMdxTool} — Execute MDX queries and return structured
 *   pivot-table results with axis labels and measure values
 * - {@link analyticsCubesTool} — List, build, or synchronize DeepSee cubes
 *
 * All tools call the custom ExecuteMCPv2 REST handler at
 * `/api/executemcp/v2/analytics/...`.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";
import { extractResult, toStructured } from "./docdb.js";

/** Base URL for the ExecuteMCPv2 custom REST API. */
const BASE_URL = "/api/executemcp/v2";

// ── iris_analytics_mdx ────────────────────────────────────────

export const analyticsMdxTool: ToolDefinition = {
  name: "iris_analytics_mdx",
  title: "Execute MDX Query",
  description:
    "Execute an MDX query against IRIS DeepSee and return structured " +
    "pivot-table results with axis labels, measure values, and dimension " +
    "members. Returns columns, rows (each with label and values), " +
    "rowCount, and columnCount.",
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .describe("MDX query string to execute"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured namespace)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { query, namespace } = args as {
      query: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);

    try {
      const response = await ctx.http.post(`${BASE_URL}/analytics/mdx`, {
        query,
        namespace: ns,
      });

      const result = extractResult(response);

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: toStructured(result),
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error executing MDX query: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── horolog → ISO 8601 helper ─────────────────────────────────

/**
 * Convert an IRIS `$HOROLOG` timestamp (e.g., `"67360,85964.1540167"`) to
 * ISO 8601 UTC format (e.g., `"2026-04-15T23:52:44.154Z"`).
 *
 * IRIS `$HOROLOG` epoch: day 0 = 1840-12-31, day 1 = 1841-01-01.
 * Seconds are seconds-since-midnight in the server's local time zone.
 * We treat them as UTC seconds since the cube endpoint does not carry a
 * time-zone offset; callers needing zone-correct values should cross-check
 * via `$ZDATETIME`.
 *
 * Returns `""` for missing, non-string, or malformed input — never throws.
 * This ensures the tool stays resilient when IRIS emits an unexpected shape.
 *
 * @param h - The `$HOROLOG` string from IRIS.
 * @returns ISO 8601 timestamp, or `""` when input is unusable.
 */
function horologToIso(h: unknown): string {
  if (!h || typeof h !== "string" || !h.includes(",")) return "";
  const [daysStr, secondsStr] = h.split(",");
  const days = parseInt(daysStr ?? "", 10);
  const seconds = parseFloat(secondsStr ?? "");
  if (!Number.isFinite(days) || !Number.isFinite(seconds)) return "";
  // Date.UTC(1840, 11, 31) gives ms-since-1970 for $HOROLOG day 0 midnight UTC.
  const epoch = Date.UTC(1840, 11, 31);
  const ms = epoch + (days * 86400 + seconds) * 1000;
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toISOString();
}

/**
 * Map a cube-list payload's `cubes[]` array so each entry carries both
 * the ISO-formatted `lastBuildTime` and the raw `lastBuildTimeRaw` horolog
 * string. Returns the result unchanged if `cubes` is not an array.
 *
 * Bug #14: the IRIS analytics cube-list endpoint emits `lastBuildTime` as a
 * raw `$HOROLOG` string, which is unreadable to MCP clients. This helper
 * preserves the raw form so callers can still cross-check or round-trip.
 */
function mapCubeList(result: unknown): unknown {
  if (
    result === null ||
    typeof result !== "object" ||
    Array.isArray(result)
  ) {
    return result;
  }
  const record = result as Record<string, unknown>;
  const cubes = record.cubes;
  if (!Array.isArray(cubes)) return result;
  const mappedCubes = cubes.map((cube) => {
    if (cube === null || typeof cube !== "object") return cube;
    const cubeRec = cube as Record<string, unknown>;
    const raw = cubeRec.lastBuildTime;
    return {
      ...cubeRec,
      lastBuildTime: horologToIso(raw),
      lastBuildTimeRaw: typeof raw === "string" ? raw : "",
    };
  });
  return { ...record, cubes: mappedCubes };
}

// Exported for unit testing.
export { horologToIso, mapCubeList };

// ── iris_analytics_cubes ──────────────────────────────────────

export const analyticsCubesTool: ToolDefinition = {
  name: "iris_analytics_cubes",
  title: "Manage DeepSee Cubes",
  description:
    "List, build, or synchronize IRIS DeepSee cubes. " +
    "'list' returns all cubes with name, source class, fact count, and both `lastBuildTime` " +
    "(ISO 8601 UTC) and `lastBuildTimeRaw` ($HOROLOG string) fields. " +
    "'build' triggers a full synchronous rebuild of a cube. " +
    "'sync' triggers an incremental synchronization of a cube.",
  inputSchema: z.object({
    action: z
      .enum(["list", "build", "sync"])
      .describe("Action to perform: 'list', 'build', or 'sync'"),
    cube: z
      .string()
      .min(1)
      .optional()
      .describe("Cube name (required for 'build' and 'sync')"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured namespace)"),
  }),
  annotations: {
    destructiveHint: false,
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { action, cube, namespace } = args as {
      action: string;
      cube?: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);

    try {
      let response: unknown;

      if (action === "list") {
        const qp = encodeURIComponent(ns);
        response = await ctx.http.get(
          `${BASE_URL}/analytics/cubes?namespace=${qp}`,
        );
      } else {
        // build or sync
        if (!cube) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: 'cube' is required for '${action}' action`,
              },
            ],
            isError: true,
          };
        }
        response = await ctx.http.post(`${BASE_URL}/analytics/cubes`, {
          action,
          cube,
          namespace: ns,
        });
      }

      // Bug #14: convert cube `lastBuildTime` from raw $HOROLOG to ISO 8601
      // on list action; preserve raw value in `lastBuildTimeRaw`. Build/sync
      // responses carry status fields, not cube rows, so no mapping needed.
      const rawResult = extractResult(response);
      const result = action === "list" ? mapCubeList(rawResult) : rawResult;

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: toStructured(result),
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error managing cubes: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
