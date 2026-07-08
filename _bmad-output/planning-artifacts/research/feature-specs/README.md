# Feature Specifications — IRIS MCP Server Suite

Implementation-ready specifications for the 10 features proposed and wargamed in
[`../feature-differentiation-research-2026-07-07.md`](../feature-differentiation-research-2026-07-07.md).

Each spec is written to be handed to an AI dev agent (Opus/Sonnet class) as a self-contained
work order. **Every spec assumes the agent first reads
[`00-conventions.md`](00-conventions.md)** — the shared ground rules (repo layout, tool
registration, ObjectScript handler patterns, deploy loop, governance, testing, docs rollup).
Do not start any spec without it.

## Specs (in recommended build order)

| # | Spec | Feature | Server | Size | Wargame rank |
|---|------|---------|--------|------|:---:|
| 01 | [01-health-check.md](01-health-check.md) | `iris_health_check` composite health diagnostic | ops | ~3 stories | 1 🟢 |
| 02 | [02-governance-presets.md](02-governance-presets.md) | `IRIS_GOVERNANCE_PRESET` safety presets + SQL caps | shared | ~3 stories | 2 🟢 |
| 03 | [03-skills-prompts-pack.md](03-skills-prompts-pack.md) | MCP prompts capability + agent skills pack | shared + all | ~3 stories | 3 🟢 |
| 04 | [04-message-resend.md](04-message-resend.md) | `iris_message_resend` interop message resend/replay | interop | ~4 stories | 4 🔵 |
| 05 | [05-env-diff-promotion.md](05-env-diff-promotion.md) | `iris_env_diff` / `iris_env_promote` cross-profile drift & promotion | dev + shared | ~5 stories | 5 🔵 |
| 06 | [06-sql-performance-advisor.md](06-sql-performance-advisor.md) | `iris_sql_analyze` `advise` action (index/stats advisor) | dev | ~4 stories | 6 🔵 |
| 07 | [07-observability-audit-log.md](07-observability-audit-log.md) | Tool-call audit logging (`IRIS_AUDIT_LOG`) | shared | ~3 stories | 7 🔵 |
| 08 | [08-embedded-python.md](08-embedded-python.md) | `iris_python_execute` / `iris_python_env` | dev | ~2 stories | 8 ⚪ |
| 09 | [09-semantic-search.md](09-semantic-search.md) | `iris_semantic_index` / `iris_semantic_search` (vector) | dev | ~1.5 epics | 9 ⚪ gated |
| 10 | [10-fhir-health-server.md](10-fhir-health-server.md) | `@iris-mcp/health` FHIR server (read-only MVP) | new package | ~2 epics | 10 🟣 |

## Dependency notes

- Specs 01–08 are independent of each other, with two soft links: spec 03 includes one prompt
  that references the tool from spec 04 (ship it disabled/omitted if 04 hasn't landed), and
  spec 02's read-only preset automatically covers any tool added by later specs (their
  `mutates` classification feeds it — no rework).
- Spec 09 is **gated**: requires spec 08 shipped AND IRIS 2024.1+ available for testing.
- Spec 10 is a separate initiative (new package); requires an IRIS for Health test instance.

## Ground rules that apply to every spec (enforced in 00-conventions.md)

1. **Probe before build** — any IRIS class-method claim in a spec marked `[PROBE]` must be
   verified against live IRIS / `irislib/` source before coding to it (project Rule #16).
2. **Governance classification is mandatory** for every new tool/action (Rule #28); new writes
   default-disabled unless a spec explicitly invokes the `defaultEnabled` mechanism (Rule #32).
3. **Never touch** `packages/shared/src/governance-baseline.ts` (frozen, Rule #23) and never
   hand-edit `bootstrap-classes.ts` (regenerate, Rules #18/#24).
4. **Every write action ships with a live rejection smoke** (Rule #26) and every
   namespace-sensitive tool smokes against a second namespace (Rule #34).
