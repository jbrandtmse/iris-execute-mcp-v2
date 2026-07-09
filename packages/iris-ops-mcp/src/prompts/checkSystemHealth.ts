/**
 * `check-system-health` prompt (Epic 25, Story 25.1 — spec
 * `03-skills-prompts-pack.md` §3).
 *
 * Runs the composite health check ({@link healthCheckTool}) and teaches the
 * client how to interpret every non-ok finding, naming the fixing tool where
 * one applies. Server: iris-ops-mcp.
 */

import type { PromptDefinition } from "@iris-mcp/shared";

/** Render `value`, or a bracketed placeholder for the static skills doc when omitted. */
function arg(value: string | undefined, placeholder: string): string {
  return value !== undefined && value !== "" ? value : placeholder;
}

export const checkSystemHealthPrompt: PromptDefinition = {
  name: "check-system-health",
  title: "Check System Health",
  description:
    "Run a full IRIS instance health check (iris_health_check) and interpret " +
    "every non-ok finding, naming the fixing tool for each one.",
  arguments: [
    {
      name: "server",
      description:
        "Optional named server profile (from IRIS_PROFILES) to target; omit to use the default server.",
      required: false,
    },
  ],
  build: (args) => {
    const server = arg(args.server, "<server>");
    const serverNote =
      args.server !== undefined
        ? `Target server profile: "${server}" — pass \`server: "${server}"\` on every tool call below.`
        : `No server profile specified — omit \`server\` (or pass "${server}") to use the default server on every tool call below.`;

    return `# Check System Health

${serverNote}

1. Call \`iris_health_check\` (optionally with an \`areas\` filter; omit or pass \`[]\` for all 9 areas) to get one composite verdict ('healthy' | 'warning' | 'critical') plus a per-area finding explaining WHY.
2. Read the overall \`verdict\` first, then walk every finding whose \`level\` is 'warning', 'critical', or 'error' — skip 'ok' and 'notApplicable' findings, they need no action.
3. For each non-ok finding, its \`explanation\` may already name a fixing tool. Otherwise use this mapping:
   - **journal** warning/critical → call \`iris_journal_info\` for detail; free disk space, or run a configured purge task via \`iris_task_run\`.
   - **databases** warning/critical → call \`iris_database_check\` for the named worst database. To raise \`maxSize\`/\`expansionSize\`, use \`iris_database_manage\` action 'modify' — note this tool is on the **admin** MCP server, NOT this ops server, so switch to the admin server for that step (or free disk space instead).
   - **license** warning/critical → call \`iris_license_info\` for detail; reduce active connections or contact licensing.
   - **locks** warning/critical → call \`iris_locks_list\` to find the largest lock holders; consider \`iris_process_manage\` to investigate the offending process.
   - **alerts** warning/critical → call \`iris_metrics_alerts\` for the active alert detail.
   - **mirror** / **ecp** / **interop** / **system** are informational in v1 (always 'ok' or 'notApplicable') — read the raw values for context; no threshold action applies.
   - **error** on any area → the probe itself failed (counts as 'warning' severity only); investigate that area's own dedicated tool directly (e.g. \`iris_journal_info\`, \`iris_mirror_status\`).
4. Summarize the overall verdict and the recommended fixing action(s). Never execute a destructive fix (e.g. \`iris_database_manage\` modify, \`iris_task_run\`) without the user's explicit confirmation.`;
  },
};
