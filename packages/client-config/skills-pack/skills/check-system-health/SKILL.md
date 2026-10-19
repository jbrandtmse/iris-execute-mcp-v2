---
# DO NOT EDIT: generated from the MCP prompt of the same name.
name: check-system-health
description: "Runs one composite health check of an IRIS instance across its nine areas (journal, databases, license, locks, alerts, mirror, ECP, interoperability and the system) and follows each warning, critical or error finding to the tool that explains or fixes it, never running a destructive fix without the user's confirmation. Use when the user asks whether IRIS is healthy or wants a health or status check, or reports trouble with journal space, database size, the license, locks or alerts."
metadata:
  iris-tools-preset: full
---

# Check System Health

No server profile specified — omit `server` (or pass "<server>") to use the default server on every tool call below.

1. Call `iris_health_check` (optionally with an `areas` filter; omit or pass `[]` for all 9 areas) to get one composite verdict ('healthy' | 'warning' | 'critical') plus a per-area finding explaining WHY.
2. Read the overall `verdict` first, then walk every finding whose `level` is 'warning', 'critical', or 'error' — skip 'ok' and 'notApplicable' findings, they need no action.
3. For each non-ok finding, its `explanation` may already name a fixing tool. Otherwise use this mapping:
   - **journal** warning/critical → call `iris_journal_info` for detail; free disk space, or run a configured purge task via `iris_task_run`.
   - **databases** warning/critical → call `iris_database_check` for the named worst database. To raise `maxSize`/`expansionSize`, use `iris_database_manage` action 'modify' — note this tool is on the **admin** MCP server, NOT this ops server, so switch to the admin server for that step (or free disk space instead).
   - **license** warning/critical → call `iris_license_info` for detail; reduce active connections or contact licensing.
   - **locks** warning/critical → call `iris_locks_list` to find the largest lock holders; consider `iris_process_manage` to investigate the offending process.
   - **alerts** warning/critical → call `iris_metrics_alerts` for the active alert detail.
   - **mirror** / **ecp** / **interop** / **system** are informational in v1 (always 'ok' or 'notApplicable') — read the raw values for context; no threshold action applies.
   - **error** on any area → the probe itself failed (counts as 'warning' severity only); investigate that area's own dedicated tool directly (e.g. `iris_journal_info`, `iris_mirror_status`).
4. Summarize the overall verdict and the recommended fixing action(s). Never execute a destructive fix (e.g. `iris_database_manage` modify, `iris_task_run`) without the user's explicit confirmation.
