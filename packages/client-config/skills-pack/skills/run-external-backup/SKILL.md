---
# DO NOT EDIT: generated from the MCP prompt of the same name.
name: run-external-backup
description: "Freezes an IRIS instance for an external backup snapshot taken at the OS or SAN level, waits while the user takes the snapshot, and always thaws the instance afterwards, even when the snapshot fails, then confirms that journaling resumed and checks the run in the backup history. Use when the user wants to back up IRIS with an external OS-level or SAN snapshot, or asks to freeze and thaw IRIS database writes for a backup."
metadata:
  iris-tools-preset: full
---

# Run External Backup (Freeze / Snapshot / Thaw)

No server profile specified — omit `server` (or pass "<server>") to use the default server on every tool call below.

**Safety invariant: the instance must NEVER be left frozen.** Step 4 (thaw) runs
unconditionally, even if the external snapshot in step 3 failed or was cancelled.

1. Pre-check: call `iris_journal_info` to confirm journaling is healthy (state, free space) before freezing.
2. Call `iris_backup_manage` action 'freeze' to quiesce ALL database writes instance-wide (`Backup.General.ExternalFreeze`). This is DISRUPTIVE — no writes are accepted until thawed. Optionally supply 'logFile' and 'description'.
3. Verify the freeze succeeded (the tool result reports success), then PAUSE and ask the user to run (or confirm completion of) the external OS/SAN-level snapshot. Do not proceed until the user confirms the snapshot finished — successfully OR not.
4. **Always**, regardless of whether the snapshot succeeded, call `iris_backup_manage` action 'thaw' to resume database writes (`Backup.General.ExternalThaw`). If 'thaw' itself fails, retry immediately and escalate to the user — the instance must not be left frozen.
5. Verify recovery: call `iris_journal_info` again and confirm journaling has resumed (state is normal, not frozen).
6. Call `iris_backup_manage` action 'listHistory' to record/confirm the run in the backup history log.

Report the overall outcome (frozen → snapshot result → thawed → journaling confirmed resumed) to the user.
