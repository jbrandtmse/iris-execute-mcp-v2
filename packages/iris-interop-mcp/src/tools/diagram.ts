/**
 * Message-trace sequence-diagram tool for the IRIS Interoperability MCP server
 * (Epic 21, Story 21.0 — FR129).
 *
 * Provides {@link messageDiagramTool} — a thin wrapper over the custom REST
 * endpoint `GET /api/executemcp/v2/interop/production/messages/diagram`, which
 * delegates to the clean-room ObjectScript library `ExecuteMCPv2.Diagram.*`
 * (architecture decisions G1/G2). Output contract per decision G3: one fenced
 * ```mermaid block per session in `content` plus the endpoint result object
 * verbatim in `structuredContent`.
 *
 * Read-only (`mutates: "read"` — Rule #28), scope NS.
 */

import {
  BLOCK_REASONS,
  IrisApiError,
  effectiveDataPolicy,
  type DataPolicySummary,
  type ToolDefinition,
} from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

/** One per-session diagram entry in the endpoint result (decision G3). */
interface DiagramEntry {
  sessionId: number;
  mermaid: string;
  messageCount: number;
  warnings: string[];
  truncated: boolean;
  /** First session id carrying the same flow (cross-session dedup, Story 21.1). */
  dedupOf?: number;
}

/** Endpoint result shape: `{ diagrams, count }`. */
interface DiagramResult {
  diagrams: DiagramEntry[];
  count: number;
}

/** Build the one-line summary + fenced mermaid block for one diagram entry. */
function renderDiagramText(d: DiagramEntry): string {
  const extras: string[] = [];
  if (d.truncated) extras.push("truncated");
  if (d.warnings && d.warnings.length > 0) {
    extras.push(
      `${d.warnings.length} warning${d.warnings.length === 1 ? "" : "s"}`,
    );
  }
  if (d.dedupOf !== undefined) extras.push(`duplicate of session ${d.dedupOf}`);
  const suffix = extras.length > 0 ? ` (${extras.join(", ")})` : "";
  const noun = d.messageCount === 1 ? "message" : "messages";
  return `Session ${d.sessionId}: ${d.messageCount} ${noun}${suffix}\n\`\`\`mermaid\n${d.mermaid}\n\`\`\``;
}

/**
 * The error warning the IRIS-side correlator writes for an errored message: `Error on message <id>: <text>`.
 * Only this template prefix is matched, never the text after it (AD-26: no content sniffing).
 */
const ERROR_WARNING = /^(Error on message \d+: ).*$/s;

/** The same warning as a Mermaid comment line: the writer renders every warning as `<indent>%% <one line>`. */
const ERROR_WARNING_LINE = /^([ \t]*%% Error on message \d+: )[^\r\n]*$/gm;

/**
 * The diagram result with the text of each error warning withheld (the `block` data policy): in `warnings[]` and
 * in every Mermaid `%% Error on message <id>: ` line the prefix is kept and the rest becomes the fixed reason.
 * Every other warning is untouched. The result gains `dataPolicy` with the number of warnings withheld.
 */
function withholdErrorText(result: DiagramResult): DiagramResult & { dataPolicy: DataPolicySummary } {
  const reason = BLOCK_REASONS.diagramErrorText();
  let withheld = 0;
  const diagrams = (result.diagrams ?? []).map((d) => {
    const warnings = (d.warnings ?? []).map((warning) => {
      if (typeof warning !== "string" || !ERROR_WARNING.test(warning)) return warning;
      withheld += 1;
      return warning.replace(ERROR_WARNING, (_whole, prefix: string) => `${prefix}${reason}`);
    });
    const mermaid =
      typeof d.mermaid === "string"
        ? d.mermaid.replace(ERROR_WARNING_LINE, (_whole, prefix: string) => `${prefix}${reason}`)
        : d.mermaid;
    return { ...d, warnings, mermaid };
  });
  return { ...result, diagrams, dataPolicy: { policy: "block", redacted: 0, blocked: withheld } };
}

