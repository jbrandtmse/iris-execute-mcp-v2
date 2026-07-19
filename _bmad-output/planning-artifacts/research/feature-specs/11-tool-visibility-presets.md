# Spec 11 — Tool Visibility Presets (`IRIS_TOOLS_PRESET`) + Per-Tool Enable/Disable

**Server:** `@iris-mcp/shared` (framework) + preset rosters in all 5 server packages | **Priority:** proposed (Wave 2 candidate) | **Effort:** ~4 stories
**Governance:** framework change, NO new tool keys, NO change to call-time governance | **Prereqs:** none
**Read first:** [`00-conventions.md`](00-conventions.md), `packages/shared/src/server-base.ts` (constructor
registration loop, `registerTool`, `start()`), `packages/shared/src/governance.ts` (preset + cascade
precedent), `packages/shared/src/tool-types.ts`, `packages/shared/src/server-discovery.ts`,
root `README.md` §"Multiple Servers & Governance",
`../technical-mcp-server-best-practices-research-2026-04-05.md` (§3.1 "5-15 Tools Per Server")

## 1. Objective

The suite has drifted past its own research-backed tool-count ceiling. The best-practices research
(2026-04-05) is unambiguous: *"limiting tools per server to 5-15 for optimal LLM performance"*
(line 11), *"Performance degrades sharply past ~20 tools — a cliff, not gradual"* (line 19), and
GitHub's Copilot evidence: 40 → 13 tools produced a 2-5% benchmark improvement + 400ms latency
reduction (line 129). The product brief promised "9-22 tools per server." Current reality
(package `tools[]` array + the framework `iris_server_profiles` tool every server registers):

| Server | Package tools | Runtime tools | vs. guidance |
|---|:---:|:---:|---|
| iris-dev-mcp | 28 | 29 | past the ~20 cliff |
| iris-admin-mcp | 26 | 27 | past the ~20 cliff |
| iris-interop-mcp | 22 | 23 | at the cliff |
| iris-ops-mcp | 21 | 22 | at the cliff |
| iris-data-mcp | 7 | 8 | fine |
| **Total** | **104** | **109** | |

Weaker models (Haiku-class, local LLMs) pay twice: tool-selection accuracy drops with list size,
and every tool's name+description+schema burns context tokens on every turn.

Today's governance layer deliberately does NOT help here: disabled actions **stay visible** in
`tools/list` and are refused at call time (README §governance; `dispatchToolCall` gate). This spec
adds the missing, orthogonal layer — **advertise-time visibility**. A hidden tool is never
registered with the MCP SDK: absent from `tools/list`, uncallable (standard MCP unknown-tool
error), zero context cost. To the agent it does not exist.

```
IRIS_TOOLS_PRESET=core                    # ~10-tool everyday subset per server (small-model sweet spot)
IRIS_TOOLS_PRESET=developer               # persona filter: dev-relevant tools, security/enterprise admin hidden
IRIS_TOOLS_PRESET=full                    # explicit alias for today's behavior (default when unset)
IRIS_TOOLS_DISABLE=iris_doc_export,iris_env_*   # hide individual tools / families
IRIS_TOOLS_ENABLE=iris_env_diff           # punch a hole: re-show a tool the preset/disable hid
```

Headline README line this enables: *"Trim any server to a ~10-tool core for small models with one
environment variable."*

**Back-compat is a release gate:** unset env vars ⇒ byte-for-byte today's `tools/list` (Rule #19
mechanical proof required). This feature is strictly additive.

## 2. Design

### 2.1 Two orthogonal layers — visibility in front of governance

| | Visibility (NEW) | Governance (existing, unchanged) |
|---|---|---|
| Question | "Does the agent know this exists?" | "Is this call allowed?" |
| Granularity | per **tool** | per **action** (`tool` / `tool:action`) |
| Enforcement point | registration (never enters SDK registry / `tools/list`) | `dispatchToolCall` runtime gate |
| Failure surface | standard MCP unknown-tool error | structured `GOVERNANCE_DISABLED` error |
| Purpose | context ergonomics, tool-selection accuracy | safety / authorization |

