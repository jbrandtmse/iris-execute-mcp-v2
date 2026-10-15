# sprint-status.yaml comment archive (2026-10-14)

`sprint_plan.py generate`, the only sanctioned writer of `sprint-status.yaml` under the `/epic-cycle` kit
installed 2026-10-14, rebuilds `development_status` from scratch and keeps no comment inside it. Its first
real run, during the 2026-10-14 correct-course
(`../planning-artifacts/sprint-change-proposal-2026-10-14-competitive-skills-distribution.md`), removed
191 of its 192 comment lines (only the first, before `epic-1`, survived). All 192 are
preserved here verbatim, each group under the tracker key it preceded
(keys as reconciled on 2026-10-14). The original file is also in git history before that correct-course.

## Before `epic-1`

```yaml
  # Epic 1: Shared Infrastructure & Developer Connection
```

## Before `epic-2`

```yaml
  # Epic 2: IRIS Development Tools — Atelier API (iris-dev-mcp)
```

## Before `epic-3`

```yaml
  # Epic 3: Custom REST Service, Auto-Bootstrap & Execution Tools
```

## Before `epic-4`

```yaml
  # Epic 4: IRIS Administration (iris-admin-mcp)
```

## Before `epic-5`

```yaml
  # Epic 5: Interoperability Management (iris-interop-mcp)
```

## Before `epic-6`

```yaml
  # Epic 6: Operations & Monitoring (iris-ops-mcp)
```

## Before `epic-7`

```yaml
  # Epic 7: Data & Analytics (iris-data-mcp)
```

## Before `epic-8`

```yaml
  # Epic 8: Documentation & Release Preparation
```

## Before `epic-9`

```yaml
  # Epic 9: Tool Name Flattening for Anthropic API / Claude Desktop Compatibility
  # Added 2026-04-09 via bmad-correct-course. See sprint-change-proposal-2026-04-09.md.
  # Note: Planning artifacts (architecture.md, prd.md, epics.md) already updated by analyst — out of scope for dev stories
```

## Before `epic-10`

```yaml
  # Epic 10: Namespace Browsing and Bulk Export Tools (iris-dev-mcp)
  # Added 2026-04-20 via bmad-correct-course. See sprint-change-proposal-2026-04-20.md.
  # Story 10.0 (deferred cleanup) explicitly skipped by user direction during epic-cycle kickoff.
```

## Before `epic-11`

```yaml
  # Epic 11: Post-Publish Bug Fix Batch (IRIS MCP Server Suite)
  # Added 2026-04-21 via bmad-correct-course. See sprint-change-proposal-2026-04-21.md.
  # 16 bugs identified in the 2026-04-21 comprehensive test pass. Pre-publish quality gate.
  # Single BOOTSTRAP_VERSION bump at end of Story 11.3 covers all ObjectScript edits (11.1–11.3).
  # Inline CHANGELOG + README updates per story — no standalone docs rollup (zero new tools).
```

## Before `epic-12`

```yaml
  # Epic 12: Post-Epic-11 Bug Fix Batch & Feature Gap Closure
  # Added 2026-04-22 via bmad-correct-course. See sprint-change-proposal-2026-04-22.md.
  # 8 bugs + 9 feature gaps identified in the 2026-04-22 comprehensive test pass. Last pre-publish quality gate.
  # 3 HIGH-severity bugs: iris_user_password change (regression from Epic 11 Bug #12), iris_production_manage create, iris_production_control stop/start/restart/update/recover.
  # Single BOOTSTRAP_VERSION bump at end of Story 12.4 covers ObjectScript edits (12.1–12.4). Second bump may be needed for 12.6 (alerts) if it adds a new handler method — flag during implementation.
  # FEAT-2 rest_manage scope rename is a breaking change (pre-release). Adds one new tool (iris_alerts_manage in Story 12.6) and one new FR to prd.md.
```

## Before `epic-13`

```yaml
  # Epic 13: Post-Epic-12 Tooling Enhancements — Macro-Expanded Routine Lookup
  # Added 2026-04-23 via bmad-correct-course. See sprint-change-proposal-2026-04-23.md.
  # TypeScript-only, Atelier-only. No BOOTSTRAP_VERSION bump required.
  # One new tool (iris_routine_intermediate) + docs rollup. Closes capability gap vs.
  # external intersystems-objectscript-routine-mcp identified in 2026-04-23 analysis.
```

