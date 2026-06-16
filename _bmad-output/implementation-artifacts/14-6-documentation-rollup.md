# Story 14.6: Documentation Rollup — Multi-Server & Governance

Status: done

## Story

As a user configuring the suite,
I want clear docs for profiles and governance,
so that I can set them up correctly with copy-pasteable, correctly-escaped examples.

## Acceptance Criteria

1. **AC 14.6.1** — Root `README.md`: extend the *Set Environment Variables* table (around [README.md:65-77](../../README.md)) with `IRIS_PROFILES` / `IRIS_GOVERNANCE`; add a *Multiple Servers & Governance* subsection under *Configure Your MCP Client* (around [README.md:78](../../README.md)) with worked examples.
2. **AC 14.6.2** — `docs/client-config/claude-code.md`, `claude-desktop.md`, `cursor.md`: add profile + governance config blocks per client, with **correctly-escaped JSON-in-env** examples that copy-paste without breaking the client config (JSON string value containing JSON — escape per each client's config format).
3. **AC 14.6.3** — Each per-package README (`packages/iris-dev-mcp`, `iris-admin-mcp`, `iris-interop-mcp`, `iris-ops-mcp`, `iris-data-mcp`) + `packages/iris-mcp-all`: note the `server` param and link to the shared profile/governance docs.
4. **AC 14.6.4** — A worked governance example (enable `iris_backup_manage:run` globally, disable it for the `prod` profile) is shown end-to-end. NOTE: `iris_backup_manage` ships in Epic 16 — use it as the illustrative write-action example (it is the architecture's canonical example), OR pair it with an existing write action (e.g. `iris_database_manage:delete`) so a reader can try it today; either way the JSON shape is the teaching point.
5. **AC 14.6.5** — Backward-compat statement: "existing single-server `IRIS_*` setups require no changes." (State it prominently — this is the release-gate promise.)
6. **AC 14.6.6** — CHANGELOG entry for the foundation feature (multi-server profiles + governance + `resources` capability; additive; no `BOOTSTRAP_VERSION` bump).

## Integration ACs

**Docs-only story — not service-introducing.** No code, no consumers. Proceed (the epic-cycle Integration-AC gate does not apply to documentation).

## Routed work — `@iris-mcp/ops` tool-count drift (CR 13.2, from Story 14.0 triage)

Story 14.0 routed the Epic-13 deferred item **CR 13.2** here. Reconcile the `@iris-mcp/ops` tool count: the `iris_alerts_manage` tool (added Epic 12 / Story 12.6, commit `a373316`) was propagated to `tool_support.md`'s ops section heading + Mix line (both say **17**) but NOT to the Suite-wide rollup row or the suite/meta-package READMEs (which still say **16**). Make ops consistently **17** everywhere and bump the suite total accordingly.

- [x] Task R1: Fix the ops count drift (CR 13.2)
  - [x] `tool_support.md` (repo root — see Dev note): the `@iris-mcp/ops` Suite-wide rollup row read `0 | 16 | 0 | **16**` — changed to `0 | 17 | 0 | **17**`. Section heading (`Operations & Monitoring (17)`) and Mix line already said 17; all three now agree. ExecuteMCPv2 column total bumped 65→66 for internal consistency.
  - [x] Suite total: incremented **88 → 89** everywhere it appears (`tool_support.md` rollup total + prose, root `README.md` count + architecture diagram, `packages/iris-mcp-all/README.md`, `docs/migration-v1-v2.md`).
  - [x] `packages/iris-ops-mcp/README.md`: states no numeric tool count (tool-reference table already lists all 17 including `iris_alerts_manage`); no change needed.
  - [x] Epic 14 adds NO new IRIS tools (foundation), so the ONLY count change is the ops 16→17 / suite 88→89 reconciliation. No other per-package count changed.

## Tasks / Subtasks

- [x] Task 1: Root README — env vars + Multiple Servers & Governance (AC 14.6.1, 14.6.4, 14.6.5)
  - [x] Added `IRIS_PROFILES` and `IRIS_GOVERNANCE` rows to the env-var table (each marked Optional with a one-line description) + a prominent "single-server installs need no changes" callout under the table.
  - [x] Added a *Multiple Servers & Governance* section: what a profile is + `IRIS_PROFILES` shape, the `server` param on every tool (profile-name-only, omit → default, composes with `namespace`), field inheritance, the two-layer governance cascade (`profile.explicit ?? global.explicit ?? defaultSeed`), the default seed, call-time `GOVERNANCE_DISABLED` enforcement, and the advisory `iris-governance://default` + `iris-governance://{profile}` resource.
  - [x] Worked governance example (AC 14.6.4 — `iris_backup_manage:run` enabled globally, disabled for `prod`, plus the try-today `iris_database_manage:delete` variant) + the *Backward Compatibility* statement (AC 14.6.5).
- [x] Task 2: Client-config docs (AC 14.6.2)
  - [x] `claude-code.md`, `claude-desktop.md`, `cursor.md`: added a *Multiple Servers & Governance (optional)* block per client with correctly-escaped JSON-in-env. The doubly-encoded `IRIS_PROFILES`/`IRIS_GOVERNANCE` string values were validated by `node JSON.parse` (outer config parses AND each env value re-parses to the intended object). Each block also shows the un-escaped logical JSON for readability.
- [x] Task 3: Per-package READMEs (AC 14.6.3)
  - [x] Added a brief "Multiple servers & the `server` parameter" note + link to `../../README.md#multiple-servers--governance` to each of the 5 server READMEs + `iris-mcp-all` (placed right after each Configuration env-var table).
- [x] Task 4: Ops tool-count drift (Routed — Task R1 above)
- [x] Task 5: CHANGELOG (AC 14.6.6)
  - [x] Added a new `[Pre-release — 2026-06-15]` section: Epic 14 foundation (multi-server profiles, governance cascade + call-time enforcement, `resources` capability + `iris-governance://{profile}`), stating **additive / no breaking changes / no `BOOTSTRAP_VERSION` bump**, plus a "Fixed" Docs note for the ops 16→17 / suite 88→89 count reconciliation.
- [x] Task 6: Verify
  - [x] No code changes (docs-only). `pnpm turbo run build` (6/6), `pnpm turbo run test` (12/12, 450+ shared tests incl. governance baseline drift check), `pnpm turbo run lint` (6/6) all exit 0 — no regression. **No `BOOTSTRAP_VERSION` bump.** Markdown links resolve (anchor `#multiple-servers--governance` matches the new README heading; cross-file relative links verified). Re-counted: ops table = 17 rows, suite rollup total = 89.

## Dev Notes

### Feature summary to document (from the shipped Stories 14.1–14.5)

- **Multi-server profiles (14.1/14.2):** `IRIS_PROFILES` is a JSON env var `{ "<name>": { host, port, username, password, namespace, https } }`. The existing `IRIS_*` vars synthesize a reserved `default` profile (so single-server installs are unchanged — AC 14.6.5). Every tool gains an optional `server` parameter carrying ONLY the profile name (credentials never leave the server process). `server` picks the instance; the existing per-call `namespace` still overrides the namespace within it. Profiles may omit fields to inherit the default's.
- **Governance (14.3/14.4):** `IRIS_GOVERNANCE` is a JSON env var `{ "global": { "<tool|tool:action>": true|false }, "profiles": { "<name>": { … } } }`. Effective = `profile.explicit ?? global.explicit ?? defaultSeed`. Default seed: existing actions + new read actions enabled; new write actions disabled (opt-in). Enforcement is call-time (a disabled action returns a structured `GOVERNANCE_DISABLED` error naming the action + profile; all tools stay advertised). With no `IRIS_GOVERNANCE`, behavior is byte-for-byte today's.
- **Resource (14.5):** net-new MCP `resources` capability; `iris-governance://{profile}` returns the effective policy map as JSON (advisory only — the call-time gate is authoritative).

### Escaping guidance (AC 14.6.2)

`IRIS_PROFILES`/`IRIS_GOVERNANCE` values are JSON strings embedded inside the client's (JSON) config. Show the doubly-encoded form correctly (inner quotes escaped) so a copy-paste does not break the outer config. Verify each of the three client formats.

### Testing standards & notes

- Docs-only — no unit tests. The "test" is: counts reconcile (ops 17, suite 89), links resolve, examples are correctly escaped, and the back-compat statement is present. Build/test/lint remain green (no-op regression check).
- No `BOOTSTRAP_VERSION` bump. No `docs/adr/` — architecture.md "Multi-Server Profiles & Tool Governance" is the design authority for the prose.

### References

- [Source: epics.md#Story-14.6] — ACs verbatim.
- [Source: deferred-work.md] — "Triaged via Story 14.0" (CR 13.2 routed here) + the original CR 13.2 entry with the drift locations.
- [Source: architecture.md#Multi-Server-Profiles-&-Tool-Governance] — feature prose authority.
- [Source: README.md] (env-var table ~65, Configure ~78), [docs/client-config/*.md], [packages/*/README.md], [docs/tool_support.md], [docs/migration-v1-v2.md], [CHANGELOG.md].

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- Escaping validation: reconstructed the exact escaped `IRIS_PROFILES`/`IRIS_GOVERNANCE` env-value strings as a JS string literal inside a full `mcpServers` config and ran `JSON.parse` twice (outer config, then each env value). Output confirmed the outer config parses AND `IRIS_PROFILES` → `{prod, stage}` (with `stage` inheriting omitted `port`) and `IRIS_GOVERNANCE` → `{global:{...}, profiles:{prod:{...}}}`. This proves the doubly-encoded blocks in the three client-config docs copy-paste cleanly.
- Regression no-op check: `pnpm turbo run build` (6 successful), `pnpm turbo run test` (12 successful — shared 450, dev 293, admin 224, interop 171, ops 159, data 120; includes `governance baseline drift check`, `server-param`, `profiles-bootstrap`, `governance-enforcement` suites all green), `pnpm turbo run lint` (6 successful). All exit 0.

### Completion Notes List

- **Docs-only story — zero code changes, no `BOOTSTRAP_VERSION` bump.** Documented the shipped behavior of Stories 14.1–14.5 exactly, cross-checked against `architecture.md` "Multi-Server Profiles & Tool Governance" (design authority) AND the shipped `packages/shared/src/` (`server-base.ts`, `profiles.ts`, `governance.ts`) to verify every load-bearing fact (Rule #16): the `GOVERNANCE_DISABLED` structured error shape `{code, action, server}` + human text, the reserved `default` profile synthesized from `IRIS_*`, profile field set `{host,port,username,password,namespace,https}` with inheritance, the `iris-governance://default` static resource + `iris-governance://{profile}` template, and the `profile.explicit ?? global.explicit ?? defaultSeed` cascade.
- **AC 14.6.4 worked example** uses `iris_backup_manage:run` (Epic 16 write action — the architecture's canonical example) as the primary illustration, and pairs it with `iris_database_manage:delete` as a write action a reader can try against the current release. The JSON shape is identical; only the key changes.
- **ROUTED CR 13.2 (ops count drift)** reconciled: ops is now `17` in `tool_support.md` (heading, Mix line, rollup row — all three already-or-now agree), root `README.md` (Servers table + architecture diagram), `packages/iris-mcp-all/README.md`, and `docs/migration-v1-v2.md`. Suite total is `89` everywhere (was 88). The `tool_support.md` ExecuteMCPv2 column total was bumped 65→66 and derived prose ("66 of 89, 74%") updated for internal consistency. Re-counted the ops table (17 rows) and the rollup (24+22+19+17+7 = 89; columns 18+66+5 = 89).

### File-path note (story-spec vs reality)

The story references `docs/tool_support.md`, but the file actually lives at the **repo root** (`tool_support.md`). The CR-13.2 deferred-work entry (`deferred-work.md:223`) confirms the real path (`tool_support.md:145/167/253`, no `docs/` prefix). Edited the real root file. No `docs/tool_support.md` exists or was created. The story's CR-13.2 sub-task cross-refs (`README.md`, `packages/iris-mcp-all/README.md`, `docs/migration-v1-v2.md`) were all correct; only the `tool_support.md` location differs.

### File List

- README.md
- CHANGELOG.md
- tool_support.md
- docs/client-config/claude-code.md
- docs/client-config/claude-desktop.md
- docs/client-config/cursor.md
- docs/migration-v1-v2.md
- packages/iris-dev-mcp/README.md
- packages/iris-admin-mcp/README.md
- packages/iris-interop-mcp/README.md
- packages/iris-ops-mcp/README.md
- packages/iris-data-mcp/README.md
- packages/iris-mcp-all/README.md
- _bmad-output/implementation-artifacts/14-6-documentation-rollup.md (this story file)
- _bmad-output/implementation-artifacts/sprint-status.yaml (status: review)

## Review Findings

Code review (docs-only, `/bmad-code-review`) ran three parallel layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor) against the diff + spec + design authority (`architecture.md` "Multi-Server Profiles & Tool Governance") + the SHIPPED code (`packages/shared/src/{profiles.ts,governance.ts,server-base.ts}`). Highest-value checks all PASSED:

- **Copy-paste safety (AC 14.6.2) — VERIFIED CLEAN.** All three client-config docs were parsed with `node`: the outer `mcpServers` JSON parses AND the escaped `IRIS_PROFILES` / `IRIS_GOVERNANCE` string values re-parse to the intended objects (`prod`+`stage` profiles with `stage` inheriting omitted fields; `global`+`profiles.prod` governance). No escaping defect.
- **Accuracy vs shipped code (Rule 6) — VERIFIED CLEAN.** The cascade (`profile.explicit ?? global.explicit ?? defaultSeed` → `governance.ts:301`), the seed (existing+new-read enabled / new-write disabled → `governance.ts:262`), the `GOVERNANCE_DISABLED` envelope (`{code,action,server}` + exact human text → `server-base.ts:773-786`), the `server` param semantics (`server-base.ts:84-91`/`:700-737`), the `IRIS_PROFILES` field set (`profiles.ts:90-219`), the governance key model (`server-base.ts:613-632`), the `iris-governance://default` (static) + `iris-governance://{profile}` (template) resources (`server-base.ts:66-71,502-538`), and the `resources` capability (`server-base.ts:351-354`) all match the docs exactly.
- **Count reconciliation (routed CR 13.2) — VERIFIED CLEAN.** ops = 17 everywhere; suite total = 89; tool_support.md rollup columns sum 18+66+5 = 89, column-2 down-sum 6+22+19+17+2 = 66, per-server 24+22+19+17+7 = 89; derived prose "66 of 89 (74%)" updated. No lingering 88 / ops-16 in the changed files. Independently re-counted ops source (`iris-ops-mcp/src/tools/index.ts` = 17 entries incl. `iris_alerts_manage`).
- **Back-compat (AC 14.6.5), CHANGELOG (AC 14.6.6), anchors/links** — all VERIFIED present/correct; no `BOOTSTRAP_VERSION` bump.

### Findings — patch (auto-resolved inline)

- [x] [Review][Patch][LOW] Per-package READMEs implied the `server` param appears only "When `IRIS_PROFILES` is set", but the shipped code injects `server` into every tool's schema unconditionally (`server-base.ts:558` always calls `withServerParam`). Reworded all six notes [packages/iris-{dev,admin,interop,ops,data}-mcp/README.md:38, packages/iris-mcp-all/README.md:50] to "Every tool accepts an optional `server` parameter (a profile name from `IRIS_PROFILES`) … omit it to use the `default` profile" — accurate to the code and consistent with the root README's unconditional phrasing.

### Findings — deferred (pre-existing, out of scope; logged in deferred-work.md)

- [x] [Review][Defer][LOW] `docs/migration-v1-v2.md:28` describes v2 tool naming as "Dot-namespaced: `iris.execute.command`, `iris.global.get`" — contradicts the shipped underscore naming (`iris_global_list`, etc.) used everywhere else. Pre-existing (line untouched by 14.6; predates Epic 14; QA flagged it). Logged to deferred-work.md.
- [x] [Review][Defer][LOW] `architecture.md:167` still reads `iris-ops-mcp/ … (16 tools)` and `architecture.md:32` says "86 tools" — residual staleness in the design-authority planning artifact (NOT in the changed-files set; routed CR 13.2 scope was the user-facing docs, all of which were correctly reconciled). Logged to deferred-work.md.

### Findings — dismissed (noise)

- [Acceptance Auditor] Spec Completion-Note's "the architecture's canonical example" justification for `iris_backup_manage:run` is unsupported by `architecture.md` (grep = no match). This critiques the STORY-SPEC prose, not the shipped documentation; AC 14.6.4 is satisfied (docs use it illustratively AND pair it with the try-today `iris_database_manage:delete`, exactly as the AC permits). No documentation defect — dismissed.

**Triage totals:** 0 decision-needed, 1 patch (auto-resolved), 2 deferred, 1 dismissed. No HIGH or MED findings. No failed review layers.
