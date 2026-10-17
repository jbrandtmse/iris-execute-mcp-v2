---
"@iris-mcp/shared": patch
"@iris-mcp/interop": patch
---

fix: Epic 39 deferred cleanup (Story 40.0)

`iris_metrics_interop` counts the Error entries (it counted Warning entries) and, with `messageCount24h`, covers the 24 hours before the call in UTC (DW-584). The `type` filter of `iris_production_logs` maps a display name such as `Error` to its stored number, and a number still matches as before (DW-585). The `trace-message-flow` prompt tells the agent, under the `block` data policy, to report the reason for withheld Event Log and diagram error text and never read it another way (DW-587). Both tools are reads that are enabled by default. No tool, action, governance key or default is added, so no tool count moves. `BOOTSTRAP_VERSION` moves `7d12cd8b3a1e` to `08b8adeaadc6`.