## Before `epic-14`

```yaml
  # Epic 14: Platform Foundation — Multi-Server Profiles & Tool Governance (cross-cutting)
  # Added 2026-06-15 via bmad-correct-course. See sprint-change-proposal-2026-06-15.md.
  # TypeScript-only (shared + all servers). No BOOTSTRAP_VERSION bump. HARD PREREQUISITE for Epics 15-17.
  # STRICTLY ADDITIVE / no breaking changes: no IRIS_PROFILES + no IRIS_GOVERNANCE = byte-for-byte today's behavior.
```

## Before `epic-15`

```yaml
  # Epic 15: Security & Admin Tools (iris-admin-mcp)
  # Added 2026-06-15 via bmad-correct-course. One BOOTSTRAP_VERSION bump at Story 15.6. Additive only.
```

## Before `epic-16`

```yaml
  # Epic 16: Operations Tools (iris-ops-mcp)
  # Added 2026-06-15 via bmad-correct-course. One BOOTSTRAP_VERSION bump at Story 16.4. Additive only.
  # 2026-06-17: corrected stale 'in-progress' marker — all stories (16.0–16.4) + retrospective are done.
```

## Before `epic-17`

```yaml
  # Epic 17: Interop & Dev Tools (iris-interop-mcp + iris-dev-mcp)
  # Added 2026-06-15 via bmad-correct-course. Additive only.
  # Rule #24 (per-story bootstrap regen): 17.1 + 17.2 each regen bootstrap-classes.ts + move BOOTSTRAP_VERSION; 17.4 VERIFIES idempotence (NOT a deferred single bump).
  # Rule #23/#25: governance baseline frozen 1e62c5ad5bf7 (141 keys); new keys via mutates; verify gen:governance-baseline:check; never run bare generator.
  # Rule #19: 17.2 (iris_production_item enhancement) carries a mechanical back-compat assertion (existing enable/disable/get/set + 6 keys + output shape unchanged).
  # Story 17.0 (2026-06-16) live-verified probe ref: 17-0-api-probes.md. Two Rule #16 discrepancies recorded for spec authors:
  #   (1) Ens.Config.Item.AdapterClassName is a read-only calculated METHOD, not a settable property — current ItemManage "6 keys" = 5 working + adapterClassName which THROWS <PROPERTY DOES NOT EXIST>. 17.2 back-compat assertion pins the 5 working property keys; adapterClassName fix (route to Ens.Config.Setting) is additive.
  #   (2) INFORMATION_SCHEMA tables use UNDERSCORES on HSCUSTOM: CURRENT_STATEMENTS / STATEMENT_DAILY_STATS / STATEMENT_HOURLY_STATS (lead evidence had no-underscore names which return SQLCODE -30).
  #   Determination: iris_sql_analyze (17.3) is Atelier/SQL-only (EXPLAIN <query> + INFORMATION_SCHEMA views) — NO ObjectScript handler, NO bootstrap contribution. 17.4 bump covers ONLY 17.1+17.2 interop ObjectScript.
```

## Before `epic-18`

```yaml
  # Epic 18: Deferred-Work Cleanup & Hardening (post-Epic-17)
  # Added 2026-06-17 via /epic-cycle 18 (minimal: Story 18.0 only — Epic 17 deferred-item triage + include-now fixes). Additive only.
  # Rule #24 bootstrap regen IFF an ObjectScript handler is touched; else hash unchanged. Rule #23/#25 governance baseline frozen 1e62c5ad5bf7.
```

## Before `epic-19`

```yaml
  # Epic 19: Server & Governance Discovery
  # Added 2026-06-18 via bmad-correct-course. See sprint-change-proposal-2026-06-18.md.
  # TypeScript-only (shared). No BOOTSTRAP_VERSION bump. Built on Epic 14. Strictly additive.
```

## Before `epic-20`

```yaml
  # Epic 20: Production Recovery / Clean (iris-interop-mcp)
  # Added 2026-06-30 via bmad-correct-course. See sprint-change-proposal-2026-06-30.md.
  # ObjectScript touched (Interop.cls) → BOOTSTRAP_VERSION bump required (Rule #24).
  # Also extends Epic 14 governance foundation: new "write, default-enabled" mechanism (decision F2, additive).
  # New iris_production_control:clean key = mutates:write but default-ENABLED via defaultEnabled marker; frozen baseline 1e62c5ad5bf7 untouched.
  # Also fixes latent recover bug (extra arg to no-arg Ens.Director.RecoverProduction()).
```

