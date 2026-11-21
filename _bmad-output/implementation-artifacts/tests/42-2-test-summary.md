# Test Automation Summary - Story 42.2 (Bootstrap Downgrade Guard)

QA gap analysis of the diff `0d65b22..4fd0acb` against the spec's I/O & Edge-Case Matrix and ACs. Every matrix row and AC
already had a pinning test with a recorded mutation; the implement stage's suite was blind in six places, closed here. Every
command ran unarmed (no `IRIS_*` variable, no docker, no built 42.2 server near the shared instance).

## Generated / Modified Tests

### Vitest (`@iris-mcp/all`)
- [x] `packages/iris-mcp-all/src/__tests__/no-live-iris-preload.test.ts` - 15 tests (new, DW-627): the connection-refusing
  preload driven in child Node processes - default watch list, `IRIS_MCP_WATCH_PORTS` / `IRIS_MCP_WATCH_HOSTS` replacing it,
  the append-only log, pass-through of unwatched TCP and IPC connects, `connectTargetOf` / `isWatched`.
- [x] `packages/iris-mcp-all/src/__tests__/story-42-2-qa-throwaway-wiring.test.ts` - 8 tests (new, AC 42.2.5): the root
  script `live:bootstrap-guard`, the harness environment against the gate's arming decision, the `docker run` arguments
  against the `docker inspect` checker.
- [x] `packages/iris-mcp-all/src/__tests__/story-42-2-qa-launcher-arming-parity.test.ts` - 28 tests (new, DW-627): the
  launcher's AD-2 copy of the arming helper agrees with the shared one over 28 environments.
- [x] `packages/iris-mcp-all/src/__tests__/live-arming-guard.test.ts` - (b2) added, 20 tests (DW-627): the per-package
  child runs again with `IRIS_HOST` and `IRIS_PORT` set and no `IRIS_REQUIRE_LIVE`, and with all five variables set and
  `IRIS_REQUIRE_LIVE=0`. Plus one `shared` default-suite group in each of the three run sets (57 -> 60 with the shared
  `integration-config.test.ts`).

### Vitest (`@iris-mcp/shared`)
- [x] `packages/shared/src/__tests__/integration-config.test.ts` - 20 tests (new, DW-627): `getIntegrationConfig` and
  `isIrisAvailable`, the choke point of the eleven integration files.
- [x] `packages/shared/src/__tests__/gen-bootstrap-write.test.ts` - 1 test added (AC 42.2.3): the hand-committed first
  state `{"sequence": 0, "hash": ""}` makes the first run sequence 1.

## Runs
- `@iris-mcp/shared` 86 files / 2435 tests; `@iris-mcp/all` 186 files in two `--shard` runs (2248 + 1942 passed, 358 + 330
  skipped); shared `type-check` clean, `lint` with its one existing warning.
- HSCUSTOM `SELECT ExecuteMCPv2.Setup_GetBootstrapVersion()` read `d51856f74d6a` before and after.

## Falsifiability
Sixteen mutations demonstrated red and reverted byte-identical (recorded under the spec's `## Verification`). Three show a
blind spot of the existing suite: a preload that refuses every connect, a preload without port 1972, and a leg armed by a set
`IRIS_HOST` all left `live-arming-guard.test.ts` (a) and (b) green.

## Not tested (by decision)
- A failed or empty version read: the DW-673 acceptance item is implemented by the code-review stage; no test written for
  either behavior.
- The armed side of the migrated family C, D and E files: ledgered (deferred item 9), Story 42.3's armed run.
- `pnpm live:bootstrap-guard` itself: no docker on this machine (decision #49); Story 42.3's CI runs it.
