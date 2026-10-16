---
"@iris-mcp/shared": minor
"@iris-mcp/dev": minor
---

feat: SQL write safety (Story 38.5)

`@iris-mcp/dev` (minor): new read tool `iris_sql_query` (dev 30 to 31 tools): it runs only queries, inside a transaction
that is always rolled back, stays enabled under the read-only preset, and declares the parent key `iris_sql_execute`.
`iris_sql_execute` gains the optional parameters `readOnly`, `maxRowsAffected` and `countOnly`, the result fields
`rowsAffected` and `totalCount`, and runs through the ExecuteMCPv2 route `POST /dev/sql/execute` (new handler
`ExecuteMCPv2.REST.Sql`) instead of the Atelier `action/query` route; its SQL-error text names the new route. Under a
rows-affected cap, an INSERT, UPDATE or DELETE whose text contains `%NOJOURN` is refused with `SQL_ROWS_AFFECTED_CAP`
before it runs, because it turns journaling off and the rollback could not undo it. The `core` preset gains
`iris_sql_query` (14 to 15 runtime tools).

`@iris-mcp/shared` (minor): new operator variables `IRIS_SQL_READ_ONLY` and `IRIS_SQL_MAX_ROWS_AFFECTED` (config fields
`sqlReadOnly` and `sqlMaxRowsAffected`, inherited by every profile), and the refusal codes `SQL_READ_ONLY` and
`SQL_ROWS_AFFECTED_CAP`.

`BOOTSTRAP_VERSION` moves from `3af8ca401e7c` to `d352a6a32158`. With no new parameter or variable in use, every
pre-existing field of every `iris_sql_execute` result is unchanged.
