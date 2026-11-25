---
"@iris-mcp/dev": patch
"@iris-mcp/shared": patch
---

fix: `iris_sql_execute` and `iris_sql_query` honor the account's SQL privileges (Story 45.1, sanction `S-45.1-sql-privileges`, GitHub issue #1 point 4)

- The ExecuteMCPv2 route `POST /api/executemcp/v2/dev/sql/execute` now prepares every statement with SQL privilege checking on. An account with `%Development` and no SQL grants used to read tables through both tools, and write and create tables through `iris_sql_execute`; now a statement it has no grant for fails at prepare with IRIS's own error (`SQLCODE: -99`, `User <name> is not privileged for the operation`), and nothing runs. There is no setting, request field or environment variable that turns the check off.
- Ordering change: the privilege check happens at prepare, before the read-only, `countOnly`, `maxRowsAffected` and `%NOJOURN` checks, so an ungranted statement answers the privilege error instead of `SQL_READ_ONLY`, `SQL_ROWS_AFFECTED_CAP` or the `countOnly` message. Nothing runs in either case. This holds for the privileges IRIS checks at prepare; IRIS checks GRANT and some DDL (for example CREATE INDEX) only at execution.
- An account with `%All`, or with the grants the statement needs (SELECT, INSERT, UPDATE or DELETE on the table, EXECUTE on each SqlProc function or procedure it calls, and each SQL administrative privilege it uses, such as `%CREATE_TABLE`, `%NOTRIGGER` for TRUNCATE TABLE or `%NOJOURN`), sees byte-identical requests and responses.
- IRIS's own Atelier `action/query` route (used by other tools, and reachable by the same account) prepares with checking off. That is IRIS's API, so it is unchanged and documented.
- `BOOTSTRAP_VERSION` moves from `1.2.0+5.6cbac260e73f` to `1.2.0+8.5cedcac20ae9`. The server redeploys its IRIS classes on the next connect.

No tool, action, input field, governance key or visibility is added or changed.