Rules of interaction (state these in README):
- Visibility is evaluated first by construction: a hidden tool cannot reach the governance gate.
- An `IRIS_GOVERNANCE` key referencing a hidden tool is legal and inert (config is shared across
  all 5 servers; governance already tolerates keys for tools it doesn't host — unchanged).
- Visibility is per-tool only. Hiding a single *action* of a multi-action tool remains
  governance's job (call-time refusal). No schema surgery on `action` enums.
- Positioning: governance is the **safety** layer; visibility is **ergonomics**. `read-only`
  safety still means `IRIS_GOVERNANCE_PRESET=read-only`, never a visibility preset.
- Per-profile visibility is impossible by protocol: an MCP server process serves ONE `tools/list`
  regardless of which connection profile a call targets. Visibility env vars are process-global;
  there is no `profiles` sub-structure (deliberate contrast with `IRIS_GOVERNANCE`).

### 2.2 Env vars & resolution

Three new env vars, one family, parsed once at startup with the existing fail-fast pattern
(mirror `parseGovernanceConfig`/`parseGovernancePreset` error style, naming the variable):

- **`IRIS_TOOLS_PRESET`** — `full` (default) | `core` | `developer`. Unknown value → **fail fast**
  at startup naming the valid values.
- **`IRIS_TOOLS_DISABLE`** — comma-separated tool names to hide. Trailing-`*` wildcard supported
  (`iris_doc_*` matches the whole family; `*` alone is rejected). Whitespace trimmed.
- **`IRIS_TOOLS_ENABLE`** — comma-separated tool names to force-show (overrides preset exclusion
  AND `IRIS_TOOLS_DISABLE`). Same syntax.

Resolution per tool (mirrors the governance cascade shape `explicit ?? preset ?? default`):

```
visible(tool) = ENABLE-match ?? DISABLE-match(inverted) ?? presetRoster(tool) ?? true
```

i.e. precedence **ENABLE > DISABLE > preset > default-visible**. `ENABLE` beating `DISABLE` is
what makes the family-except-one pattern work (`IRIS_TOOLS_DISABLE=iris_doc_*` +
`IRIS_TOOLS_ENABLE=iris_doc_get`).

Edge semantics (all deterministic, all tested):
- Same **literal** name in both lists → startup **warning** (ENABLE wins per precedence); not an
  error because wildcard-expansion overlap is the intended usage.
- Unknown tool name in either list → startup **warning, not an error** — the same env block is
  shared by all 5 servers, so a dev-server name is "unknown" to the data server (same tolerance
  governance has for cross-server keys). A wildcard matching zero tools also warns.
- **`iris_server_profiles` is reserved and always visible.** It is the discovery surface every
  server's MCP instructions say to call FIRST, and the diagnostic for this very feature.
  Wildcards silently skip it; naming it **literally** in `IRIS_TOOLS_DISABLE` → fail fast (that
  is a deliberate misconfiguration, not cross-server sharing).
- Config hiding EVERY package tool is legal (server serves only `iris_server_profiles`) but logs
  a startup warning.
- Case-sensitive exact matching; tool names are already all-lowercase `iris_*`.

### 2.3 Enforcement seam — filter before registration

The single choke point is the `McpServerBase` constructor loop that registers `options.tools`
(currently `server-base.ts` ~L459-462, every package flows through it). Change:

1. Parse the three env vars **in the constructor** (registration is constructor-time; governance
   parsing stays in `start()` — note the asymmetry in a code comment). A constructor throw is
   still a startup crash with a clear message, same operator UX as existing fail-fast paths.
2. Compute the visible subset of `options.tools` via §2.2 resolution.
3. Register only the visible subset. Hidden tools never reach `mcpServer.registerTool` — they are
   absent from the SDK registry, from `tools/list`, and from governance key derivation.
4. The framework `iris_server_profiles` registration is unconditional (before/outside the filter).
5. The dynamic `addTools()` path applies the same filter (a hidden tool added at runtime stays
   hidden); `removeTools()` unchanged. Do NOT build runtime toggling (§5).

Calling a hidden tool returns the MCP SDK's standard unknown-tool error — no custom error body.
That is the point: indistinguishable from a tool that never existed.

### 2.4 Preset rosters — ownership, shape, and rot-proofing

**Ownership:** each package owns its rosters in a new `packages/<pkg>/src/tools/presets.ts`,
passed to the framework via a new `McpServerBaseOptions.toolPresets` field. Shared owns the
resolution engine and the allowed preset-name set:

```typescript
// shared/src/tool-visibility.ts
export const TOOL_PRESET_NAMES = ["full", "core", "developer"] as const;
// "full" is reserved (= all tools) and cannot appear in rosters.

// packages/<pkg>/src/tools/presets.ts
export const toolPresets: ToolPresetRosters = {
  core:      { include: [/* names */], exclude: [/* names */] },
  developer: { include: [/* names */], exclude: [/* names */] },
};
```

**Rot-proofing — the #1 failure mode is a future tool silently missing from rosters.** Two
mechanical guards, mirroring the Rule #28 / #44 discipline used for `mutates` (codified
2026-07-19 as **Rule #53**: every new tool declares an explicit include/exclude disposition in
every named preset, in the same story that adds the tool):