// ── iris_message_diagram ─────────────────────────────────────

export const messageDiagramTool: ToolDefinition = {
  name: "iris_message_diagram",
  title: "Message Trace Diagram",
  description:
    "Generate a Mermaid sequence diagram from an Interoperability message trace. " +
    "Use this when the user wants to visualize how messages flowed through a production " +
    "for one or more sessions — equivalent to the Management Portal's Visual Trace, as " +
    "renderable Mermaid text. Returns one sequenceDiagram per session showing config " +
    "items as participants, sync (->>) vs async (-->>) calls, request/response pairing, " +
    "loop blocks compressing repeated patterns, and [ERROR] flags on failed messages; " +
    "anomalies are reported as warnings, and iris_production_messages remains the tool " +
    "for raw message-row data. Under the block PHI data policy (IRIS_DATA_POLICY) the text of " +
    "error warnings, which can carry message content, is withheld with a fixed reason; under " +
    "redact and allow it is shown unchanged.",
  inputSchema: z.object({
    sessionIds: z
      .array(z.number().int().positive())
      .min(1)
      .max(20)
      .describe("Session IDs to diagram (1-20 positive integers, one diagram per session)"),
    labelMode: z
      .enum(["full", "short"])
      .optional()
      .describe(
        "Arrow label style: 'full' (default) = full message body class name; " +
          "'short' = last dotted segment only",
      ),
    maxRows: z
      .number()
      .int()
      .min(1)
      .max(10000)
      .optional()
      .describe(
        "Per-session cap on loaded message rows (default: 2000, max: 10000); " +
          "the diagram is flagged truncated when the cap is hit",
      ),
    dedup: z
      .boolean()
      .optional()
      .describe(
        "Collapse identical flows across the requested sessions (default: true): " +
          "a session whose diagram matches an earlier one (session metadata header " +
          "and per-message row-id tokens in warning comments normalized) keeps its " +
          "own entry and reports dedupOf = the first session id with that flow. " +
          "Pass false to compare nothing and render every session independently.",
      ),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace. Defaults to the server's configured namespace; pass an explicit value to query a different namespace per call without changing the connection default."),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  mutates: "read",
  // Story 39.7 (AD-26, decision #31): the policy governs every call, under `block` only. The audit entry
  // carries `dataPolicy` from the response's own counts; under redact and allow the response has none, so the
  // entry records the profile's policy with 0 counts.
  dataPolicy: {},
  handler: async (args, ctx) => {
    const { sessionIds, labelMode, maxRows, dedup, namespace } = args as {
      sessionIds: number[];
      labelMode?: "full" | "short";
      maxRows?: number;
      dedup?: boolean;
      namespace?: string;
    };

    const blocked = effectiveDataPolicy(ctx.config) === "block";
    const ns = ctx.resolveNamespace(namespace);
    const params = new URLSearchParams();
    params.set("namespace", ns);
    params.set("sessionIds", sessionIds.join(","));
    // Rule #10: send the documented defaults explicitly on the wire.
    params.set("labelMode", labelMode ?? "full");
    params.set("maxRows", String(maxRows ?? 2000));
    params.set("dedup", String(dedup ?? true));

    const path = `${BASE_URL}/interop/production/messages/diagram?${params}`;

    try {
      const response = await ctx.http.get(path);
      const result = blocked
        ? withholdErrorText(response.result as DiagramResult)
        : (response.result as DiagramResult);
      const diagrams = result.diagrams ?? [];
      const content =
        diagrams.length > 0
          ? diagrams.map((d) => ({
              type: "text" as const,
              text: renderDiagramText(d),
            }))
          : [{ type: "text" as const, text: "No diagrams generated." }];
      return {
        content,
        // Decision G3: the endpoint result OBJECT verbatim (object, never array).
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error generating message diagram: ${error.message}`,
            },
          ],
          ...(blocked
            ? { structuredContent: { dataPolicy: { policy: "block", redacted: 0, blocked: 0 } } }
            : {}),
          isError: true,
        };
      }
      throw error;
    }
  },
};
