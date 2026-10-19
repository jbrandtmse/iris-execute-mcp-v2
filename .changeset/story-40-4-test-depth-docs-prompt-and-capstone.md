---
"@iris-mcp/dev": patch
"@iris-mcp/shared": patch
---

fix(dev): correct the `iris_execute_tests` hints, two class-source mapping defects, and offer coverage in the deploy prompt (Epic 40, Story 40.4)

`iris_execute_tests` now declares `readOnlyHint: false` and `idempotentHint: false` (DW-498), to agree with its `write` classification; `destructiveHint` and `openWorldHint` stay `false`, and the tool stays classified `write` and enabled by default; an MCP client that reads the hints now treats it as a write. `iris_test_coverage` stays a write and DEFAULT-DISABLED, `iris_test_status:poll` stays a read, and `iris_test_status:cancel` and `iris_test_status:export` stay writes and DEFAULT-DISABLED; `minCoverage` omitted means no verdict. No tool is added and no tool count moves.

The class-source coverage map is corrected twice. A freshly compiled class whose methods hold only `#;` or `#dim` lines is no longer reported `not-up-to-date`, and a stale class whose methods share their first 31 characters no longer reads as 0 lines (DW-601): the service records whether each class still has its compiled line map (`lineMap`) and reads each method's label from its compiled label. A `#dim` line that holds an `=` outside parentheses, string literals and comments is an executable class line (DW-602). `iris_test_status` returns an error result with `structuredContent` for the three reads of `%UnitTest_Result` that could still throw.

The `deploy-and-test-class` prompt gains an optional coverage step, run only when the user asks, and a `PRODUCTION_BUSY` note; its name, title and argument are unchanged.

`@iris-mcp/shared` embeds the changed IRIS classes (`ExecuteMCPv2.Coverage.Job`, `ExecuteMCPv2.REST.Coverage`), so `BOOTSTRAP_VERSION` moves from `845e95f6e726` to `5024e4623f1d`. The Status route of the coverage service gains `lineMap` and is otherwise unchanged (additive).