- **Registration-time assert** (`assertPresetCoverage`, sibling of
  `assertGovernanceClassification`): for every named preset, `include ∪ exclude` must EQUAL the
  package tool-name set exactly, with `include ∩ exclude = ∅`. A new tool added without a preset
  disposition **throws at server construction**, naming the tool and preset. Explicit disposition
  is the contract — there is no default bucket.
- **Per-package unit test** asserting the same set equality (fails naming the missing/extra
  name), so the break is caught at `pnpm test` time, not first launch.

**Pairs guard:** tools designed as a unit must be co-visible in every preset. Shared constant
`TOOL_PAIRS = [["iris_env_diff", "iris_env_promote"]]` (extensible) + a test asserting each
pair is together-in or together-out of every roster. (Hiding `iris_env_promote` while showing
`iris_env_diff` strands the agent mid-workflow.)

Adding a future preset name (e.g. `operator`) = extend `TOOL_PRESET_NAMES` + add the roster to
all 5 packages; the coverage assert forces completeness suite-wide.

### 2.5 The rosters (approved by product owner 2026-07-12 — implement as written)

Design intents differ and should be stated in README:
- **`core`** attacks the **count cliff**: the everyday ~80% loop, ≤13 runtime tools per server,
  tuned for small models. Destructive-and-rare tools (`iris_doc_delete`, `iris_global_kill` is
  kept — see note) and bulk/specialist tools are hidden.
- **`developer`** attacks **persona relevance**, per the product owner's sketch: everything a
  developer touches (full dev server, production lifecycle + monitoring, namespace/database/webapp
  config, runtime/task tools, all data tools) while hiding security & enterprise administration
  (users/roles/resources/SSL/OAuth/LDAP/X509/audit, backup/mirror/ECP). Counts stay above the
  cliff on dev/interop — that is accepted; `core` is the count answer.

`iris_server_profiles` is additionally visible on every server under every preset (+1 to every
runtime count below).

#### iris-dev-mcp (28 tools → core 12, developer 28)

| Tool | developer | core |
|---|:---:|:---:|
| iris_doc_get | ✓ | ✓ |
| iris_doc_put | ✓ | ✓ |
| iris_doc_delete | ✓ | — |
| iris_doc_list | ✓ | ✓ |
| iris_doc_compile | ✓ | ✓ |
| iris_doc_index | ✓ | — |
| iris_doc_search | ✓ | — |
| iris_macro_info | ✓ | — |
| iris_doc_convert | ✓ | — |
| iris_doc_xml_export | ✓ | — |
| iris_sql_execute | ✓ | ✓ |
| iris_sql_analyze | ✓ | — |
| iris_server_info | ✓ | — |
| iris_server_namespace | ✓ | — |
| iris_global_get | ✓ | ✓ |
| iris_global_set | ✓ | ✓ |
| iris_global_kill | ✓ | ✓ |
| iris_global_list | ✓ | — |
| iris_execute_command | ✓ | ✓ |
| iris_execute_classmethod | ✓ | ✓ |
| iris_execute_tests | ✓ | ✓ |
| iris_doc_load | ✓ | ✓ |
| iris_doc_export | ✓ | — |
| iris_package_list | ✓ | — |
| iris_routine_intermediate | ✓ | — |
| iris_loc_count | ✓ | — |
| iris_env_diff | ✓ | — |
| iris_env_promote | ✓ | — |

