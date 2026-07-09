/**
 * `run-external-backup` prompt (Epic 25, Story 25.1 — spec
 * `03-skills-prompts-pack.md` §3).
 *
 * Encodes the freeze/external-snapshot/thaw safety workflow around
 * {@link backupManageTool}: the instance must NEVER be left frozen, even if
 * the external snapshot step fails. Server: iris-ops-mcp.
 */

import type { PromptDefinition } from "@iris-mcp/shared";

/** Render `value`, or a bracketed placeholder for the static skills doc when omitted. */
function arg(value: string | undefined, placeholder: string): string {
  return value !== undefined && value !== "" ? value : placeholder;
}

export const runExternalBackupPrompt: PromptDefinition = {
  name: "run-external-backup",
  title: "Run External Backup",
  description:
    "Freeze the IRIS instance for an external (OS/SAN-level) snapshot backup and thaw it " +
    "safely afterward — thaw ALWAYS runs, even if the snapshot step failed.",
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

    return `# Run External Backup (Freeze / Snapshot / Thaw)

${serverNote}

**Safety invariant: the instance must NEVER be left frozen.** Step 4 (thaw) runs
unconditionally, even if the external snapshot in step 3 failed or was cancelled.

1. Pre-check: call \`iris_journal_info\` to confirm journaling is healthy (state, free space) before freezing.
2. Call \`iris_backup_manage\` action 'freeze' to quiesce ALL database writes instance-wide (\`Backup.General.ExternalFreeze\`). This is DISRUPTIVE — no writes are accepted until thawed. Optionally supply 'logFile' and 'description'.
3. Verify the freeze succeeded (the tool result reports success), then PAUSE and ask the user to run (or confirm completion of) the external OS/SAN-level snapshot. Do not proceed until the user confirms the snapshot finished — successfully OR not.
4. **Always**, regardless of whether the snapshot succeeded, call \`iris_backup_manage\` action 'thaw' to resume database writes (\`Backup.General.ExternalThaw\`). If 'thaw' itself fails, retry immediately and escalate to the user — the instance must not be left frozen.
5. Verify recovery: call \`iris_journal_info\` again and confirm journaling has resumed (state is normal, not frozen).
6. Call \`iris_backup_manage\` action 'listHistory' to record/confirm the run in the backup history log.

Report the overall outcome (frozen → snapshot result → thawed → journaling confirmed resumed) to the user.`;
  },
};
