# Sprint Change Proposal — 2026-11-22 (Epic 44: correctness and safety fixes)

**Trigger:** Epic 42's close. Its decision sheet (wave-8 decision #130, `orchestrator-decisions-wave-8.md`) turned five real defects into `sprint-status.yaml` action items, "charter a story in the next planned epic", because no Epic 44 existed: DW-670, DW-684, DW-685, DW-688 (high priority) and DW-721 (due before February 2027).

**Facilitator:** correct-course (drafting agent) · **Owner:** Project Lead

**Mode:** Batch · **Scope classification:** **Minor to Moderate.**
- It is Minor in substance: five independent fixes to shipped behavior, with no new tool, no MVP change and nothing rolled back.
- It is Moderate in mechanics: it adds a new epic and amends three spine ADs and one PRD line.

**Approval:** **APPROVED 2026-11-22** by the owner. The scope (these five, nothing else) was approved earlier the same day. The answers to Q-1 to Q-3 are in the [Approval](#approval-2026-11-22) section below.

**Applied 2026-11-22:** §4.1, §4.2(a)(b)(c), §4.3 and §4.4, adjusted for the owner's answers. The results are recorded in [Application record](#application-record-2026-11-22). The changes are uncommitted; the Lead commits. §4.1 and §4.2(a) must land in **one commit**, because `check-epics-sync` is a CI gate (Story 42.3).

---

## Approval (2026-11-22)

The owner approved the proposal on 2026-11-22, relayed by the coordinator.

- **Q-1, order: approved as drafted.** 44.1 → 44.2 (VS Code) → 44.3 → 44.4 → 44.5.
- **Q-2, the 44.0 gate: approved as recommended, with one correction.** `epic-42-retro-item-9-…` (DW-716, the `npm deprecate` of `0.0.0-stage`) is **done**. The owner ran it, and the coordinator verified on the registry that all 8 packages' `0.0.0-stage` versions are deprecated with "placeholder created at first publish; use 1.x", and that `1.1.0` is still `latest`.
  - **Done:**
    - `epic-38-retro-item-1-…` (DW-538, declined);
    - `epic-41-decision-sheet-item-1-…` (DW-615), `epic-42-retro-item-5-…` (DW-678) and `epic-42-retro-item-10-…` (DW-717), all by commit `0e7bff1a`, which the owner approved;
    - `epic-42-retro-item-9-…` (DW-716).
  - **Stays open:** only `epic-43-decision-sheet-item-1-…` (the VS Code Copilot dialog run). It is explicitly **deferred out of Story 44.0** as an owner action, to be paired with Story 44.2's re-certification sitting.
- **Q-3, the release: no early release.** There is **one release at the end of the epic**, even if that is close to the February 2027 deadline. Every AC, handoff and epic line that planned a release after 44.2 was removed or adjusted. The resulting deadline risk is risk 6 in §3.

---

## 1. Issue Summary

Five defects shipped in `1.1.0`. Each was found by an Epic 42 review layer and escalated, and none could be fixed inside its story's footprint.

| DW | Severity / fix-risk | What is wrong | Who notices |
|---|---|---|---|
| **DW-688** | med / high, **high priority** (owner) | `iris_docdb_manage create` makes a database that every other DocDB call rejects with `ERROR #822` on IRIS 2026.2, because the REST create registers no `Security.DocDBs` record | A data engineer, on the first call after `create` (FR100–FR103 are broken end to end) |
| **DW-721** | med / med, **deadline before 2027-02-01** | The `vscode` adapter writes `.vscode/mcp.json` and the profile `mcp.json`. VS Code deprecates the Local harness that reads them and removes it in February 2027. New Copilot setups belong in `~/.copilot/mcp-config.json` (`COPILOT_HOME`) and a workspace-root `.mcp.json`, both keyed `mcpServers` | Every VS Code user of the CLI or the extension's MCP Clients view, after the removal |
| **DW-670** | med / high (safety) | On a client that answers the dialog in a second request, `iris_env_promote` execute re-runs its Storage preflight in the accepting round and writes the drops that round finds. The confirmation state binds only the tool and the argument hash (AD-34), so drops that appeared during the dialog are written unseen | A person who confirmed one scope and got another |
| **DW-685** | med / high | `bootstrap()` reports `compiled: true` whatever the compile says. `General.Compile` answers HTTP 200 when only some classes fail | An operator, later, as a 404 or 500 from a tool |
| **DW-684** | med / med (test gap) | Armed integration suites can go green without testing. Guard returns (`interop.integration.test.ts:204,219,239`, `if (!created.production) return;`) report "passed" after a create test that tolerates `isError` | A maintainer trusting a green armed CI run |

**Evidence re-checked against the source on 2026-11-22 (Rules #14/#47).** The checks were read-only: no IRIS call was made, and the local `irislib/`/`irissys/` snapshot is absent from this worktree.

| Claim | Verified | Note |
|---|---|---|
| DocDB create is a bare REST POST | ✓ `packages/iris-data-mcp/src/tools/docdb.ts:308-325` posts `/api/docdb/v1/{ns}/db/{name}` with `{}`; no custom handler exists (`docdb.ts:10-12`) | The IRIS side (`%Api.DocDB.v1:299-313`, `CheckAccess^%SYS.DOCDB`, `Ens.Setting.Report.base:629`) is **unverified here**, but was reproduced live in Story 42.3's rework (`spec-42-3-ci-workflow.md:46,334`) |
| `DOCDB_SKIPS` depends on the missing record | ✓ `scripts/lib/ci-checks.mjs:151-169` | 44.1 and 44.5 interact here |
| The `vscode` adapter targets the Local-harness files | ✓ `packages/client-config/src/adapters.ts:158-202`: `rootKey: "servers"`, user `…/Code/User/mcp.json`, project `.vscode/mcp.json`, `envExpansion: "vscode"` (`${env:VAR}` and `inputs`) | `claude-code`'s project scope is **also** `.mcp.json` (`adapters.ts:35-39`), so the new workspace target is a file shared by two adapters |
| The extension reaches client-config through the CLI | ✓ `extensions/iris-mcp-launcher/src/clientsEngine.ts:3-25` (`npx -y -p @iris-mcp/client-config@1`) | An npm release may be enough to reach extension users |
| The confirmation decides before re-resolving the scope | ✓ `packages/shared/src/server-base.ts:2125-2170`. Step 1 honors an echoed state on tool plus `argsHash` alone; `scope` is resolved only when a new question is minted | The ledger's `:2133-2143` is close to current |
| Promote re-runs the preflight every round | ✓ `env-promote.ts:1319` (`preflightClassSteps`) → `planned` → `promotionScope(…, planned)` at `:1343-1347` | |
| Six gates, one helper | ✓ six `ctx.confirm?.(` sites: `audit.ts:387`, `env-promote.ts:1343`, `production.ts:223`, `message-resend.ts:565` and `:644`, `doc-edit.ts:582` | Matches AD-34's "As built" set |
| Bootstrap ignores the compile envelope | ✓ `compileClasses` returns it (`bootstrap.ts:428-436`), and both call sites drop it and set `compiled = true` (`:877-878`, `:919-920`) | The ledger's `:746,788` are stale line numbers |
| Guard returns in armed suites | ✓ and **wider than the ledger names**. In `*.integration.test.ts` there are 15 `if (…) return;` guards (data 3, interop 8, ops 4) and 33 `result.isError` conditionals (admin 22, interop 10, ops 1). The `iris-mcp-all` live-gate files have more `if (…) return;` lines, which are to be classified | The ledger names interop and admin only |

**Unverified or contradicted claims embedded in the suggested fixes (each story probes first):**

1. **DW-685 — contradicted by Story 42.3's own review.** The action item says to "read the Atelier compile envelope (status and error fields)". 42.3's review found that `General.Compile` *replaces* the compile status with the status of the documents it updated (`irislib/%Atelier/v1/Utils/General.cls`). A partly failing compile then answers HTTP 200 with **no** status error, and the failure is **only in the console**; real documents carry no `errors` (`spec-42-3-ci-workflow.md:464,478`). If that holds, the envelope fields cannot detect the defect. AC 44.4.1 settles it live, and AC 44.4.2 lists oracles that read no localized text: a dictionary query, or an up-to-date check.
2. **DW-721 — the ledger overstates the docs.** As read on 2026-11-22, VS Code removes the **Local harness**, not necessarily the files:
   - the Copilot harness "doesn't read those files directly", but **forwards** eligible definitions from `.vscode/mcp.json`, profile configurations and extension-provided definitions, except those needing `${input:…}` or `${command:…}`;
   - the docs give no Windows path for `~/.copilot/mcp-config.json`;
   - they gate only the *guided setup* of a workspace `.mcp.json` behind the experimental `chat.mcp.workspaceRootConfig.enabled`;
   - they don't say which file wins on a name conflict.

   The portable format also has **no `inputs`, no `envFile` and no `${env:…}`**. So the vscode credential mode (native `inputs` password prompts) cannot carry over. Every one of these is **unverified in a real VS Code** and probed in AC 44.2.1.
3. **DW-688 — the IRIS API.** The signature and privilege of `$$Create^%SYS.DOCDB`, whether it needs `%SYS`, whether REST `DELETE` removes the record, and the version range are unverified in this pass. The snapshot is absent and the instance was not touched. They are probed in AC 44.1.1.
4. **DW-670 — the "bind a digest" fix is incomplete as worded.** `resendFiltered`'s scope text carries a live match count ("N message(s) match now"). A digest over the whole text would re-ask on a busy queue, possibly until the client's 10-round limit. AC 44.3.3 makes the bound and the per-gate binding value explicit.

**Sources for DW-721** (fetched 2026-11-22):

- [VS Code docs, MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration), page footer 11/18/2026. It covers the Local harness deprecation and February 2027 removal, the `$COPILOT_HOME/mcp-config.json` / `~/.copilot/mcp-config.json` and `.mcp.json` destinations, `mcpServers`, the forwarding rules, the portable schema, and `${NAME}` expansion.
- [GitHub Changelog, 2026-11-16: VS Code retires the Local harness in February 2027](https://github.blog/changelog/2026-11-16-vs-code-retires-the-local-harness-in-february-2027). It covers removal in February 2027 with a three-month transition, and the removal of the temporary enterprise setting with it. It says nothing about MCP files.
- [VS Code blog, 2026-11-18: Copilot harness](https://code.visualstudio.com/blogs/2026/11/18/copilot-harness), and [Choose an agent harness](https://code.visualstudio.com/docs/agents/run/agent-harnesses). Both were seen in search results only and not read in full.

**Issue type:** defects in shipped behavior (DW-688, DW-685, DW-670), a test-evidence gap (DW-684), and an external platform deprecation with a deadline (DW-721).

---

## 2. Impact Analysis

### Epic impact

- **No epic is in flight.** Epics 1–43 are `done` and `main` carries `v1.1.0`. Nothing in a done epic is reopened; each defect is fixed forward.
- **Adds Epic 44** (5 stories) on `feature/feature-wave-9-bug-fixes`. 44.0 is left free for `/epic-cycle`'s retro-review gate.
- **No future epic is planned,** so no dependency on later work exists.

### Story impact

No existing story changes. Five new stories:

| Story | Resolves | Size | Depends on | Key risk |
|---|---|---|---|---|
| **44.1** DocDB Create Registers the Database | DW-688 | **M**: a new IRIS-side route, bootstrap regen, a sanctioned description change, a live lifecycle on a throwaway | — | The registration's privilege, and the documentation fallback |
| **44.2** VS Code Copilot MCP Configuration Targets | DW-721 | **L**: adapter targets, format and env syntax, the credential mode, a file shared with `claude-code`, migration, extension text, re-certification | — (deadline) | Doc claims unverified; the shared `.mcp.json`; loss of `inputs` |
| **44.3** Confirmation Bound to the Scope Shown | DW-670 | **M**: one helper, six gates, both eras, a bounded re-ask | — | A re-ask loop on volatile scope text (`resendFiltered`) |
| **44.4** Bootstrap Compile Result Accuracy | DW-685 | **M** (fix-risk high) | — | No oracle without localized text may exist in the envelope (claim 1 above) |
| **44.5** Integration Suites Cannot Pass Without Testing | DW-684 | **M**, and may split at the spec gate (Rule #52) if the live-gate inventory is large | 44.1 (DocDB skip reason), 44.4 (seed consumers) | Newly honest suites going red on real product defects |

**Why this order differs from the suggested split.** The suggested split was 44.1 DocDB, 44.2 confirmation, 44.3 bootstrap, 44.4 guards, 44.5 VS Code. This proposal moves VS Code from fifth to **second** and guard returns to **last**:

- **VS Code moves up.** It is the only item with an external deadline, and the fix only helps once it is **released** before 2027-02-01. The owner chose a single end-of-epic release (Q-3), so the whole epic must finish in time. Doing the largest, least certain story second leaves the most room for its rework. Epic 42 ran about a month (2026-10-21 to 2026-11-22).
- **Guard returns move last.** They depend on 44.1 (`DOCDB_SKIPS`) and 44.4 (the CI seed's compile check), and their armed CI run is the epic-done evidence.

### Artifact conflicts

- **PRD:**
  - **FR162** says "the confirmation is bound to the exact arguments shown". 44.3 extends that to the scope shown → §4.4.
  - **FR100** has no conflict: it promises create and drop, and 44.1 makes create actually usable. An optional clarifying clause is in §4.4.
  - **FR141** lists `servers` among the root keys and names VS Code (Copilot). It is history, as the 2026-10-14 proposal decided for FR141's client count, and is not rewritten. 44.2 records the change in the client-config README and the certification table instead.
  - No NFR conflicts.
- **Architecture** (the spine, `architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md`; `architecture.md` defers to it):
  - **AD-34** "Binding to the call" and its As-built "Binding" → amend (44.3);
  - **AD-14** "on failure" → amend: a compile counts only on a non-localized check (44.4);
  - **AD-30** → new "Shared files" bullet (44.2);
  - the frontmatter's `binds: Epics 38-43` and `updated` move.

  No conflict with AD-12, AD-31 or AD-33: 44.1's route is thin, additive and authorized by IRIS. AD-23 (stdio only) is untouched, because DW-538 is out of scope. §4.3 has the text.
- **epics.md:** Epic 44 appended (§4.1, done in the worktree).
- **sprint-status.yaml:** the new keys come through `generate`, and five action items move to `in-progress` (§4.2).
- **deferred-work.md:** no change. The five entries are terminal (`dropped note=action_item`, decision #130), and the action items carry the work.
- **UX:** no UX document. The extension's MCP Clients view text changes in 44.2 only.
- **CI:** `check-epics-sync` must stay green, so §4.1 and §4.2(a) land together. 44.5 adds one gates-job step (and the step-equality self-test with it).

### Technical impact

- **Bootstrap:** 44.1 adds or changes an IRIS-side class, so `BOOTSTRAP_VERSION` moves in that story (Rule #24), from `1.1.0+2.244fe8623c76`. 44.4 moves it only if its oracle needs a `Setup` method. A new class joins both rosters (Rule #39). The IPM tree moves only at the release version step (AD-14).
- **Governance and visibility:** no new tool, action or key. `GOVERNANCE_BASELINE` stays frozen (`1e62c5ad5bf7`/141); Rules #28 and #53 don't fire.
- **Wire and text:** 44.1's description change and any 44.3 refusal-code addition are sanctioned AD-15 changes through the Frozen goldens convention. 44.3 changes the opaque `requestState` payload (`v: 1` → `v: 2`). States are per-process HMAC, so no cross-version state exists to honor.
- **Shared instance:** never stopped, and no service toggled. DocDB lifecycle and broken-compile proofs run on a throwaway.
- **Release:** the epic's single end-of-epic release (Q-3) must carry a published `@iris-mcp/client-config` (at least) before 2027-02-01. A new vsix is needed only if AC 44.2.5 finds extension code changes, and it would ship through DW-720's manual step.

---

## 3. Recommended Approach

**Direct adjustment:** add Epic 44 with five stories. Nothing is rolled back and the MVP is unchanged.

- **Option 1, direct adjustment:** viable. Effort is medium: 5 stories, 1 L and 4 M. Risk is medium, concentrated in 44.2's external claims and 44.4's oracle.
- **Option 2, rollback:** not viable. Each defect is in shipped `1.1.0` code whose removal would remove features (DocDB create, the VS Code adapter, elicitation).
- **Option 3, MVP review:** not applicable. The MVP is intact.

**Effort:** 5 stories plus the 44.0 gate.

**Timeline constraint:** the epic's one release, at its end (owner, Q-3), must ship before **2027-02-01**. No release happens after 44.2 alone.

**Risks:**

1. **44.4 may find no structured signal in the envelope** (claim 1). The fallback oracles are a dictionary query or an up-to-date check. If neither holds on every supported Atelier version, the story amends itself and records the residual risk.
2. **44.2's targets rest on documents dated 2026-11-16/18** about a platform still in transition. The probe in a real VS Code governs, and the shared `.mcp.json` needs an ownership rule (AD-30 amendment).
3. **44.3's re-ask must be bounded,** or a busy `resendFiltered` queue could loop to the client's round limit.
4. **44.5 may turn suites red** that were silently green. Product defects found that way are filed, not hidden, which can add work.
5. **44.1's registration privilege.** If IRIS requires more than the suite can rely on, the story falls back to documentation.
6. **The deadline under a single end-of-epic release (the owner's choice, Q-3, 2026-11-22).** The VS Code fix reaches users only when the whole epic is done and released. A slip anywhere in 44.3–44.5 therefore delays 44.2's fix too, and the release could land close to the February 2027 removal, or after it. The docs don't give an exact removal day. Two things lower the risk:
   - 44.2 runs second, so it is done early;
   - the old files are still forwarded to the Copilot harness until the removal (§1, claim 2).

   The owner accepted this risk.

**Approval questions for the owner** (each has a recommended default):

- **Q-1, order:** 44.1 → 44.2 (VS Code) → 44.3 → 44.4 → 44.5. *Recommended,* because of the deadline. The alternative is the suggested order, with VS Code last.
- **Q-2, the 44.0 gate:** other open action items remain in `sprint-status.yaml`, and `/epic-cycle` pulls every **open** one into Story 44.0 unless the owner explicitly defers it. *Recommended dispositions,* each recorded by the owner:
  - `epic-38-retro-item-1-…` (DW-538, HTTP transport): **done**, decided-declined 2026-11-22;
  - `epic-41-decision-sheet-item-1-…` (DW-615), `epic-42-retro-item-5-…` (DW-678) and `epic-42-retro-item-10-…` (DW-717): **done** by the owner's commit `0e7bff1a` (owner to confirm);
  - `epic-42-retro-item-9-…` (`npm deprecate` of `0.0.0-stage`) and `epic-43-decision-sheet-item-1-…` (the VS Code Copilot dialog run): **stay open**, explicitly deferred out of 44.0 as owner actions. The second one pairs naturally with 44.2's re-certification session, if the owner runs both together. *(Answered 2026-11-22: item 9 is done, since the owner ran the deprecate; only the dialog run stays open. See Approval.)*
- **Q-3, the release:** the Lead releases after 44.2 if the epic is not done by about 2027-01-15. *Recommended.* **Answered 2026-11-22: declined.** There is one release at the end of the epic (see Approval).

---

## 4. Detailed Change Proposals

### 4.1 — `epics.md` — append Epic 44 (DONE in the worktree, uncommitted)

**OLD:** end of file, after Story 43.4's last bullet ("…a sanctioned dedupe, or keep it as is. (ledger; routed by the Story 43.2 code review 2026-10-20)").

**NEW:** the section `## Epic 44: Correctness & Safety Fixes (added 2026-11-22)` through the end of the file, with Stories 44.1–44.5. It is drafted in place in `_bmad-output/planning-artifacts/epics.md`, which is its single copy. It is deliberately not duplicated here, so the proposal and the plan cannot drift. Review it there.

**Format:** it follows Epics 42/43:
- a goal, context, ordering, the wave's shared bullets, the epic-done gate, and out of scope;
- per story, a user-story sentence, `**AC 44.N.M** —` criteria, and a closing `DW-n (action item …; chartered by correct-course 2026-11-22)` bullet.

**Proof** (`sprint_plan.py generate --dry-run` against a scratch copy of the tracker, 2026-11-22): `new_entries` is exactly `epic-44`, the five keys in §4.2(a) and `epic-44-retrospective`; `dropped_orphans: []`, `changed: 0`.

### 4.2 — `sprint-status.yaml` (on approval, through the sanctioned writers only)

**(a) Keys,** through `sprint_plan.py generate` (no `--set`), in the same commit as §4.1.

OLD (end of `development_status`):

```yaml
  epic-43: done
  43-1-framework-migration-to-sdk-v2: done
  43-2-serve-mcp-revision-2026-07-28: done
  43-3-human-confirmation-through-elicitation: done
  43-4-sdk-v2-docs-smokes-and-capstone: done
  epic-43-retrospective: optional
action_items:
```

NEW:

```yaml
  epic-43: done
  43-1-framework-migration-to-sdk-v2: done
  43-2-serve-mcp-revision-2026-07-28: done
  43-3-human-confirmation-through-elicitation: done
  43-4-sdk-v2-docs-smokes-and-capstone: done
  epic-43-retrospective: optional

  epic-44: backlog
  44-1-docdb-create-registers-the-database: backlog
  44-2-vs-code-copilot-mcp-configuration-targets: backlog
  44-3-confirmation-bound-to-the-scope-shown: backlog
  44-4-bootstrap-compile-result-accuracy: backlog
  44-5-integration-suites-cannot-pass-without-testing: backlog
  epic-44-retrospective: optional
action_items:
```

Then rerun `sprint_plan.py validate` and `node scripts/check-epics-sync.mjs`. Both must pass.

**(b) Action items chartered,** through BMAD's writer (`sprint_status.py update --set-action-status`). The writer cannot edit `ref:` on an existing item, so the story mapping lives in each story's closing bullet in `epics.md`.

OLD (each of the five): `status: open`

NEW: `status: in-progress`, for:
- `epic-42-retro-item-4-charter-a-story-in-the-next-planned-epic` (DW-670 → 44.3);
- `epic-42-retro-item-6-charter-a-story-in-the-next-planned-epic` (DW-684 → 44.5);
- `epic-42-retro-item-7-charter-a-story-in-the-next-planned-epic` (DW-685 → 44.4);
- `epic-42-retro-item-8-charter-a-story-in-the-next-planned-epic` (DW-688 → 44.1);
- `epic-42-retro-item-11-charter-a-story-due-before-february-2027` (DW-721 → 44.2).

```text
uv run --no-cache .claude/skills/bmad-retrospective/scripts/sprint_status.py update \
  --file _bmad-output/implementation-artifacts/sprint-status.yaml --epic 42 \
  --set-action-status '[{"id":"epic-42-retro-item-4-charter-a-story-in-the-next-planned-epic","status":"in-progress"},{"id":"epic-42-retro-item-6-charter-a-story-in-the-next-planned-epic","status":"in-progress"},{"id":"epic-42-retro-item-7-charter-a-story-in-the-next-planned-epic","status":"in-progress"},{"id":"epic-42-retro-item-8-charter-a-story-in-the-next-planned-epic","status":"in-progress"},{"id":"epic-42-retro-item-11-charter-a-story-due-before-february-2027","status":"in-progress"}]'
```

**Why `in-progress`:** `/epic-cycle`'s X.0 gate default-includes every **open** action item. Without this, Story 44.0 would claim the same five items the five stories own. They move to `done` only at the Epic 44 retrospective, with the owner's confirmation (`epic-cycle.md`, X.0 step 8).

**(c) Owner dispositions from Q-2** (as answered 2026-11-22), through the same writer:
- `done` for `epic-38-retro-item-1-…`, `epic-41-decision-sheet-item-1-…`, `epic-42-retro-item-5-…`, `epic-42-retro-item-10-…` and `epic-42-retro-item-9-…`. The last was corrected at approval: the owner ran the deprecate;
- only `epic-43-decision-sheet-item-1-…` stays `open`. The owner explicitly deferred it out of 44.0, to pair with 44.2's re-certification.

### 4.3 — Architecture spine (`architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md`)

**(a) AD-34 — Prevents** (44.3)

OLD:
> - **Prevents:** a destructive write proceeding because the agent set `confirm: true` on its own, a decline that loops, and a confirmation that doesn't match the call it approved

NEW:
> - **Prevents:** a destructive write proceeding because the agent set `confirm: true` on its own, a decline that loops, and a confirmation that doesn't match the call or the scope it approved

**(b) AD-34 — Rule, "Binding to the call"** (44.3, DW-670)

OLD:
> - **Binding to the call.** A confirmation is bound to the exact arguments it showed: if they change between rounds, the helper asks again. Any `requestState` is integrity-protected and verified.

NEW:
> - **Binding to the call.** A confirmation is bound to the exact arguments **and the scope** it showed. If either changes between rounds, the helper asks again, showing the new scope, and never proceeds on the old answer. Re-asks are bounded, so a scope that changes on every round ends the call with a refusal instead of looping (Story 44.3). Any `requestState` is integrity-protected and verified.

**(c) AD-34 — As built, "Binding"**

OLD:
> - **Binding.** Through signed, single-use `requestState`: an HMAC codec with a per-process key and a 600 s TTL. The state covers the tool, the resolved profile and a hash of the validated arguments, plus a nonce consumed on the deciding round. Forged, replayed, expired or changed-argument state asks again.

NEW:
> - **Binding.** Through signed, single-use `requestState`: an HMAC codec with a per-process key and a 600 s TTL. The state covers the tool, the resolved profile and a hash of the validated arguments, plus a nonce consumed on the deciding round. *(Story 44.3, DW-670.)* It also covers a digest of the scope binding the dialog showed (state `v: 2`). The deciding round resolves the scope again, and a different digest asks again. Each gate's binding value is recorded in Story 44.3's gate table: the promote's planned Storage drops are always inside it. Forged, replayed, expired, changed-argument or changed-scope state asks again.

**(d) AD-14 — the embed, "on failure"** (44.4, DW-685)

OLD:
> - **on failure.** The per-step report is logged with manual remediation, never as a silent no-op.

NEW:
> - **on failure.** The per-step report is logged with manual remediation, never as a silent no-op. A compile counts as succeeded only when a check that reads no localized text confirms that every embedded class compiled (Story 44.4, DW-685; Rule #13). An HTTP 200 from `action/compile` is not success on its own, because `General.Compile` can answer 200 when only some classes failed.

**(e) AD-30 — new bullet after "Ownership"** (44.2, DW-721). This is a draft rule; Story 44.2's probe may refine it, and amends this text in place.

OLD: (no bullet)

NEW:
> - **Shared files** *(Story 44.2)*. When two adapters target one file (a workspace-root `.mcp.json` is both Claude Code's and VS Code Copilot's project file), entries are owned per server name, not per client. A write that finds a byte-identical entry adopts it, and any other entry under that name is a conflict. A disable or remove for one client warns that the other client reads the same file. `detect`, `status` and `doctor` show the file under both clients without counting it twice.

**(f) Frontmatter**

OLD: `updated: '2026-10-21'` · `binds: ['FR1-FR162', 'Epics 38-43']`

NEW: `updated: '2026-11-22'` · `binds: ['FR1-FR162', 'Epics 38-44']`

`architecture.md` is not changed: since 2026-10-15 the spine is the decision registry (`architecture.md:535`).

### 4.4 — `prd.md`

**(a) FR162** (`prd.md:719`; 44.3)

OLD:
> … A decline refuses and changes nothing. The confirmation is bound to the exact arguments shown. On clients that cannot elicit, …

NEW:
> … A decline refuses and changes nothing. The confirmation is bound to the exact arguments and scope shown: if the scope changes before the answer is honored, the human is asked again (Epic 44, Story 44.3). On clients that cannot elicit, …

**(b) FR100** (`prd.md:601`; 44.1). This is optional; recommended because the "create" promise was false on 2026.2.

OLD:
> - FR100: Data engineer can create or drop document databases

NEW:
> - FR100: Data engineer can create or drop document databases; a created database is registered so every other DocDB operation can use it (Epic 44, Story 44.1)

FR141 is not changed (§2, Artifact conflicts).

### 4.5 — Not changed by this proposal (by design)

- **Code, the bootstrap embed, `GOVERNANCE_BASELINE`, presets and tool arrays.** Every change there belongs to its story.
- **`deferred-work.md`.** The five entries are terminal, and the action items carry the work.
- **`.claude/` rules and `CLAUDE.md`.** Agents never edit them. The owner's corrections are already in `0e7bff1a`.

---

## 5. Implementation Handoff

**Scope classification:** Minor to Moderate (header). The route is the PO/Dev pipeline through `/epic-cycle`.

**Recipient:** the `/epic-cycle` orchestrator runs **Epic 44** on `feature/feature-wave-9-bug-fixes`, with epic branch `epic44`. At the SC-1 prompt, it names that wave branch.

**On approval, the agent applies, in this order:**

1. §4.1 is already in the worktree. Run §4.2(a) in the same commit, then `validate` and `check-epics-sync`.
2. §4.2(b), and §4.2(c) as the owner answered Q-2.
3. §4.3(a) to §4.3(f), and §4.4.
4. Verification:
   - `sprint_plan.py validate`;
   - `node scripts/check-epics-sync.mjs`;
   - `SPRINT_PLAN status` shows `open_action_items` without the five chartered items.
5. The agent records the results under each section here and leaves the commit to the Lead.

**Owner and Lead actions:**

- Q-1 to Q-3 were answered on 2026-11-22 (see Approval);
- approve the epic's single end-of-epic release, which must ship before 2027-02-01;
- run the VS Code Copilot dialog check (`epic-43-decision-sheet-item-1-…`) in the same sitting as AC 44.2.7, if convenient;
- provide a consenting Copilot session for AC 44.2.7, or accept a human-only certification row.

**Success criteria:**

- the tracker is in sync: `generate` reports 0 dropped orphans and `check-epics-sync` passes;
- each story's pinning gate is green and proven red on the path it guards (Rule #59), with the path named in its spec's `## Verification`;
- 44.1: a disposable DocDB database created through the tool runs the whole lifecycle live, with no #822, and the drop leaves no record;
- 44.2: a real VS Code 1.146 or later Copilot-harness session starts the servers from the new targets, the certification row is regenerated, and the epic's end-of-epic release carries it before 2027-02-01;
- 44.3: a promote whose drops change between rounds asks again on both eras and never writes the unseen drops;
- 44.4: a partial compile on a throwaway reports `compiled: false` with the failing class named, and no localized text is read;
- 44.5: one armed CI run of the wave tip is green with zero non-allowlisted skips, and the guard-return check is in the gates job, proven red;
- the five action items move to `done` at the Epic 44 retrospective, with the owner's confirmation.

---

## Appendix — Change navigation checklist (record)

| # | Item | Status | Note |
|---|---|---|---|
| 1.1 | Triggering story | [x] | Stories 42.3 (DW-684, DW-685, DW-688), 42.9 (DW-721, decision #118) and 42.11 (DW-670); routed by the Epic 42 decision sheet (decision #130) |
| 1.2 | Core problem | [x] | §1: three shipped defects, one test-evidence gap, one external deprecation with a deadline |
| 1.3 | Evidence | [x] | §1 table, re-checked in source. IRIS-side and VS Code runtime claims are **[!] unverified** here, and each is probed first in its story |
| 2.1 | Current epic viable | [N/A] | No epic in flight; Epic 42/43 are done |
| 2.2 | Epic-level changes | [x] | Add Epic 44 |
| 2.3 | Future epics | [N/A] | None planned |
| 2.4 | Obsolete or new epics | [x] | 1 new; none obsolete |
| 2.5 | Order and priority | [x] | 44.1 first (high priority); VS Code second (deadline); guard returns last (dependencies). Q-1 |
| 3.1 | PRD conflicts | [!] | FR162 (and optionally FR100) → §4.4. MVP unaffected |
| 3.2 | Architecture conflicts | [!] | AD-34, AD-14, AD-30 and the frontmatter → §4.3 |
| 3.3 | UX | [N/A] | No UX document. The extension view text changes inside 44.2 |
| 3.4 | Other artifacts | [!] | `sprint-status.yaml` (§4.2); the `check-epics-sync` CI gate (one commit); action items vs the 44.0 gate (Q-2); `scripts/lib/ci-checks.mjs` `DOCDB_REASON` (44.1/44.5) |
| 4.1 | Direct adjustment | [x] Viable | Effort medium, risk medium |
| 4.2 | Rollback | [x] Not viable | It would remove shipped features |
| 4.3 | MVP review | [N/A] | MVP unchanged |
| 4.4 | Path selected | [x] | Direct adjustment |
| 5.1 | Issue summary | [x] | §1 |
| 5.2 | Epic and artifact impact | [x] | §2 |
| 5.3 | Recommended path | [x] | §3 |
| 5.4 | MVP impact and action plan | [x] | §3, §5 |
| 5.5 | Handoff plan | [x] | §5 |
| 6.1 | Checklist complete | [x] | This table |
| 6.2 | Proposal accuracy | [x] | Line references re-checked 2026-11-22; stale ledger line numbers noted |
| 6.3 | User approval | [x] | Approved 2026-11-22; Q-1 as drafted, Q-2 with the item-9 correction, Q-3 declined (single end-of-epic release) |
| 6.4 | Tracker update | [x] | Applied 2026-11-22 through `generate` and BMAD's writer (Application record) |
| 6.5 | Next steps | [x] | `/epic-cycle 44` on `feature/feature-wave-9-bug-fixes` |

---

## Application record (2026-11-22)

Applied in the `feature/feature-wave-9-bug-fixes` worktree after the owner's approval. Nothing is committed; the Lead commits.

- **§4.1, `epics.md`.** The Epic 44 section is appended, then adjusted for Q-3, in four places:
  - the **44.2 second** ordering bullet;
  - the "publishing a release" out-of-scope bullet;
  - Story 44.2's **Due** line;
  - AC 44.2.9.

  Each now says there is one release at the end of the epic, and that no story publishes.
- **§4.2(a), `generate`** (no `--set`, `--date 2026-11-22`):
  - 44 epics and 242 stories;
  - `new_entries` is exactly `epic-44`, the five 44.x keys and `epic-44-retrospective`;
  - `dropped_orphans: []`, `changed: 0`, `illegal: []`.
- **§4.2(b)(c), the writer** (`sprint_status.py update --set-action-status`, one call): `action_items_updated: 10`. The mechanical tally of `action_items` statuses is 5 `done`, 5 `in-progress` and 1 `open` (`epic-43-decision-sheet-item-1-…`). `last_updated` is `11-22-2026 08:53`.
- **§4.3, the spine:**
  - the frontmatter (`updated`, `binds`);
  - AD-14 "on failure";
  - the new AD-30 "Shared files" bullet;
  - AD-34's Prevents, "Binding to the call" and As-built "Binding".

  The diff is 7 lines added and 6 removed.
- **§4.4, the PRD:** FR100 and FR162. The diff is 2 lines added and 2 removed.
- **Verification:**
  - `sprint_plan.py validate`: `valid: true`, `problems: []`;
  - `node scripts/check-epics-sync.mjs`: OK, with 0 orphans and 0 duplicates;
  - `sprint_plan.py status`: of the action items, only `epic-43-decision-sheet-item-1-…` has `status: open`. **Note:** the status command's `open_action_items` field lists every item that is not `done`, so the five `in-progress` items appear there too. The 44.0 gate should treat those five as owned by Stories 44.1–44.5, per each story's closing bullet, and not include them.
  - `pnpm gen:governance-baseline:check`: not run. Only planning artifacts changed, and nothing touched governance sources.
