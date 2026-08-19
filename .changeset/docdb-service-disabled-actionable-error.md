---
"@iris-mcp/data": patch
---

fix(data): actionable error when %Service_DocDB is disabled (Epic 35, Story 35.7 / 35-SWEEP-5)

`%Service_DocDB` is disabled by default on IRIS, and all four DocDB tools (`iris_docdb_manage`, `iris_docdb_document`, `iris_docdb_find`, `iris_docdb_property`) previously failed with a bare `ERROR #822: Access Denied` and no path forward. The tools now detect this case on the error path — an `IrisApiError` carrying the locale-stable numeric `code: 822` (message text is never matched) triggers a single follow-up check of the live `%Service_DocDB` state, and when the service reads disabled the error becomes an actionable message naming the cause and BOTH remedies: the Management Portal (System Administration > Security > Services > %Service_DocDB), or `iris_service_manage` with `action="enable"` (itself governance-default-disabled, requiring an `IRIS_GOVERNANCE` override such as `{"global": {"iris_service_manage:enable": true}}`). When the service is enabled (a genuine privilege failure), when the state check itself fails, or when the error is not 822, the original error passes through unchanged. The four tool descriptions and the package README now document the prerequisite, and `tool_support.md` no longer claims the service is enabled by default.
