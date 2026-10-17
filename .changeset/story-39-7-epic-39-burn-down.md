---
"@iris-mcp/shared": minor
"@iris-mcp/dev": patch
"@iris-mcp/interop": minor
---

fix: Epic 39 burn-down (Story 39.7)

Every non-2xx response from IRIS is now an `IrisApiError`, including an HTTP 400 with an empty error list (DW-569): an empty `iris_doc_search` query is an error, and `iris_macro_info` with no document keeps its documented empty result. Under the `block` PHI data policy `iris_production_logs` and `iris_message_diagram`, both reads that are enabled by default, withhold their Event Log text and error-warning text with a fixed reason; under `redact` and `allow` they are unchanged (DW-576). Under `allow`, `iris_message_body` shows the text of a character-stream property within `maxChars` (DW-583). The header reads of `iris_message_search` carry an index hint, so a filter reads the time window and not history-wide bitmaps (DW-572). No tool, action, governance key or default is added, so no tool count moves. `BOOTSTRAP_VERSION` moves `2fd17b50a024` to `7d12cd8b3a1e`.
