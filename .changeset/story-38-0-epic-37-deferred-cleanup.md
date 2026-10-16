---
"@iris-mcp/shared": minor
"@iris-mcp/dev": patch
"@iris-mcp/admin": patch
"@iris-mcp/interop": patch
---

fix: Epic 37 deferred cleanup (Story 38.0)

`@iris-mcp/shared` (minor): the `IRIS_NAMESPACE` default is now `USER` (it was `HSCUSTOM`); set `IRIS_NAMESPACE`
explicitly to keep a HealthShare namespace. The startup health-check failure is logged with its prefix exactly once. New
exports `stripLeadingBom` and `atelierDocStatusError`.

`@iris-mcp/dev` (patch): `iris_doc_put` strips a leading BOM and reports an IRIS-refused write as an error instead of
"saved successfully"; `iris_doc_export` sends `generated` on its `modifiedSince` branch.

`@iris-mcp/admin` (patch): `iris_resource_manage:listPrivileges` takes `system` (default false, always sent as 1 or 0)
and rejects a malformed `target` with a validation message instead of a raw `<SUBSCRIPT>` 500.

`@iris-mcp/interop` (patch): `iris_production_manage:delete` refuses the current production in any state other than
Stopped and removes an orphan `Ens.Config.Production` row (`orphanRemoved: true`); `iris_production_item:get` adds a
`production` field; the `enable`/`disable` description documents the unresolvable-host repair.

The cube-build output-redirect restore in the Analytics handler (shipped through the bootstrap embed, so it reaches
`iris_analytics_cubes` `build`) is guarded step by step.

`BOOTSTRAP_VERSION` moves from `2159ec9e6f69` to `3af8ca401e7c`. Every IRIS-side route change keeps every older request
shape working and only adds response fields; the behavior changes are the ones listed above.
