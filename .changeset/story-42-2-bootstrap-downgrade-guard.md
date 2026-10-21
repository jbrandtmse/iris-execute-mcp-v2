---
"@iris-mcp/shared": minor
---

feat: the bootstrap never downgrades the ExecuteMCPv2 classes (Story 42.2, DW-508)

- `BOOTSTRAP_VERSION` is now the marker `<semver>+<sequence>.<hash>`, ordered by semver and then sequence. An absent deployment is installed and an older one (a lower marker, or a bare 12-character hash from an earlier build) is redeployed as before. A newer deployment, and a foreign one (the same semver and sequence with another hash, `dev`, or an unparseable value), is left alone: nothing is uploaded or compiled and one `[WARN]` names both markers and the remedy. The marker is read again immediately before each compile.
- An instance whose deployed marker is `dev` (a hand-loaded `src/` deployment) is no longer overwritten at the next start.
- Builds from before this release still redeploy over a newer deployment, so upgrade every client that shares an instance together.
- `@iris-mcp/shared` exports `classifyDeployedMarker` and `parseBootstrapMarker`.
- Live test legs are opt-in: `IRIS_REQUIRE_LIVE=1` arms them and then all five of `IRIS_HOST`, `IRIS_PORT`, `IRIS_USERNAME`, `IRIS_PASSWORD` and `IRIS_NAMESPACE` are required. A plain `pnpm test` touches no IRIS instance.

No tool, action, governance key, preset row, REST route or product environment variable is added or changed, and the governance baseline stays `1e62c5ad5bf7` (141 keys).
