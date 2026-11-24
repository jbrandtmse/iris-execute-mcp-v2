---
"@iris-mcp/data": patch
"@iris-mcp/shared": patch
---

fix: `iris_docdb_manage` `create` registers the database's `Security.DocDBs` record, so the database is usable at once (Story 44.1, DW-688)

- IRIS denies every DocDB call other than `list` on a database without a `Security.DocDBs` record (`ERROR #822: Access Denied`), and the DocDB REST API never writes one. After the DocDB create, `create` now registers the record through the new ExecuteMCPv2 route `POST /api/executemcp/v2/security/docdb` (IRIS's own `$$Create^%SYS.DOCDB`; no Resource). The result is the DocDB definition plus `registered: true`. `create` on a database that exists without a record (made by `1.1.0` or earlier) registers it and returns `{database, namespace, created: false, registered: true}`; with the record present it returns the unchanged "already defined" error. A registration failure is an error naming what was created, the real text and the two fixes.
- A document, find, property or drop call that answers `#822` with `%Service_DocDB` enabled now checks the record (`GET /api/executemcp/v2/security/docdb`) and names a missing record or database. The disabled-service message and the pass-through of any other `#822` are unchanged.
- The `iris_docdb_manage` description gains one appended sentence (sanction `S-44.1-docdb-manage-text`). `BOOTSTRAP_VERSION` moves from `1.1.0+2.244fe8623c76` to `1.1.0+3.3e97060f5bc4`.

No tool, action, input field, governance key or visibility is added or changed, and the requests of `list`, `drop` and the other DocDB tools are byte-identical.