Core = the authoring loop (get/put/list/compile/load) + execution & debug loop
(command/classmethod/tests, global get/set/kill — kill stays because the documented
`^ClineDebug` debug pattern ends with a cleanup kill) + SQL. 12 package tools = 13 runtime.

#### iris-admin-mcp (26 tools → core 12, developer 10)

| Tool | developer | core |
|---|:---:|:---:|
| iris_namespace_manage | ✓ | ✓ |
| iris_namespace_list | ✓ | ✓ |
| iris_database_manage | ✓ | ✓ |
| iris_database_list | ✓ | ✓ |
| iris_mapping_manage | ✓ | — |
| iris_mapping_list | ✓ | — |
| iris_user_manage | — | ✓ |
| iris_user_get | — | ✓ |
| iris_user_roles | — | ✓ |
| iris_user_password | — | ✓ |
| iris_role_manage | — | — |
| iris_role_list | — | ✓ |
| iris_resource_manage | — | — |
| iris_resource_list | — | — |
| iris_permission_check | ✓ | ✓ |
| iris_webapp_manage | ✓ | ✓ |
| iris_webapp_get | ✓ | — |
| iris_webapp_list | ✓ | ✓ |
| iris_ssl_manage | — | — |
| iris_ssl_list | — | — |
| iris_oauth_manage | — | — |
| iris_oauth_list | — | — |
| iris_service_manage | — | — |
| iris_ldap_manage | — | — |
| iris_x509_manage | — | — |
| iris_audit_manage | — | — |

Admin `core` = the everyday admin loop (namespaces, databases, users, webapps, permission
checks); `developer` = only what devs self-serve (namespace/db/mapping/webapp config) — no
user/security administration.

#### iris-interop-mcp (22 tools → core 9, developer 22)

| Tool | developer | core |
|---|:---:|:---:|
| iris_production_manage | ✓ | — |
| iris_production_control | ✓ | ✓ |
| iris_production_status | ✓ | ✓ |
| iris_production_summary | ✓ | ✓ |
| iris_production_item | ✓ | ✓ |
| iris_production_autostart | ✓ | — |
| iris_production_logs | ✓ | ✓ |
| iris_production_queues | ✓ | ✓ |
| iris_production_messages | ✓ | ✓ |
| iris_production_adapters | ✓ | — |
| iris_credential_manage | ✓ | — |
| iris_credential_list | ✓ | — |
| iris_lookup_manage | ✓ | — |
| iris_lookup_transfer | ✓ | — |
| iris_rule_list | ✓ | — |
| iris_rule_get | ✓ | — |
| iris_transform_list | ✓ | — |
| iris_transform_test | ✓ | — |
| iris_interop_rest | ✓ | — |
| iris_default_settings_manage | ✓ | — |
| iris_message_diagram | ✓ | ✓ |
| iris_message_resend | ✓ | ✓ |

Interop `core` = the troubleshoot-a-production loop: status/summary/control, item config,
logs/queues/messages, trace diagram, resend. `iris_production_control` keeps the MCP-instructions
`recover` guidance intact under every preset.

#### iris-ops-mcp (21 tools → core 9, developer 9)

