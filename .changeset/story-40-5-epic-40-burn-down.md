---
"@iris-mcp/shared": patch
"@iris-mcp/dev": patch
"@iris-mcp/interop": patch
---

fix: Epic 40 burn-down (Story 40.5)

`iris_alerts_manage` `reset` stamps `clearedAt` in UTC (it labelled local time as UTC; the format is unchanged) (DW-589). `POST /tests` at the package level runs the package's test classes (the spec joined them in a form the test runner read as a method name), and `iris_test_coverage` package runs are unchanged (DW-597). `pnpm gen:bootstrap` writes the embed only when its content changes (DW-591). The `recover-stuck-production` prompt tells the agent, under the `block` data policy, to report the reason for withheld Event Log text and never read it another way (DW-590); the `edit-and-test-class` prompt gains the `PRODUCTION_BUSY` note (DW-609); and that note, shared with `deploy-and-test-class`, covers a refusal whose production state could not be read (DW-610). The names, titles, arguments and descriptions of the three prompts are unchanged. No tool, action, governance key or default is added, so no tool count moves. `BOOTSTRAP_VERSION` moves from `5024e4623f1d` to `5296a1c836f4`.
