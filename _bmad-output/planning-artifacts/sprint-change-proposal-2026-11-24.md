# Sprint Change Proposal — 2026-11-24 (Epic 45: Security Boundaries)

**Trigger:** GitHub issue #1 ([jbrandtmse/iris-execute-mcp-v2#1](https://github.com/jbrandtmse/iris-execute-mcp-v2/issues/1)), "Feedback from trying the read-only preset and the HL7 data policy (commit 9a2f5150)". An external user built commit `9a2f5150` and ran the five servers against IRIS for Health Community 2026.2 with synthetic HL7, through the official MCP SDK and the Inspector CLI. The Planner verified all four points against `1.2.0` on 2026-11-24, and the owner answered on the issue the same day, committing the `1.3.0` changes this proposal plans.

**Facilitator:** correct-course (drafting agent, batch mode) · **Owner:** Project Lead, through the Planner

**Mode:** Batch · **Scope classification:** **Moderate.**
- It adds a new epic of five stories, amends nine spine ADs and the PRD (four new FRs, two amended, two NFR bullets).
- It carries three sanctioned behavior changes (AD-15) and one documented-method change. No tool, governance key or preset row is added, nothing is rolled back, and the MVP is unchanged.

**Approval:** the owner approved decisions (1) to (6) on 2026-11-24, relayed by the Planner (see [Approval](#approval-2026-11-24)). **Final approval of this proposal is pending the Planner's review.** The edits are applied in the worktree and uncommitted; the Planner commits. §4.1 and §4.2(a) must land in **one commit**, because `check-epics-sync` is a CI gate (Story 42.3).

---

## Approval (2026-11-24)

The owner approved these decisions on 2026-11-24, relayed by the Planner. They are encoded as given; the drafting pass asked the owner nothing.

1. **SQL privileges.** `REST/Sql.cls` prepares with privilege checking on, with no off-switch. Proof: an account with no SQL grant on a table is refused; after a GRANT it gets rows; `%All` accounts are unchanged. Every SQL tool path is verified with checks on. A sanctioned AD-15 change.
2. **Auto-install.** A new `IRIS_AUTO_INSTALL` (default on, any mode; also per profile, since the profile mechanism supports such settings). `IRIS_GOVERNANCE_PRESET=read-only` forces it off; an explicit "on" with read-only is a startup error naming the conflict (AD-8). With it off, the server never installs, upgrades or repairs the IRIS side; a missing or stale IRIS side makes the custom-REST tools return a clear message (install once without read-only or with auto-install on, or through IPM), never running old classes; Atelier-only tools keep working; the Story 44.4 compile/currency check still runs. IPM-owned installs are unchanged. A sanctioned AD-15 change for read-only users on a fresh instance.
3. **Careful uninstall.** Removes the web application, the `ExecuteMCPv2` mapping in `%ALL` and the classes. Removes `%ALL` only if our install created it and our mapping was the only thing in it, and `^UnitTestRoot` only if our install set it and its value is unchanged. The install records what it created (where: probe). How a package uninstalls itself, and `Config.MapPackages`/`Config.Namespaces` `%ALL` semantics, are probed first. Whether uninstall is a tool, a CLI or a documented one-liner is a story-level probe outcome (the Planner leans to the documented one-liner). README section "Removing the IRIS side", including what `zpm uninstall` leaves behind.
4. **Data policy.** `redact` (the default) is documentation only: the README says it covers the message tools only and names `iris_sql_query`, `iris_sql_execute`, `iris_global_get`, `iris_global_list` and Event Log text as not covered. `block` additionally turns off those four and the code-execution tools; an operator may re-enable one explicitly through the existing per-tool mechanism (explicit re-enable wins and is logged). A startup warning, one line per server, names the raw-read and code-execution tools enabled under `redact` or `block`. Rules #20, #23, #28, #32 and #53 are respected.
5. **Docs.** README section "What the safety settings protect" (the controls guard the agent, not the account; the account's privileges are the boundary; read-only is not a sandbox; the data-policy scope; the audit log's scope; pointers to auto-install and uninstall), linked from the five server READMEs and the governance variable docs. A root `SECURITY.md` with the summary and private reporting through GitHub private vulnerability reporting (enabled by the Planner on 2026-11-24), no email address. `tool_support.md` and docs per Rules #30 and #43.
6. **Delivery.** Epic 45 on `feature/feature-wave-10-security-boundaries` (cut from `main` `11d879d`), epic branch `epic45`. One release, `1.3.0` (minor), at the end; no per-story release; changesets per convention (the Planner raises the bump to minor at release). The Planner auto-merges the wave into `main` at epic-45 done (owner OK 2026-11-24). Probe first (Rule #16) for every IRIS claim.

**Rulings on §7 (owner, 2026-11-24, after reviewing this draft through the Planner):**

- **C-2: accepted, with documentation.** An instance touched only by read-only servers refuses its custom-REST tools after each release that changes IRIS classes, until an operator upgrades it once (one run with auto-install on, or `zpm`). Upgrading is a deliberate admin step. The README, the refusal message, the `1.3.0` CHANGELOG and the release notes say so explicitly. 45.2 keeps "stale → refuse, never old classes".
- **C-3: narrow the `SECURITY.md` scope.** In scope: getting past a control through the servers' own tools. Out of scope: using the IRIS account directly (the REST service, Atelier, a terminal), which IRIS privileges govern. The `1.3.0` release notes say the scope was narrowed.
- **C-4: keep the IPM warning.** An out-of-date IPM-owned install keeps today's behavior in every mode: a warning naming the `zpm` command, and the tools keep using the installed classes.
- **C-1, C-5, C-6, C-7:** handled as written in §7 (C-1: 45.5 states that database resources, not SQL grants alone, bound a `%Development` account, and that Atelier's query route skips SQL privileges).

**Proposal status:** APPROVED by the owner on 2026-11-24 (through the Planner). Scope: Moderate (backlog reorganization: a new epic of five stories); routed to the `/epic-cycle` orchestrator. Development does not start until the owner says so (weekly quota hold, 2026-11-24).

---

## 1. Issue Summary

Four points, each verified by the Planner against `1.2.0` and re-checked in source by this pass:

| # | What the reporter found | Who is affected |
|---|---|---|
| 1 | Under `IRIS_GOVERNANCE_PRESET=read-only` and `IRIS_DATA_POLICY=redact`, `iris_message_body` masked the PID, but `iris_sql_query` (`SELECT RawContent FROM EnsLib_HL7.Message`, and the search table) and `iris_global_get` (`^EnsHL7.Segment`) returned the same message in full; `iris_production_logs` shows Event Log text under `redact` | Anyone who reads "data policy" as covering patient data in general |
| 2 | Under the read-only preset, `SELECT MyPkg.MyClass_Method('x')` on a `SqlProc` method ran it: it wrote a file, started a JOB and incremented a counter | Anyone who reads "read-only" as a sandbox |
| 3 | One `tools/list` under the read-only preset installed the IRIS side: 35 classes, the web application, a `%ALL` namespace with a package mapping, and `^UnitTestRoot`; `Setup.Uninstall` removes the web application only | A "look, don't touch" connection, and an administrator removing the suite |
| 4 | Every safety control lives in the Node process; with the same account a plain POST to `/api/executemcp/v2/command` ran ObjectScript while the servers were read-only, and the SQL route prepares with privilege checking off, so an account with `%Development` and no SQL grants could read tables | Anyone choosing the IRIS account for the suite |

**Evidence re-checked in source on 2026-11-24 (Rules #14/#47).** Read-only: no IRIS call was made. The `irislib/`/`irissys/` snapshot was read from the main checkout (it is gitignored and absent from the worktree).

| Claim | Verified | Note |
|---|---|---|
| The SQL route turns privilege checking off | ✓ `src/ExecuteMCPv2/REST/Sql.cls:191` `tStmt.%Prepare(.pQuery, 0)`; `irislib/%SQL/Statement.cls:513-519`: `checkPriv` 0 skips prepare-time checks, default 1 | Added by Story 38.5 (`06b1b209`); its spec records the choice as parity with `action/query` (`spec-38-5-sql-write-safety.md:716`) |
| Atelier's `action/query` also prepares with checking off | ✓ `irislib/%Api/Atelier/v1.cls:691` and `v6.cls:236` `%Prepare(tQuery.query,0)` | **New to this pass.** Fixing our route does not close this one; see §6, conflict C-1 |
| Only one caller of the SQL route | ✓ `/dev/sql/execute` is called only by `packages/iris-dev-mcp/src/tools/sql.ts` (plus tests and the fake listener) | Every other IRIS-side `%Prepare` already uses the default `checkPriv` 1 |
| Bootstrap never reads the preset | ✓ `packages/shared/src/bootstrap.ts` has no reference to a preset; all five servers pass `needsCustomRest: true` (`packages/iris-*-mcp/src/index.ts`), and `server-base.ts:2979` and `:3241` call `bootstrap()` unconditionally | |
| What the install creates | ✓ `Setup.ConfigureMapping` creates `%ALL` (on `%DEFAULTDB`/`IRISLIB`/`IRISTEMP`) when absent, then the `ExecuteMCPv2` package mapping; `EnsureUnitTestRoot` sets `^UnitTestRoot` when empty; the IPM manifest invokes `Configure` and `ConfigureMapping` (not `EnsureUnitTestRoot`) | Nothing records whether `%ALL` pre-existed |
| `Uninstall` removes only the web application | ✓ `src/ExecuteMCPv2/Setup.cls:103-119` | README `:371` documents what `zpm uninstall` leaves |
| The data policy reaches only the message tools | ✓ `dataPolicy` is read in five interop files only (`message-body.ts`, `message-search.ts`, `message-resend.ts`, `diagram.ts`, `monitor.ts`) | `tool_support.md` "PHI data policy scope" (as of 2026-10-17) already lists the raw tools as **residual**; README `:143` and PRD FR152 overstate the scope |
| `dataPolicy` and governance are per profile; visibility and the preset are per server/global | ✓ `profiles.ts:169,352-410` (`dataPolicy` on an `IRIS_PROFILES` entry, never inherited); `governance.ts:714` (preset from the environment only); AD-7 (visibility per server) | Decides 45.4's mechanism (judgment J-4) |
| The covered tools' default state | ✓ `iris_execute_command`, `iris_execute_classmethod`, `iris_execute_tests`, `iris_global_get`, `iris_global_list`, `iris_sql_execute`, `iris_transform_test` and `iris_task_run` are frozen-baseline keys (enabled by default); `iris_sql_query` is a new read (enabled); `iris_test_coverage` is a new write (disabled) | `baseline-classifications.ts`, `governance-baseline.ts`, `test-coverage.ts:1081` |
| `SECURITY.md` | ✓ It **exists** (Story 42.5) and already routes reports through GitHub private vulnerability reporting with no email address | Its scope paragraph conflicts with the trust model; see C-3 |

**Unverified claims, each probed first in its story:**

1. **45.1:** what a least-privilege account gets with `checkPriv` 1 for each statement type; which checks remain at execution time with `checkPriv` 0; whether a SELECT calling a `SqlProc` needs `EXECUTE` when checking is on; whether Atelier's `action/query` returns rows of an ungranted table to the same account.
2. **45.2:** that every request on the auto-install-off path is a read; that no tool reaches the custom REST service by a path other than the gateway's `/api/executemcp/v2` prefix.
3. **45.3:** how the package can be removed safely (a class should not delete itself while running); `%ALL` mapping enumeration and deletion (`Config.MapPackages`, `MapGlobals`, `MapRoutines`, `Namespaces`); whether a shadowed per-namespace copy reappears once the mapping is gone; where the install record lives so it survives class deletion; the working order for an IPM-owned install.
4. **45.4:** whether reusing `DATA_POLICY_BLOCKED` is better than `GOVERNANCE_DISABLED` plus an attribution field; the dispositions of the judgment-call tools.

**Issue type:** a gap between documented and actual safety behavior (points 1, 3), an IRIS-side defect in privilege handling (point 4), and a residual that cannot be fixed at the suite's layer and must be documented (point 2).

---

## 2. Impact Analysis

### Epic impact

- **No epic is in flight.** Epics 1–44 are `done`; `main` carries `v1.2.0` (`11d879d`). Nothing done is reopened.
- **Adds Epic 45** (5 stories) on `feature/feature-wave-10-security-boundaries`; 45.0 stays free for `/epic-cycle`'s retro-review gate.
- **No future epic is planned,** so no dependency on later work exists.

### Story impact

| Story | Scope (one line) | Size | Depends on | Key risk |
|---|---|---|---|---|
| **45.1** SQL Statements Honor SQL Privileges | `checkPriv` 1 on the SQL route, no off-switch; probe the privilege model; prove refusal → grant → rows on a throwaway | **M** (one IRIS-side line, a bootstrap regen, a least-privilege throwaway user, probes) | — | Atelier's own `action/query` stays unchecked (C-1) |
| **45.2** Auto-Install Setting, Off Under Read-Only | `IRIS_AUTO_INSTALL` + per-profile `autoInstall`; read-only forces it off; the conflict fails fast; a gateway refusal for custom-REST calls on a missing/stale/unconfigured IRIS side | **L** (config, profiles, every bootstrap branch, the gateway, discovery fields, the start-path proof) | — | Every read-only-only deployment refuses after upgrading to `1.3.0` (C-2) |
| **45.3** Careful Uninstall of the IRIS Side | An IRIS-side install record; an uninstall that removes only what the install created; a convergence round trip on a throwaway | **L** (IRIS-side, five probes, multi-namespace and IPM edges) | 45.2 (docs: auto-install off keeps a removed instance removed) | `%ALL` is instance-wide; a wrong check deletes another user's mapping |
| **45.4** Block Turns Off Raw-Read and Code-Execution Tools | A `block` seed layer in the AD-6 cascade; the declared covered set with a mechanical cross-check; the startup warning | **M** (one engine layer, discovery attribution, a cross-package test) | — | The covered set's edges (J-5) |
| **45.5** What the Safety Settings Protect | The README trust-model section, links from five READMEs and the governance docs, `SECURITY.md`, `tool_support.md`; assembles the capstone | **M** (docs rollup plus the capstone) | 45.1–45.4 | Docs drifting from the covered set (guarded) |

**Why this order** (45.1 → 45.2 → 45.3 → 45.4 → 45.5, as the Planner proposed): 45.1 is the smallest change with the widest effect; 45.3's docs depend on 45.2's setting to keep an uninstalled instance uninstalled; 45.3 owns the install record because it lives in the IRIS-side `Setup` class that the uninstall reads (45.2 does not need it), so 45.3 does not depend on 45.2's code; 45.4 is independent; 45.5 closes. **No change to the proposed cut.**

### Artifact conflicts

- **PRD:** FR152 overstates the policy's scope → amended (§4.4). FR9 gains the auto-install exception. The Security NFR "Governance is additive … never disables a capability users have today" conflicts with decision (4) → a sanctioned exception is recorded in place. New FR163–FR166. No MVP change.
- **Architecture** (the spine; `architecture.md` defers to it): AD-6 (the `block` seed layer; the preset's auto-install effect), AD-8 (fail-fast for the new setting and the conflict), AD-9 (the new channel and per-profile safety control), AD-14 ("when", "governance", and the install record and uninstall), AD-15 (four Epic 45 entries), AD-19 (what the trail covers), AD-25 (SQL privileges; supersedes 38.5's parity note), AD-26 (what `redact` and `block` cover; the startup warning), AD-31 (the trust model). The frontmatter and the capability map move (§4.3).
- **epics.md:** Epic 45 appended (§4.1).
- **sprint-status.yaml:** the new keys through `generate`, and one action item for issue #1 (§4.2).
- **deferred-work.md:** no change; the issue is tracked by the action item.
- **UX:** no UX document. The launcher extension is not changed (J-7).
- **Docs in the stories:** `README.md`, the five server READMEs, `SECURITY.md`, `tool_support.md`, `docs/client-config/*.md`, `CHANGELOG.md` and changesets.

### Technical impact

- **Bootstrap:** 45.1 (`REST/Sql.cls`) and 45.3 (`Setup.cls`) move `BOOTSTRAP_VERSION` from `1.2.0+5.6cbac260e73f` (Rule #24). The IPM tree is stamped only by the `1.3.0` version step (Rule #18).
- **Governance and visibility:** no new tool, action or key; `GOVERNANCE_BASELINE` stays frozen (`1e62c5ad5bf7`/141); presets and `TOOL_PAIRS` are untouched. 45.4 adds a seed layer and a `configSource` value, not keys (AD-5, AD-6, AD-7).
- **Wire:** three sanctioned changes and one documented-method change (§4.3(e)). Additive fields: per-profile `autoInstall` and its source in `iris_server_profiles`; a data-policy attribution on governance denials. One new refusal code (45.2) joins the catalog.
- **Shared instance:** never stopped; no uninstall, user, role, grant or `%ALL` change there. Those proofs run on throwaways.
- **Release:** one `1.3.0` (minor) at the end; the Planner raises the changesets' bump.

---

## 3. Recommended Approach

**Direct adjustment:** add Epic 45 with five stories. Nothing is rolled back and the MVP is unchanged.

- **Option 1, direct adjustment:** viable. Effort medium-high (2 L, 3 M). Risk medium, concentrated in 45.3 (instance-wide `%ALL`) and 45.2 (upgrade behavior for read-only users).
- **Option 2, rollback:** not viable. Reverting Story 38.5's `checkPriv` 0 alone would undo its safety work; the other points are missing features, not regressions.
- **Option 3, MVP review:** not applicable.

**Epic-done gate (Rule #21):** `packages/iris-mcp-all/src/__tests__/epic45-capstone-gate.test.ts`, default suite, built by 45.5: issue #1's four points replayed against the built dist servers through the real SDK client (block denials, re-enable and warning; the README residual statements as a doc-rot guard; read-only start sends no write and refuses custom-REST calls; the SQL privilege mode on the request path), each proven red by reverting its story's guard, plus one armed CI run of the wave tip for the IRIS-side halves (45.1's refusal for an ungranted account, 45.3's install → uninstall → leftovers-clean round trip).

**Risks:**

1. **45.2 breaks read-only-only deployments at upgrade.** 45.1 and 45.3 move `BOOTSTRAP_VERSION`, so every instance that only read-only servers touch finds a `stale` IRIS side at its first `1.3.0` start, and its custom-REST tools refuse until someone upgrades it once. The decision text names "read-only users on a fresh instance"; this is wider (C-2).
2. **45.3 touches instance-wide configuration.** `%ALL` and the web application serve every namespace. A wrong "created by us" or "empty" check removes another user's configuration. Mitigations: fail-safe without a record, a seeded foreign-`%ALL` mutation proof, throwaway only.
3. **45.1 leaves Atelier's `action/query` unchecked.** A `%Development` account reaches it directly. The docs must say so, or the README's "SQL grants apply" overclaims (C-1).
4. **45.4's covered set is a judgment boundary.** A tool left residual is a documented hole under `block`; a tool covered needlessly costs `block` users a capability. The owner's six are the floor; the rest is decided at the spec gate (J-5).
5. **The startup warning reaches every default user** of the dev server (`redact` is the default, and the dev server has the covered tools), on every start. It is stderr, not wire, and the owner asked for it; it is noted so nobody is surprised.
6. **The SECURITY.md scope changes** what the project promises to treat as a vulnerability (C-3).

---

## 4. Detailed Change Proposals

### 4.1 — `epics.md` — append Epic 45 (APPLIED in the worktree, uncommitted)

**OLD:** end of file, after Story 44.8's last bullet ("…so a workspace file may direct a stored password to its own host. Probe first; fix with the same user-scope rule, or close with evidence.").

**NEW:** the section `## Epic 45: Security Boundaries (added 2026-11-24)` through the end of the file, with Stories 45.1–45.5. It is drafted in place in `_bmad-output/planning-artifacts/epics.md`, its single copy, and deliberately not duplicated here. It follows Epic 44's format: Runs on, Goal, Context (with the issue-point → story → decision table), Ordering, Shared by every story, the Epic-done gate, Out of scope; per story a user-story sentence, `**AC 45.N.M** —` criteria (probe items marked), a back-compat AC with a mechanical proof (Rule #19), a live or mutation proof on the guarded path (Rules #48/#59), minimal docs (Rule #43), the optional reporter evidence where it applies, and a closing issue/decision bullet.

### 4.2 — `sprint-status.yaml` (APPLIED through the sanctioned writers)

**(a) Keys,** through `sprint_plan.py generate` (no `--set`, `--date 2026-11-24`), in the same commit as §4.1.

OLD (end of `development_status`):

```yaml
  44-8-local-resolver-hands-a-password-only-to-user-scoped-servers: done
  epic-44-retrospective: optional
action_items:
```

NEW:

```yaml
  44-8-local-resolver-hands-a-password-only-to-user-scoped-servers: done
  epic-44-retrospective: optional

  epic-45: backlog
  45-1-sql-statements-honor-sql-privileges: backlog
  45-2-auto-install-setting-off-under-read-only: backlog
  45-3-careful-uninstall-of-the-iris-side: backlog
  45-4-block-turns-off-raw-read-and-code-execution-tools: backlog
  45-5-what-the-safety-settings-protect: backlog
  epic-45-retrospective: optional
action_items:
```

**(b) Action item for issue #1,** through BMAD's writer (`sprint_status.py update --add-action`, then `--set-action-status`):

```yaml
  - id: "epic-45-trigger-item-1-github-issue-1-security-boundaries"
    epic: 45
    action: "Deliver Epic 45 (Security Boundaries) for GitHub issue #1, the external
      security report on commit 9a2f5150: SQL privilege checking on (45.1), auto-install
      off under read-only (45.2), careful uninstall (45.3), block turns off raw-read
      and code-execution tools (45.4), the trust-model docs and SECURITY.md (45.5);
      close the issue at the 1.3.0 release"
    owner: "build"
    status: in-progress
    ref: "https://github.com/jbrandtmse/iris-execute-mcp-v2/issues/1"
```

**Why `in-progress`:** `/epic-cycle`'s X.0 gate default-includes every **open** action item. Epic 45's stories own this one, as Epic 44's chartered items were owned (2026-11-22 precedent). It moves to `done` at the `1.3.0` release, when issue #1 is closed. **Owner `build`** as the Planner specified; every earlier item uses `user` (J-9).

### 4.3 — Architecture spine (`architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md`) (APPLIED)

Each amendment is tagged *(lands in Story 45.N)* or with its decision, per the spine's own convention. The full text is in the file; summaries:

- **(a) Frontmatter.** `updated: '2026-11-22'` → `'2026-11-24'`; `binds: ['FR1-FR162', 'Epics 38-44']` → `['FR1-FR166', 'Epics 38-45']`.
- **(b) AD-6.** Under the `read-only` preset: it also turns the automatic install off, as an operator setting, not a key. New bullet "The `block` data-policy seed" (45.4): the cascade becomes `env.profile ?? env.global ?? file.profile ?? file.global ?? inheritedDisable ?? dataPolicySeed ?? presetSeed ?? defaultSeed`; above the preset (so `iris_sql_query` turns off), below the explicit layers (so an explicit `true` wins); never inherited by a child key; `configSource: "dataPolicy"` and an attribution field; no key added.
- **(c) AD-8.** New "The automatic install" failure-semantics bullet: a malformed value fails fast; explicit "on" with `read-only` fails fast naming both.
- **(d) AD-9.** `autoInstall` joins the per-profile safety controls; its channels are `IRIS_AUTO_INSTALL` and the `IRIS_PROFILES` field, never the governance file; default on, forced off by `read-only`.
- **(e) AD-14.** "when": only with the automatic install on; the off path only reads; the gateway refuses `/api/executemcp/v2` on `missing`/`stale`/`unconfigured`; other branches and IPM unchanged. "governance": the preset acts through the setting, not a key. New "The install record and the uninstall" bullet (45.3).
- **(f) AD-15.** A new "Epic 45" entry with `S-45.1-sql-privileges`, `S-45.2-read-only-no-install` (stating the upgrade reach, C-2), `S-45.3-careful-uninstall` and `S-45.4-block-raw-tools`.
- **(g) AD-19.** "What it covers": tool calls through the servers only; direct REST calls are IRIS auditing's.
- **(h) AD-25.** New "SQL privileges" bullet (45.1), superseding Story 38.5's parity note, and naming the Atelier `action/query` residual.
- **(i) AD-26.** New "What `redact` and `block` cover" bullet (45.4, 45.5), with the startup warning.
- **(j) AD-31.** New "The trust model" bullet (45.5), including the vulnerability-scope sentence that `SECURITY.md` will carry.
- **(k) Capability map.** New row "Security boundaries (Epic 45)".

`lint_spine.py` reports 0 findings before and after (§Application record). `architecture.md` is not changed: the spine is the decision registry.

### 4.4 — `prd.md` (APPLIED)

- **FR9.** Appends ", unless the profile's automatic install is off (FR164)".
- **FR152.** Appends a dated scope statement: "governs" means the governed message tools; the raw-read and code-execution tools and Event Log text under `redact` are outside it and documented; under `block` those tools are off (FR166).
- **New block "Epic 45 — Security Boundaries (added 2026-11-24)"** after FR162: FR163 (SQL privileges), FR164 (automatic install), FR165 (careful uninstall), FR166 (`block` turns off the raw tools; the startup warning).
- **Security NFRs.** "Governance is additive" gains the sanctioned `block` exception; a new "The trust model" bullet.

### 4.5 — Not changed by this proposal (by design)

- Code, the bootstrap embed, `GOVERNANCE_BASELINE`, presets, tool arrays, `SECURITY.md`, the READMEs and `tool_support.md`: every change there belongs to its story.
- `deferred-work.md`: the issue is tracked by the action item.
- `.claude/` rules and `CLAUDE.md`: agents never edit them.

---

## 5. Implementation Handoff

**Scope classification:** Moderate. The route is the PO/Dev pipeline through `/epic-cycle`.

**Recipient:** the `/epic-cycle` orchestrator runs **Epic 45** on `feature/feature-wave-10-security-boundaries`, epic branch `epic45`; at the SC-1 prompt it names that wave branch.

**Done in the worktree (uncommitted):** §4.1, §4.2(a)(b), §4.3, §4.4, and this proposal. The Planner reviews and commits; §4.1 and §4.2(a) in one commit.

**Planner and owner actions:**

- review this proposal and the judgment calls (§6) and conflicts (§7), and raise C-1 to C-3 with the owner where needed;
- confirm 45.4's covered set at its spec gate (J-5);
- approve the single `1.3.0` release; close issue #1 and set the action item to `done` at release;
- optionally, ask the reporter for his probe class and calls (evidence for 45.1, 45.4 and the capstone; never a dependency).

**Success criteria:**

- the tracker is in sync: `generate` reported 0 dropped orphans; `validate` and `check-epics-sync` pass;
- 45.1: an ungranted least-privilege account is refused through the tool on the live route, gets rows after `GRANT`, and `%All` is byte-identical; proven red with `checkPriv` 0;
- 45.2: a read-only start against a fake IRIS with no IRIS side sends zero write requests through the real start path; proven red by removing the preset check; live, a read-only server changes nothing on a throwaway;
- 45.3: install → uninstall → snapshot equals the pre-install snapshot on a throwaway, with a seeded foreign `%ALL` and a pre-set `^UnitTestRoot` surviving; proven red by removing the "created by us and empty" check;
- 45.4: under `block` every covered key is denied with its attribution through the call path, an explicit re-enable wins and is named in the warning; proven red by removing the seed layer; `gen:governance-baseline:check` green;
- 45.5: the capstone is green in the default suite, each point proven red, and one armed CI run of the wave tip is green and recorded.

---

## 6. Judgment calls made in this pass

Each is where the decisions left room; each is recorded in the story text so the spec gate can revisit it.

- **J-1, value syntax.** `IRIS_AUTO_INSTALL` takes `true`/`false` (case-insensitive), not `on`/`off`, matching `IRIS_SQL_READ_ONLY` and `IRIS_HTTPS`; empty means unset; malformed fails fast.
- **J-2, per-profile channel.** `IRIS_PROFILES` supports per-profile safety settings (`dataPolicy` precedent, `profiles.ts:169,352`), so `autoInstall` is a per-profile field, never inherited from `default` (AD-9). The governance file is **not** a channel, because the preset is environment-only; Server Manager profiles take the variable.
- **J-3, where the refusal lives.** In the one gateway (AD-1), keyed on the `/api/executemcp/v2` prefix per profile, so no tool needs a per-tool flag; a new stable refusal code (name chosen by 45.2, e.g. `IRIS_SIDE_NOT_INSTALLED`); `iris_server_profiles` gains the effective `autoInstall` and its source as additive fields.
- **J-4, block mechanism: governance, not visibility.** `IRIS_TOOLS_ENABLE` is visibility, which is per server and never a safety control (AD-7); `dataPolicy` and governance are both per profile. So `block` is a seed layer in the AD-6 cascade, and "explicit re-enable" means an explicit `true` in `IRIS_GOVERNANCE` or the governance file. It sits above the preset seed so `block` turns off `iris_sql_query` under `read-only` too. This resolves the "per-profile vs per-server" question in decision (4): enablement follows the profile's effective policy.
- **J-5, the covered set beyond the owner's six.** Recommended **covered**: `iris_execute_tests`, `iris_test_coverage` (run test-class code), `iris_transform_test` (runs DTL code on a message and returns the result), and `iris_docdb_document:get`/`iris_docdb_find` (raw reads of stored documents). Recommended **residual**: `iris_task_run` (runs existing task code, no caller code), `iris_analytics_mdx`, `iris_lookup_manage:get`, `iris_lookup_transfer`, `iris_sql_analyze`, `iris_test_status`, the document-source tools, `iris_audit_events`, and the compile/load writes (which can run generator code but are writes the read-only preset already governs). Decided at 45.4's spec gate; the owner's six are the floor. Note `iris_global_list` is in the owner's set but not in `tool_support.md`'s residual table today; 45.4 adds its row.
- **J-6, the warning's shape.** At most one `[WARN]` line per server process, grouped per profile; it names only callable tools (visible and enabled), so a hidden tool is never named (AD-7); under `block` it lists only explicit re-enables, which is the "logged" requirement.
- **J-7, no launcher setting.** `IRIS_AUTO_INSTALL` passes through from the environment, as `IRIS_DATA_POLICY` does (`extensions/iris-mcp-launcher/src/env.ts`); a launcher setting would need a new vsix. A launcher user with `governancePreset: read-only` and an ambient `IRIS_AUTO_INSTALL=true` gets the startup conflict error.
- **J-8, uninstall without a record, and IPM-owned uninstall.** Without a record (any install by `1.2.0` or earlier), `%ALL` and `^UnitTestRoot` are left and reported with the manual commands (fail safe). With `InstallGuard` present, our uninstall removes the configuration only and says to run `zpm uninstall` for the classes, in the order the probe confirms. The install record is written by the IRIS-side `Setup` methods, so the IPM path records too; it belongs to 45.3, not 45.2.
- **J-9, action item owner `build`.** As the Planner specified; all eleven earlier items use `user`, and the writer accepts any string. Status `in-progress` keeps it out of the 45.0 gate.
- **J-10, capstone placement.** Assembled by 45.5 (the closing story) in `packages/iris-mcp-all`, default suite, with the IRIS-side halves in one armed CI run, as Epic 44's gate did.
- **J-11, ordering edge in 45.1.** With checking on, an ungranted non-SELECT on a read-only path fails at prepare with the privilege error instead of `SQL_READ_ONLY`; recorded as part of `S-45.1-sql-privileges` (nothing runs either way).

---

## 7. Conflicts with existing ADs, rules or behavior (for the Planner to raise)

- **C-1. Atelier's `action/query` bypasses SQL privileges too.** `%Api.Atelier.v1:691` and `v6:236` prepare with `checkPriv` 0, and the Atelier web application is reachable with the same `%Development` account. Decision (1) closes our route, but "SQL grants apply" is only true for the suite's SQL tools: the same account can read an ungranted table through Atelier directly, and through the command route's ObjectScript (bounded by database resources, not SQL grants). 45.1 probes it and 45.5 states it; the owner may want the README to lead with "database resources are the data boundary for a `%Development` account" rather than SQL grants.
- **C-2. "Read-only users on a fresh instance" is wider in practice.** Decision (2) sanctions the change for fresh instances, but "stale → refuse, never run old classes" also hits every read-only-only deployment at its first `1.3.0` start, because Epic 45 moves `BOOTSTRAP_VERSION` (and every later release that changes a class will do it again). Recorded in `S-45.2-read-only-no-install` and the CHANGELOG note; the owner may prefer an explicit upgrade note in the release text, or confirm the wider reach.
- **C-3. `SECURITY.md` already exists and promises the opposite scope.** It was added in Story 42.5 (AD-29); its scope says "a way around the governance controls of the servers … is in scope", which reads as if a direct REST call with the same account were a vulnerability. Decision (5)'s trust model makes that by design. 45.5 rewrites the paragraph (in scope: getting past a control through the servers' tools; not: using the account directly). This narrows a published promise; the owner should see the wording.
- **C-4. IPM-owned stale installs still run old classes.** Decision (2) says both "never running old classes" and "IPM-owned installs unchanged". With `InstallGuard` present and an older IPM version, today's behavior (warn, and tools call the older classes) is kept in both modes. If the owner meant the refusal to apply to IPM-owned stale installs too, 45.2's AC changes.
- **C-5. PRD Security NFR "Governance … never disables a capability users have today".** Decision (4) does exactly that under the opt-in `block`; recorded as a sanctioned exception in place (§4.4), but it is a change to a release-gate sentence.
- **C-6. AD-14 "Bootstrap is never a governed action".** The preset now changes bootstrap; the spine reconciles it by routing the effect through the automatic-install setting, not a governance key (§4.3(e)). No conflict remains, but the wording moved.
- **C-7. The `zpm uninstall` hand-back.** README `:367` says `zpm uninstall` hands the namespace back to the server's automatic install; with the automatic install off that no longer happens. 45.2 updates the line.

---

## Appendix — Change navigation checklist (record)

| # | Item | Status | Note |
|---|---|---|---|
| 1.1 | Triggering story | [x] | No story; GitHub issue #1 (external report on `9a2f5150`), verified by the Planner against `1.2.0` |
| 1.2 | Core problem | [x] | §1: documented safety behavior wider than actual (points 1, 3), an IRIS-side privilege defect (4), an unfixable residual to document (2) |
| 1.3 | Evidence | [x] | §1 table, re-checked in source; IRIS runtime claims **[!] unverified** here and probed first in each story |
| 2.1 | Current epic viable | [N/A] | No epic in flight |
| 2.2 | Epic-level changes | [x] | Add Epic 45 |
| 2.3 | Future epics | [N/A] | None planned |
| 2.4 | Obsolete or new epics | [x] | 1 new; none obsolete |
| 2.5 | Order and priority | [x] | 45.1 → 45.2 → 45.3 → 45.4 → 45.5, as proposed; reasons in §2 |
| 3.1 | PRD conflicts | [!] | FR152 and FR9 amended, the Security NFR exception, FR163–FR166 (§4.4). MVP unaffected |
| 3.2 | Architecture conflicts | [!] | AD-6, 8, 9, 14, 15, 19, 25, 26, 31, frontmatter, capability map (§4.3) |
| 3.3 | UX | [N/A] | No UX document; the launcher is unchanged (J-7) |
| 3.4 | Other artifacts | [!] | `sprint-status.yaml` (§4.2); `check-epics-sync` CI gate (one commit); `SECURITY.md`, READMEs, `tool_support.md` in the stories |
| 4.1 | Direct adjustment | [x] Viable | Effort medium-high, risk medium |
| 4.2 | Rollback | [x] Not viable | Points are missing features, not regressions |
| 4.3 | MVP review | [N/A] | MVP unchanged |
| 4.4 | Path selected | [x] | Direct adjustment |
| 5.1–5.5 | Proposal components | [x] | §1–§5 |
| 6.1 | Checklist complete | [x] | This table |
| 6.2 | Proposal accuracy | [x] | Line references checked 2026-11-24 in the worktree at `11d879d` |
| 6.3 | User approval | [~] | Decisions (1)–(6) approved by the owner 2026-11-24; final proposal approval pending the Planner's review |
| 6.4 | Tracker update | [x] | Applied 2026-11-24 through `generate` and BMAD's writer |
| 6.5 | Next steps | [x] | `/epic-cycle 45` on `feature/feature-wave-10-security-boundaries` |

---

## Application record (2026-11-24)

Applied in the `feature/feature-wave-10-security-boundaries` worktree. Nothing is committed; the Planner commits.

- **§4.1, `epics.md`:** the Epic 45 section is appended (208 lines).
- **§4.2(a), `generate`** (no `--set`, `--date 2026-11-24`): 45 epics and 250 stories; `new_entries` is exactly `epic-45`, the five 45.x keys and `epic-45-retrospective`; `dropped_orphans: []`, `changed: 0`, `illegal: []`, `preserved: 333`. It also rewrote `last_updated`, which the writer below then set to `11-24-2026 12:00`.
- **§4.2(b), the writer:** `--add-action` (`action_items_added: 1`), then `--set-action-status` to `in-progress` (`action_items_updated: 1`).
- **§4.3, the spine:** applied as summarized; `lint_spine.py` reports `total_findings: 0` on both the original and the amended spine.
- **§4.4, the PRD:** applied as summarized.
- **Verification:**
  - `sprint_plan.py validate`: `valid: true`, `problems: []`;
  - `node scripts/check-epics-sync.mjs`: OK, 250 keys and 250 sections, 0 genuine drift, 0 orphans, 0 duplicates;
  - `pnpm gen:governance-baseline:check`: not run; only planning artifacts changed.
