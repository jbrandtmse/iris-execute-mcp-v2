---
"@iris-mcp/shared": minor
"@iris-mcp/admin": minor
"@iris-mcp/data": minor
"@iris-mcp/dev": minor
"@iris-mcp/interop": minor
"@iris-mcp/ops": minor
---

feat: `IRIS_DATA_POLICY=block` also turns off the raw-read and code-execution tools (Story 45.4, sanction `S-45.4-block-raw-tools`, GitHub issue #1 point 1)

- Under the data policy `block`, a profile's raw-read and code-execution tools are seeded **disabled**: `iris_sql_query`, `iris_sql_execute`, `iris_global_get`, `iris_global_list`, `iris_execute_command`, `iris_execute_classmethod`, `iris_execute_tests`, `iris_test_coverage`, `iris_transform_test`, `iris_docdb_document:get` and `iris_docdb_find`. The seed is a new layer of the governance cascade (`env.profile ?? env.global ?? file.profile ?? file.global ?? inheritedDisable ?? dataPolicySeed ?? presetSeed ?? defaultSeed`), so it sits below every explicit setting and above the read-only preset. A call is refused with `GOVERNANCE_DISABLED` plus the new field `dataPolicyApplied: "block"` and the text suffix ` (data policy 'block')`, nothing reaches IRIS, and the audit entry (`denied`) copies `dataPolicyApplied`. `iris_server_profiles`, the `iris-governance://` resource and the `iris-mcp-governance` CLI (`effective` and `universe`) report the key `false` with the new `configSource` value `dataPolicy`.
- An explicit `true` for the key in `IRIS_GOVERNANCE` or the governance file (per profile or global) re-enables it; the startup warning then names it. `IRIS_TOOLS_ENABLE` only shows a tool and never re-enables one, and a call's own arguments never do. A seeded disable is not inherited by a child key, so `iris_sql_query` has its own seed.
- Each server writes at most one startup `[WARN]` line, from configuration alone, naming for each `redact` or `block` profile the covered tools that are visible and enabled. It says that `redact` covers message bodies only, points to the README's "PHI data policy" section, and never offers `IRIS_DATA_POLICY=allow` as a way out. It is absent under `allow` and when nothing qualifies. With the default policy a stock dev server now logs this line; it is the only new output.
- `block` does not cover the write tools that run code (compile, load, production start, cube build, task run); the `read-only` preset turns those off, so use both for a connection to an instance with PHI.
- Under `redact`, `allow` and an unset policy, every key's enabled state and `configSource`, every tool result, every `iris_server_profiles` field, every denial and every audit entry are byte-identical to before; a test replays the baseline build's output and fails on any difference. The PHI data policy scope table in `tool_support.md` moves to 2026-11-25: `iris_global_list` and `iris_locks_list` move from not applicable to residual, and every residual row has an "Under `block`" verdict.

No tool, action, governance key, preset row or input field is added or changed, `GOVERNANCE_BASELINE` is untouched, and `BOOTSTRAP_VERSION` does not move.