## Before `epic-21`

```yaml
  # Epic 21: Message Trace Sequence Diagram (iris-interop-mcp)
  # Added 2026-07-02 via bmad-correct-course. See sprint-change-proposal-2026-07-02.md.
  # Clean-room reimplementation of stakeholder-owned ../DiagramTool/ functionality — reference consulted for spec ONLY (proposal §6), no code/sample-data embedded (decision G2).
  # Library = ObjectScript ExecuteMCPv2.Diagram.* under src/ExecuteMCPv2/ (stakeholder-directed; rides existing bootstrap, no new package mappings, no new npm package).
  # ObjectScript touched in BOTH stories → BOOTSTRAP_VERSION bump per story (Rule #24).
  # New iris_message_diagram key = mutates:read → default-enabled (Rule #28); frozen baseline 1e62c5ad5bf7 untouched (Rules #23/#25).
  # (fixed 2026-07-03 via bmad-correct-course session: was stale 'in-progress' — all stories + retro done, cycle-close commit 77a6ff9)
```

## Before `epic-22`

```yaml
  # Epic 22: ObjectScript LOC Counter & Deferred-Work Cleanup (iris-dev-mcp + suite-wide hardening)
  # Added 2026-07-03 via bmad-correct-course. See sprint-change-proposal-2026-07-03.md.
  # 22.0: native-ObjectScript LOC counter (research: technical-objectscript-loc-counter-2026-07-03.md, decisions D1–D7 ratified).
  #       New LOC library under src/ExecuteMCPv2/ + thin REST endpoint + iris_loc_count on @iris-mcp/dev.
  #       ObjectScript touched → BOOTSTRAP_VERSION bump (Rule #24). New key mutates:read → default-enabled (Rule #28); baseline 1e62c5ad5bf7 untouched.
  # 22.1: deferred-work ledger burn-down — 14 items + Epic 20 retro Action #2 → TERMINAL dispositions (Epic 21 retro directive: no re-deferral).
```

## Before `epic-23`

```yaml
  # Epic 23: Composite Health Check — iris_health_check (iris-ops-mcp)
  # Added 2026-07-07 via bmad-correct-course. See sprint-change-proposal-2026-07-07.md. BINDING SPEC: research/feature-specs/01-health-check.md + 00-conventions.md.
  # ObjectScript touched (new /monitor/health) → BOOTSTRAP_VERSION bump in 23.1 (Rule #24). New key iris_health_check mutates:read → default-enabled (Rule #28); frozen baseline 1e62c5ad5bf7 untouched (Rules #23/#25).
  # OS returns raw per-area values (per-area Try/Catch isolation); thresholds→findings→verdict engine lives in TS. Rule #34 second-namespace smoke required. ops 20→21.
```

## Before `epic-24`

```yaml
  # Epic 24: Governance Safety Presets & SQL Resource Caps (shared)
  # Added 2026-07-07 via bmad-correct-course. BINDING SPEC: research/feature-specs/02-governance-presets.md.
  # TS-only, no bootstrap bump, NO new tools/keys. NEW generated artifact baseline-classifications.ts (complete read/write map of the frozen 141-key baseline; completeness test enforces exact key-set parity; frozen governance-baseline.ts NEVER touched — Rules #20/#23/#25).
  # Cascade: explicit > presetSeed > defaultSeed (F2 threading pattern); unset preset = byte-for-byte today (Rule #19 capstone, DEFAULT suite); read-only ALSO blocks defaultEnabled writes (Epic 20 clean); unknown preset fails fast at startup.
```

## Before `epic-25`

```yaml
  # Epic 25: MCP Prompts Capability & Agent Skills Pack (shared + all servers)
  # Added 2026-07-07 via bmad-correct-course. BINDING SPEC: research/feature-specs/03-skills-prompts-pack.md.
  # TS/content-only, no bootstrap bump, no governance keys, NO tool-count changes anywhere (asserted). prompts capability advertised ONLY when prompts registered (Rule #19 capability snapshot).
  # 9 v1 prompts (list STAKEHOLDER-APPROVED 2026-07-07; incl. same-session additions recover-stuck-production [interop, Epic-20 escalation ladder] + run-external-backup [ops, thaw-ALWAYS guarantee]). GATED: resend-failed-messages → ships 26.3, promote-environment-change → ships 27.4. skills/ generated by scripts/gen-skills.mjs with --check (Rules #18/#25); scripts/validate-prompts.mjs in DEFAULT suite (tool-name rot breaks CI).
```

