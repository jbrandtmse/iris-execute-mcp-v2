---
"@iris-mcp/dev": minor
"@iris-mcp/shared": patch
---

feat(dev): refuse a TestProduction run while another production runs (Epic 40, Story 40.3)

`%UnitTest.TestProduction` stops any production in the namespace that is not stopped before it starts its own, so running such a test silently stopped another user's production on a shared instance. `iris_execute_tests` and `iris_test_coverage` now ask one IRIS-side guard, under Ens's own production lifecycle lock, before anything runs: the run goes ahead when the namespace's production is stopped or is one of the productions the run's TestProduction tests declare, and is otherwise refused with the new refusal code `PRODUCTION_BUSY` (`namespace`, `state`, `testProductions`, and `production` or `error`). Nothing is queued or run, and the other production is left untouched. A run with no TestProduction test is unchanged. `iris_execute_tests` stays enabled by default, `iris_test_coverage` stays DEFAULT-DISABLED, and no key is added. The guard needs the ExecuteMCPv2 service at this version: a run against a server without it is unguarded, as before. The suite never stops a production, not even one a failed or cancelled TestProduction run left behind; stop it with `iris_production_control`.

`@iris-mcp/shared` adds `REFUSAL_CODES.PRODUCTION_BUSY` and embeds the changed IRIS classes (`ExecuteMCPv2.REST.UnitTest`, `ExecuteMCPv2.REST.Coverage`, `ExecuteMCPv2.REST.Dispatch`), so `BOOTSTRAP_VERSION` moves from `06b8b83fc319` to `7f92a971b7e5`. The new route `GET /dev/test/production` and the coverage outcome `production-busy` are additive. `iris_test_coverage` also rejects a `target` whose package or class part is empty (such as `:` or `:TestSomething`), in its schema and in the service's validation, because the runner would read it as every compiled test class under `^UnitTestRoot`. No tool is added and no tool count moves.