| Tool | developer | core |
|---|:---:|:---:|
| iris_metrics_system | ✓ | ✓ |
| iris_metrics_alerts | — | ✓ |
| iris_metrics_interop | ✓ | — |
| iris_alerts_manage | — | — |
| iris_jobs_list | ✓ | ✓ |
| iris_locks_list | ✓ | ✓ |
| iris_process_manage | ✓ | ✓ |
| iris_journal_info | — | — |
| iris_mirror_status | — | — |
| iris_audit_events | — | — |
| iris_database_check | — | — |
| iris_database_action | — | — |
| iris_backup_manage | — | — |
| iris_license_info | — | ✓ |
| iris_ecp_status | — | — |
| iris_task_manage | — | — |
| iris_task_list | ✓ | ✓ |
| iris_task_run | ✓ | ✓ |
| iris_task_history | ✓ | — |
| iris_config_manage | — | — |
| iris_health_check | ✓ | ✓ |

Ops `core` = monitoring-persona basics (health, system metrics, alert metrics, jobs/locks/
processes, tasks, license). `developer` = runtime debugging slice (interop metrics + task
history for their own scheduled jobs; no backup/mirror/ECP/config surface).

#### iris-data-mcp (7 tools → core 7, developer 7)

Already inside the 5-15 sweet spot: both rosters include all 7 tools
(`iris_docdb_manage`, `iris_docdb_document`, `iris_docdb_find`, `iris_docdb_property`,
`iris_analytics_mdx`, `iris_analytics_cubes`, `iris_rest_manage`). Rosters are still declared
explicitly (empty `exclude`) — the coverage assert applies uniformly.

#### Roster summary

| Preset | dev | admin | interop | ops | data | Package total | Runtime total |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| full (default) | 28 | 26 | 22 | 21 | 7 | 104 | 109 |
| developer | 28 | 10 | 22 | 9 | 7 | 76 | 81 |
| core | 12 | 12 | 9 | 9 | 7 | 49 | 54 |

Every `core` server lands at ≤13 runtime tools — inside the researched 5-15 window.

### 2.6 Surfacing & diagnosability

- `iris_server_profiles` output gains a `toolVisibility` block:
  `{ "preset": "core" | "developer" | "full", "visibleTools": <n>, "hiddenTools": <n> }`.
  **Deliberately NOT the hidden tool names** — invisible means invisible to the agent; the
  operator diagnoses via env vars + README roster tables. This block is how "why is tool X
  missing?" support questions resolve in one call.
- The effective-governance report in `iris_server_profiles` (and the `iris-governance://{profile}`
  resource) **omits keys belonging to hidden tools** — the agent's view stays self-consistent.
  Add one assertion each.
- Startup log line (stderr, existing style): active preset + visible/hidden counts + any
  warnings from §2.2.
- **Prompt-pack check (one-time, story 4):** the MCP prompts registered via `registerPrompt`
  reference tool names in their text. Sweep prompt texts for references to tools hidden under
  `core`/`developer`; where found, either soften the wording or record it as a known limitation
  in README ("prompts may reference tools your preset hides").

### 2.7 Payload measurement (evidence, not vibes)

Nobody has ever measured the `tools/list` payload; the annotation audit counts tools, not tokens.
New script `scripts/measure-tools-payload.mjs`: for each server × preset, construct the server,
serialize the `tools/list` result, report tool count, JSON bytes, and ~tokens (bytes/4 heuristic —
no new tokenizer dependency). Output is a markdown table pasted into the README visibility section
and the story notes. This turns "should help small models" into recorded numbers and gives the
PRD's tool-selection-accuracy validation a denominator.

## 3. Story breakdown

1. **Story 1 — Visibility engine (shared):** env parsing (`IRIS_TOOLS_PRESET` /
   `IRIS_TOOLS_ENABLE` / `IRIS_TOOLS_DISABLE`), wildcard + precedence + conflict/unknown-name
   semantics (§2.2), constructor filter + reserved-tool exemption + `addTools` filter (§2.3),
   `assertPresetCoverage`, startup log line. Unit tests for every §2.2 edge; **Rule #19
   back-compat capstone**: with no visibility env vars, each constructed server's registered
   tool-name list deep-equals the pre-feature snapshot (all 5 packages, in the DEFAULT suite).