## Before `epic-26`

```yaml
  # Epic 26: Interop Message Resend / Replay — iris_message_resend (iris-interop-mcp)
  # Added 2026-07-07 via bmad-correct-course. BINDING SPEC: research/feature-specs/04-message-resend.md.
  # MANDATORY Story 26.0 Rule #16 probe (EnsPortal.MessageResend → Ens.MessageHeader family; scratch production) BEFORE any spec-driven coding.
  # mutates {preview:read, resend:write, resendFiltered:write} — writes DEFAULT-DISABLED, deliberately NOT defaultEnabled (resend duplicates clinical data flow).
  # Guards OS-side before any mutation: numeric ids; item+from required; window ≤7d; hard cap 500 refuse-not-truncate; dryRun default true; confirm double-gate (Epic 20 pattern). Live rejection smokes per Rule #26.
  # ObjectScript touched → BOOTSTRAP_VERSION bump in 26.1 (Rule #24). interop 21→22. Story 26.3 also ships the gated resend-failed-messages prompt into the Epic 25 pack.
```

## Before `26-4-deferred-work-ledger-burn-down-rule-37`

```yaml
  # 26.4 = Rule #37 dedicated burn-down (created at Epic 26 retro-review gate per BINDING decision 2026-07-09; terminal disposition of all carried-open LOW items; runs LAST after 26.0-26.3).
```

## Before `epic-27`

```yaml
  # Epic 27: Environment Diff & Promotion — iris_env_diff / iris_env_promote (iris-dev-mcp + shared)
  # Added 2026-07-07 via bmad-correct-course. BINDING SPEC: research/feature-specs/05-env-diff-promotion.md.
  # PREREQ RESOLVED 2026-07-07 (stakeholder): two profiles on the single dev instance (different default namespaces) accepted for the 27.4 capstone; 27.4 records the residual-risk note (no cross-instance/cross-version coverage; prefer a second instance if one exists by then) AND ships the gated promote-environment-change prompt (AC 27.4.4).
  # Framework: ToolContext.resolveProfileClient (additive, Rule #19 snapshot). New OS /dev/doc/hashes (EnvSync.cls; $SYSTEM.Encryption SHA API [PROBE]; spec required per Rule #38) → BOOTSTRAP_VERSION bump in 27.0 (Rule #24).
  # iris_env_diff mutates:read; iris_env_promote {plan:read, execute:write} — execute DEFAULT-DISABLED behind steps-allowlist + confirm + plan-hash freshness + TARGET-profile governance gate; onlyInTarget = warnings, NEVER deletions; SDS credential-ish values redacted. dev 26→28.
```

## Before `epic-28`

```yaml
  # Epic 28: SQL Performance Advisor — iris_sql_analyze advise action (iris-dev-mcp)
  # Added 2026-07-07 via bmad-correct-course. BINDING SPEC: research/feature-specs/06-sql-performance-advisor.md.
  # MANDATORY Story 28.0 probe (Rules #14/#16): plan markers VERBATIM, %Dictionary.CompiledIndex, TuneTable metadata, INFORMATION_SCHEMA.STATEMENTS availability (underscore names per Epic 17 finding).
  # Split architecture: new OS POST /dev/sql/advise-data (this tool's FIRST OS handler — Epic 17 shipped it Atelier-only) → BOOTSTRAP_VERSION bump in 28.1 (Rule #24); heuristic engine in TS with Rule #36 REFERENCE-CAPTURED fixtures (ExecuteMCPv2.Test.AdvisorFixture scratch schema).
  # advise added to mutates map as read → default-enabled; existing 4 actions byte-for-byte (Rule #19 snapshot); advisory-only, no writes in v1 (applyIndex deferred); never recommend against %*/system schemas; unknown plan → findings:[] + note.
```

## Before `epic-29`

