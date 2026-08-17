# Sprint Change Proposal — 2026-08-17

**Trigger:** Post-Epic-34 full-suite manual verification sweep (109 tools, 5 MCP servers)
**Facilitator:** Bob (Scrum Master) · **Project Lead:** Developer
**Mode:** Batch · **Scope classification:** **Moderate** (new epic, no PRD/MVP change)

---

## 1. Issue Summary

Following Epic 34's retrospective close (HEAD `bc614f6`) and immediately before the SC-4 merge and beta hand-off, the Project Lead requested a build/self-install verification plus a manual exercise of **every tool in the suite** — all read actions and every write action that could be performed safely or reversed.

**Build and deployment verified clean:**

| Check | Result |
|---|---|
| `pnpm build` | 7/7 packages |
| `pnpm test` | 15/15 tasks — dev 665/665, shared 1308/1308, admin 451/451, interop 334/334, all 120/120; **0 failures** |
| Bootstrap regen | idempotent, no drift, 29 classes |
| Embedded `BOOTSTRAP_VERSION` | `01dc15bb27df` |
| **Deployed** version (live SQL probe) | `01dc15bb27df` — **match** |
| `Setup_IsConfigured()` | `true` |

**Every Epic 34 feature confirmed live**, several with decisive oracles: device output capture (the originally reported bug), `é` → code `233` (Story 34.8 request-path UTF-8), astral/emoji surrogate pairs round-tripping (`𝄞` → `55348,56606`), the shared response budget arithmetic (`ceiling=32763`, proving `returnValue`'s 5 chars were deducted from the shared 32768 pool per AC 34.7.3), ByRef markers, subscripted-array out-values, the 20-argument ceiling, and `truncated`/`byRefTruncated`/`returnValueTruncated` on the error envelope per AC 34.4.2.

**However, the sweep surfaced 8 defects — 2 HIGH and 6 MEDIUM — none of them in code Epic 34 authored.** All are pre-existing defects in handlers and TS tool layers that Epic 34 never touched, made visible only because this was the first exercise of the *complete* tool surface (109 tools) against a live instance rather than a per-story smoke of the story's own deliverable.

**Issue type:** Technical defects discovered during verification (pre-existing, newly visible).

### Evidence

| # | Sev | Defect | Evidence |
|---|-----|--------|----------|
| F1 | **HIGH** | `iris_production_item:set` can never succeed | `Interop.cls:473` calls one-arg `Ens.Config.Item.NameExists(itemName, .tID)`; the index is composite `(Production, Name)`, so `itemName` binds to the *Production* slot and the undefined ByRef ID binds to *Name*. Proven live via `iris_execute_classmethod`: 2-key call → `returnValue 1`, id `835`; 1-key call → `returnValue 0`. `get`/`enable`/`disable` are unaffected (they use SQL over the extent and `Ens.Director.EnableConfigItem`). |
| F2 | **HIGH** | `iris_analytics_cubes:build` returns unparseable non-JSON | `%DeepSee.Utils.%BuildCube()` at `Analytics.cls:219` writes to the current device; **no `ReDirectIO` appears anywhere in `Analytics.cls`**. Raw wire body: `\nERROR #20013: Cube 'NOSUCHCUBE' does not exist{"status":…}` — a correct envelope with prepended device output. `sync` (line 231, `%SynchronizeCube`) parses cleanly, isolating the cause. |
| F3 | MEDIUM | Localized error prefixes from an unpinned request locale | `Accept-Language` is never set anywhere in the suite (`http-client.ts` ~L183 builds headers without it). IRIS resolves `*` to the alphabetically-first locale (`araw`). Verified by direct curl against the same endpoint: `Accept-Language: *` → `خطأ #5001`, `en-US,en;q=0.9` → `ERROR #5001`, no header → `ERROR #5001`. Instance locale is `enuw`. |
| F4 | MEDIUM | `iris_resource_manage:listPrivileges` unbounded | For grantee `_SYSTEM` (holds `%All`): **15,341 rows / 2,900,478 characters**, exceeding the client limit and diverting to a file. No `maxRows`, no `cursor`, no output ceiling. Handler at `Security.cls:3083`, tool at `packages/iris-admin-mcp/src/tools/resource.ts`. Violates Rule #38. |
| F5 | MEDIUM | DocDB tool family (4 tools) dead on a default IRIS install | `%Service_DocDB` is **disabled** by IRIS default; all of `iris_docdb_manage`/`_document`/`_find`/`_property` fail with a bare `ERROR #822: Access Denied`. The remedy (`iris_service_manage:enable`) is itself governance-default-disabled, so the suite offers no path forward. Prerequisite undocumented. |
| F6 | MEDIUM | `iris_oauth_manage` client-create leaks a raw `<PARAMETER>` | `Security.cls:1792` calls `%SYS.OAuth2.Registration.RegisterClient(tServerName, .tProps)` after validating only that `serverName` is non-empty — never that it names a real server definition. `OAuth2.ServerDefinition` does not exist on this instance (`COUNT(*) = 0`), producing `<PARAMETER>` instead of a diagnostic. Client registration additionally requires a prior successful `discover`, which requires an IRIS SSL/TLS configuration — none of this is documented. |
| F7 | MEDIUM | `iris_interop_rest` rejects its own documented example | `rest.ts:32` describes `name` as `"REST application name (e.g., '/myapi')"`. Passing `/claudesmokeapi` fails: *"Application name is not a valid package name"*. A package name (`ClaudeSmokeApi`) succeeds. |
| F8 | MEDIUM | `iris_doc_xml_export:import` reports success but does not compile | `format.ts:163` POSTs to Atelier `action/xml/load`, which loads the definition without compiling. Response: `{"imported":["ExecuteMCPv2.Temp.XmlProbe.cls"]}` — then invoking the class yields `<CLASS DOES NOT EXIST>`. Works only after a separate `iris_doc_compile`. No `compile` option (unlike `iris_doc_load`), no warning. |
| F9 | MEDIUM | `iris_rest_manage:get` fails misleadingly on legacy apps | `list` with `scope:"all"` returns `/api/executemcp/v2`; `get` on that exact name 404s via the Mgmnt API with *"Check the IRIS web server configuration."* Per Rule #12 the Mgmnt API only knows spec-first apps — but `get` neither routes legacy names to the legacy path nor says so. Spec-first `get` works correctly. |

> F1–F9 is nine rows for "2 HIGH + 6 MEDIUM" because F3 and the beta-visibility item were counted together in the verbal report; the mechanical count of distinct defects is **2 HIGH + 7 MEDIUM = 9**. This proposal carries all nine (Rule #51 — the tally is derived from the table, not hand-authored).

**Governance verified correct and unchanged:** 32 post-foundation write actions are default-disabled across all 11 families; a clean refusal was confirmed in **every** family (including instance-wide `backup_manage:freeze` and `process_manage:terminate`), with no mutation afterward. The frozen baseline was not touched.

**System restored:** 17 disposable artifacts created and removed; `errlog` and production autostart restored to original values; the pre-existing `Troubled` SADEMO production left untouched. Verified back to baseline: 10 namespaces, 15 databases, 9 users, 37 roles, 1 SSL config, 0 OAuth servers, 4 credentials, 1 HSCUSTOM webapp, 0 `ExecuteMCPv2.Temp` docs, production Stopped, health `healthy`. Working tree clean, HEAD unchanged.

---

## 2. Change Navigation Checklist Results

### Section 1 — Understand the Trigger and Context

| Item | Status | Finding |
|---|---|---|
| 1.1 Triggering story | **[x] Done** | No single story. Trigger is the Project-Lead-requested post-Epic-34 verification sweep (2026-08-17), the first exercise of the complete 109-tool surface against a live instance. |
| 1.2 Core problem | **[x] Done** | Nine pre-existing defects across 5 packages and 4 ObjectScript handlers, invisible to a green suite and to per-story smokes because no prior activity drove every tool. Category: *technical defects discovered during verification*. |
| 1.3 Evidence | **[x] Done** | Every finding carries a live reproduction, a source citation, and (for F1/F2/F3) a decisive discriminating oracle. See §1 table. |

### Section 2 — Epic Impact Assessment

| Item | Status | Finding |
|---|---|---|
| 2.1 Current epic completable as planned? | **[x] Done** | **Yes — Epic 34 is unaffected.** All 9 stories `done`, retro `done`, 0 HIGH in its ledger. None of F1–F9 is in code Epic 34 authored; none is a regression it introduced. Epic 34 requires no re-open. |
| 2.2 Epic-level change required | **[!] Action-needed** | **Add a new epic (Epic 35).** `epics.md` currently tops out at Epic 34 and Epic 35 was already an open retro action item (#6, "Epic 35 is undefined — define before the next cycle"). This change defines it. |
| 2.3 Remaining planned epics | **[N/A]** | No epics beyond 34 exist. Nothing downstream to re-assess. |
| 2.4 Issue invalidates future epics / needs new ones? | **[x] Done** | Invalidates nothing. Necessitates exactly one new epic. F5/F6 surface *undocumented environmental prerequisites* rather than missing features — documentation scope, not new epics. |
| 2.5 Epic order / priority | **[!] Action-needed** | Epic 35 is sequenced **after the SC-4 merge and before the beta hand-off** (Project Lead decision, 2026-08-17). F1 is a governance-enabled write tool that can never succeed; shipping it to beta testers unfixed would burn credibility on a trivially reproducible failure. |

### Section 3 — Artifact Conflict and Impact Analysis

| Item | Status | Finding |
|---|---|---|
| 3.1 PRD conflicts | **[x] Done — no conflict** | No FR/NFR is contradicted. F1/F2 are defects *against* existing requirements, not requirement changes. **MVP scope is unchanged.** No PRD edit required. |
| 3.2 Architecture conflicts | **[!] Action-needed (minor)** | No architectural decision is invalidated. One pattern gap worth codifying: `Analytics.cls` calls a device-writing IRIS API with no I/O isolation, which is the Rule #7 concern applied to a *non-capture* handler. Candidate addition to `architecture.md` §"Implementation Patterns & Consistency Rules" — to be decided at Epic 35's retro, not pre-emptively. |
| 3.3 UI/UX conflicts | **[N/A]** | No UI surface affected. The VS Code extension and `iris-mcp-clients` CLI are untouched by all nine findings. |
| 3.4 Other artifacts | **[!] Action-needed** | (a) **Docs**: per-server READMEs + `tool_support.md` need the DocDB prerequisite (F5), the OAuth discover/SSL prerequisite (F6), the `interop_rest` name contract (F7), and the `doc_xml_export` compile behaviour (F8). (b) **`epics.md` drift found during this analysis**: 34.6–34.8 appear out of order (4575 → 4595 → 4613), and story sections are missing. **Corrected post-approval by a mechanical both-directions recount (Rule #51):** this section initially named "34.0 and 34.5". The real count is **16** status keys with no `epics.md` section — but **15 are runtime-created gate/cleanup stories** (14 × `*-epic-N-deferred-cleanup` for epics 2-9, 12, 14-17, 34, plus `33-5-late-findings-cleanup`), which the epic-cycle generates at gate time and which have never been pre-planned in `epics.md`. Their absence is BY DESIGN. **Exactly one is genuine drift: Story 34.5** (`34-5-tool-layer-truncated-and-test-runner-guard`), an escalated story whose siblings 34.4/34.6/34.7/34.8 all have sections. There are **0 orphan sections** (nothing in `epics.md` lacks a status key). Baseline: 185 status keys, 169 sections. AC 35.8.2/35.8.3 carry the corrected scope and require the check to CLASSIFY the expected-absent class rather than re-raise 15 false positives each epic. (c) **Bootstrap**: F1/F2/F4/F6 modify bootstrapped classes (`Interop`, `Analytics`, `Security`) → `BOOTSTRAP_VERSION` must bump (Rule #24) and rosters stay unchanged (Rule #39 — no new `.cls`). (d) **Testing strategy**: F1–F9 were all invisible to a 2,878-test green suite; the epic gate must be a *live* full-surface exercise. |

### Section 4 — Path Forward Evaluation

| Option | Status | Assessment |
|---|---|---|
| **1. Direct Adjustment** | **[x] Viable — SELECTED** | Add Epic 35 with focused stories. Every finding is well-diagnosed with a known fix site; several are description/doc-only. Effort **Medium**, Risk **Low**. Preserves Epic 34's clean close and the existing plan structure. |
| **2. Potential Rollback** | **[ ] Not viable** | Nothing to roll back. Epic 34's work is correct and independently verified; F1–F9 predate it. Rolling back would remove verified value and fix nothing. Effort High, Risk High. |
| **3. PRD MVP Review** | **[ ] Not viable — unnecessary** | MVP is intact and achievable. These are defects against existing requirements, not scope pressure. No goal or requirement needs modification. |

**4.4 Selected path: Option 1 (Direct Adjustment) — new Epic 35, sequenced between the SC-4 merge and the beta hand-off.**

Rationale: the two HIGHs are small, fully root-caused fixes in single call sites; the MEDIUMs are mostly validation and documentation. Deferring them past beta would send testers a suite containing a write action that cannot succeed (F1) and an action returning unparseable JSON (F2) — both trivially reproducible, both damaging to first impressions, and both cheaper to fix now than to triage through beta reports. Fixing before beta also keeps the ledger honest at Rule #37 count 0 for this batch.

### Section 5 — Proposal Components · Section 6 — Final Review

| Item | Status |
|---|---|
| 5.1 Issue summary | **[x] Done** — §1 |
| 5.2 Epic + artifact impact | **[x] Done** — §2 |
| 5.3 Recommended path + rationale | **[x] Done** — §4.4 |
| 5.4 MVP impact + action plan | **[x] Done** — MVP **unaffected**; action plan §3 |
| 5.5 Agent handoff plan | **[x] Done** — §5 |
| 6.1 Checklist completion | **[x] Done** — all sections addressed; 5 `[!]` items each carry a proposal in §3 |
| 6.2 Proposal accuracy | **[x] Done** — every finding source-cited and live-reproduced |
| 6.3 User approval | **[ ] Pending** — awaiting explicit approval |
| 6.4 `sprint-status.yaml` update | **[ ] Pending approval** — add `epic-35` + 9 story keys as `backlog` |
| 6.5 Next steps confirmed | **[ ] Pending approval** |

---

## 3. Detailed Change Proposals

### 3.1 — `epics.md`: append Epic 35

**Artifact:** `_bmad-output/planning-artifacts/epics.md` (append after line 4628, end of Epic 34)
**Rationale:** Closes Epic 34 retro action item #6 (Epic 35 undefined) and gives the nine findings a home with explicit ACs.

```markdown
## Epic 35: Pre-Beta Defect Remediation — Live-Surface Findings (added 2026-08-17)

**Goal**: Close the 2 HIGH and 7 MEDIUM defects found by the post-Epic-34 full-surface
verification sweep (2026-08-17), so the beta hand-off ships a suite with no known-broken
tool action and no misleading tool contract.

**Context**: The sweep exercised all 109 tools across the 5 servers against a live IRIS
2026.1 instance. Epic 34's own deliverables all passed. Every finding below is a
PRE-EXISTING defect in code Epic 34 did not author, invisible to a 2,878-test green suite
because no prior activity drove the complete tool surface. Full evidence, source citations
and discriminating oracles: `sprint-change-proposal-2026-08-17.md`.

**Constraint E-1 (no governance surface change)**: Epic 35 adds NO new tool and NO new
action key. Every fix targets an existing tool/action, so no `mutates` classification
(#28) and no preset disposition (#53) is required, and tool counts must not move (#31).
Any fix tempted to introduce a new ACTION must instead be an additive PARAMETER on the
existing action — a new action key would change the governed surface and is out of scope.

**Constraint E-2 (frozen baseline untouched)**: `GOVERNANCE_BASELINE` stays frozen at
`1e62c5ad5bf7`/141/201/60. Verify with `gen:governance-baseline:check` ONLY; never run the
bare generator (#23/#25).

### Story 35.0: Epic 34 Retro-Review Gate + Deferred-Work Triage

- **AC 35.0.1** - Standard retro-review gate: read `epic-34-retro-2026-08-17.md` and
  confirm every action item is either done, carried with an owner, or explicitly closed.
- **AC 35.0.2** - Confirm the SC-4 merge completed and Epic 34's commits are reachable
  from the wave-4 feature branch (retro §6 branch-reachability risk). If not, HALT and
  escalate — Epic 35 must not build on an unmerged base.
- **AC 35.0.3** - Triage Epic 34's carried ledger (0 HIGH / 12 MEDIUM / 72 LOW). Record
  the Rule #37 consecutive-re-deferral count per batch. This epic's own nine findings
  enter the ledger at count 0.
- **AC 35.0.4** - Rule #57 machinery armed for every review in this epic: bounded-close,
  frozen-diff snapshot, delivery receipts. Epic 34 closed 9/9 non-degraded; hold that bar.

### Story 35.1: HIGH - `iris_production_item:set` Composite-Key Resolution

- **AC 35.1.1** - `Interop.cls:473` resolves the config item by its FULL composite key.
  `Ens.Config.Item`'s `Name` index is `(Production, Name)`; the current one-arg
  `NameExists(tItemName, .tID)` binds `tItemName` to the Production slot and can never
  match (Rule #27, already codified — this call site did not apply it).
- **AC 35.1.2** - Probe-first (#16): before coding, confirm live which resolution API is
  correct and available - two-key `NameExists(prod, name, .id)` (verified working:
  returns 1, id 835 for `ExecuteMCPv2.Temp.SmokeProduction`/`SmokeFileOut`) versus
  `tProd.FindItemByConfigName(name)` as already used by this handler's `add`/`remove`
  paths (lines 609/693). Prefer consistency with the sibling paths unless the probe shows
  otherwise; record the probe output in Dev Notes.
- **AC 35.1.3** - The production is resolved explicitly: from an optional `production`
  argument when supplied, else the namespace's active production, matching how
  `add`/`remove` already default it. An item name that is ambiguous across productions
  yields a clear error naming the candidates, never a silent wrong-row write (#29/#50).
- **AC 35.1.4** - Audit the WHOLE handler for the same one-arg-composite pattern, not just
  line 473: grep every `NameExists(`/`%OpenId(`/`%ExistsId(` call in `Interop.cls` and
  `Security.cls` and confirm each passes a complete key. Report the audit result even if
  no further instances are found (#56 - enumeration completeness is a review question).
- **AC 35.1.5** - Rule #48 mutation evidence: revert the fix, show `set` failing with
  "Config item not found" on a live item that `get` resolves, restore, show it passing.
  The regression test is pinned from LIVE behavior, not from the implementation (#36).
- **AC 35.1.6** - Live proof on the real endpoint (#26): create a disposable production
  with items via class XData (`item:add` is governance-disabled), then `get` -> `set` ->
  `get` showing the mutation landed, plus `enable`/`disable` still working. Delete the
  production afterward.

### Story 35.2: HIGH - `iris_analytics_cubes:build` Device-Output Isolation

- **AC 35.2.1** - `Analytics.cls:219`'s `%DeepSee.Utils.%BuildCube()` call no longer lets
  device output reach the response. The wire body today is
  `\nERROR #20013: Cube 'NOSUCHCUBE' does not exist{"status":...}` - a correct envelope
  with prepended device text, unparseable by any JSON client.
- **AC 35.2.2** - Follow the Rule #7 discipline already proven in `Command.cls`: bind the
  redirect to a throw-away null device, restore FULLY before rendering
  (`ReDirectIO(0)` then bare `Use tInitIO` - note `Use tInitIO::("")` is a NO-OP), and
  render EXACTLY ONE response body per request via a single If/Else dispatch after
  Try/Catch. Do not invent a new mechanism.
- **AC 35.2.3** - Decide and document what happens to the captured text: either discard it
  or surface it in an additive field. If surfaced it MUST be bounded by
  `ExecuteMCPv2.Utils.ApplyOutputCeiling` with the structured truncation marker, exactly
  as `Command.cls` does - an unbounded progress dump is a new instance of the very defect
  Epic 34 Story 34.6 fixed.
- **AC 35.2.4** - Audit every OTHER call in `Analytics.cls` and the remaining handlers for
  IRIS APIs that write to the current device without isolation. `%SynchronizeCube`
  (line 231) is verified clean; enumerate the rest and report the result (#56).
- **AC 35.2.5** - Rule #48 mutation evidence: revert, show the non-JSON body on the wire,
  restore, show a parseable envelope. Proof is a RAW HTTP body inspection, not an
  internal round-trip - an in-IRIS check cannot see prepended device bytes (Rule #59: the
  gate must fail on the path it actually guards, and that path is the wire).
- **AC 35.2.6** - Both paths proven: the ERROR path (verified reproducible today with a
  nonexistent cube) AND a SUCCESS path. The success path is currently UNVERIFIED because
  this instance has zero cubes - stand up a minimal disposable cube, or record an explicit
  residual risk if that proves impractical. Do not assume success is unaffected;
  `%BuildCube` is documented to emit progress output.

### Story 35.3: MEDIUM - Pin the Request Locale for Error Text

- **AC 35.3.1** - The shared HTTP client sends an explicit `Accept-Language` header
  (`packages/shared/src/http-client.ts`, header construction ~L183). Today none is sent,
  and IRIS resolves the effective `*` to the alphabetically-first locale (`araw`),
  localizing every `%Status` error prefix suite-wide.
- **AC 35.3.2** - Oracle pinned from live behavior (#36), captured 2026-08-17 by curl
  against `POST /api/executemcp/v2/classmethod` with a nonexistent class:
  `Accept-Language: *` -> `خطأ #5001: ...`; `Accept-Language: en-US,en;q=0.9` ->
  `ERROR #5001: ...`; no header -> `ERROR #5001: ...`. Instance locale is `enuw`.
- **AC 35.3.3** - The value is operator-overridable (env var), defaulting to English.
  Hard-coding English with no escape hatch is wrong for non-English deployments.
- **AC 35.3.4** - **All existing localized-prefix handling is PRESERVED.** This fix
  addresses ONE of TWO independent mechanisms. Verified still required:
  `ExecuteMCPv2.Utils.cls:181` strips both `"ERROR #"` and `"خطأ #"` (Rule #8), and
  `ExecuteMCPv2.Diagram.Loader.cls:168-214` normalizes locale words on resolved
  renderings because `GetErrorText` picks the message table PER WORKER PROCESS
  (Rule #13) - a mechanism the request header does not control, found by the 2026-07-03
  SADEMO smoke. Removing either would re-open a previously fixed bug. The story must not
  claim to eliminate localized prefixes wholesale.
- **AC 35.3.5** - `packages/shared/src/__tests__/http-client.test.ts:1084-1129` (the
  Arabic-prefix UTF-8 preservation test) still passes UNCHANGED. It asserts multi-byte
  text is not mangled using a MOCKED envelope; it is not a locale test and must not be
  weakened or deleted to accommodate this change (#54 - a fake must stay something the
  real API can return, and IRIS can still return Arabic under an operator override).
- **AC 35.3.6** - Live proof across at least two servers that a real error now renders
  `ERROR #` on the MCP path, plus one call with the override set to a non-English locale
  showing the header is genuinely honored (proving the knob is not inert - Rule #59).

### Story 35.4: MEDIUM - Bound `iris_resource_manage:listPrivileges`

- **AC 35.4.1** - The action accepts `maxRows` and returns a `cursor`/`nextCursor` for
  pagination, matching the pagination convention already used by sibling admin list tools.
- **AC 35.4.2** - Measured baseline to beat, captured live 2026-08-17: grantee `_SYSTEM`
  (holds `%All`) returns **15,341 rows / 2,900,478 characters**, exceeding the client
  limit and diverting to a file.
- **AC 35.4.3** - Rule #38 stated honestly in the tool description: a `maxRows`/topN cap
  truncates OUTPUT only - the scan work has already happened. If the scan itself cannot be
  bounded, say so explicitly rather than implying timeout protection. Prefer pushing the
  limit into the SQL (`TOP`) so the scan is genuinely bounded, and state which was done.
- **AC 35.4.4** - `%All` short-circuit consistency (#6): a grantee holding `%All` holds
  every privilege via `SuperUser` with no explicit rows. Consider returning the
  short-circuit verdict with a reason field - as `iris_permission_check` already does
  ("target holds %All super-role") - instead of enumerating 15,341 derived rows. If
  enumeration is kept, justify it in the description.
- **AC 35.4.5** - Rule #19 back-compat: an omitted `maxRows` must not silently change the
  result shape for callers who fit under the cap. Proven mechanically.

### Story 35.5: MEDIUM - Validate Before Delegating: OAuth Client + `interop_rest` Name

- **AC 35.5.1** - `Security.cls:1792` pre-validates that `serverName` names an existing
  OAuth2 server definition before calling
  `%SYS.OAuth2.Registration.RegisterClient(tServerName, .tProps)`. Today only non-emptiness
  is checked (lines 1770-1776), so a missing definition surfaces as a raw
  `<PARAMETER>` ObjectScript error. Probe-first (#16) which class actually backs the
  lookup: `OAuth2.ServerDefinition` does NOT exist on this instance (`COUNT(*) = 0`), so
  do not assume it.
- **AC 35.5.2** - The error names the real precondition: client registration requires a
  prior successful `discover`, which itself requires an IRIS SSL/TLS configuration.
  Verified live: `discover` against `https://accounts.google.com` fails with *"Although
  Https property is enabled no SSLConfiguration is specified"*. Both prerequisites are
  documented in the tool description (#43 - the story ships its own minimal docs).
- **AC 35.5.3** - `iris_interop_rest`'s `name` description is corrected. `rest.ts:32`
  currently reads `"REST application name (e.g., '/myapi')"`, and that documented example
  is REJECTED: *"Application name is not a valid package name: /claudesmokeapi"*. A
  package name (`ClaudeSmokeApi`) succeeds. Fix the description to state the package-name
  contract with a working example; if a path-shaped value should also be accepted, that is
  a handler change and must be called out as such rather than silently assumed.
- **AC 35.5.4** - Audit the remaining tool descriptions for the same class of defect - a
  documented example the implementation rejects (#56). At minimum, every `describe()`
  containing an `e.g.` in the touched packages is checked against its validator. Report
  the audit result.
- **AC 35.5.5** - Live proof of each corrected contract: the documented example now works,
  and the rejected form yields a clear validation error rather than a raw ObjectScript
  error (#26).

### Story 35.6: MEDIUM - `doc_xml_export:import` Compile Parity + `rest_manage:get` Legacy Routing

- **AC 35.6.1** - `iris_doc_xml_export` `import` no longer reports bare success for a
  document that is not usable. Verified today: `{"imported":["...XmlProbe.cls"]}` followed
  by `<CLASS DOES NOT EXIST>` on invocation; a separate `iris_doc_compile` fixes it.
- **AC 35.6.2** - Probe-first (#16): determine whether Atelier's `action/xml/load`
  (`format.ts:163`) accepts a compile qualifier natively, or whether a follow-up compile
  call is required. Implement whichever is REAL - do not assume the flag exists. Record
  the probe.
- **AC 35.6.3** - Expressed as an additive `compile` PARAMETER mirroring `iris_doc_load`'s
  existing `compile`/`flags` options - NOT a new action (Constraint E-1). Default
  preserves today's behavior (Rule #19); when compile is not requested, the response
  states plainly that imported documents are uncompiled.
- **AC 35.6.4** - `iris_rest_manage:get` handles legacy dispatch apps. Today `list` with
  `scope:"all"` returns `/api/executemcp/v2` but `get` on that exact name 404s via the
  Mgmnt API with *"Check the IRIS web server configuration"* - a misleading message for a
  by-design limitation (Rule #12: the Mgmnt API lists spec-first apps only). Either route
  legacy names to the legacy path or return a clear, correct explanation. A name that
  `list` returns must never fail with a message implying server misconfiguration.
- **AC 35.6.5** - Live proof of the list->get round trip for BOTH scopes: every name
  returned by `scope:"all"` is resolvable by `get`, or fails with an accurate reason.
  Spec-first `get` (verified working today) must be unchanged.

### Story 35.7: MEDIUM - DocDB Prerequisite: Actionable Error + Documentation

- **AC 35.7.1** - All four DocDB tools (`iris_docdb_manage`, `_document`, `_find`,
  `_property`) surface an actionable error when `%Service_DocDB` is disabled. Today all
  four return a bare `ERROR #822: Access Denied` from `/api/docdb/v1/{ns}`.
- **AC 35.7.2** - Root cause verified live 2026-08-17: `%Service_DocDB.enabled = false`
  (IRIS default) while the `/api/docdb` webapp exists and IS enabled - so the failure is
  the service gate, not the webapp and not privileges (`_SYSTEM` holds `%All`).
- **AC 35.7.3** - The error names the fix AND the catch: enabling the service is itself
  governance-default-disabled (`iris_service_manage:enable`), so the message must point at
  both routes - the Management Portal, or an `IRIS_GOVERNANCE` override. A user must never
  be left with "Access Denied" and no path forward.
- **AC 35.7.4** - Detection must not manufacture a state the real system cannot produce
  (#54): probe how the disabled-service condition is actually distinguishable from a
  genuine privilege failure, and pin any test fake to that real shape. Do not guess.
- **AC 35.7.5** - Prerequisite documented at the point of use (#30/#43): the per-server
  README DocDB entries plus `tool_support.md`, each stating that `%Service_DocDB` is
  disabled by default on IRIS and must be enabled before these four tools function.
- **AC 35.7.6** - Live proof: with the service disabled, all four tools return the new
  actionable error. If the service can be temporarily enabled under an override, prove one
  tool then works and RESTORE the service to disabled afterward.

### Story 35.8: Docs + Artifact Rollup, `epics.md` Backfill, Epic Gate

- **AC 35.8.1** - Docs rollup ENRICHES what stories 35.1-35.7 already shipped; it must not
  be the first place any capability is documented (#43). Per-server READMEs and
  `tool_support.md` updated for every changed contract, each with its governance default
  state stated mechanically from `mutates` (#30).
- **AC 35.8.2** - **`epics.md` backfill** (drift found during this change analysis):
  add the missing **Story 34.0** and **Story 34.5** sections - both `done` in
  `sprint-status.yaml` (`34-0-epic-33-deferred-cleanup`,
  `34-5-tool-layer-truncated-and-test-runner-guard`) but absent from `epics.md` - and
  reorder 34.6-34.8 into ascending sequence (they currently appear 34.8 at 4575, 34.7 at
  4595, 34.6 at 4613). Content is reconstructed from the story files in
  `implementation-artifacts/`, not invented.
- **AC 35.8.3** - Mechanical cross-check (#51): every story key in `sprint-status.yaml`
  for epics 1-35 has a corresponding `epics.md` section, and vice versa. Derive the
  comparison with a script/grep and report both directions; do not hand-audit. Fix or
  explicitly log any further drift this reveals.
- **AC 35.8.4** - **Epic gate** - a LIVE full-surface exercise, in the DEFAULT test suite
  (#21), covering all nine findings: F1 `production_item:set` mutates and reads back;
  F2 `analytics_cubes:build` returns parseable JSON verified from the RAW wire body;
  F3 an error renders `ERROR #`; F4 `listPrivileges` respects `maxRows`; F5-F9 each
  assert the corrected contract. Rule #59: the gate is proven RED by breaking each fix on
  the path it actually guards, and the story STATES which path that was for each leg.
- **AC 35.8.5** - Gates green: `pnpm turbo run build test lint type-check`;
  `gen:governance-baseline:check` (`:check` ONLY) exit 0 at frozen
  `1e62c5ad5bf7`/141/201/60; tool counts unmoved (#31); no new action keys
  (Constraint E-1); `BOOTSTRAP_VERSION` from->to recorded with Constraint C-2 re-verified
  (#24 - `Interop`, `Analytics`, `Security` are bootstrapped); bootstrap rosters unchanged
  (#39 - no new `.cls`); changeset added.
- **AC 35.8.6** - `iris_execute_tests` count check (#35): `ExecuteMCPv2.Tests` total
  compared against the mechanically-counted `Test*` method count; rerun per-class if short.

**Out of scope**: Epic 34's carried ledger (12 MEDIUM / 72 LOW) beyond the Story 35.0
triage; the npm publish (a Project Lead action); and the `architecture.md` pattern addition
floated in §3.2 of the change proposal, which is an Epic 35 RETRO decision, not a story.
```

### 3.2 — `sprint-status.yaml`: add Epic 35

**Artifact:** `_bmad-output/implementation-artifacts/sprint-status.yaml` (append after `epic-34-retrospective: done`)

```yaml
  epic-35: backlog
  35-0-epic-34-retro-gate-deferred-triage: backlog
  35-1-production-item-set-composite-key: backlog
  35-2-analytics-cubes-build-device-output: backlog
  35-3-pin-request-locale-error-text: backlog
  35-4-bound-list-privileges: backlog
  35-5-validate-before-delegating-oauth-restname: backlog
  35-6-xml-import-compile-and-legacy-rest-get: backlog
  35-7-docdb-prerequisite-error-and-docs: backlog
  35-8-docs-artifact-rollup-epic-gate: backlog
```

**Note:** only the Project Lead writes `epic-35: done` (status ownership convention).

### 3.3 — PRD: no change

No FR or NFR is contradicted; MVP scope is unaffected. Recorded explicitly so the absence of a PRD edit is a decision, not an oversight.

### 3.4 — `architecture.md`: deferred to Epic 35 retro

One candidate pattern (device-writing IRIS APIs require I/O isolation even in non-capture handlers — §3.2) is worth codifying, but Rule #1 requires general-pattern shape before codification. Decide at Epic 35's retro with F2's evidence plus the AC 35.2.4 audit result in hand.

### 3.5 — Deferred-work ledger

Add all nine findings as `35-*` entries with their §1 evidence, at Rule #37 consecutive-re-deferral **count 0**. Any item not resolved by Epic 35 close carries forward with an explicit owner.

---

## 4. Implementation Handoff

**Scope classification: Moderate** — backlog reorganization (new epic + 9 stories) with no PRD/architecture/UX change.

| Recipient | Responsibility |
|---|---|
| **Project Lead** | Approve this proposal. Execute the SC-4 merge FIRST (prerequisite — Epic 34's commits are still only on `epic34`). Then decide the beta-visible branch (open retro item #2). Own `epic-35: done`. |
| **Scrum Master** (`/epic-cycle 35`) | Drive stories 35.0→35.8 through the standard pipeline: story creation → dev (sonnet) → QA (sonnet) → code-review (opus) → lead smoke → commit to `epic35` only. |
| **Dev / QA / Review agents** | Per-story execution under Rule #57 (bounded-close, frozen-diff, delivery receipts) — Epic 34 achieved 9/9 non-degraded closes; hold that bar. |

**Sequencing (Project Lead decision, 2026-08-17):** SC-4 merge → **Epic 35** → beta hand-off → npm publish after beta feedback.

### Success criteria

1. F1 fixed and mutation-verified: `production_item:set` mutates a live item that `get` resolves.
2. F2 fixed and verified **from the raw wire body**, on both the error path and a success path (or an explicit residual risk for success).
3. F3 fixed with the override proven honored, and **all** existing localized-prefix handling intact (`Utils.cls:181`, `Loader.cls:168-214`, `http-client.test.ts:1084-1129`).
4. F4–F9 each closed with a live proof of the corrected contract.
5. Epic gate is a live full-surface exercise in the default suite, each leg proven RED on the path it guards, with that path named (Rule #59).
6. Governance surface unmoved: no new action keys, tool counts unchanged, frozen baseline verified via `:check` only.
7. `epics.md` ↔ `sprint-status.yaml` reconciled mechanically in both directions.

---

## 5. Approval

- [x] **Project Lead approval — APPROVED 2026-08-17** (explicit "yes")
- Conditions / amendments: _(none — all four navigation decisions taken as recommended: Batch mode; merge first then Epic 35 before beta; all findings in scope; `epics.md` backfill as an Epic 35 story)_

### Changes applied on approval

| Artifact | Change |
|---|---|
| `_bmad-output/planning-artifacts/epics.md` | Epic 35 appended (9 stories, Constraints E-1/E-2) |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | `epic-35: backlog` + 9 story keys as `backlog` |
| `_bmad-output/implementation-artifacts/deferred-work.md` | 9 findings ledgered as `35-SWEEP-1`…`35-SWEEP-9` at Rule #37 count 0; ledger state recomputed to 2 HIGH / 19 MEDIUM / 72 LOW = 93 open across 158 distinct |
| PRD / architecture.md / UX | **No change** (recorded as a decision — MVP unaffected; the architecture pattern candidate is deferred to Epic 35's retro) |

### Immediate next action (Project Lead)

**The SC-4 merge is a hard prerequisite** — Story 35.0's AC 35.0.2 HALTS if Epic 34's commits are not reachable from the wave-4 feature branch. Merge first, then `/epic-cycle 35`.
