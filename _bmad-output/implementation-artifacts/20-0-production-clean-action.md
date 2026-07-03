# Story 20.0: Production `clean` Action

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **integration engineer**,
I want **a `clean` action on `iris_production_control` that clears a stopped production's stale runtime state (and, only on explicit double-confirmation, its persistent app data)**,
so that **I can recover a wedged production that `recover` cannot fix — without manually killing globals at the terminal**.

## Acceptance Criteria

(Verbatim from [epics.md](../planning-artifacts/epics.md) Epic 20 / Story 20.0.)

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
- **AC 20.0.10** — Docs rollup is a **required, in-scope deliverable of this story** (not a follow-up). Update README and **all linked documentation** so every place that lists `iris_production_control`'s actions includes `clean`. Concretely: `packages/iris-interop-mcp/README.md`, root `README.md`, `packages/iris-mcp-all/README.md`, `tool_support.md`, `docs/migration-v1-v2.md`, `docs/tool-annotation-audit.md`, the governance docs section (document the `defaultEnabled` mechanism + "write but enabled by default" for `clean` with the *why*), and `CHANGELOG.md`. Grep the repo for the action enum across `*.md` so no `iris_production_control` action list is left without `clean` (Rule #30). **Tool count unchanged** (new action, not new tool).

## Tasks / Subtasks