```yaml
  # Epic 29: Tool-Call Observability & Session Audit Log (shared)
  # Added 2026-07-07 via bmad-correct-course. BINDING SPEC: research/feature-specs/07-observability-audit-log.md.
  # TS-only, no bootstrap bump, no new tools/keys. IRIS_AUDIT_LOG (JSONL path) + IRIS_AUDIT_LOG_MAX_MB (50) + IRIS_AUDIT_LOG_PARAMS (false). Interceptor at the handleToolCall single choke point.
  # Redaction NON-NEGOTIABLE before queue (password/secret/token/credential families + 2KB truncation; fuzz + zero-occurrence tests). Audit writes NEVER fail/slow a tool call (fire-and-forget + droppedEntries); unwritable dir fails fast at STARTUP only.
  # Logging is server CONFIG, not a tool — deliberately NOT bypassable via IRIS_GOVERNANCE. Unset ⇒ mechanical no-op (Rule #19). presetApplied populated when Epic 24 shipped (no hard dep). iris_audit_sessions tool = phase 2, out of scope.
```

## Before `29-3-deferred-work-ledger-burn-down-added-2026-07-12-rule-37-mand`

```yaml
  # 29.3 added 2026-07-12 at the Epic 29 retro-review gate: Rule #37 ≥3-consecutive-re-defer threshold trips
  # (Epic-26-own batch: Epic 27 + Epic 28 re-deferred = 2; Epic 29 is the 3rd). Mandatory deferred-work
  # burn-down driving all carried Epic-26/27/28-own items to TERMINAL disposition (re-deferral NOT allowed).
  # Binding: Epic 28 retro Action #2. Placed LAST per Project Lead decision (mirrors Story 22.1 / 26.4 precedent).
```

## Before `epic-30`

```yaml
  # Epic 30: Tool Visibility Presets & Per-Tool Enable/Disable (shared + rosters in all 5 packages)
  # Added 2026-07-12 via bmad-correct-course. BINDING SPEC: research/feature-specs/11-tool-visibility-presets.md (§2.5 rosters stakeholder-APPROVED 2026-07-12 — implement as written).
  # TS-only: no new tools, no governance keys, no governance-engine change, no ObjectScript/bootstrap bump. Env: IRIS_TOOLS_PRESET (full default | core | developer) + IRIS_TOOLS_DISABLE/IRIS_TOOLS_ENABLE (comma lists, trailing-* wildcards; ENABLE > DISABLE > preset > default-visible).
  # ADVERTISE-TIME layer in FRONT of call-time governance: filter at the McpServerBase constructor registration loop — hidden tools never reach the SDK registry (absent from tools/list, SDK unknown-tool error on call). Orthogonal to IRIS_GOVERNANCE (per-action, call-time, unchanged).
  # iris_server_profiles RESERVED always-visible (+ toolVisibility {preset, visible/hidden COUNTS — never hidden names}); governance report + iris-governance:// resource OMIT hidden tools' keys. Rosters = explicit include/exclude per preset per package; assertPresetCoverage throws at construction on a missing disposition (Rule #28 analog); TOOL_PAIRS co-visibility (iris_env_diff/iris_env_promote).
  # core ≤13 runtime tools/server (12/12/9/9/7 package tools — the research 5-15 window); developer hides security/enterprise admin (28/10/22/9/7). Unset env ⇒ byte-for-byte today's tools/list (Rule #19 snapshot, all 5 servers, DEFAULT suite). Package tools[] arrays + count assertions UNCHANGED (Rule #31).
  # New scripts/measure-tools-payload.mjs (count/bytes/~tokens per server × preset — recorded in README + story notes). Story 30.3 sweeps the prompt pack for hidden-tool references.
```

## Before `epic-31`

