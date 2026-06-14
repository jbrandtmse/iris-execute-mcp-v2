# @iris-mcp/admin

## 0.0.2

### Patch Changes

- Fix `iris_mapping_manage` for global subscript-level mappings (SLM).

  The handler passed the subscript as a `Subscript` property to `Config.MapGlobals`, which has no such property, so the subscript was silently dropped and create/delete operated on the base global instead of the subscript node (e.g. a request to map `%SYS("HealthShare")` instead remapped base `%SYS`). The subscript is now validated and encoded into the global name for both create and delete, the response `name` echoes the full node, and a new `force` flag guards against remapping a base `%`-prefixed system global. The embedded ObjectScript bootstrap was regenerated (`BOOTSTRAP_VERSION` `8f0cf75be984`) so the fixed classes auto-install on the next MCP-server connect.

- Updated dependencies
  - @iris-mcp/shared@0.0.2