- [x] **Task 1 — ObjectScript handler: add `clean` branch + fix `recover`** (AC: 20.0.1, 20.0.2, 20.0.3, 20.0.4, 20.0.6)
  - [x] In [`src/ExecuteMCPv2/REST/Interop.cls`](../../src/ExecuteMCPv2/REST/Interop.cls) `ProductionControl()`: add `clean` to the allowed-action validation at line 163 (and the error message at line 164 — append `, clean`).
  - [x] Add an `ElseIf tAction = "clean"` branch after the `recover` branch (~line 240). Read `Set tKillAppData = +tBody.%Get("killAppData")`. If `tKillAppData`, require `+tBody.%Get("confirm")`; if not confirmed → restore namespace, render `SanitizeError` with a message naming the `^Ens.AppData` consequence, `Set tSC=$$$OK`, `Quit`. Else call `Set tSC = ##class(Ens.Director).CleanProduction(tKillAppData)`, restore namespace, on error render `SanitizeError`, else `Set tResult = {"action":"cleaned","killAppData":(tKillAppData)}` and render.
  - [x] **Fix the latent `recover` bug (AC 20.0.6):** change line 234 from `##class(Ens.Director).RecoverProduction(tForce)` to `##class(Ens.Director).RecoverProduction()` (the method takes NO args — see Dev Notes).
  - [x] Add a `///` comment near the `clean` branch recording the `[ Internal ]` dependency on `CleanProduction` (Rule #4) and that the running-guard + `^Ens.AppData` semantics are documented in the Epic 20 change proposal.
  - [x] Update the method's `///` doc banner (lines 135–142) to include `clean` and its `killAppData`/`confirm` params.
  - [x] Follow the existing namespace save/restore pattern (Rule: no `New $NAMESPACE`; restore `Set $NAMESPACE = tOrigNS` before each render and first-line in the `Catch`) and the single-`RenderResponseBody`-per-path shape already used by the other branches.
  - [x] Compile via the `compile_objectscript_class` MCP tool; verify clean compile on HSCUSTOM.

- [x] **Task 2 — Governance foundation: "write, default-enabled" mechanism (F2)** (AC: 20.0.5, 20.0.5a)
  - [x] `packages/shared/src/tool-types.ts`: add an optional `defaultEnabled?: string[]` field to `ToolDefinition` (per-action list of `action` values that are writes but should default to enabled). Document it mirroring the `mutates` JSDoc — truthful `mutates` stays `write`; this is the ONLY lever to ship a write enabled-by-default without touching the frozen baseline.
  - [x] `packages/shared/src/governance.ts`: add `buildDefaultEnabledWrites(tools): ReadonlySet<string>` (mirror `buildMutatesLookup` at line 280; collect `tool.name:action` for each `defaultEnabled` action; validate the action isn't a `RESERVED_KEYS` member). Thread an **optional, default-empty** `defaultEnabledWrites: ReadonlySet<string> = new Set()` param through `defaultSeed` → `effective` → `getEffectivePolicy` (all three signatures). In `defaultSeed`, a write key present in the set returns `true` instead of `false`.
  - [x] `packages/shared/src/server-base.ts`: add `private defaultEnabledWrites: ReadonlySet<string> = new Set();`; build it in `rebuildMutatesLookup()` (line 431, alongside `buildMutatesLookup`) from `this.tools.values()`; pass `this.defaultEnabledWrites` to `getEffectivePolicy` (the resource, line 522) AND `effective` (the call-time gate, line 865).
  - [x] `packages/shared/src/server-discovery.ts` (Epic 19 `iris_server_profiles`): if it calls `getEffectivePolicy`/`effective`, thread `defaultEnabledWrites` there too so discovery reports `clean` enabled (AC 20.0.5 non-drift). Verify by reading the file — do NOT assume the signature.
  - [x] Confirm `assertGovernanceClassification` is unaffected (clean still carries `mutates:"write"`; the new marker is orthogonal).

- [x] **Task 3 — TS tool schema + description** (AC: 20.0.1, 20.0.1a, 20.0.5)
  - [x] [`packages/iris-interop-mcp/src/tools/production.ts`](../../packages/iris-interop-mcp/src/tools/production.ts) `productionControlTool`: add `"clean"` to the `action` enum (line 98); add `killAppData` (`z.boolean().optional()`) and `confirm` (`z.boolean().optional()`) fields with descriptions warning that `killAppData` wipes persistent `^Ens.AppData` (HL7 sequence numbers, file/FTP done-file tables → duplicate re-ingestion, batch/control state) and requires `confirm:true`.
  - [x] Extend `description` (line 91): add the `clean` action AND state `recover` is preferred / `clean` is last-resort (AC 20.0.1a).
  - [x] Add `mutates: { clean: "write" }` and `defaultEnabled: ["clean"]` to the tool definition (mirror the per-action `mutates` shape in [`item.ts`](../../packages/iris-interop-mcp/src/tools/item.ts)). Do NOT classify the 5 baseline actions.
  - [x] Handler: forward `killAppData`/`confirm` into `body` (mirror the existing `if (name)`/`if (timeout !== undefined)` conditional-append pattern at lines 143–145). Keep the existing `.refine()` name-requiredness (clean does not require `name`).

- [x] **Task 4 — MCP server `instructions` field** (AC: 20.0.1a)
  - [x] In `packages/shared/src/server-base.ts` (wherever the MCP `Server`/`instructions` is set — same field Epic 19 used for "call `iris_server_profiles` first"), append the recover-preferred / clean-last-resort guidance. Verify by reading the current `instructions` string; extend, don't replace.

- [x] **Task 5 — Bootstrap regen** (AC: 20.0.8)
  - [x] After Interop.cls is final + compiled: run `pnpm run gen:bootstrap` (Rule #18 — never hand-edit `bootstrap-classes.ts`). Record `BOOTSTRAP_VERSION` from→to in Completion Notes. Confirm `bootstrap.test.ts` green.
  - [x] Confirm `governance-baseline.ts` git-clean (frozen `1e62c5ad5bf7`); run `pnpm run gen:governance-baseline:check` → exit 0. Do NOT run the bare generator (Rule #25).

- [x] **Task 6 — Tests** (AC: 20.0.9, 20.0.5a, 20.0.7)
  - [x] `packages/iris-interop-mcp/src/__tests__/production.test.ts`: `clean` default routing (body `{action:"clean", killAppData:0?...}` → `pKillAppDataToo` path) + result shape; `killAppData:true` w/o `confirm` rejected at handler; `killAppData:true,confirm:true` forwards; unchanged bodies/outputs for the 5 existing actions (full-object `toEqual`, AC 20.0.7).
  - [x] Interop governance test (mirror [`item-governance.test.ts`](../../packages/iris-interop-mcp/src/__tests__/item-governance.test.ts)): `iris_production_control:clean` resolves **enabled** by default through the real `McpServerBase.handleToolCall` gate; an explicit `IRIS_GOVERNANCE {global:{"iris_production_control:clean":false}}` disables it.
  - [x] `packages/shared` governance test: `buildDefaultEnabledWrites` + `defaultSeed`/`effective`/`getEffectivePolicy` with the set — the all-other-writes-still-disabled sweep (AC 20.0.5a) AND empty-set byte-for-byte unchanged. Must be in the DEFAULT suite (not `*.integration.test.ts`).
  - [x] Ensure all new tests are discoverable by the default runner (Rule 8: naming, not excluded, not tagged out).

- [x] **Task 7 — Docs rollup** (AC: 20.0.10)
  - [x] Update the files enumerated in AC 20.0.10; grep `*.md` for the action enum (`start`/`stop`/`restart`/`update`/`recover`) to find every `iris_production_control` list and add `clean`. Tool count UNCHANGED (do not bump per-server counts). CHANGELOG entry covering `clean` + F2 + `recover` fix.

## Dev Notes

### Source-verified IRIS API (Rule #16 — read before wrapping)

- **`Ens.Director.CleanProduction(pKillAppDataToo As %Boolean) As %Status [ Internal ]`** — [`irislib/Ens/Director.cls:1371`](../../irislib/Ens/Director.cls#L1371). It: (a) rejects unsupported remote-worker namespaces; (b) **refuses while the production is running** — `If tState=$$$eProductionStateRunning ... Quit $$$EnsError(...,"Cannot clean Production '"_tProductionName_"' while it is running")`; (c) else calls `killProductionGlobals(.pKillAppDataToo)`.
- **`killProductionGlobals(pKillAppDataToo = 0)`** — [`Director.cls:1384`](../../irislib/Ens/Director.cls#L1384). ALWAYS kills: `$$$EnsRuntime`, `$$$KillAllEnsRuntimeAppData`, `$$$EnsQueue`, job-status/started/request, suspended. Kills `^Ens.AppData` **only if `pKillAppDataToo`**.
- **`Ens.Director.RecoverProduction() As %Status`** — [`Director.cls:642`](../../irislib/Ens/Director.cls#L642). **Takes NO arguments.** Acts only when state is `$$$eProductionStateTroubled` (else "Nothing to recover"); moves runtime → suspended. The current handler call `RecoverProduction(tForce)` at [`Interop.cls:234`](../../src/ExecuteMCPv2/REST/Interop.cls#L234) passes an extra arg → expected `<PARAMETER>` at runtime (AC 20.0.6). Verify live with a temp production before/after the fix.

### The `^Ens.AppData` distinction (why the double-gate)

Two different globals — mappings in [`irislib/Ensemble.inc:131-134`](../../irislib/Ensemble.inc#L131):
- `$$$EnsRuntimeAppData` → `^IRIS.Temp.EnsRuntimeAppData($namespace,...)` — **transient** scratch (`^IRIS.Temp`, cleared on restart): async-request tracking, scheduler alarm-set, BP retry, runtime archiving flags. `$$$KillAllEnsRuntimeAppData` clears it and is ALWAYS run by `clean` — this is the safe "unwedge" part.
- `$$$EnsStaticAppData` → `^Ens.AppData` — **persistent, per-config business state that survives restarts**: HL7 `ExpectedSequenceNumber` ([`EnsHL7.inc:12`](../../irislib/EnsHL7.inc#L12)), File/FTP "done file" tables ([`File/InboundAdapter.cls:231`](../../irislib/EnsLib/File/InboundAdapter.cls#L231), [`FTP/InboundAdapter.cls:376`](../../irislib/EnsLib/FTP/InboundAdapter.cls#L376)) — **wiping causes re-ingestion of already-processed files (duplicate messages)**, RecordMap/X12 batch + control-number state ([`EnsRecordMap.inc:10`](../../irislib/EnsRecordMap.inc#L10)), alert throttle counters ([`Ensemble.inc:365`](../../irislib/Ensemble.inc#L365)). Only wiped when `pKillAppDataToo=1`. This is why the `killAppData` wipe is behind an explicit `killAppData:true` + `confirm:true` double-gate (Rule #26).

### Handler pattern to mirror (do NOT reinvent)

[`Interop.cls` `ProductionControl()`, lines 143–248](../../src/ExecuteMCPv2/REST/Interop.cls#L143). Note: `Set tOrigNS = $NAMESPACE` up top; `SwitchNamespace` if `tNamespace '= ""`; per-branch `Set $NAMESPACE = tOrigNS` before every render; `Catch ex { Set $NAMESPACE = tOrigNS ... }`. Timeout/force read via `+tBody.%Get(...)` (Rule #15 — never `$Get()` wrapping a method call). The `clean` branch adds `killAppData`/`confirm` reads the same way. `CleanProduction` takes neither `timeout` nor `force`.

### Governance F2 threading (the novel part)

The engine ([`packages/shared/src/governance.ts`](../../packages/shared/src/governance.ts)) has only `read→enabled` / `write→disabled` (`defaultSeed`, line 401) + frozen-baseline membership. The baseline is FROZEN (`1e62c5ad5bf7`, Rule #23/#25) — cannot add to it. So to ship a truthful write enabled-by-default, add an orthogonal `defaultEnabled` marker + `defaultEnabledWrites` set threaded through `defaultSeed`/`effective`/`getEffectivePolicy` as an **optional default-empty** param (empty ⇒ byte-for-byte today's seed — AC 20.0.5a). Wiring call sites in [`server-base.ts`](../../packages/shared/src/server-base.ts): `mutatesLookup` field (line 328) + `rebuildMutatesLookup` (431); resource `getEffectivePolicy` (522); call-time gate `effective` (865). Also thread through `server-discovery.ts` (Epic 19 discovery tool) so the roster's policy agrees. **Keep `mutates: { clean: "write" }` truthful; `annotations.destructiveHint` stays `true`.** `assertGovernanceClassification` (line 478) is satisfied because `clean` carries `mutates`.

### Governance key model (why the 5 existing actions are untouched)

`computeGovernanceKey` derives one `tool:action` key per enum value. The 5 existing actions (`iris_production_control:start|stop|restart|update|recover`) are baseline members (in the frozen 141) → default-enabled, no `mutates` needed. Only `iris_production_control:clean` is new → must carry `mutates:"write"` (it does) → default-disabled UNLESS in `defaultEnabledWrites` (it is → enabled). Do NOT retro-classify the baseline actions (Rule: grandfathered tools omit `mutates`).

### Bootstrap & baseline (Rule #24 / #23 / #25)

Interop.cls changes → `pnpm run gen:bootstrap` regenerates `bootstrap-classes.ts` and moves `BOOTSTRAP_VERSION` (record from→to). Never hand-edit the generated file (Rule #18). `governance-baseline.ts` stays git-clean (frozen `1e62c5ad5bf7`); use `pnpm run gen:governance-baseline:check` (exit 0) — never run the bare generator (Rule #25 footgun).

### Back-compat is a release gate (Rule #19 / no-breaking-changes)

The suite has live users; all new features must be strictly additive. Prove it mechanically: (a) 5 existing actions' bodies/outputs unchanged (AC 20.0.7 full-object `toEqual`); (b) empty `defaultEnabledWrites` ⇒ every existing write still default-disabled (AC 20.0.5a sweep); (c) frozen baseline + no schema break.

### Project Structure Notes

- ObjectScript handler: `src/ExecuteMCPv2/REST/Interop.cls` (existing). TS tool: `packages/iris-interop-mcp/src/tools/production.ts` (existing). Shared governance foundation: `packages/shared/src/{tool-types.ts,governance.ts,server-base.ts,server-discovery.ts}`.
- No new tool file, no new package, no new REST route (reuses `POST /interop/production/control`). Tool count unchanged.
- This is the ONE story touching the shared foundation all 5 servers use — keep the F2 change minimal + default-empty so the other 4 servers are unaffected.

### References

- [Sprint Change Proposal 2026-06-30](../planning-artifacts/sprint-change-proposal-2026-06-30.md) (full design, decisions F1 + F2, `^Ens.AppData` research)
- [architecture.md § Production Recovery / Clean (Epic 20) — ADRs F1 + F2](../planning-artifacts/architecture.md)
- [prd.md FR128](../planning-artifacts/prd.md)
- [epics.md Epic 20 / Story 20.0](../planning-artifacts/epics.md)
- Project rules: #4 (`[Internal]` caution), #15 (no `$Get()` on method call), #16 (live-probe), #18 (generated files output-only), #19 (additive back-compat), #23/#25 (frozen baseline), #24 (per-story bootstrap regen), #26 (destructive-path rejection in live smoke), #28 (mutates required), #30 (docs default-state callout)

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — `claude-opus-4-8[1m]`.

### Debug Log References

Live IRIS probes (namespace HSCUSTOM, port 52773) via MCP tools + curl to `/api/executemcp/v2/interop/production/control`:

- **AC 20.0.6 (recover fix):** `RecoverProduction()` no-arg → empty error text (OK). `RecoverProduction(tForce)` with `tForce=1` → `CAUGHT: <PARAMETER>` (confirms the old bug and the fix).
- **AC 20.0.3 (double-gate):** `{"action":"clean","killAppData":true}` (no confirm) → `ERROR #5001: killAppData wipes the persistent Ens.AppData business state … requires confirm:true. No changes were made.` with `result:{}` (no change).
- **AC 20.0.4 (running-guard):** production started, `{"action":"clean"}` → `ERROR #5001: ERROR <Ens>ErrGeneral: Cannot clean Production 'SessionAgent.Sample.Production' while it is running` via SanitizeError (no opaque `<…>` crash).
- **AC 20.0.1/20.0.2 (happy path):** production stopped, `{"action":"clean"}` → `{"action":"cleaned","killAppData":0}`.
- Discovery snapshot (running server, pre-reload) confirmed the back-compat sweep is intact: `iris_production_item:add/remove` and `iris_default_settings_manage:set/delete` still `false` (default-disabled). `clean` appearing enabled requires an MCP server restart (lead smoke gate).

### Completion Notes List

- **Sanitizer collision (resolved):** `ExecuteMCPv2.Utils.SanitizeError` strips bare caret-global references (`^Ens.AppData`), which blanked the consequence in the double-gate error message. Reworded the ObjectScript message to name the state descriptively (`Ens.AppData`, no caret) so it survives sanitization (AC 20.0.3 "naming the consequence"); the TS `killAppData` description still spells out `^Ens.AppData`.
- **BOOTSTRAP_VERSION (AC 20.0.8):** `daeb5f0bd525` → `5376735fabab` (regenerated via `pnpm run gen:bootstrap`, Rule #18 — not hand-edited). `bootstrap.test.ts` green.
- **Frozen baseline (Rule #23/#25):** `governance-baseline.ts` git-clean, hash `1e62c5ad5bf7` untouched; `pnpm run gen:governance-baseline:check` exit 0 (141 frozen keys intact, 49 post-foundation new keys allowed one-directionally). Bare generator NOT run.
- **F2 mechanism:** `defaultEnabled?: string[]` on `ToolDefinition`; `buildDefaultEnabledWrites` collector; `defaultEnabledWrites` threaded (optional, default-empty) through `defaultSeed`/`effective`/`getEffectivePolicy` and `computeServerDiscovery`; wired at `server-base.ts` (field + `rebuildMutatesLookup` build + resource + gate + discovery call sites). Empty set ⇒ byte-for-byte pre-F2 seed (proven by tests). `clean` carries truthful `mutates:{clean:"write"}` + `defaultEnabled:["clean"]`; `assertGovernanceClassification` passes.
- **Tool count unchanged:** interop stays 20 (new action, not new tool); package `index.test.ts` length assertions unchanged (14 tests green), per Rule #31.
- **Validation:** full workspace `pnpm -r build` + `pnpm -r lint` clean; `pnpm -r test` all green — shared 547, data 121, interop 230 (production.test.ts 46, new control-governance.test.ts 3), dev 330, admin 439, ops 254. Zero regressions across all 5 servers.
- **Instructions field (AC 20.0.1a):** appended recover-preferred / clean-last-resort guidance to `SERVER_DISCOVERY_INSTRUCTIONS` (generic, all servers) alongside the description guidance in the tool.

### File List

**Modified — ObjectScript:**
- `src/ExecuteMCPv2/REST/Interop.cls` (clean branch, recover no-arg fix, doc banner, action validation)

**Modified — TypeScript (shared foundation, F2):**
- `packages/shared/src/tool-types.ts` (`defaultEnabled?: string[]`)
- `packages/shared/src/governance.ts` (`buildDefaultEnabledWrites`; `defaultEnabledWrites` threaded through `defaultSeed`/`effective`/`getEffectivePolicy`)
- `packages/shared/src/server-base.ts` (`defaultEnabledWrites` field + build + 3 call sites)
- `packages/shared/src/server-discovery.ts` (`computeServerDiscovery` param threading; `SERVER_DISCOVERY_INSTRUCTIONS` recover/clean guidance)
- `packages/shared/src/index.ts` (export `buildDefaultEnabledWrites`)

**Modified — TypeScript (interop tool):**
- `packages/iris-interop-mcp/src/tools/production.ts` (clean enum + killAppData/confirm fields + description + `mutates`/`defaultEnabled` + handler forwarding)

**Modified — generated (regenerated, not hand-edited):**
- `packages/shared/src/bootstrap-classes.ts` (`gen:bootstrap`, BOOTSTRAP_VERSION `daeb5f0bd525`→`5376735fabab`)

**Added — tests:**
- `packages/iris-interop-mcp/src/__tests__/control-governance.test.ts`
- (extended) `packages/iris-interop-mcp/src/__tests__/production.test.ts`
- (extended) `packages/shared/src/__tests__/governance.test.ts`

**Modified — docs:**
- `packages/iris-interop-mcp/README.md`, `README.md` (root), `tool_support.md`, `docs/tool-annotation-audit.md`, `CHANGELOG.md`

**Modified — sprint tracking:**
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (20-0 → in-progress → review)

### Review Findings

Code review 2026-07-02 (adversarial: Blind Hunter + Edge Case Hunter + AC/ADR audit against F1/F2). All 10 ACs verified against the implementation and the Accepted ADRs; ObjectScript `clean` branch, governance F2 threading (positional args across gate/resource/discovery), back-compat sweep, bootstrap idempotence (`5376735fabab` reproduced), and frozen baseline (`1e62c5ad5bf7` git-clean) all confirmed correct. 2 findings auto-resolved, 1 deferred, 3 dismissed.

**Auto-resolved (patched):**

- [x] [Review][Patch] `buildDefaultEnabledWrites` did not cross-validate `defaultEnabled` actions against `mutates` — a typo/drift (`defaultEnabled:["clena"]` vs `mutates:{clean:"write"}`) would emit an inert `tool:clena` key matching no real write, silently shipping the intended write DEFAULT-DISABLED with no error, quietly defeating the F2 opt-in the mechanism exists to deliver. Fixed with a fail-fast: each listed action MUST be a per-action `"write"` in the same tool's `mutates` (throws if absent, classified `read`, or the tool uses scalar `mutates`). Hardens the F2 foundation touching all 5 servers. `[packages/shared/src/governance.ts:buildDefaultEnabledWrites]` + 4 new tests in `governance.test.ts`. (source: blind+edge, finding #1)
- [x] [Review][Patch] `ToolDefinition.defaultEnabled` JSDoc claimed a scalar-`mutates` tool "can list its bare governance concept" — but `buildDefaultEnabledWrites` only emits `tool:action` keys, so a scalar-write tool's bare-name key is unaddressable → the documented path was unimplementable. Corrected the doc to state the per-action `mutates` record form is required (now also enforced by the finding-#1 fail-fast). `[packages/shared/src/tool-types.ts:defaultEnabled]` (source: edge, finding #2)

**Deferred (see deferred-work.md → "code review of story 20.0"):**

- [x] [Review][Defer] `recover` still accepts+forwards `force` which the server now ignores (advertised-vs-actual drift) [packages/iris-interop-mcp/src/tools/production.ts] — deferred: pre-existing tool-wide param, out of Story 20.0's additive scope; risks AC 20.0.7 back-compat gate. CR 20.0-1 / LOW.

**Dismissed (noise / by-design):**

- `killAppData` echoed as numeric `0/1` not boolean — DISMISSED: AC 20.0.1 explicitly specifies `{"action":"cleaned","killAppData":<0|1>}` (numeric is spec-mandated); tests codify it. (blind+edge, finding #3/#5)
- `force`/`timeout` silently ignored for `clean` with no schema signal — DISMISSED: tool-wide params, pre-existing pattern; same class as the deferred `recover`/`force` note. (blind, finding #3)
- `confirm:true` without `killAppData` is a silent no-op — DISMISSED: correct semantic; `confirm` is meaningless without `killAppData`, no escalation implied. (blind, finding #4)

**Post-fix validation:** shared 551 (+4), interop 234, dev 330, admin 439, data 121, ops 254 — all green. Lint clean. Bootstrap `bootstrap-classes.ts` unaffected by the fixes (shared TS only, not embedded); frozen baseline still git-clean.