```yaml
  # Epics 31-33: Connection & Configuration Management Wave (added 2026-07-25 via bmad-create-epics-and-stories → bmad-sprint-planning)
  # BINDING SPEC (all three): research/technical-iris-server-manager-mcp-connections-research-2026-07-25.md. prd.md +FR139/FR140/FR141. Three independently shippable features; strictly additive under the standing back-compat gate; NO new MCP tool, NO governance key, NO tool-count change anywhere (Rule #31 held). The optional VS Code extension iris-mcp-launcher is scaffold-if-absent across 31.4/32.2/33.3 — whichever epic runs first creates it; no cross-epic blocking.
  # Epic 31: Server Manager Connection Integration (FR139). Source IRIS profiles from intersystems.servers (JSONC in VS Code settings, readable anywhere) in BOTH standalone + in-VS-Code runtimes. Env: IRIS_SERVER_MANAGER (off default|auto|required), IRIS_SM_SERVERS, IRIS_SM_SETTINGS_PATHS, IRIS_CREDENTIAL_HELPER. VS Code SecretStorage passwords are unreachable outside VS Code (verified) → credential chain env→OS keychain(@napi-rs/keyring optionalDep, service iris-mcp)→helper→fail-with-remediation. Merge AFTER env profiles (env wins collisions); source provenance through iris_server_profiles allow-list + audit profileSource. New iris-mcp-credentials CLI. Optional broker extension (McpServerDefinitionProvider, gjServAI pattern) = separate deliverable, may trail. Unset IRIS_SERVER_MANAGER ⇒ byte-for-byte today's resolution (Rule #19).
  # RE-OPENED 2026-07-26 per Rule SC-5: Story 31.5 added post-retro (launcher
  # server-selection UI). Stories 31.0-31.4 stay done and are NOT re-touched;
  # epic-31-retrospective stays done (it covered 31.0-31.4 and is not re-run).
  # Epic returns to done when 31.5 closes.
```

## Before `31-6-local-package-path-option-iris-mcp-launcher`

```yaml
  # Added 2026-07-26: the Story 31.5 smoke established that NO @iris-mcp/*
  # package is published to npm, so `npx -y @iris-mcp/<pkg>` fails on every
  # machine and every definition the extension registers cannot start. 31.6
  # adds irisMcpLauncher.developmentRepoPath and removes the `all` key, which
  # is a dependency-only meta-package with no bin/main/dist (latent 31.4 defect).
```

## Before `epic-32`

```yaml
  # Epic 32: Governance File & Editors (FR140). Make one governance policy portable across every client via IRIS_GOVERNANCE_FILE (a static file path is the only fully agent-agnostic contract). Same parseGovernanceConfig validation; cascade explicit IRIS_GOVERNANCE env > file > IRIS_GOVERNANCE_PRESET seed > defaults; per-key configSource attribution. New iris-mcp-governance CLI (validate/get/set/unset/preset/effective/diff, single-sourced with the shared engine) + later extension governance UI. Enforcement NEVER moves — servers keep sole authority at dispatchToolCall. No hot-reload in v1 (restart semantics, documented). Unset ⇒ mechanically-proven no-op.
```

## Before `epic-33`

```yaml
  # Epic 33: Multi-Client MCP Configuration Manager (FR141). New @iris-mcp/client-config package (NOT a server-runtime dep): declarative ClientAdapter registry for 13 verified clients (Claude Code, Claude Desktop, Cursor, VS Code/Copilot, Cline, Roo Code, Windsurf, Codex CLI, Gemini CLI, Zed, Goose, Kimi CLI, Kimi Code) — format/rootKey/paths/scopes/env-expansion/disable/restart-hint per client. Detection; per-client × per-server ENABLE/DISABLE (native flags where present, else byte-preserving stash-and-remove); format-preserving writes (jsonc-parser edits, TOML section splices, comment-preserving YAML) under validate→backup→edit→re-parse→auto-restore→diff-confirm; four env modes (server-manager[Epic31], env-reference, governance-file[Epic32], explicit w/ typed secret confirmation); manager modifies only entries it owns. iris-mcp-clients CLI + extension "MCP Clients" view with user-selectable client roster + per-server toggle matrix. Pi documented not-MCP-capable (excluded w/ rationale); JetBrains/Kilo Code = roadmap adapters pending verification.
```

## Before `epic-34`

```yaml
  # Epic 34: iris_execute_classmethod fidelity (trigger docs/bugs-2026-08-14.md +
  # stakeholder request; sprint-change-proposal-2026-08-14.md). Write-capture bug
  # (ClassMethod() lacks Execute()'s null-device redirect -> non-JSON envelope),
  # explicit {byRef:true, value?} marker args w/ additive byRefValues response
  # (new FR142; completes FR38's output-parameter clause), arg ceiling 10->20.
  # Strictly additive; no new tool/governance
  # key; BOOTSTRAP_VERSION bump in 34.2 (Rule #24). Docs scope in AC 34.3.3 names
  # every surface explicitly (dev README x2 spots, migration-v1-v2.md row, CHANGELOG;
  # tool_support.md + root README audited as no-mention). Epic gate: the three
  # bug-report reproductions pass live without wrapper classes (34.3, Rule #21).
  # Story numbering (2026-08-14 stakeholder decision): epic work starts at 34.1.
  # 34.0 is RESERVED for the /epic-cycle retro-review gate's auto-created
  # "Epic 33 Deferred Cleanup" story (epic-33 retro exists; deferred-work.md
  # carries 15 unresolved LOW items from 33.5 — first deferral, so Rule #37
  # allows re-deferral at triage). Do NOT renumber 34.1-34.3 onto 34.0.
  # Branch (2026-08-14): cut feature/feature-wave-4-classmethod-fidelity off
  # main for this epic — wave-3 is already merged. Epic branch: epic34
  # (ticketless convention, matching epic31/32/33; SC-1 default JIRA pattern
  # does NOT apply — answer the SC-1 prompt with this convention).
```

