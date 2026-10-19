/**
 * `find-patient-messages` prompt (Story 39.6).
 *
 * Finds a patient's messages by an indexed Search Table value
 * (`iris_message_search` action `searchTable`), lists the header rows, and
 * reads bodies with `iris_message_body` only when the user wants content, all
 * under the PHI data policy. Every search is windowed; the prompt never
 * loosens the policy and never reads a withheld body another way.
 * Server: iris-interop-mcp.
 */

import type { PromptDefinition } from "@iris-mcp/shared";
import { argOrPlaceholder as arg, isArgProvided } from "@iris-mcp/shared";

/** The Search Table class used when the caller names none. */
const DEFAULT_SEARCH_TABLE_CLASS = "EnsLib.HL7.SearchTable";

export const findPatientMessagesPrompt: PromptDefinition = {
  name: "find-patient-messages",
  title: "Find Patient Messages",
  description:
    "Find a patient's Interoperability messages by a Search Table value, such as a medical " +
    "record number, with iris_message_search, then read their bodies with iris_message_body " +
    "under the PHI data policy.",
  skill: {
    description:
      "Finds a patient's interoperability messages by an identifier such as a medical record number, " +
      "through a Search Table and in search windows of at most 7 days, lists the matching message " +
      "headers, and reads message bodies only when the user wants the content, under the PHI data " +
      "policy, which redacts or withholds them. Use when the user asks for the messages, HL7 traffic or " +
      "message history of a patient or medical record number in an IRIS interoperability production.",
    preset: "core",
  },
  arguments: [
    {
      name: "patientId",
      description:
        "The patient identifier to look up, such as a medical record number (matched against the Search Table's PatientID).",
      required: true,
    },
    {
      name: "from",
      description:
        "Start of the search window, ISO 8601 UTC (for example 2026-07-01T00:00:00Z). Omit it and the prompt asks the user for the period.",
      required: false,
    },
    {
      name: "to",
      description: "End of the search window, ISO 8601 UTC (default: now). At most 7 days after from.",
      required: false,
    },
    {
      name: "searchTableClass",
      description: `Search Table class to query (default: ${DEFAULT_SEARCH_TABLE_CLASS}).`,
      required: false,
    },
    {
      name: "namespace",
      description: "Target namespace (default: the server's configured namespace).",
      required: false,
    },
  ],
  build: (args) => {
    const patientId = arg(args.patientId, "<patientId>");
    const from = arg(args.from, "<from>");
    const to = arg(args.to, "<to>");
    const searchTableClass = isArgProvided(args.searchTableClass)
      ? args.searchTableClass
      : DEFAULT_SEARCH_TABLE_CLASS;
    const namespace = arg(args.namespace, "<namespace>");
    const namespaceNote =
      isArgProvided(args.namespace)
        ? `Target namespace: "${namespace}" \u2014 pass \`namespace: "${namespace}"\` on every tool call below except \`iris_server_profiles\`, which takes none.`
        : `No namespace specified \u2014 omit \`namespace\` to use the server's configured default on every call below.`;
    const windowNote = isArgProvided(args.from)
      ? `Search window: from \`${from}\` to ${isArgProvided(args.to) ? `\`${to}\`` : "now"}.`
      : "No start time was given \u2014 ask the user for the period to search before step 3.";

    return `# Find Patient Messages

Patient identifier: \`${patientId}\`
${windowNote}
Search Table class: \`${searchTableClass}\`

${namespaceNote}

1. Call \`iris_server_profiles\` and read the profile's \`dataPolicy\`. Under \`block\` the lookup is refused with \`DATA_POLICY_BLOCKED\` and every body is withheld, so stop and tell the user. Do not look the patient up another way (for example through SQL, global or document tools).
2. Fix the search window. With no \`from\`, ask the user for the period. Each search spans at most 7 days (\`from\` to \`to\`, where an omitted \`to\` is now). If the user wants a longer period, ask before searching it window by window; never search without a window.
3. Call \`iris_message_search\` with \`action: "searchTable"\`, \`searchTableClass: ${JSON.stringify(searchTableClass)}\`, \`filters: [{"property": "PatientID", "op": "eq", "value": ${JSON.stringify(patientId)}}]\`, and \`from\` and \`to\` for the window. \`PatientID\` covers PID-2, every PID-3 repetition and PID-4 of an \`EnsLib.HL7.SearchTable\`, and values ignore case. When \`hasMore\` is true, pass \`nextCursor\` back as \`cursor\` with the same \`from\` and \`to\`. If the error names an unknown property it lists the class's properties: pick the identifier property and retry. If the result says \`notApplicable\`, no Search Table is configured in the namespace, so tell the user. No match does not prove that no message holds the value, because only messages that were indexed when they were processed can match. A refusal (\`DATA_POLICY_BLOCKED\`, or an action an operator disabled) ends the lookup: tell the user, and do not look the patient up another way.
4. List the matching rows: \`id\`, time, source to target, status and \`sessionId\`. The rows hold no body values.
5. Only when the user wants the content, call \`iris_message_body\` with up to 20 header \`id\` values per call. Under the default \`redact\` data policy an HL7 v2 body is shown with every field outside a reviewed keep-list replaced, and every other body is withheld with a reason; under \`block\` every body is withheld. A \`dataPolicy\` argument can only tighten the profile's policy (for example to \`block\`); a looser value is ignored and reported as \`dataPolicyClamped\`. A refusal here is reported the same way.
6. Optionally call \`iris_message_diagram\` with \`sessionIds\` set to the rows' distinct \`sessionId\` values (at most 20; ask the user which sessions when there are more) to show how the messages moved through the production.
7. Report the messages found, the result's data policy line, and the reason for each withheld body. Repeat no identifying value from a body beyond what the user gave, and never read a withheld body another way.`;
  },
};
