/**
 * `trace-message-flow` prompt (Epic 25, Story 25.1 — spec
 * `03-skills-prompts-pack.md` §3; extended in Story 39.6).
 *
 * Walks `iris_production_messages` → `iris_message_search` (headers) →
 * `iris_message_body` → `iris_message_diagram` → `iris_production_logs` (for
 * erroring items) to trace a single message's flow through a production.
 * The name, title and arguments are a stable contract. Server: iris-interop-mcp.
 */

import type { PromptDefinition } from "@iris-mcp/shared";
import { argOrPlaceholder as arg, isArgProvided } from "@iris-mcp/shared";

export const traceMessageFlowPrompt: PromptDefinition = {
  name: "trace-message-flow",
  title: "Trace Message Flow",
  description:
    "Trace a message's flow through an Interoperability production using " +
    "iris_production_messages, iris_message_search, iris_message_body, iris_message_diagram, " +
    "and iris_production_logs for any erroring items.",
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
        ? `Target namespace: "${namespace}" \u2014 pass \`namespace: "${namespace}"\` on every tool call below.`
        : `No namespace specified \u2014 omit \`namespace\` to use the server's configured default on every call below.`;

    return `# Trace Message Flow

Session or header ID to trace: \`${id}\`

${namespaceNote}

1. Call \`iris_production_messages\` with \`sessionId: ${id}\` (traces every message in that session). If the result is empty or the ID does not look like a session ID, retry with \`headerId: ${id}\` instead \u2014 the ID may be a specific message header ID rather than a session ID. Note the hops (source item, target item, message class, timestamp and status), the session ID, and the earliest and latest message times of the flow. If you started from a header ID, call it again with that session's \`sessionId\` so the hops and times cover the whole flow, and raise \`count\` (default 100, at most 10000) when the list may be cut off.
2. Call \`iris_message_search\` with \`action: "headers"\`, \`sessionId\` set to the session ID from step 1, and \`from\` and \`to\` bracketing the flow's earliest and latest times in UTC ISO 8601 (for example \`2026-07-01T10:00:00Z\`; the times of step 1 are already UTC, written without a zone, so add the \`T\` and the \`Z\` and do not convert them), with \`to\` rounded up to the next whole second so a fractional second is not cut off. A search window spans at most 7 days: if the flow spans more, ask the user before searching it window by window, each window at most 7 days. The header rows give each message's \`id\`, status, \`isError\`, source and target item, and body class and body ID. When \`hasMore\` is true, pass \`nextCursor\` back as \`cursor\` with the same \`from\` and \`to\`. If the search is refused (for example because an operator restricted it), tell the user and go on with the hops of step 1; do not read the headers another way.
3. Call \`iris_message_body\` with up to 20 header \`id\` values per call that matter, taken from step 2 (or from the hops of step 1 when the search was refused): the first request, and each erroring message with its response. Each body comes back rendered by kind, with its \`bodyPolicy\`. Under the default \`redact\` data policy an HL7 v2 body is shown with every field outside a reviewed keep-list replaced, and every other body is withheld with a reason. Under \`block\` every body is withheld. Report a withheld body's reason to the user, and never read it another way (for example through SQL, global or document tools). If the read is refused (for example because an operator restricted it), tell the user and go on; do not read the bodies another way.
4. Call \`iris_message_diagram\` with \`sessionIds: [${id}]\` (use the session ID discovered in step 1, even if you started from a header ID) to render a Mermaid sequence diagram of the same flow \u2014 participants, sync vs async calls, request/response pairing, and \`[ERROR]\` flags on failed messages.
5. For every step flagged as an error (in the header rows' \`isError\`, the raw trace or the diagram's \`[ERROR]\` markers), call \`iris_production_logs\` filtered by \`itemName\` (the erroring config item) and/or \`type: "Error"\` to pull the detailed error log entries for that item around the same timeframe.
6. Summarize the failure point: which item failed, what the error log says, and where in the flow (which hop) it occurred, repeating no identifying value from a body, a log entry or the diagram beyond what the user gave. Recommend next steps (e.g. \`iris_production_control\` action 'recover', or a data/config fix) but do NOT execute a recovery action without the user's confirmation.`;
  },
};
