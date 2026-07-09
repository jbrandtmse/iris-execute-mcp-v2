/**
 * `diagnose-slow-query` prompt (Epic 25, Story 25.1 — spec
 * `03-skills-prompts-pack.md` §3).
 *
 * Walks {@link sqlAnalyzeTool}'s explain → indexUsage → stats actions and
 * teaches the interpretation checklist. Always ends in a RECOMMENDATION —
 * this prompt never instructs the client to auto-apply a fix. Server:
 * iris-dev-mcp.
 */

import type { PromptDefinition } from "@iris-mcp/shared";

/** Render `value`, or a bracketed placeholder for the static skills doc when omitted. */
function arg(value: string | undefined, placeholder: string): string {
  return value !== undefined && value !== "" ? value : placeholder;
}

export const diagnoseSlowQueryPrompt: PromptDefinition = {
  name: "diagnose-slow-query",
  title: "Diagnose Slow Query",
  description:
    "Diagnose a slow SQL query using iris_sql_analyze (explain, indexUsage, stats) and " +
    "recommend a fix — never auto-applies one.",
  arguments: [
    {
      name: "query",
      description: "The SQL query text to diagnose.",
      required: true,
    },
    {
      name: "namespace",
      description: "Target namespace (default: the server's configured namespace).",
      required: false,
    },
  ],
  build: (args) => {
    const query = arg(args.query, "<query>");
    const namespace = arg(args.namespace, "<namespace>");
    const namespaceNote =
      args.namespace !== undefined
        ? `Target namespace: "${namespace}" — pass \`namespace: "${namespace}"\` on every \`iris_sql_analyze\` call below.`
        : `No namespace specified — omit \`namespace\` to use the server's configured default on every call below.`;

    return `# Diagnose Slow Query

Query to diagnose:
\`\`\`sql
${query}
\`\`\`

${namespaceNote}

1. Call \`iris_sql_analyze\` action 'explain' with \`query: "${query}"\` to get the query plan text.
2. Call \`iris_sql_analyze\` action 'indexUsage' with the SAME query to see which maps/indexes the plan actually reads.
3. Call \`iris_sql_analyze\` action 'stats' (optionally with a 'filter' matching this query's statement text) to see cumulative runtime statistics — StatCount, StatTotal, StatAverage, StatRowCount — if this query has run before.
4. Interpretation checklist:
   - **Full-scan markers**: plan text mentioning "Read master map" scanning the WHOLE table (no index map named) on a large table is a red flag — the query is likely not using an index it should.
   - **Missing-index reasoning**: if 'indexUsage' shows only the master map (no index map) for a WHERE/JOIN/ORDER BY column, an index on that column may help.
   - **High StatAverage relative to StatRowCount**: many statement executions each touching few rows but taking long individually suggests a plan inefficiency, not a data-volume issue.
   - **StatCount very high**: a hot query — even a small per-execution improvement compounds; prioritize it.
5. Summarize findings and RECOMMEND a fix (e.g. "add an index on Table.Column", or "rewrite the WHERE clause to avoid a function on an indexed column"). Do NOT create the index or modify the class yourself — present the recommendation and let the user decide whether to apply it (e.g. via a class edit + \`iris_doc_load\`).`;
  },
};
