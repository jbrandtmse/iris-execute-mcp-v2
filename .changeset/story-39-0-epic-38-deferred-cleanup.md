---
"@iris-mcp/shared": minor
"@iris-mcp/dev": patch
---

feat: Epic 38 deferred cleanup (Story 39.0)

**Governance keys that name nothing (`@iris-mcp/shared`).** A key inside `global` or a profile of `IRIS_GOVERNANCE` or of the `IRIS_GOVERNANCE_FILE` file that is none of a tool's keys (a bare name for a per-action tool, an action on a single-operation tool, an action the tool lacks) now logs one `[WARN]` per key at server startup, for the tools that server registers. The server still starts and the effective policy is unchanged. A misspelled tool name names no tool any server registers, so it logs nothing at startup; the new `iris-mcp-governance check` command checks every key against the whole suite's key universe and exits 1 when a key matches nothing, a misspelled tool name included. A valid document behaves exactly as before.

**Tool description (`@iris-mcp/dev`).** The `type` parameter of `iris_doc_list`, `iris_package_list` and `iris_doc_export` no longer offers `'cls'` for category CLS, which Atelier answers with HTTP 400. The three tools share one description.

The default test runs now share one environment harness and one startup-variable scrub; neither is published.
