/**
 * `trace-message-flow` prompt (Epic 25, Story 25.1 — spec
 * `03-skills-prompts-pack.md` §3).
 *
 * Walks `iris_production_messages` → `iris_message_diagram` →
 * `iris_production_logs` (for erroring items) to trace a single message's
 * flow through a production. Server: iris-interop-mcp.
 */

import type { PromptDefinition } from "@iris-mcp/shared";
import { argOrPlaceholder as arg, isArgProvided } from "@iris-mcp/shared";

export const traceMessageFlowPrompt: PromptDefinition = {
  name: "trace-message-flow",
  title: "Trace Message Flow",
  description:
    "Trace a message's flow through an Interoperability production using " +
    "iris_production_messages, iris_message_diagram, and iris_production_logs for any " +
    "erroring items.",
  arguments: [
    {
      name: "sessionOrHeaderId",
      description:
        "A session ID (traces every message in the session) or a specific message header ID.",
      required: true,
    },
    {
      name: "namespace",
      description: "Target namespace (default: the server's configured namespace).",
      required: false,
    },
  ],
  build: (args) => {
    const id = arg(args.sessionOrHeaderId, "<sessionOrHeaderId>");
    const namespace = arg(args.namespace, "<namespace>");
    const namespaceNote =
      isArgProvided(args.namespace)
        ? `Target namespace: "${namespace}" — pass \`namespace: "${namespace}"\` on every tool call below.`
        : `No namespace specified — omit \`namespace\` to use the server's configured default on every call below.`;

    return `# Trace Message Flow

Session or header ID to trace: \`${id}\`

${namespaceNote}

1. Call \`iris_production_messages\` with \`sessionId: ${id}\` (traces every message in that session). If the result is empty or the ID does not look like a session ID, retry with \`headerId: ${id}\` instead — the ID may be a specific message header ID rather than a session ID.
2. Review the returned message steps: source item, target item, message class, timestamp, and status for each hop.
3. Call \`iris_message_diagram\` with \`sessionIds: [${id}]\` (use the session ID discovered in step 1, even if you started from a header ID) to render a Mermaid sequence diagram of the same flow — participants, sync vs async calls, request/response pairing, and \`[ERROR]\` flags on failed messages.
4. For every step flagged as an error (in either the raw trace or the diagram's \`[ERROR]\` markers), call \`iris_production_logs\` filtered by \`itemName\` (the erroring config item) and/or \`type: "Error"\` to pull the detailed error log entries for that item around the same timeframe.
5. Summarize the failure point: which item failed, what the error log says, and where in the flow (which hop) it occurred. Recommend next steps (e.g. \`iris_production_control\` action 'recover', or a data/config fix) but do NOT execute a recovery action without the user's confirmation.`;
  },
};
