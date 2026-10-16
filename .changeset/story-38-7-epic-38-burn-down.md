---
"@iris-mcp/shared": minor
"@iris-mcp/dev": minor
"@iris-mcp/interop": patch
---

fix: Epic 38 burn-down (Story 38.7)

**Governance (`@iris-mcp/shared`).** A top-level key of `IRIS_GOVERNANCE` or of the `IRIS_GOVERNANCE_FILE` file that is neither `global` nor `profiles` now fails startup when it looks like governance (a name starting with `iris_` in any letter case, or a boolean or object value), naming the variable, the key and the documented shape and never echoing the value. Plain string, number or null metadata keys (`comment`, `version`) stay valid. A profile name under `profiles` that is not configured only logs a `[WARN]`. The `iris-mcp-governance` commands `set`, `unset` and `validate` fail the same way and leave the file unchanged. The embedded ExecuteMCPv2 classes change (`BOOTSTRAP_VERSION` `d352a6a32158` to `089f8f0a62b2`).

**Documents (`@iris-mcp/dev`).** `iris_doc_get` without a line range returns an error when IRIS answers a soft error. A non-empty `modifiedSince` on `iris_doc_list`, `iris_doc_export` and `iris_package_list` is refused before any request. `iris_doc_load` with `ignoreConflict: false` replaces an existing document through a version-checked save (a lost race is a per-file `DOCUMENT_CONFLICT`). `iris_env_promote` `execute` fails a step whose target write IRIS refused inside an HTTP 200 answer. The rows-affected cap refusal no longer claims that every row change was undone.

**Interop (`@iris-mcp/interop`).** `iris_production_manage` `delete` refuses a class that is not a production class and deletes nothing.