## Before `epic-36`

```yaml
  # Epic 36: Beta Feedback Remediation — long-running test execution fidelity
  # (trigger docs/bugs-2026-09-10.md, first beta-feedback defect;
  # sprint-change-proposal-2026-09-10-execute-tests-long-run.md).
  # iris_execute_tests converts its hard-coded 120s poll budget into a terminal
  # error while the %UnitTest run keeps executing; job id + run index discarded;
  # no timeout knob (ledger 34-6-CR-20(b) predicted it). 36.1 = running-result
  # contract + handles + caller budget (additive params/fields ONLY — no action
  # enum, E-1; pure TS, no BOOTSTRAP bump). 36.2 = iris_test_status companion
  # (the epic's ONLY new tool: mutates per action, both presets, L-2 decided:
  # developer include / core exclude / not paired; counts +1). 36.0 RESERVED
  # for the /epic-cycle retro-review gate (epic-35 retro exists; ledger carries
  # 0H/26M/95L=121 open). Do NOT renumber.
  # Branch (L-1, 2026-09-10): cut feature/feature-wave-5-beta-feedback off main
  # (wave-4 merged 60be515); epic branch epic36 (ticketless convention — answer
  # the SC-1 prompt with this convention).
  # 36.0 gate (2026-09-10): Rule #37 >=3 trigger FIRED - 48 Epic-33/34-era items
  # at count 2. 34-5-R2/R3/R4 fold into 36.1 (AC 36.1.12); the other 45 go to
  # 36.3 (burn-down, runs LAST, mandatory 45 only - Project Lead decisions).
```

## Before `36-4-high-global-subscript-injection-read-tool-executes-code-read`

```yaml
  # 36.4 added 2026-09-11 (Project Lead): HIGH 36-2-CR-1 /global subscript
  # injection (read-only preset bypass); runs AFTER 36.3; BOOTSTRAP moves.
```

## Before `epic-37`

```yaml
  # Epic 37: Beta Feedback Remediation — startup resilience with an unreachable
  # default profile (trigger docs/bugs-2026-09-16.md, second beta-feedback
  # defect; sprint-change-proposal-2026-09-16-default-profile-outage.md).
  # McpServerBase.start() calls process.exit(1) when the reserved default
  # profile fails its startup health check, before the transport connects, so
  # healthy IRIS_PROFILES / Server-Manager profiles never get to serve (all 5
  # servers; since Story 14.1). 37.1 = eager-but-non-fatal default
  # establishment with lazy retry (option A, non-fatal everywhere per L-2; pure
  # TS in @iris-mcp/shared; no tool/action key; no BOOTSTRAP bump).
  # ONE story by Project Lead decision L-5 (2026-09-16): the 37.0 retro-review
  # gate is SKIPPED by Lead direction at kickoff (answer the epic-cycle's gate
  # step with this decision) and NO burn-down runs here. The Epic 36 gate's
  # Rule #37 forward obligation (36 items at count 2, deferred-work.md L2939)
  # transfers UNCHANGED to the Epic 38 gate — recorded exception; see the Epic
  # 37 preamble in epics.md and the ledger's 2026-09-16 section. 36-4-CR-1
  # (HIGH) stays deferred to its own pre-publish story. Ledger carries
  # 1H/24M/62L=87 open. Do NOT renumber.
  # Branch (L-1, 2026-09-16): epic37 DIRECTLY off main (2ed83ff; identical tree
  # to the wave-5 tip 63bf908); the planning commit is its first commit. At SC-1 name
  # the existing feature/feature-wave-5-beta-feedback; SC-2 finds epic37
  # present; at close merge epic37 → wave-5 → main.
```
