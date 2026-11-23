---
"@iris-mcp/data": patch
"@iris-mcp/dev": patch
"@iris-mcp/admin": patch
"@iris-mcp/shared": patch
"@iris-mcp/client-config": patch
---

fix: the Epic 44 burn-down (Story 44.7: DW-723, DW-724, DW-725, DW-747, DW-754, DW-755, DW-757, DW-758, DW-759)

- `iris_docdb_property`: `create` sends a `path` (default `$.<property>`, new optional input `path`), so a created property is filled and `iris_docdb_find` on it matches; `index` reads an existing property (`indexed: true, created: false`, no write) and creates a missing one (`created: true`) instead of failing with `ERROR #5805`. The `iris_docdb_property` and `iris_docdb_manage` descriptions are corrected (sanctions `S-44.7-docdb-property`, `S-44.7-docdb-manage-text`).
- `iris_doc_compile`, `iris_doc_load` (`compile: true`) and `iris_env_promote` (`execute`) check, after a compile IRIS answered with no error listed, that each class (class dictionary and IRIS's up-to-date flag) and each `.mac` routine (up-to-date flag) compiled, so a failure that IRIS answers with HTTP 200 is no longer reported as success. `@iris-mcp/shared` exports `verifyRoutinesCompiled`.
- `iris_database_manage` `delete` also dismounts the database (the reply gains `dismounted` and `dismountNote`) and keeps `IRIS.DAT` (sanction `S-44.7-database-delete`). `BOOTSTRAP_VERSION` moves from `1.1.0+3.3e97060f5bc4` to `1.1.0+4.08228306009d`.
- `iris-mcp-clients doctor` tells a user to delete by hand an old-file entry that Claude Code owns in the shared `.mcp.json`, instead of an `apply` that is refused.

No tool, action, governance key or visibility is added or changed. Every request and result outside the listed ones is byte-identical (pinned).