2. **Story 2 — Preset rosters (all 5 packages):** `presets.ts` × 5 exactly per §2.5 tables,
   `toolPresets` wiring in each `index.ts`, per-package coverage tests, shared `TOOL_PAIRS` +
   co-visibility test. Package `tools[]` arrays are UNTOUCHED — existing count assertions
   (e.g. interop `toHaveLength(22)`) must not move (Rule #31 note: no tool counts change).
3. **Story 3 — Surfacing + measurement:** `iris_server_profiles` `toolVisibility` block,
   hidden-key omission in the governance report + resource (one assertion each),
   `scripts/measure-tools-payload.mjs` + recorded per-preset table.
4. **Story 4 — Docs + live smokes:** README env-var rows + new "Tool Visibility Presets" section
   (incl. roster tables, layering rules from §2.1, measurement table); `tool_support.md` note;
   all three `docs/client-config/*.md`; per-server READMEs; CHANGELOG; prompt-pack sweep (§2.6).
   Live smokes (Rules #22/#26): built dist in a real Node process — (a) default launch ⇒
   `tools/list` identical to pre-feature; (b) `IRIS_TOOLS_PRESET=core` ⇒ list equals the core
   roster exactly AND a call to a hidden tool name returns the MCP unknown-tool error; (c)
   `IRIS_TOOLS_DISABLE=iris_global_*` + `IRIS_TOOLS_ENABLE=iris_global_get` ⇒ family hidden,
   hole punched; (d) invalid preset value ⇒ startup crash naming valid values. Delete disposable
   smoke scripts before staging.

## 4. Acceptance criteria

1. No visibility env vars ⇒ every server's registered tool-name set is byte-for-byte identical
   to pre-feature (mechanical snapshot, all 5 packages, default suite).
2. A hidden tool is absent from `tools/list` AND calling it returns the SDK's standard
   unknown-tool error (no custom envelope, no governance error).
3. Precedence holds: `ENABLE > DISABLE > preset > default-visible`, wildcard `iris_x_*` expands,
   literal dup in both lists warns (ENABLE wins), unknown names warn without failing startup.
4. `iris_server_profiles` is visible under every configuration; literal disable of it fails
   startup; wildcards skip it silently.
5. Unknown `IRIS_TOOLS_PRESET` value fails startup naming valid values.
6. `assertPresetCoverage`: a tool missing from a preset's `include`/`exclude` throws at
   construction naming tool + preset; per-package coverage tests enforce the same at test time.
7. Rosters match §2.5 exactly; every `core` server ≤13 runtime tools; `TOOL_PAIRS` co-visible in
   every preset.
8. `iris_server_profiles` reports `toolVisibility` (preset + counts, NOT hidden names); governance
   report + `iris-governance://` resource omit hidden tools' keys.
9. Package `tools[]` arrays and their count tests unchanged; `gen:governance-baseline:check`
   exits 0; frozen baseline untouched.
10. Measurement table (server × preset: count / bytes / ~tokens) recorded in README + story notes.
11. All four live smokes from Story 4 recorded. Conventions §6 checklist complete.

## 5. Out of scope

- **Per-action visibility** (hiding one value of an `action` enum) — requires schema surgery;
  call-time governance already covers per-action safety.
- **Runtime toggling** (`RegisteredTool.enable()/disable()` + `listChanged` on the fly) — config
  is static env at startup. Capturing the `RegisteredTool` handles that `registerTool` currently
  discards is a cheap enabler if this is ever wanted; not now.
- **Per-profile visibility** — impossible per MCP (one `tools/list` per server process).
- **An `operator` preset** — add when demand appears; the mechanism makes it a roster-only change.
- **Tool consolidation** (e.g. collapsing the 11-tool `iris_doc_*` family into 2-3 multi-action
  tools, back under ~15 tools per server without hiding anything) — the philosophically right
  long-term fix, but breaking: removes shipped tool names and frozen-baseline governance keys
  (Rule #23 treats key removal as regression). Belongs to a future major version; this spec is
  the additive bridge.
- **Audit-log session-start record** of the active preset (Epic 29's `IRIS_AUDIT_LOG` is
  per-call; a startup record type is its own decision).
- Documenting client-side alternatives beyond one README pointer (e.g. Claude Code tool
  allowlists) — complementary, not a substitute.
