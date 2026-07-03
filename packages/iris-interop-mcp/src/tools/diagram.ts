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

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
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
  const suffix = extras.length > 0 ? ` (${extras.join(", ")})` : "";
  const noun = d.messageCount === 1 ? "message" : "messages";
  return `Session ${d.sessionId}: ${d.messageCount} ${noun}${suffix}\n\`\`\`mermaid\n${d.mermaid}\n\`\`\``;
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
    "for raw message-row data.",
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
  handler: async (args, ctx) => {
    const { sessionIds, labelMode, maxRows, namespace } = args as {
      sessionIds: number[];
      labelMode?: "full" | "short";
      maxRows?: number;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    const params = new URLSearchParams();
    params.set("namespace", ns);
    params.set("sessionIds", sessionIds.join(","));
    // Rule #10: send the documented defaults explicitly on the wire.
    params.set("labelMode", labelMode ?? "full");
    params.set("maxRows", String(maxRows ?? 2000));

    const path = `${BASE_URL}/interop/production/messages/diagram?${params}`;

    try {
      const response = await ctx.http.get(path);
      const result = response.result as DiagramResult;
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
          isError: true,
        };
      }
      throw error;
    }
  },
};
