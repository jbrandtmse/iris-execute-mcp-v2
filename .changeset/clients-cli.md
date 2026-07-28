---
"@iris-mcp/client-config": minor
---

feat(clients): `iris-mcp-clients` CLI — detect/status/diff/apply/enable/disable/remove/restore/doctor over the client-config engine

A new `bin` in `@iris-mcp/client-config` (Epic 33, Story 33.2): `iris-mcp-clients` wires the iris-mcp servers into any supported MCP client without a copy-paste-JSON ritual. The full command surface — `detect` (installed clients + resolved config paths), `status` (the client × iris-mcp-server matrix, foreign entries names-only), `diff` (a hypothetical apply's pending edits, writes nothing), `apply --client --servers --scope --mode` (diff preview first, interactive confirmation on a TTY, `--yes` to skip, a non-TTY invocation without `--yes` refuses), `enable|disable|remove --client --server`, `restore --client [--backup]`, and `doctor` (env-reference resolvability, file parseability, stale-backup and orphaned-stash detection, restart hints, and re-recording entries orphaned by a state.json loss behind `doctor --repair --yes-i-mean-it`).

Exit codes mirror the governance CLI contract (0 success / 1 operational failure / 2 usage error) and every command answers `--json` with one stable `{ok, command, data, error?}` envelope, so the CLI is fully scriptable. `server-manager` and `governance-file` synthesis modes are host-probed (unavailable modes are hidden from `--help` and refused with an explanatory exit 2); `explicit` mode's literal `IRIS_PASSWORD` comes from `--password-stdin` or a hidden prompt — never argv, never echoed — behind the `--confirm-secret <entry-name>` typed confirmation. Every successful write prints the client's restart hint and takes a timestamped backup first.

The CLI is a pure consumer of the package's 33.0/33.1 engine (no re-implemented parse/splice logic, mechanically pinned); it adds zero new dependencies. Also new in the engine: `ensureInputs`/`presentInputIds`, the VS Code native `inputs` merge that completes the env-reference mode's `${input:iris-password}` upgrade on `apply`.
