---
"@iris-mcp/dev": minor
---

feat: editing and SQL safety docs, the `edit-and-test-class` prompt and the Epic 38 capstone (Story 38.6)

`@iris-mcp/dev` (minor): new prompt and generated skill `edit-and-test-class` (dev 4 to 5 prompts): it reads a line range
with `iris_doc_get`, edits with a guarded `iris_doc_edit`, compiles and runs the tests, checking `total` against the number
of `Test*` methods. No tool, governance key or preset row is added. A `STALE_CONTENT` refusal's `mismatches[].current` now
ends with one line break, so it parses back to exactly the addressed lines (also for a range that ends in an empty line)
and can be passed back as `expected` unchanged; the running hint and description of `iris_execute_tests` and the
`deploy-and-test-class` prompt name `iris_sql_query` for the manual `%UnitTest_Result` query, because the read-only preset
blocks `iris_sql_execute`; `deploy-and-test-class` also fixes a class with no local source in place.

No ObjectScript change: `BOOTSTRAP_VERSION` stays `d352a6a32158`.
