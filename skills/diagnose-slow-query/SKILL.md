---
# DO NOT EDIT: generated from the MCP prompt of the same name.
name: diagnose-slow-query
description: "Diagnoses a slow IRIS SQL query from its query plan, the maps and indexes the plan reads, and the statement's cumulative run-time statistics, looking for full table scans, missing indexes, hot statements and plan inefficiencies, then recommends a fix such as a new index or a rewritten WHERE clause without applying it. Use when the user says a SQL query is slow, asks why a query does not use an index, or wants a query plan explained."
metadata:
  iris-tools-preset: developer
---

# Diagnose Slow Query

Query to diagnose:
```sql
<query>
```

No namespace specified — omit `namespace` to use the server's configured default on every call below.

1. Call `iris_sql_analyze` action 'explain' with `query: "<query>"` to get the query plan text.
2. Call `iris_sql_analyze` action 'indexUsage' with the SAME query to see which maps/indexes the plan actually reads.
3. Call `iris_sql_analyze` action 'stats' (optionally with a 'filter' matching this query's statement text) to see cumulative runtime statistics — StatCount, StatTotal, StatAverage, StatRowCount — if this query has run before.
4. Interpretation checklist:
   - **Full-scan markers**: plan text mentioning "Read master map" scanning the WHOLE table (no index map named) on a large table is a red flag — the query is likely not using an index it should.
   - **Missing-index reasoning**: if 'indexUsage' shows only the master map (no index map) for a WHERE/JOIN/ORDER BY column, an index on that column may help.
   - **High StatAverage relative to StatRowCount**: many statement executions each touching few rows but taking long individually suggests a plan inefficiency, not a data-volume issue.
   - **StatCount very high**: a hot query — even a small per-execution improvement compounds; prioritize it.
5. Summarize findings and RECOMMEND a fix (e.g. "add an index on Table.Column", or "rewrite the WHERE clause to avoid a function on an indexed column"). Do NOT create the index or modify the class yourself — present the recommendation and let the user decide whether to apply it (e.g. via a class edit + `iris_doc_load`).
