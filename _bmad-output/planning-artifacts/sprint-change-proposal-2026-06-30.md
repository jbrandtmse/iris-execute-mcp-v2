# Sprint Change Proposal — 2026-06-30

**Author:** Bob (Scrum Master) via `bmad-correct-course`
**Trigger:** Operational gap — no tool can recover an Interoperability production that is wedged in a *non-running* bad state (stuck runtime/queue globals) where the existing soft `recover` action is insufficient. Requested capability: expose `Ens.Director.CleanProduction()`.
**Change type:** Additive capability (new stakeholder requirement) — an action on the existing `iris_production_control` tool, **plus** a strictly-additive extension to the Epic 14 governance foundation.
**Path forward:** Option 1 — Direct Adjustment (append one new single-story epic).
**Scope classification:** Moderate–Major (ObjectScript handler edit + tool-schema extension + BOOTSTRAP_VERSION bump + a shared-foundation governance extension touching all five servers; design settled in the analyst session — not a replan, but the foundation change warrants architect sign-off).
**Review mode:** Batch.
**New epic:** Epic 20 (single story 20.0).
**New FR:** FR128.
**BOOTSTRAP_VERSION:** **bump required** (ObjectScript `Interop.cls` is edited — Rule #24).

---

## 1. Issue Summary

`iris_production_control` exposes `start / stop / restart / update / recover`. The `recover` action calls `Ens.Director.RecoverProduction()`, which is **soft**: it only acts when the production state is `Troubled`, and it merely moves the runtime to *suspended* ([`Director.cls:642`](../../irislib/Ens/Director.cls#L642), `RecoverProduction` returns *"Nothing to recover"* for any non-Troubled state).

There is **no tool** for the harder failure mode: a production that is stopped/wedged with stale runtime state (orphaned `^IRIS.Temp.EnsRuntimeAppData`, stuck `$$$EnsRuntime`/`$$$EnsQueue`/job-status globals) such that it cannot be started cleanly and `recover` does nothing. The IRIS-native remedy is `Ens.Director.CleanProduction()` ([`Director.cls:1371`](../../irislib/Ens/Director.cls#L1371)), which the Management Portal's own director UI invokes ([`Director.cls:2002`](../../irislib/Ens/Director.cls#L2002)).

**`clean` is genuinely distinct from `recover`** (source-verified):

| | `recover` (exists) | `clean` (this proposal) |
|---|---|---|
| IRIS method | `RecoverProduction()` | `CleanProduction(pKillAppDataToo)` |
| Behavior | Soft — acts only on `Troubled` state; moves runtime → suspended | Hard — kills runtime/queue/job-status globals so a wedged production can start clean |
| Running guard | n/a | **Refuses while production is running** |
| Destructive option | none | `pKillAppDataToo` → additionally wipes persistent `^Ens.AppData` |
| Annotation | public | **`[ Internal ]`** |

**Evidence.** Verified directly against `irislib/Ens/Director.cls` (method signatures, running-guard, and the two globals cleared by `killProductionGlobals` at [`Director.cls:1384`](../../irislib/Ens/Director.cls#L1384)) and `irislib/Ensemble.inc` (global mappings at lines 131–134).

### Two side-findings surfaced during source review

1. **Latent bug in the existing `recover` action.** [`Interop.cls:234`](../../src/ExecuteMCPv2/REST/Interop.cls#L234) calls `##class(Ens.Director).RecoverProduction(tForce)`, but `RecoverProduction()` declares **zero formal parameters** ([`Director.cls:642`](../../irislib/Ens/Director.cls#L642)). Passing an extra argument is expected to raise `<PARAMETER>` at runtime — i.e. `recover` is likely currently broken. **Stakeholder decision: fix it in this epic** (verify live, then drop the argument).
2. **`CleanProduction` is `[ Internal ]`** (Rule #4). Acceptable to depend on — it is the documented mechanism the Portal itself uses — but the dependency is recorded so a future IRIS upgrade audit knows to re-verify.

---

## 2. Impact Analysis

### Epic Impact
- **No existing epic invalidated, rolled back, or rescoped.** Epics 1–19 are `done` and remain valid.
- **One new epic appended (Epic 20),** single story (20.0), following the minimal single-story-epic pattern proven by Epics 18 and 19.
- **No resequencing.** Builds directly on the shipped `iris_production_control` handler; no new prerequisites.

### Story Impact
- **1 new story (20.0).** No existing story is touched.

### Artifact Conflicts
| Artifact | Impact | Nature |
|---|---|---|
| **PRD** | Add FR128; no existing FR changed | Additive |
| **Architecture** | Add an Epic 20 ADR (decision **F1**: `clean` action + destructive `killAppData` double-gate + `recover` arg fix); no decision reversed | Additive |
| **UX** | N/A — headless MCP server suite | None |
| **`epics.md`** | Add Epic 20 section | Additive |
| **`sprint-status.yaml`** | Add `epic-20` + `20-0-…` + `epic-20-retrospective` as `backlog` | Additive |
| **`Interop.cls` (`ProductionControl`)** | Add `clean` branch + extend action validation; fix `recover` arg | Additive + 1 in-place bug fix |
| **`production.ts` (`iris_production_control`)** | Extend `action` enum with `clean`; add `killAppData` + `confirm` schema fields + description | Additive |
| **`governance.ts` + `tool-types.ts` (`@iris-mcp/shared`)** | Extend the governance foundation with a "write, default-enabled" mechanism (decision F2); additive — absent the new marker every write stays default-disabled | Additive (foundation) |
| **`bootstrap-classes.ts` / `BOOTSTRAP_VERSION`** | Regenerate + bump (ObjectScript changed) — Rule #24 | **Required** |
| **README + all linked docs** (root `README.md`, interop & `iris-mcp-all` READMEs, `tool_support.md`, `docs/migration-v1-v2.md`, `docs/tool-annotation-audit.md`) | Add `clean` to every `iris_production_control` action listing; document the `^Ens.AppData` warning, `recover`-preferred / `clean`-last-resort, and the F2 default-enabled note (Rule #30). **Tool count unchanged** (new *action*, not new tool). | Additive (in-scope deliverable) |
| **CHANGELOG** | New entry | Additive |

### Technical Impact — the safety-critical design (research-backed)

`CleanProduction` always calls `killProductionGlobals(pKillAppDataToo)` ([`Director.cls:1384`](../../irislib/Ens/Director.cls#L1384)). That routine clears **two different classes of data**:

- **Always cleared — transient runtime state** (`$$$KillAllEnsRuntimeAppData` → `^IRIS.Temp.EnsRuntimeAppData($namespace)` per [`Ensemble.inc:131-132`](../../irislib/Ensemble.inc#L131)), plus `$$$EnsRuntime`, `$$$EnsQueue`, job-status, job-request, and suspended globals. This is scratch state in `^IRIS.Temp` (async-request tracking, scheduler alarm-set, BP retry state, runtime archiving flags) — **wiped on restart anyway**. This *is* the genuine "unwedge" operation and is safe.

- **Cleared only if `pKillAppDataToo=1` — persistent business state** (`Kill ^Ens.AppData`, `$$$EnsStaticAppData` per [`Ensemble.inc:134`](../../irislib/Ensemble.inc#L134)). This is **per-config-item state that survives restarts** and is genuinely dangerous to lose:
  - **HL7 `ExpectedSequenceNumber`** ([`EnsHL7.inc:12`](../../irislib/EnsHL7.inc#L12)) — sequence/dedup tracking
  - **File/FTP "done file" tables** (`adapter.file`, `adapter.ftp` — [`File/InboundAdapter.cls:231`](../../irislib/EnsLib/File/InboundAdapter.cls#L231), [`FTP/InboundAdapter.cls:376`](../../irislib/EnsLib/FTP/InboundAdapter.cls#L376)) — **wiping causes re-ingestion of already-processed files → duplicate messages**
  - **RecordMap & X12 batch state / control numbers** ([`EnsRecordMap.inc:10-18`](../../irislib/EnsRecordMap.inc#L10), `EnsLib/EDI/X12/Operation/BatchStandard.cls`)
  - **Alert throttle counters/delays** ([`Ensemble.inc:365-368`](../../irislib/Ensemble.inc#L365)) — reset can cause alert storms
  - File-creation timestamp counters, MFT done-file tables, SQL snapshot data

**Design decision (F1):**
- `clean` defaults to `pKillAppDataToo = 0` — clears **only** transient runtime state. This is the safe, useful default that unwedges a stuck production.
- Wiping the persistent `^Ens.AppData` is opt-in behind an explicit **`killAppData: true`** flag, **double-gated** with **`confirm: true`** (Rule #26 destructive-path guard — mirrors the Epic 15 audit-purge bounded-scope pattern). With `killAppData:true` but no `confirm:true`, the handler **refuses** and changes nothing.
- `CleanProduction`'s own running-guard is preserved (it returns a clean error while the production is running); the handler surfaces that via the standard `SanitizeError` envelope.

**Governance classification & foundation extension (decision F2; Rules #28 / #23 / #19).** Per stakeholder decision, `clean` must be **callable by default** (the safe transient-only default is the common case; the destructive `^Ens.AppData` wipe stays gated by the handler `confirm` double-gate, not by governance). The action is **truthfully** classified `mutates: "write"` ([`governance.ts:401`](../../packages/shared/src/governance.ts#L401) `defaultSeed` would otherwise default it to *disabled*). Because the framework today has only `read→enabled` / `write→disabled` and the 141-key baseline (`1e62c5ad5bf7`) is **frozen** (Rules #23/#25 — adding to it is forbidden), we extend the Epic 14 governance foundation with an explicit **"write, default-enabled"** mechanism:

- A tool declares specific write actions as default-enabled (recommended shape: a `defaultEnabled` marker on `ToolDefinition`, mirroring `mutates`'s per-action form — **final API confirmed by the architect**).
- A new `defaultEnabledWrites: ReadonlySet<string>` (built from that marker, analogous to `buildMutatesLookup`) is threaded as an **optional, default-empty** parameter through `defaultSeed` → `effective` → `getEffectivePolicy`. In `defaultSeed`, a write key present in that set resolves to `true` instead of `false`.
- **Strictly additive (Rule #19 mechanical proof):** with the set empty (its default), every existing call site is byte-for-byte unchanged and every `write` still defaults to *disabled*. Only `iris_production_control:clean` opts in.

The frozen baseline is **untouched** (clean is non-baseline; it is enabled via the new marker, NOT via baseline membership — the 5 existing actions remain baseline-enabled). `assertGovernanceClassification` still passes (clean carries `mutates: "write"`). The Epic 19 discovery tool (`iris_server_profiles`) and the D6 `iris-governance://` resource both compute enablement via `getEffectivePolicy`, so they will report `clean` **enabled** consistently — no drift.

---

## 3. Recommended Approach

**Option 1 — Direct Adjustment.** Append one new single-story epic (Epic 20); no rollback, no MVP reduction.

**Rationale:** The capability is small, fully designed, and strictly additive. It extends an already-shipped tool with one new action, touches one ObjectScript handler and its TS schema, and reuses the existing namespace-switch + error-envelope + governance machinery. The single-story-epic shape matches Epics 18/19 and keeps the ledger clean with its own retro.

- **Effort:** Medium (one handler branch + schema field + double-gate guard + the `recover` arg fix + the additive governance-foundation "write, default-enabled" extension + tests + docs + bootstrap bump).
- **Risk:** Medium — two care-points, both mitigated: (1) the `killAppData` path is destructive to persistent business data → default-off + `confirm` double-gate + `destructiveHint` + loud docs; (2) the governance-foundation change touches all five servers → strictly additive (default-empty set), proven byte-for-byte unchanged when no action opts in (Rule #19), and gated by architect sign-off (decision F2). The `recover` arg fix is low-risk and corrects a likely-broken path.
- **Timeline/sequencing:** No dependencies; can start immediately. The foundation extension is small and self-contained within `@iris-mcp/shared`.

**Alternatives considered:**
- *New standalone tool* (rejected per stakeholder) — `recover` already lives in `iris_production_control`; `clean` is the same lifecycle family and belongs beside it. Avoids tool proliferation.
- *Wrap `killProductionGlobals` directly* (rejected) — `CleanProduction` adds the running-guard for free; calling the lower-level routine would drop that safety.
- *Always wipe `^Ens.AppData`* (rejected) — unacceptable data-loss risk per the research above.

---

## 4. Detailed Change Proposals

> Additive — new content blocks for `prd.md`, `architecture.md`, `epics.md`, `sprint-status.yaml`, plus the in-scope source edits delivered by Story 20.0. No before/after diffs for planning docs (nothing existing is modified). The two source edits below are shown old→new because one is a bug fix.

### 4.1 PRD addition (append to Functional Requirements)

**Epic 20 — Production Recovery / Clean (added 2026-06-30)**
- **FR128:** Integration engineer can clean an Interoperability production that is stopped in a bad state via a new `clean` action on `iris_production_control`, clearing the transient runtime/queue/job-status state (`Ens.Director.CleanProduction()`) so the production can be started cleanly. `clean` is a last resort: the tool description directs the client to try `recover` first and use `clean` only when `recover` does not resolve the problem. The action refuses while the production is running, is truthfully classified `mutates: "write"` but is **enabled by default** (via the new governance "write, default-enabled" mechanism — FR128 does not require an operator to opt in via `IRIS_GOVERNANCE`), and optionally — behind an explicit `killAppData:true` + `confirm:true` double-gate — additionally wipes the persistent `^Ens.AppData` application-data global (HL7 sequence numbers, file/FTP done-file tables, batch/control state). The default `clean` never touches `^Ens.AppData`.

### 4.2 Architecture additions (new ADRs — Epic 20, decisions F1 + F2)

- **New ADR — Epic 20 (decision F1).** *`clean` as a destructive-but-guarded, last-resort action on `iris_production_control`.* Add a `clean` action mapping to `Ens.Director.CleanProduction(pKillAppDataToo)`. Default `pKillAppDataToo=0` (transient runtime state only). The persistent `^Ens.AppData` wipe is opt-in via `killAppData:true` and double-gated with `confirm:true` (Rule #26). The tool description positions `clean` as a **last resort after `recover`** — `recover` is the preferred first response to a troubled production; `clean` is for when `recover` does not resolve it. *Rationale:* reuses the existing lifecycle tool + namespace/error/governance machinery; preserves `CleanProduction`'s running-guard; isolates the one data-loss path behind an explicit, audited gate. *Recorded caveats:* `CleanProduction` is `[ Internal ]` (re-verify on IRIS upgrade); the same change corrects a latent `recover` defect (extra arg to a no-arg `RecoverProduction()`).

- **New ADR — Epic 20 (decision F2).** *"Write, default-enabled" governance mechanism.* Extend the Epic 14 governance engine so a tool can declare specific `write` actions that should default to **enabled** without misclassifying them as reads and without touching the frozen baseline. A `defaultEnabled` marker on `ToolDefinition` (mirroring `mutates`'s per-action shape) feeds a `defaultEnabledWrites` set that is threaded as an **optional, default-empty** parameter through `defaultSeed`/`effective`/`getEffectivePolicy`; a write key in that set seeds to `true`. *Rationale:* keeps `mutates` truthful (Rule #28) and the truthful destructive signal in `annotations.destructiveHint`; preserves the frozen-baseline model (Rule #23/#25); strictly additive — empty set ⇒ byte-for-byte today's behavior, every other write still default-disabled (Rule #19). *Scope note:* this is the one change that touches the shared foundation used by all five servers, hence the architect sign-off gate. Final field/param naming is the architect's to confirm.

### 4.3 Source edits delivered by Story 20.0 (illustrative — final form confirmed in dev)

**Edit A — fix the latent `recover` bug** ([`Interop.cls:234`](../../src/ExecuteMCPv2/REST/Interop.cls#L234)):
```
OLD:  Set tSC = ##class(Ens.Director).RecoverProduction(tForce)
NEW:  Set tSC = ##class(Ens.Director).RecoverProduction()
```
*Rationale:* `RecoverProduction()` takes no arguments; the extra `tForce` likely raises `<PARAMETER>`. Verify live before/after.

**Edit B — extend action validation** ([`Interop.cls:163`](../../src/ExecuteMCPv2/REST/Interop.cls#L163)): add `clean` to the allowed-action set and the error message.

**Edit C — new `clean` branch** (after the `recover` branch, ~`Interop.cls:240`):
```
ElseIf tAction = "clean" {
    Set tKillAppData = +tBody.%Get("killAppData")
    If tKillAppData {
        ; Double-gate the destructive persistent-data wipe (Rule #26)
        If '+tBody.%Get("confirm") {
            Set $NAMESPACE = tOrigNS
            Set tSC = $$$ERROR($$$GeneralError, "killAppData wipes persistent ^Ens.AppData (HL7 sequence numbers, done-file tables, batch state) and requires confirm:true")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }
    }
    Set tSC = ##class(Ens.Director).CleanProduction(tKillAppData)
    Set $NAMESPACE = tOrigNS
    If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
    Set tResult = {"action": "cleaned", "killAppData": (tKillAppData)}
    Do ..RenderResponseBody($$$OK, , tResult)
}
```

**Edit D — TS schema** ([`production.ts:96`](../../packages/iris-interop-mcp/src/tools/production.ts#L96)): add `clean` to the `action` enum; add `killAppData` (boolean, optional) and `confirm` (boolean, optional) fields with descriptions warning about persistent-data loss; forward both fields in the request body. The tool **description** must state that `recover` is the **preferred** first response to a troubled production and that `clean` is a **last resort for when `recover` does not resolve the problem**. Governance: classify `clean` truthfully as `mutates: "write"` AND mark it default-enabled via the new `defaultEnabled` marker (decision F2).

**Edit E — governance foundation** (`@iris-mcp/shared`): per decision F2, add the `defaultEnabled` marker to `ToolDefinition` (`tool-types.ts`), a `buildDefaultEnabledWrites`-style collector + the optional `defaultEnabledWrites` parameter threaded through `defaultSeed`/`effective`/`getEffectivePolicy` (`governance.ts`), and wire it where `server-base.ts` calls those. Strictly additive (default-empty set). Also update the **MCP server `instructions`** field (shared server base) so the recover-preferred / clean-as-last-resort guidance surfaces at connect time, consistent with the tool description.

### 4.4 sprint-status.yaml addition (applied on approval)

```yaml
  # Epic 20: Production Recovery / Clean (iris-interop-mcp)
  # Added 2026-06-30 via bmad-correct-course. See sprint-change-proposal-2026-06-30.md.
  # ObjectScript touched (Interop.cls) → BOOTSTRAP_VERSION bump required (Rule #24).
  # Also extends Epic 14 governance foundation: new "write, default-enabled" mechanism (decision F2, additive).
  # New iris_production_control:clean key = mutates:write but default-ENABLED via defaultEnabled marker; frozen baseline 1e62c5ad5bf7 untouched.
  epic-20: backlog
  20-0-production-clean-action: backlog
  epic-20-retrospective: optional
```

### 4.5 New Epic (for `epics.md`)

---

## Epic 20: Production Recovery / Clean (added 2026-06-30)

**Goal**: Give integration engineers a way to recover a production wedged in a *non-running* bad state — stale runtime/queue/job-status globals that the soft `recover` action cannot fix — by adding a guarded `clean` action to `iris_production_control` backed by `Ens.Director.CleanProduction()`.

**Scope**: One new `clean` action on the existing `iris_production_control` tool — ObjectScript handler (`ExecuteMCPv2.REST.Interop.ProductionControl`) + TS schema (`production.ts`) — **plus** an additive extension to the Epic 14 governance foundation (`@iris-mcp/shared`: `tool-types.ts` + `governance.ts` + `server-base.ts` wiring) providing a "write, default-enabled" mechanism (decision F2). **BOOTSTRAP_VERSION bump required** (Rule #24). Also fixes a latent `recover` defect (extra arg to no-arg `RecoverProduction()`). **Strictly additive** — existing actions/outputs unchanged; `clean` is truthfully `mutates: "write"` but **enabled by default** via the new mechanism (the destructive `^Ens.AppData` wipe remains double-gated and off by default); absent the new marker, every other write stays default-disabled (byte-for-byte today's governance behavior).

**Functional Requirements (new)**: FR128.

**Stories**:
- 20.0 Production `clean` action (+ `recover` arg fix) + bootstrap bump + docs

**Out of scope (deferred)**:
- Auto-detecting the bad state and auto-cleaning — operator-initiated only.
- A standalone repair/diagnostics tool — `clean` lives in the existing lifecycle tool.
- Cleaning *across* namespaces in one call — single-namespace per call (consistent with the rest of `iris_production_control`).

### Story 20.0: Production `clean` Action

**As an** integration engineer,
**I want** a `clean` action on `iris_production_control` that clears a stopped production's stale runtime state (and, only on explicit double-confirmation, its persistent app data),
**so that** I can recover a wedged production that `recover` cannot fix — without manually killing globals at the terminal.

**Acceptance Criteria**:
- **AC 20.0.1** — `iris_production_control` accepts a new `action: "clean"`. The handler validates `clean` as an allowed action and routes it to `##class(Ens.Director).CleanProduction(tKillAppData)`; the success result is `{"action":"cleaned","killAppData":<0|1>}`.
- **AC 20.0.1a** — Preferred-action guidance: the tool **description** states that `recover` is the **preferred** first response to a troubled production and `clean` is a **last resort for when `recover` does not resolve the problem**. The shared MCP server **`instructions`** field carries the same guidance so capable clients surface it at connect time.
- **AC 20.0.2** — Default behavior (`killAppData` omitted/false) passes `pKillAppDataToo=0`: only transient runtime state is cleared (`^IRIS.Temp.EnsRuntimeAppData`, `$$$EnsRuntime`, `$$$EnsQueue`, job-status/request, suspended). `^Ens.AppData` is **not** touched.
- **AC 20.0.3** — The destructive persistent wipe (`killAppData:true`) is **double-gated**: it proceeds only when `confirm:true` is also supplied. `killAppData:true` without `confirm:true` is **refused** with a clear error naming the consequence, and changes nothing (live-verified per Rule #26).
- **AC 20.0.4** — The running-guard is honored: cleaning a running production returns `CleanProduction`'s native refusal ("Cannot clean Production '…' while it is running") via the standard `SanitizeError` envelope — no opaque `<…>` crash.
- **AC 20.0.5** — Governance (decision F2): `iris_production_control:clean` is classified **truthfully** `mutates:"write"` and marked **default-enabled** via the new `defaultEnabled` mechanism, so it resolves **enabled** under empty `IRIS_GOVERNANCE`. It is a new non-baseline key and does **not** modify the frozen baseline (`1e62c5ad5bf7`); `assertGovernanceClassification` passes (it carries `mutates`). The Epic 19 discovery tool and the D6 `iris-governance://` resource both report `clean` enabled (shared `getEffectivePolicy` — no drift). An operator can still disable it via an explicit `IRIS_GOVERNANCE` override (cascade honors explicit `false`).
- **AC 20.0.5a** — Foundation back-compat (Rule #19, capstone-style): with **no** action opting into `defaultEnabled` (the default-empty set), `defaultSeed`/`effective`/`getEffectivePolicy` are byte-for-byte unchanged and **every** existing `write` key still resolves **default-disabled**. A test sweeps the governed write keys and asserts all-disabled under empty config, and asserts `clean` is the only write flipped to enabled by the new marker. The foundation change is exercised on a representative real server (not only the pure functions).
- **AC 20.0.6** — Latent-bug fix: the `recover` action calls `RecoverProduction()` with **no** argument; live-verify `recover` works against a Troubled production before and after.
- **AC 20.0.7** — Back-compat (Rule #19): the 5 existing actions' request bodies and output shapes are unchanged (mechanical assertion — full-object `toEqual` on a representative call per action, or equivalent). No existing tool/schema changed beyond the additive `clean`/`killAppData`/`confirm` fields.
- **AC 20.0.8** — BOOTSTRAP_VERSION: regenerate `bootstrap-classes.ts` and record the from→to hash (Rule #24); `bootstrap.test.ts` green; `bootstrap-classes.ts` not hand-edited (Rule #18).
- **AC 20.0.9** — Tests: `clean` default (no app-data wipe) routing + result shape; `killAppData:true` without `confirm` rejected; `killAppData:true,confirm:true` passes `pKillAppDataToo=1`; running-guard error envelope; governance — `clean` resolves **enabled** by default through the real `handleToolCall` gate, an explicit `IRIS_GOVERNANCE` `false` still disables it, and the all-other-writes-still-disabled sweep (AC 20.0.5a); `recover` no-arg regression.
- **AC 20.0.10** — Docs rollup is a **required, in-scope deliverable of this story** (not a follow-up). Update README and **all linked documentation** so every place that lists `iris_production_control`'s actions includes `clean`. Concretely, this story MUST update:
  - **`packages/iris-interop-mcp/README.md`** — add `clean` to the `iris_production_control` action list + its usage block; document `killAppData`+`confirm` with the `^Ens.AppData` data-loss warning; state `recover` preferred / `clean` last-resort.
  - **Root `README.md`** + **`packages/iris-mcp-all/README.md`** — reflect the new action where the interop tools are described.
  - **`tool_support.md`** — update the `iris_production_control` row/action enumeration to include `clean`.
  - **`docs/migration-v1-v2.md`** and **`docs/tool-annotation-audit.md`** — update wherever `iris_production_control` actions are listed.
  - **Governance docs section** — document the new `defaultEnabled` "write, default-enabled" mechanism (F2) and that `clean` is a **write but enabled by default** (note *why*: recovery tools should be available out of the box) while still operator-disablable via `IRIS_GOVERNANCE`.
  - **`CHANGELOG.md`** — new entry covering the `clean` action, the F2 governance mechanism, and the `recover` arg fix.
  - **Completeness check:** grep the repo for the action enum across `*.md` so no user-facing list of `iris_production_control` actions is left without `clean` (Rule #30). **Tool count unchanged** (new action, not new tool).

**Implementation Notes**:
- **Governance F2 mechanism** — implement the "write, default-enabled" extension as the minimal additive change: a `defaultEnabled` marker on `ToolDefinition`, a collector + optional default-empty `defaultEnabledWrites` set threaded through `defaultSeed`/`effective`/`getEffectivePolicy`, wired at the `server-base.ts` call sites. Confirm final naming with the architect (decision F2). Do **not** touch the frozen baseline or misclassify `clean` as a read.
- **Description / instructions wording** — `clean`'s description and the shared `instructions` field must say `recover` is preferred and `clean` is the last resort when `recover` doesn't work (AC 20.0.1a).
- Reuse the existing namespace save/restore + `SanitizeError` + single-`RenderResponseBody` patterns already in `ProductionControl` (Rules #7, namespace-save-restore — no `New $NAMESPACE`).
- `CleanProduction` is `[ Internal ]` (Rule #4) — acceptable (Portal uses it); record the dependency in a code comment so an IRIS-upgrade audit re-verifies.
- Read `^Ens.AppData` characterization in this proposal §2 before wording the `killAppData` description — the warning must name HL7 sequence numbers, done-file re-ingestion, and batch/control state.
- Lead per-story smoke (Rule #22/#26): live-HTTP against the deployed route — confirm default `clean` succeeds on a stopped production, the `killAppData`-without-`confirm` path is **refused** (no change), and `recover` works post-fix.
- Keep the existing `.refine()` name-requiredness intact; `clean` does not require `name`.

---

## 5. Implementation Handoff

**Scope classification: Moderate–Major** — an ObjectScript handler edit + TS schema extension + a required BOOTSTRAP_VERSION bump + a strictly-additive governance-foundation extension touching all five servers, with one destructive (double-gated) path. Small and fully designed, but the foundation change warrants architect sign-off.

**Routing:**
1. **Architect (Winston)** — confirm decisions **F1** (clean action + double-gated `killAppData` + last-resort positioning + `recover` arg fix) and **F2** (the "write, default-enabled" governance mechanism + final field/param naming). F2 is the one change to the shared foundation, so this is a genuine design confirm, not just a sign-off.
2. **Scrum Master (Bob)** — run `/epic-cycle 20`: create Story 20.0 from this proposal and drive the cycle (dev → review → retro).
3. **Dev (Amelia)** — implement Story 20.0 per the ACs; honor the double-gate and governance classification; regenerate bootstrap.
4. **QA / Review** — verify the running-guard envelope, the `killAppData`-without-`confirm` refusal, governance default-disabled, the `recover` no-arg regression, and the back-compat assertion.

**Sequencing & dependencies:** None — can start immediately.

**Guardrails (project rules the dev/review agents must apply):**
- **Rule #19 / #23:** strictly additive — mechanical back-compat for the 5 existing actions AND for the governance foundation (empty `defaultEnabledWrites` ⇒ byte-for-byte today's seed; every other write still default-disabled); frozen baseline untouched.
- **Rule #21:** the foundation change carries a capstone-style test in the **default** suite proving the all-writes-still-disabled invariant and that `clean` is the only write flipped enabled — a test that would genuinely fail if the marker leaked to other keys.
- **Rule #24:** regenerate `bootstrap-classes.ts` + move `BOOTSTRAP_VERSION` in this story (ObjectScript changed).
- **Rule #26:** the destructive `killAppData` path must be refused without `confirm:true`, proven by a live-HTTP smoke.
- **Rule #28:** `clean` MUST carry a truthful `mutates:"write"` (default-enablement comes from the separate `defaultEnabled` marker, NOT from misclassifying it as a read).
- **Rule #30:** docs rollup states `clean` is a **write but enabled by default** (the deliberate F2 exception, with the *why*), that `recover` is preferred / `clean` is last resort, + the `^Ens.AppData` warning.
- **Rule #4 / #16:** record the `[ Internal ]` dependency; live-verify the IRIS API behavior.

**Success criteria:**
- FR128 demonstrably satisfied: a stopped, wedged production can be cleaned via `clean`; it can then start cleanly.
- Default `clean` never touches `^Ens.AppData`; the wipe requires `killAppData:true` + `confirm:true`.
- `recover` works (no-arg) post-fix, and is presented as the preferred action over `clean` in the description + `instructions`.
- `clean` resolves **enabled** by default (truthful `mutates:"write"` + `defaultEnabled` marker); every other write stays default-disabled; frozen baseline + 5 existing actions unchanged; an explicit `IRIS_GOVERNANCE` override can still disable `clean`.
- BOOTSTRAP_VERSION bumped; docs + CHANGELOG updated; tool count unchanged.

**Open items carried into implementation (non-blocking):**
- Final flag naming (`killAppData` / `confirm`) — confirm in dev against existing param conventions.
- Whether `clean` should also accept the existing `timeout`/`force` params (likely not — `CleanProduction` takes neither) — dev's call, recorded either way.
