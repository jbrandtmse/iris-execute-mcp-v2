---
title: 'Story 45.5: What the Safety Settings Protect'
type: 'feature'
created: '2026-11-26'
status: 'ready-for-dev'
baseline_revision: 'f4481848df128f80ea25c5fb9706818b83783542'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-45-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Through `iris_sql_query` (the read-only preset's query tool, whose statement is always rolled back), an admin account can run
      `SELECT ExecuteMCPv2.Setup_ConfigureMapping(...)`. The rollback undoes the configuration records but not the effect: a missing
      `%ALL` namespace and `ExecuteMCPv2` mapping come back in `iris.cpf` and in the running configuration (another namespace sees the
      classes again), while `Config.Namespaces.Exists("%ALL")` and `Config.MapPackages.Exists("%ALL","ExecuteMCPv2")` answer 0.
    evidence: |-
      Plan probe 2026-11-26 on a throwaway (IRIS for Health 2026.2 Build 221U), recorded under Design Notes "Probe B". `Configure`'s
      web-application change through the same route IS rolled back (namespace unchanged); through Atelier `action/query` (no rollback) it
      moved the web application to another namespace. `EnsureUnitTestRoot` through the route is rolled back. A least-privilege account
      is refused on all five procedures through the suite (decision #165). DW-771 was closed by the owner (#171: keep the procedures,
      document them) on the narrower premise "it can only register the same web application"; this widens point 3, so it is an owner
      question for the epic-close decision sheet (decision-pending). This story documents it (amendment A2) and changes no code.
    location: >-
      src/ExecuteMCPv2/Setup.cls (ConfigureMapping L727-777, SqlProc); README.md "What the safety settings protect"
    severity: med
  - summary: >-
      The bootstrap cannot install into a namespace that is not interoperability-enabled: `ExecuteMCPv2.REST.Interop` fails to compile
      (`Class 'Ens.Config.Item' ... does not exist`), so the web application and the mapping are not configured. The README does not say
      the install namespace must be interoperability-enabled.
    evidence: |-
      Plan probe 2026-11-26 (Probe A, step 3): a new namespace SPLIT on IRIS for Health 2026.2 answered `Compile failed: 1 of 35
      classes did not compile: ExecuteMCPv2.REST.Interop ... ERROR #5373`; after `%Library.EnsembleMgr.EnableNamespace("SPLIT")` the same
      bootstrap installed cleanly. Not checked on the iris-community edition (CI's bootstrap-guard passes there in USER, so its USER
      may see Ens classes). Out of this story's footprint (docs of 45.5 do not cover install prerequisites).
    location: >-
      src/ExecuteMCPv2/REST/Interop.cls; README.md "Prerequisites"
    severity: low
---

<intent-contract>

## Intent

**Problem:** The suite's safety settings guard the agent in the MCP process, but the docs never say so in one place. `SECURITY.md` reads as if calling IRIS directly with the same account were a vulnerability, and the SQL minimum account is stated only for a one-database layout. GitHub issue #1 points 1, 2 and 4 (owner decision (5)). Epic 45 also has no epic-done gate yet.

**Approach:** Write the README section "What the safety settings protect" from probe and code oracles, link it from the five server READMEs and the governance variable docs, and narrow `SECURITY.md` (C-3). Roll up the 45.1 to 45.4 docs (DW-768) and repoint the 45.4 startup warning to the new section (decision #170). Assemble `epic45-capstone-gate.test.ts`, the Rule #21 epic gate, in the default suite, with an armed least-privilege leg (decision #166).

## Boundaries & Constraints

**Always:**
- Describe only shipped behavior, and give each load-bearing sentence an oracle in code, in the built dists, or in a recorded probe (Design Notes). Write the section in plain words: short sentences, active voice, and the house style of the README.
- The covered-tool list comes from `DATA_POLICY_BLOCK_KEYS` in the built shared dist. The five setup procedures come from the `[ SqlProc ]` methods of `ExecuteMCPv2.Setup` in the embed. The warning pointer comes from `buildDataPolicyWarning`'s output. No list is hand-copied without a test that compares it with its source.
- The only product-code change is the warning's last sentence: `See "PHI data policy" in the README.` becomes `See "What the safety settings protect" in the README.` This line is new in 1.3.0, so it falls under `S-45.4-block-raw-tools`. Change that string, and every pin of it, in the same change.
- Make the capstone hermetic legs FAIL, never skip, on a stale or missing dist. The armed leg skips before any request when it is unarmed, refuses to skip when armed, and runs only against a throwaway-shaped target.
- Shared IRIS rule: no test, smoke or probe touches `localhost:52773`. Principals, grants and `%ALL` changes happen only on a throwaway.

**Never:**
- No new tool, action, governance key, preset row, refusal code, input field or tool description. No `.cls` change, so `BOOTSTRAP_VERSION` stays `1.2.0+10.109d0129528f`. Mutation P4 changes it temporarily and is restored byte for byte.
- No change to `GOVERNANCE_BASELINE` (`:check` only), golden JSONs, the tools-list snapshot, generated files, the IPM tree, `epics.md`, the spine, `sprint-status.yaml`, the ledger, the cycle log, `.claude/rules/*`, `CLAUDE.md`, `irislib/` or `irissys/`.
- No compliance claim. No email address in `SECURITY.md`. Do not restate DW-773's or DW-784's open fixes as done. Do not move the "after every upgrade" wording of DW-770 (the burn-down owns it).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Capstone P1 `block` | Built dev, interop and data servers; `IRIS_DATA_POLICY=block`; a 503 stub | Each of the 12 declared keys answers `GOVERNANCE_DISABLED` + `dataPolicyApplied:"block"`, and the stub sees 0 requests. No `Data policy:` `[WARN]` | — |
| Capstone P1 re-enable | `block` + `IRIS_GOVERNANCE={"global":{"iris_sql_query":true}}` | `iris_sql_query` reaches the stub. The one warning line names exactly `iris_sql_query from IRIS_GOVERNANCE` and ends `See "What the safety settings protect" in the README.` | — |
| Capstone P1 default | No policy (`redact`), each server | The warning names exactly dev 7, interop 1 and data 3 keys (the 45.4 matrix plus #172). The quoted heading is a `## ` heading of README.md (slug check) | — |
| Capstone P2 doc-rot | README section vs the built dists | The section's `block` list equals `DATA_POLICY_BLOCK_KEYS`, in order. Its not-covered list is rows that are residual in `DATA_POLICY_SCOPE`. Its five procedures equal the embed's `SqlProc` set. The SqlProc-in-SELECT and account-boundary sentences are present | — |
| Capstone P3 read-only | Built dev; `IRIS_GOVERNANCE_PRESET=read-only`; stateful fake with no IRIS side | 0 writes (PUT, DELETE, compile, `Setup_Configure`/`ConfigureMapping`/`EnsureUnitTestRoot`). `iris_global_get` answers `IRIS_SIDE_NOT_INSTALLED`. `iris_server_info` works | — |
| Capstone P3 least-privilege (hermetic) | read-only; a current side; `isConfiguredReadsFalse` | 0 writes, one could-not-confirm `[WARN]`, and the custom-REST call is sent and answered | — |
| Capstone P4 | Built dev, install on, an empty stateful fake | The PUT of `ExecuteMCPv2.REST.Sql.cls` holds exactly one `%Prepare(`, `%Prepare(.pQuery, 1)`. The `iris_sql_query` body to `/dev/sql/execute` has only keys of the route's control set (`ReadControls` in `Sql.cls`: `query`, `parameters`, `namespace`, `readOnly`, `countOnly`, `maxRowsAffected`), and no privilege field | — |
| Capstone armed least-privilege | `IRIS_REQUIRE_LIVE=1` on the seeded throwaway; a disposable account with `%Development:U` plus `R` on the namespace's database resource(s); read-only preset | Start: no class changes (the `ExecuteMCPv2.Setup.cls` document's content and timestamp, read as `_SYSTEM` before and after, are equal) and one could-not-confirm `[WARN]`. A granted SELECT returns `_SYSTEM`'s Atelier rows. An ungranted one answers `SQLCODE -99`. `SELECT ExecuteMCPv2.Setup_ConfigureMapping(...)` answers -99 and the `%ALL` mapping is unchanged. Under `block`, `iris_sql_query` is denied with `dataPolicyApplied` | Unarmed: skip before any request. Armed with an unreachable target: fail. Teardown asserts that nothing named `QaEpic45Cap` is left |

</intent-contract>

## Code Map

- `README.md` -- the main deliverable. The governance variable rows are at L132 (`IRIS_GOVERNANCE`), L133 (`_PRESET`), L134 (`_FILE`), L135 (`IRIS_AUDIT_LOG`) and L143 (`IRIS_DATA_POLICY`). The `IRIS_AUTO_INSTALL` row is L144. The `iris-mcp-governance` CLI section starts at L220. "Removing the IRIS Side" is L376, and its "Who can run it" is L434. The cascade text at L489, L526 and L546 still lacks the `dataPolicySeed` step (45.4 updated only the CLI row). The read-only bullet "Installs nothing on IRIS" is L549. `## PHI data policy` is L900, and its warning example at L926 ends with the old pointer. `## Compliance & Auditability` is L936. The new `## What the safety settings protect` goes immediately before L900, and its slug is `what-the-safety-settings-protect`.
- `SECURITY.md` L28-30 -- the scope paragraph to narrow (C-3). It is pinned only by `story-42-5-doc-claims.test.ts` L161-186 (the reporting, the scope list and the handling), and the replacement must keep those strings.
- `packages/shared/src/data-policy.ts` L325 -- `buildDataPolicyWarning`'s pointer. It is the only code change.
- Pins of the old pointer, which move with it:
  - `packages/shared/src/__tests__/data-policy-warning.test.ts` L21, 28, 33, 39, 140 and 234;
  - `packages/iris-mcp-all/src/__tests__/story-45-4-block-seed-wire.test.ts` L131 and 138;
  - `packages/iris-mcp-all/src/__tests__/story-45-4-doc-claims.test.ts` L88 (the README example);
  - `README.md` L926;
  - the 45.4 `CHANGELOG.md` bullet L15 ("points to the README's "PHI data policy" section");
  - `.changeset/story-45-4-block-turns-off-raw-read-and-code-execution-tools.md` (same phrase).

  `fixtures/story-45-4-back-compat-baseline.json` drops `Data policy:` lines and is NOT touched.
- `tool_support.md`:
  - L230: the 45.4 dated note. Add a 45.5 note after it.
  - L405-452: the scope section. L415 is the `iris_sql_analyze` row; its Why text marks DW-784 as under probe, and the verdict stays `on`.
  - L477-501: "Dependency implications". Name `IRIS_AUTO_INSTALL`, the per-profile `autoInstall` and `IRIS_SIDE_NOT_INSTALLED`.
- `docs/client-config/claude-code.md` L274-311, `claude-desktop.md` L239-275 and `cursor.md` L270-306 -- the "Read-only Mode + SQL Resource Caps" sections. `story-38-6-doc-claims.test.ts` L269 pins "All five are **optional**", so add a paragraph and leave the table and that sentence alone.
- `extensions/iris-mcp-launcher/README.md` L405 -- the list of variables left alone. Launcher src has no `AUTO_INSTALL` handling (`rg AUTO_INSTALL extensions/iris-mcp-launcher/src`: none), so the variable inherits.
- `packages/shared/README.md`:
  - L54-73: the error classes and Bootstrap. `IrisSideNotInstalledError`, `IrisSideRefusal`, `buildIrisSideRefusal`, `recordSideRefusal`/`SideRefusalRecorder`, `AUTO_INSTALL_ENV_VAR`, `parseOperatorAutoInstall`, `resolveAutoInstall`, `applyAutoInstall` and `AutoInstallSource`/`AutoInstallCarrier` are missing.
  - L95-110: PHI and the refusal list. `DATA_POLICY_BLOCK_KEYS`, `DATA_POLICY_BLOCK_KEYS_AS_OF`, `dataPolicySeed`, `buildDataPolicyWarning`, `DataPolicyWarningProfile` and `REFUSAL_CODES.IRIS_SIDE_NOT_INSTALLED` are missing.

  The exhaustive source is `git diff 11d879d..HEAD -- packages/shared/src/index.ts` (Rule #56, as of 2026-11-26).
- `packages/iris-{dev,admin,interop,ops,data}-mcp/README.md` -- the Configuration section of each gets the link line (AC 45.5.2).
  - The dev README L44-46 "Read-only mode" paragraph gets the automatic-install sentence (AC 45.5.4).
  - The dev README L198 "SQL privileges (Story 45.1)" blockquote states the single-database minimum. `story-45-1-doc-claims.test.ts` L70 pins that substring, so APPEND the layout rule to the blockquote and do not rewrite it.
- `src/ExecuteMCPv2/Setup.cls` (read-only oracle):
  - the `SqlProc` set is `Configure` L63, `ConfigureMapping` L727, `IsConfigured` L780, `EnsureUnitTestRoot` L814 and `GetBootstrapVersion` L835;
  - `Uninstall` L154 is not a procedure;
  - the web application's `Resource` is `%Development`, L91 and L106;
  - `EnsureUnitTestRoot` sets only an empty `^UnitTestRoot`, to `$System.Util.ManagerDirectory()` (L816-821);
  - the mapping points to the install namespace's `Routines` database (L739, L769).
- `src/ExecuteMCPv2/REST/Sql.cls` `Perform` -- `%Prepare(.pQuery, 1)`, the target of mutation P4. `packages/iris-dev-mcp/src/__tests__/sql-privilege-mode.test.ts` is the source-text sibling.
- Capstone reuse in `packages/iris-mcp-all/src/__tests__/`:
  - `process-gate-helpers.ts`: `resolveSdkEsmDir` L30, `staleDistReason` L51, `liveArmingSkipReason` L214, `withWireSession` L437, `distEntry` L680, `governanceReport` L827, `governanceDenial` L835, `start503Stub` L1051 and `withStub` L1067;
  - `bootstrap-guard-legs.ts`: `loadEmbedded` L81 and `runServerCalls` L512;
  - `stateful-fake-atelier.ts`: `startStatefulFakeAtelier` L257, `isConfiguredReadsFalse` and request bodies;
  - `story-45-2-auto-install-orchestration.test.ts` L92-117: the `writesIn`/`customRestIn` oracles, which move to `bootstrap-guard-legs.ts` and are imported by both files;
  - `story-45-4-block-seed-wire.test.ts`: the `block` wire pattern;
  - `pack-fixture.ts`: `markdownHeadingSlugs` L90 and `REPO_ROOT` L19;
  - `data-policy-scope.ts`: `DATA_POLICY_SCOPE`.
- Armed-leg reuse:
  - `packages/iris-dev-mcp/src/__tests__/sql-privileges-live-gate.test.ts`: principal, grant and teardown discipline, and arming through `@iris-mcp/shared/test-helpers/live-target`;
  - `live-principal-helpers.ts` (`isMissingUserError`);
  - `story-45-3-uninstall-round-trip-live-gate.test.ts` L754-800: least-privilege role strings.
- `packages/iris-mcp-all/scripts/prepublish-gate.mjs` `gateTestFiles` (L111) -- the armed capstone joins it. `live-gate-roster.test.ts` enforces this, and CI runs it in `suite prepublish-all` on the seeded HSCUSTOM throwaway.
- Mutation targets: `governance.ts` L1298 (the seed term in `effective`); `auto-install.ts` L82 (the read-only preset forcing the install off); `Sql.cls` `%Prepare(.pQuery, 1)`.

## Tasks & Acceptance

**Execution:**

1. **README section.**
   - `README.md`: add `## What the safety settings protect` before `## PHI data policy`, with the content of Design Notes "Section content". It is AC 45.5.1 plus DW-766, DW-771 (amended A2), DW-773 and DW-784. It answers issue #1 points 1, 2 and 4.
   - In the same file, add the link sentence to the `IRIS_GOVERNANCE`, `IRIS_GOVERNANCE_PRESET`, `IRIS_GOVERNANCE_FILE`, `IRIS_DATA_POLICY` and `IRIS_AUDIT_LOG` rows and to the CLI section intro (AC 45.5.2).
   - Add `dataPolicySeed` to the cascade text at L489, L526 and L546, with one clause for the seed in the paragraph after L489.
   - Replace the L926 example pointer.
   - Add one sentence to "Who can run it" (L434) linking to the section.
2. **`SECURITY.md`** -- replace the second scope paragraph with the Design Notes text, and add the short trust-model summary. Keep the strings `story-42-5-doc-claims` pins. Add no email address (AC 45.5.3, C-3).
3. **Warning pointer.**
   - `packages/shared/src/data-policy.ts` L325: change the pointer to `See "What the safety settings protect" in the README.`
   - Update its pins in `data-policy-warning.test.ts`, `story-45-4-block-seed-wire.test.ts` and `story-45-4-doc-claims.test.ts`.
   - Update the 45.4 CHANGELOG bullet and the 45.4 changeset phrase. Both are unreleased, so the 1.3.0 notes must not name a section the line no longer points to (decision #170).
4. **`tool_support.md`** (AC 45.5.4, DW-768, DW-784):
   - add a dated `Story 45.5 (2026-11-26)` note after L230: no tool, key or default moves; the automatic-install rule and the pointer;
   - in "Dependency implications", name `IRIS_AUTO_INSTALL`, the per-profile `autoInstall` and the `IRIS_SIDE_NOT_INSTALLED` refusal of a not-installed side with the install off;
   - mark the `iris_sql_analyze` Why cell "`stats` and `running` may show other sessions' statement text; under probe (DW-784)";
   - enrich the scope section's closing paragraph with a link to the new section.
5. **Client-config pages** -- in `docs/client-config/{claude-code,claude-desktop,cursor}.md`, after the read-only JSON block, add a paragraph covering:
   - the read-only preset also turns the automatic install off (`IRIS_AUTO_INSTALL`, default on; per-profile `autoInstall`);
   - a missing or older IRIS side then answers `IRIS_SIDE_NOT_INSTALLED`, and Atelier-only tools keep working;
   - an explicit on together with read-only fails startup;
   - a link to the new section (AC 45.5.4, DW-768).
6. **Launcher README** -- in `extensions/iris-mcp-launcher/README.md` L405, add `IRIS_AUTO_INSTALL` to the variables left alone. It is unset by default (on, except under the read-only preset) and global; a profile's `autoInstall` is set in `IRIS_PROFILES` (DW-768).
7. **Shared README** -- `packages/shared/README.md`: add the epic-45 exports listed in the Code Map, each with one line, and the `REFUSAL_CODES.IRIS_SIDE_NOT_INSTALLED` entry (`structuredContent` fields as `buildIrisSideRefusal` builds them; audited `error`, decision #160) (DW-768).
8. **Five server READMEs** (AC 45.5.2, AC 45.5.4):
   - in each Configuration section, add `> **What the safety settings protect:** …` (one sentence plus the link `../../README.md#what-the-safety-settings-protect`);
   - in the dev README, add the automatic-install sentence to "Read-only mode";
   - in the dev README, APPEND the DW-766 layout sentence to the "SQL privileges (Story 45.1)" blockquote.
9. **Release notes.**
   - `CHANGELOG.md`: add a `## [Unreleased] - Story 45.5: What the Safety Settings Protect` section above the 45.4 one. It gives the docs, the narrowed `SECURITY.md` scope (C-3: the 1.3.0 release notes must say so), the pointer change under `S-45.4-block-raw-tools`, and `### Release handoff (1.3.0)`, written from Design Notes.
   - Add `.changeset/story-45-5-what-the-safety-settings-protect.md`: `minor` for the six `@iris-mcp/*` packages (decision #160; D2).
10. **Doc-claims test** -- new `packages/iris-mcp-all/src/__tests__/story-45-5-doc-claims.test.ts`, default suite. Pin each row of Design Notes "Doc-claims pins" against its oracle, plus the Rule #56 completeness check (every `IRIS_*` row of the README variable table is named in the section or in the test's explicit not-a-safety-setting list).
11. **Capstone** -- new `packages/iris-mcp-all/src/__tests__/epic45-capstone-gate.test.ts`, default suite. Legs P1, P2, P3, P4, LP-hermetic and LP-armed, per the matrix and Design Notes "Capstone plan". Its header names each point, its oracle, its mutation and the path the mutation runs on (Rule #59).
    - Move `writesIn` and `customRestIn` from `story-45-2-auto-install-orchestration.test.ts` into `bootstrap-guard-legs.ts`, exported, and import them in both files (Rule 2).
    - Add the capstone to `packages/iris-mcp-all/scripts/prepublish-gate.mjs` `gateTestFiles`, with a comment naming what it writes.
12. **Mutation proofs** -- run P1 to P6 (Verification). Record each `mutation: … → …` line, then restore and confirm `git status --short` and `git diff --stat` are as before.

**Acceptance Criteria:**
- Given the README, when `story-45-5-doc-claims.test.ts` runs, then the section states each AC 45.5.1 bullet, DW-766 (the layout rule), DW-771's four points (point 3 per A2), DW-773's two settings and DW-784 "under probe". Every pinned sentence matches its oracle, and every README `IRIS_*` variable is classified (Rule #56) (AC 45.5.1).
- Given the five server READMEs and the governance variable docs, when the doc-links test and the doc-claims test run, then each names the section with a link that resolves to its heading (AC 45.5.2).
- Given `SECURITY.md`, when read, then the scope says that getting past a control through the servers' tools is in scope and using the account directly is not. It carries the trust-model summary and links the section. It holds no email address, and the 42.5 pins stay green (AC 45.5.3).
- Given `tool_support.md`, the three client-config pages, the launcher README and `packages/shared/README.md`, when read, then they name `IRIS_AUTO_INSTALL`, `autoInstall` and `IRIS_SIDE_NOT_INSTALLED`. The shared README lists every Epic-45 export and the refusal code (AC 45.5.4, DW-768).
- Given the built servers under any `redact` or `block` configuration that logs the data-policy warning, when they start, then the line ends with `See "What the safety settings protect" in the README.` and that text is the title of a `## ` heading of README.md (decision #170).
- Given the default suite, when `epic45-capstone-gate.test.ts` runs, then P1 to P4 and the hermetic least-privilege leg pass on the built dists. Each goes red under its mutation, on the path named in its header (AC 45.5.5, Rules #21, #59).
- Given the seeded CI throwaway, when the `ci` workflow runs on the pushed wave tip, then `suite prepublish-dev` (45.1's privilege gate), `suite uninstall-round-trip` (45.3) and `suite prepublish-all` (the capstone's armed least-privilege leg) are green. The lead records the run URL under `## Verification` (AC 45.5.5).
- Given the change, when `gen:governance-baseline:check`, `gen:tools-list-snapshot:check` and `gen:ipm:check` run and the golden fixtures are diffed, then nothing moved. `BOOTSTRAP_VERSION` is `1.2.0+10.109d0129528f`, and the only product-code diff is the pointer string (AC 45.5.6 as amended by A1).

## Spec Change Log

- 2026-11-26 (lead, spec gate, decision #173):
  - **D1–D6 accepted:**
    - **D1:** A2. The `ConfigureMapping` residual is harvested as DW-786, decision-pending with the owner via the Planner.
    - **D2:** the changeset is `minor`.
    - **D3:** `SECURITY.md` treats a residual the README documents as out of scope.
    - **D4:** the capstone joins `gateTestFiles`.
    - **D5:** the unreleased 45.4 CHANGELOG bullet and changeset are reworded to the new pointer.
    - **D6:** the Interop compile finding is harvested as DW-787 (burn-down, probe first).
  - **Amendments A1–A5 are applied to `epics.md` as written,** each tagged.
  - **The plan's two `deferred:` items are already ledger entries** DW-786 and DW-787. At dev_complete, do not harvest them again.
  - **If the owner rules a fix for DW-786,** the burn-down story ships it and updates this section's point 3 in the same change. Until then, this story documents today's behavior (A2).
  - **DW-784:** the `iris_sql_analyze` stats/running literal exposure is unverified and the burn-down probes it. This story's residual table lists it as "under probe", and the burn-down writes the outcome.

## Review Triage Log

## Design Notes

**Planning context and ADs.**
- `epic-45-context.md` is older than `epics.md` (13:24 vs 23:21). As the lead directed, it was read with `epics.md` Story 45.5 (L6538-6575) winning, and it was not recompiled: a recompile would dirty the tree before the step-01 check.
- Governing ADs: AD-6 (the cascade text), AD-7 (visibility is not a control), AD-14 (the automatic install, the uninstall and the record), AD-15 (sanction `S-45.4-block-raw-tools`), AD-19 (audit scope), AD-25 (SQL privileges), AD-26 (what `redact` and `block` cover) and AD-31 (the trust model and the vulnerability sentence).
- No service is introduced (Rule 1): the consumers are readers. Consumes: 45.1 (`sql-privilege-mode`, the live gate and its probe facts), 45.2 (auto-install and the fake), 45.3 (the uninstall section and the round-trip suite) and 45.4 (`DATA_POLICY_BLOCK_KEYS`, the warning and the wire patterns).
- Extend, don't copy: the doc-claims test mirrors `story-45-4-doc-claims.test.ts`. The capstone reuses the 45.2 and 45.4 harnesses, and the oracles move into `bootstrap-guard-legs.ts`.

**Ledger inbox.**
- DW-766 is addressed by Probe A and the README layout rule (task 1 and the dev README in task 8). An armed capstone check on the CI layout backs it.
- DW-768 is addressed by tasks 4 to 7.
- No entry is declined.

**Facts cited, not re-derived.**
- Through `iris_sql_query`, an account without `EXECUTE` is refused on all five `Setup` procedures. Through Atelier `action/query`, the same account calls them with no `EXECUTE` check, and `Configure` and `ConfigureMapping` fail with `<PROTECT>` (decision #165).
- Atelier `action/query` does not check SQL grants at prepare (45.1).
- A `SqlProc` in a SELECT needs `EXECUTE` through the suite (45.1).
- DW-773 (45.2 rework live probe, `%Development:U` plus `RW` on the namespace database):
  - install off: one could-not-confirm warning on every start, and the tools run;
  - install on: every connect recompiles the classes and fails `Configure` with the `%Admin_Manage` warning, and the tools run.

**Probe A: DW-766, the minimum account on split and mapped layouts.**
- Setup: throwaway `iris-mcp-throwaway-a9c243572d1b` on IRIS for UNIX (Ubuntu Server LTS for ARM64 Containers) 2026.2 (Build 221U), from the pinned `irishealth-community` digest, `up --namespace USER --host-port 52792`.
- Session (`%SYS`): created the databases `SPLITG` and `SPLITR` with the resources `%DB_SPLITG` and `%DB_SPLITR`, and the namespace `SPLIT` (globals `SPLITG`, routines `SPLITR`). Interoperability was enabled after step 3 (see deferred).
- Install: the real `bootstrap()` of the built shared dist, run with `IRIS_NAMESPACE=SPLIT`. The first run answered `Compile failed: 1 of 35 classes … ExecuteMCPv2.REST.Interop` (SPLIT was not interoperability-enabled; second `deferred` item). After `%Library.EnsembleMgr.EnableNamespace("SPLIT")` the second run answered `{probe:"unconfigured", deployed, compiled, configured, mapped: true, errors: []}`. Read back: mapping `%ALL`/`ExecuteMCPv2` → `SPLITR`; web application namespace `SPLIT`, resource `%Development`.
- Tables: `Probe766.T` in SPLIT (its data in SPLITG) and `Probe766.U` in USER, with SELECT granted.
- Calls: `POST /api/executemcp/v2/dev/sql/execute` as each account, with a statement prepared before and with a never-prepared one (unique alias); with and without `readOnly:true`, which is `iris_sql_query`'s body.
- Results (all accounts hold `%Development:U` besides what is listed):

  | Account | Database resources | Namespace queried | Route answer |
  |---|---|---|---|
  | LP1 | `%DB_SPLITG:RW` | SPLIT | HTTP 500 `<PROTECT>^%CSP.REST.1 ^\|^^/usr/irissys/mgr/splitr/\|ExecuteMCPv2.REST.Dispatch.1` |
  | LP2 | `SPLITG:RW`, `SPLITR:R` | SPLIT | 200, rows, fresh statements included |
  | LP3 | `SPLITG:RW`, `SPLITR:RW` | SPLIT | 200, rows |
  | LP4 | `SPLITR:R` | SPLIT | HTTP 403 |
  | LP5 | `%DB_USER:RW` | USER | 403 |
  | LP6 | `USER:RW`, `SPLITR:R` | USER | 403 |
  | LP7 | `USER:RW`, `SPLITR:R`, `SPLITG:R` | USER | 200, rows; an ungranted table answers `SQLCODE: -99` |
  | LP8 | `USER:RW`, `SPLITG:R` | USER | 500 `<PROTECT>` (Dispatch in SPLITR) |
  | LP9 | `USER:RW`, `SPLITR:RW`, `SPLITG:RW` | USER | 200 |
  | LP10 | `SPLITG:R`, `SPLITR:R` | SPLIT | 200 with `readOnly:true` and without; INSERT answers -99 |
  | LP11 | `USER:R`, `SPLITG:R`, `SPLITR:R` | USER | 200 with `readOnly:true` and without; INSERT answers -99 |

  Atelier `SELECT ExecuteMCPv2.Setup_GetBootstrapVersion()` (the bootstrap's read) needs the same `R` on SPLITR. LP1, LP5 and LP8 got `SQLCODE -149 … <PROTECT>`.
- **Finding:** the minimum account is `%Development:U`, plus `R` on three database resources (they may be the same database), plus the SQL grants:
  1. `R` on the database that holds the `ExecuteMCPv2` classes, which is the routines database of the namespace the suite was installed in (where the `%ALL` mapping points). Without it: HTTP 500 `<PROTECT>`.
  2. `R` on the default globals database of that install namespace, where the web application runs. Without it: HTTP 403.
  3. `R` for reads, or `RW` for writes, on the database that holds the data the statement touches.

  Write access to the routines database is not needed: cached queries were generated with `R` only. In the usual layout one database is all three, which is 45.1's `%Development:U` plus `%DB_<name>`.
- Teardown: `down`, then `docker ps -a --filter label=iris-mcp.owner=throwaway` printed only its header.
- The commands and outputs are in the scratchpad (`dw766/*.script`, `*.mjs`, `out-*.txt`), summarized here.

**Probe B: DW-771 point 3 (Rule #42).**
- Setup: throwaway `iris-mcp-throwaway-8fe15ad13daa`, same image and build, `up --namespace HSCUSTOM --host-port 52792`. The real bootstrap answered `missing → deployed, compiled, configured, mapped`. Every call below is made as `_SYSTEM`, through the route with `readOnly:true` (`iris_sql_query`'s body) or through Atelier.
- Configure through the route: `SELECT ExecuteMCPv2.Setup_Configure('USER')` returned `1`, and the web application's namespace stayed `HSCUSTOM` (rolled back).
- Configure through Atelier `action/query`: the same statement moved the web application to `USER`. It was restored with `Configure('HSCUSTOM')`.
- ConfigureMapping, mapping deleted: after `Config.MapPackages.Delete("%ALL","ExecuteMCPv2")`, a cross-namespace command answered `<NOROUTINE>`. Then the route `SELECT ExecuteMCPv2.Setup_ConfigureMapping('HSCUSTOM')` returned `1`. Afterwards:
  - `Config.MapPackages.Exists` = 0;
  - USER sees `ExecuteMCPv2.Setup` again (the cross-namespace command works);
  - `iris.cpf` holds `Package_ExecuteMCPv2=HSCUSTOM` under `[Map.%ALL]`.
- ConfigureMapping, mapping and `%ALL` both deleted: the route call returned `1`. Afterwards:
  - `Config.Namespaces.Exists("%ALL")` = 0 and `Config.MapPackages.Exists` = 0;
  - USER's `%Dictionary.CompiledClass` count for `ExecuteMCPv2.Setup` went 0 → 1;
  - `iris.cpf` has `%ALL=%DEFAULTDB` and the mapping back.
- `EnsureUnitTestRoot` through the route returned the manager directory, and `^UnitTestRoot` stayed undefined (rolled back).
- **Finding:** the owner's point 3 ("can only register the same web application") is incomplete. See amendment A2 and the first `deferred` item. The container was removed, and the `docker ps` check was empty.

**Section content (the implementer writes the prose; each bullet is required).** The intro says the settings guard the agent, not the account, and that the account is chosen first. Then:
1. *The settings guard the agent.* This is the Rule #56 list as of 2026-11-26, from the README variable table, AD-31 and the refusal catalog:
   - governance (`IRIS_GOVERNANCE`, `IRIS_GOVERNANCE_FILE`) and the presets (`IRIS_GOVERNANCE_PRESET`);
   - the confirmation dialogs;
   - the audit log (`IRIS_AUDIT_LOG`);
   - the data policy (`IRIS_DATA_POLICY`);
   - the SQL safety settings (`IRIS_SQL_READ_ONLY`, `IRIS_SQL_MAX_ROWS_AFFECTED`, `IRIS_SQL_MAX_ROWS`, `IRIS_SQL_TIMEOUT`, and the call parameters);
   - the document write guards.

   They all run in, or are sent by, the MCP process. Anyone with the same account can call `/api/executemcp/v2`, the Atelier API or a terminal directly, and none of them applies. Tool visibility (`IRIS_TOOLS_*`) only changes what the agent is shown and is not a safety control (AD-7). `IRIS_AUTO_INSTALL` decides what the servers write to IRIS when they connect.
2. *The account is the boundary.*
   - Use a least-privilege account, no `%All`, SQL grants only where needed, and a separate read-only account (database resources `R` only, Probe A LP10/LP11) for look-don't-touch connections.
   - `%Development`: the web application requires it (`U`). With it, the account runs ObjectScript through the command route and compiles code through Atelier, and that code reads globals subject to the database resources. So the database resources bound the data, and SQL grants bound only the SQL tools (C-1).
3. *Minimum account for the SQL tools*: Probe A's finding, with the 403 and 500 symptoms and the one-database short form.
4. *The read-only preset* limits statement types and the suite's write tools, not what a query can call. A SELECT can call a `SqlProc` method, which runs with the account's privileges. Through the suite that needs `EXECUTE` on it (45.1). The rollback does not undo every effect: link "SQL write safety".
5. *SQL privileges*: statements through the suite are prepared with checking on (45.1). IRIS's own Atelier `action/query` does not check SQL grants at prepare.
6. *The five setup procedures* (DW-771), in plain words:
   1. `Configure`, `ConfigureMapping`, `IsConfigured`, `EnsureUnitTestRoot` and `GetBootstrapVersion` can be called through SQL, including Atelier, which skips the `EXECUTE` check. The account's privileges are the boundary.
   2. A limited account is refused on `Configure` and `ConfigureMapping`. The three reads are harmless, and `EnsureUnitTestRoot` only sets an empty `^UnitTestRoot`, to the IRIS manager directory.
   3. The residual, per A2.
   4. The mitigations: a least-privilege account, or `block` (which turns `iris_sql_query` off).
7. *Data-policy scope*:
   - `redact` (the default) covers the message tools only. Not covered: `iris_sql_query`, `iris_sql_execute`, `iris_global_get`, `iris_global_list` and Event Log text (`iris_production_logs`).
   - `block` turns off the declared keys, listed as backticked tokens in a paragraph that starts `**What \`block\` turns off here.**`. An explicit governance key re-enables one, and the startup warning names it.
   - `iris_sql_analyze` `stats`/`running` is under probe (DW-784).
8. *Audit log*: it records MCP tool calls only. A direct REST or Atelier call with the same account is not in it; IRIS auditing covers those (`iris_audit_manage`, `iris_audit_events`).
9. *A least-privilege account and the automatic install* (DW-773, shipped behavior only, as probed) gives both settings' outcomes. It advises installing once as an administrator (a start with the install on, or IPM) and then connecting the limited account with `IRIS_AUTO_INSTALL=false` or the read-only preset.
10. Pointers: `IRIS_AUTO_INSTALL` (the read-only bullet's anchor) and "Removing the IRIS Side".

**`SECURITY.md` scope text (C-3).**
- First paragraph, kept: "The authorization model is IRIS's own: the servers act as the IRIS user they connect with, and what that user may do is decided by IRIS."
- Trust model: the servers' safety settings (governance, the presets, the confirmation dialogs, the audit log and the data policy) guard the agent that uses the servers, not the IRIS account.
- **In scope:** a way to get past one of those controls through the servers' own tools, for example a tool call that runs an action governance turned off, or returns data the data policy should withhold.
- **Out of scope:**
  - using the IRIS account directly (the REST service, the Atelier API, a terminal), which IRIS privileges govern;
  - a finding that depends on giving the account more privileges than it needs;
  - a residual that [What the safety settings protect](README.md#what-the-safety-settings-protect) already documents.

**Doc-claims pins (sentence → oracle).**
- The `block` list equals `DATA_POLICY_BLOCK_KEYS` (shared dist), in order.
- Each not-covered tool is `scope: "residual"` in `DATA_POLICY_SCOPE`, and `iris_production_logs` is governed under `block` only (the row reason).
- The five procedures equal the `[ SqlProc ]` method names of `ExecuteMCPv2.Setup.cls` in `BOOTSTRAP_CLASSES` (shared dist), and `Uninstall` is not among them.
- "requires `%Development`" matches `Setup.cls`: every `Set tProps("Resource")` is `%Development`.
- The `EnsureUnitTestRoot` sentence matches the method body's guard on an empty `^UnitTestRoot` and its `ManagerDirectory()` value.
- The "prepared with checking on" sentence matches the embed's `%Prepare(.pQuery, 1)`.
- The DW-773 sentences quote substrings of the built `packages/shared/dist/bootstrap.js` (`could not confirm that the /api/executemcp/v2 web application is registered`) and of `MANUAL_INSTRUCTIONS` (`registration requires %Admin_Manage privileges`).
- The audit sentence matches the code: `AuditLogger` is not exported from the shared barrel, and the only writer is `server-base.ts`.
- The pointer: `buildDataPolicyWarning` output (shared dist) quotes a heading present in `markdownHeadingSlugs(README)`.
- The Probe A and Probe B sentences cite this spec in the test header (probe oracle, Rule #36), and the armed capstone leg checks the one-database form live.

**Capstone plan (Rules #21, #59; decision #166).**
- **P1 (point 1).** Built dev, interop and data servers with `IRIS_DATA_POLICY=block` against `start503Stub`: every declared key is denied and the stub sees 0 requests. An explicit re-enable reaches the stub, and the warning names exactly that key. The default warning lists per server come from the 45.4 matrix plus #172: dev `iris_sql_query`, `iris_sql_execute`, `iris_global_get`, `iris_global_list`, `iris_execute_command`, `iris_execute_classmethod` and `iris_execute_tests`; interop `iris_transform_test`; data `iris_docdb_document:get`, `iris_docdb_document:delete` and `iris_docdb_find`. Each list is cross-checked against `iris_server_profiles`. The warning's heading resolves in README.
  - **Mutation P1:** delete the `dataPolicySeed(...)` term at `governance.ts` L1298 and rebuild shared. The P1 denial legs go red. Path: stdio `tools/call` → `handleToolCall`'s gate in the shared dist that each built server loads.
- **P2 (point 2).** The README section's lists against the built shared dist and the embed (the pins above).
  - **Mutation P2:** drop `iris_docdb_find` from `DATA_POLICY_BLOCK_KEYS` and rebuild, and P2 (and P1) go red. Then delete the README's SqlProc-in-SELECT sentence, and P2 goes red. Path: README text against the built shared dist.
- **P3 (point 3).** Built dev, read-only preset, a stateful fake with no IRIS side: no write, `IRIS_SIDE_NOT_INSTALLED` from `iris_global_get`, and `iris_server_info` works.
  - **Mutation P3:** return `{autoInstall: true}` instead of false at `auto-install.ts` L82 and rebuild. Writes appear and the refusal is gone. Path: `McpServerBase.start` → `bootstrap` in the built dev process.
- **P4 (point 4).** Built dev, install on, an empty fake. The uploaded `ExecuteMCPv2.REST.Sql.cls` body prepares with `%Prepare(.pQuery, 1)`, and the `iris_sql_query` request carries no privilege control.
  - **Mutation P4:** set `%Prepare(.pQuery)` in `Sql.cls`, run `pnpm run gen:bootstrap` and rebuild shared, and P4 goes red. Path: the built server's Atelier PUT. Restore `Sql.cls`, `bootstrap-classes.ts` and `scripts/bootstrap-sequence.json`, rebuild, and confirm `BOOTSTRAP_VERSION` is `1.2.0+10.109d0129528f` and the tree is byte-identical.
- **LP-hermetic.** Read-only, a current side, `isConfiguredReadsFalse`: no write, one could-not-confirm warning, and the call is sent.
  - **Mutation P6:** make the install-off `unconfigured` branch refuse up front, which was 45.2's state before decision #165. The leg goes red. Path: the built dev gateway.
- **LP-armed (`IRIS_REQUIRE_LIVE`, throwaway-shaped env).**
  - Setup: read the namespace's Globals and Routines databases through Atelier `%SYS` SQL on `Config.Namespaces`, and make the role `%Development:U` plus `R` on each distinct `%DB_*` (Probe A's rule). Create the disposable user, role and table `ExecuteMCPv2_Temp.QaEpic45Cap*`, and GRANT SELECT on the one table.
  - Run the built dev server as that user with `IRIS_GOVERNANCE_PRESET=read-only`, then with `IRIS_DATA_POLICY=block`, asserting the matrix row.
  - Teardown: remove everything, and assert by query that nothing named `QaEpic45Cap` is left.
  - **Mutation P5** (lead smoke, a local throwaway): P4's `Sql.cls` mutation deployed. The ungranted-SELECT leg goes red. Path: the real `/dev/sql/execute` through the built server.
- **Armed run.** Push the wave tip, then `gh run list --workflow ci.yml --commit <sha>`. The `throwaway` job's `suite prepublish-dev`, `suite uninstall-round-trip` and `suite prepublish-all` are green. The lead records the URL under Verification.
- The reporter's probe cases (optional evidence) were not shared as of 2026-11-26, so the capstone does not replay them.

**Release handoff text (CHANGELOG).** The release is `1.3.0` (minor) and carries every `@iris-mcp/*` package through the Changesets fixed group (`.changeset/config.json` `fixed: [["@iris-mcp/*"]]`).
- `@iris-mcp/shared` carries the new IRIS-side embed. It is `1.2.0+10.109d0129528f` on the branch, and the version step restamps the semver.
- The IPM tree is stamped only at `pnpm run version` (AD-14).
- The release notes must state:
  - the narrowed `SECURITY.md` scope (C-3);
  - the C-2 upgrade note: install-off profiles refuse until one upgrade. DW-770's hash rule, if the burn-down lands it, changes this note;
  - the warning pointer.

**Decisions for the lead (the spec implements each recommendation).**
- **D1:** accept A2 and harvest the first `deferred` item as decision-pending for the owner. It reopens the premise of #171; no code changes here.
- **D2:** the changeset is `minor` for six packages. The story is not docs-only (the warning string), and #160 says one minor release.
- **D3:** the `SECURITY.md` out-of-scope list includes "a residual the README documents".
- **D4:** the capstone's armed leg is listed in `gateTestFiles`, so CI's `prepublish-all` arms it on the seeded HSCUSTOM throwaway.
- **D5:** edit the unreleased 45.4 CHANGELOG bullet and changeset phrase to the new pointer.
- **D6:** route the second `deferred` item (the install namespace must be interoperability-enabled).

**Proposed `epics.md` amendments (Rule #42; the lead applies them).**
- **A1 (AC 45.5.6).** Replace "Back-compat (Rule #19): docs only, plus the capstone; no product code changes in this story." with: "Back-compat (Rule #19): docs, the capstone, and one product string: the startup warning's last sentence becomes `See "What the safety settings protect" in the README.` (decision #170; the line is new in `1.3.0`, under `S-45.4-block-raw-tools`). No other product code changes in this story."
- **A2 (the DW-771 bullet, point 3).** Replace "3. The residual, named: an agent using `iris_sql_query` on a read-only server connected with an admin account can run `Configure` through a `SELECT`. It can only register the same web application the install registers, and only where the classes are already present. This is the issue #1 point 2 class." with: "3. The residual, named: an agent using `iris_sql_query` on a read-only server connected with an admin account can call `Configure` and `ConfigureMapping` through a `SELECT`. `iris_sql_query` rolls the statement back, which undoes `Configure`'s change to the web application, but not `ConfigureMapping`'s: when the `%ALL` namespace or the `ExecuteMCPv2` mapping is missing, the call puts them back in `iris.cpf` and in the running configuration, while `Config.Namespaces` and `Config.MapPackages` report them absent. Called without a rollback (Atelier `action/query`), `Configure` can point the web application at another namespace. This is the issue #1 point 2 class. *(Amended 2026-11-26 at the Story 45.5 spec gate, from the plan's probe B.)*"
- **A3 (AC 45.5.1, first bullet; Rule #56).** After "the audit log and the data policy", insert ", and the SQL safety settings (`IRIS_SQL_READ_ONLY`, `IRIS_SQL_MAX_ROWS_AFFECTED`, `IRIS_SQL_MAX_ROWS`, `IRIS_SQL_TIMEOUT`)", and append "; tool visibility (`IRIS_TOOLS_*`) is named as not a safety control (AD-7)".
- **A4 (the epic-done gate, point 4).** Replace "the SQL route's privilege mode, pinned on the request path" with "the SQL route's privilege mode, pinned on the request path: the `ExecuteMCPv2.REST.Sql` class the built server uploads prepares with privilege checking on, and the `iris_sql_query` request carries no privilege control".
- **A5 (AC 45.5.5).** Append "It includes a least-privilege leg (decision #166): hermetic in the default suite, and armed on the seeded throwaway through `prepublish-all`."

## Verification

**Commands** (each in its own foreground call, `timeout: 600000`):
- `pnpm build` -- expected: every package builds.
- `pnpm --filter @iris-mcp/shared test` -- expected: green, including the updated warning pins.
- `pnpm --filter @iris-mcp/all test` -- expected: green. Run it per file batch if the run nears the cap; the full suite runs before push (Planner memory).
- `pnpm type-check && pnpm lint && pnpm check:live-guards` -- expected: clean.
- `pnpm gen:governance-baseline:check && pnpm gen:tools-list-snapshot:check && pnpm gen:ipm:check && node scripts/check-epics-sync.mjs` -- expected: unchanged.
- `git diff --stat f4481848df128f80ea25c5fb9706818b83783542 -- packages/iris-mcp-all/src/__tests__/fixtures/ packages/shared/src/bootstrap-classes.ts scripts/bootstrap-sequence.json src/` -- expected: empty.
- `grep -n "PHI data policy\" in the README" -r packages README.md CHANGELOG.md .changeset` -- expected: no hit.

**Planned mutations (Rule 19; the implement and QA stages record the actual red):** P1 to P6 above. AC 45.5.1-45.5.4 docs are also pinned by P2's README mutation. The warning-pointer AC: change the string back, and the P1 slug check and the doc-claims pointer test go red.

**Shared surfaces:**
- the startup warning string (the 45.4 unit, wire and doc-claims pins);
- the README variable table, the cascade text, `## PHI data policy` and the new heading;
- the `SECURITY.md` scope (42.5 doc-claims);
- the client-config read-only sections (38.6 doc-claims);
- the launcher left-alone list (38.6);
- the dev README SQL privileges blockquote (45.1 doc-claims);
- the `tool_support.md` scope section (scope test);
- the CHANGELOG section order (45.x doc-claims);
- `gateTestFiles` (live-gate roster).

Every test added or changed passes on a fresh environment, in either order.

**Manual checks:**
- Lead smoke (decision #166): mutation P5, plus a least-privilege run of the capstone's armed leg on a local throwaway (port 52792; `down` afterwards; `docker ps -a --filter label=iris-mcp.owner=throwaway` prints nothing).
- Armed run: the lead records the `ci` run URL for the pushed tip.

## Auto Run Result

Status: ready-for-dev
Blocking condition: none (halted after planning, as directed).

Planning ran two throwaway probes (Probe A: DW-766; Probe B: DW-771 point 3), and both containers were removed. Lead decisions D1 to D6 and the proposed `epics.md` amendments A1 to A5 are under Design Notes. The spec implements each recommendation.
