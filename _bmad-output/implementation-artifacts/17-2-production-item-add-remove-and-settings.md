# Story 17.2: `iris_production_item` — Add/Remove Items + Arbitrary Settings

**Status:** done

**Epic:** 17 — Interop & Dev Tools (`iris-interop-mcp` + `iris-dev-mcp`)

## Story

**As an** integration engineer, **I want** to add and remove production config items and set any host/adapter setting, **so that** I can edit a production fully (today's tool only toggles/sets the fixed property keys).

## Acceptance Criteria

- **AC 17.2.1** — Extend the EXISTING `iris_production_item` tool with `add` and `remove` actions (create/delete a config item in a production). The two new actions are mutating → `mutates: { add: "write", remove: "write" }` (default-disabled). The four existing actions (`enable`/`disable`/`get`/`set`) stay grandfathered (they are already in the frozen baseline `1e62c5ad5bf7` as `iris_production_item:{enable,disable,get,set}` — do NOT add them to `mutates`; baseline membership exempts them, verified in `governance.ts assertGovernanceClassification`).
- **AC 17.2.2** — Generalize the `set` action's `settings` object to accept **arbitrary host/adapter setting names** (not just the 5 working property keys), routing any non-property key to an `Ens.Config.Setting` (`Target` Host/Adapter, `Name`, `Value`) on the item's `Settings` list (per `17-0-api-probes.md` Area 2b). The 5 working property keys (`poolSize`/`enabled`/`comment`/`category`/`className`) continue to map to `Ens.Config.Item` properties **exactly as before**.
- **AC 17.2.3** — Backed by `Ens.Config.Production` (`%OpenId` → `Items.Insert` / `RemoveItem` → `SaveToClass`) + `Ens.Config.Item` (Required `Name`+`ClassName`) + `Ens.Config.Setting`; the production is updated/recompiled (`SaveToClass` for add/remove; `%Save()`+`Ens.Director.UpdateProduction()` for `set`, mirroring today's path). Use the verified recipes in `17-0-api-probes.md` Area 2a/2b.
- **AC 17.2.4** — **Back-compat gate (Rule #19 — MECHANICAL, not prose):** a failing-if-drift assertion proves the existing `enable`/`disable`/`get`/`set` actions are byte-for-byte unchanged: (a) the 5 working property keys still map to their `Ens.Config.Item` properties and the `set` output `{action:"set",itemName,updatedSettings:[...]}` shape is identical; (b) `enable`→`{action:"enabled",itemName}`, `disable`→`{action:"disabled",itemName}`, `get`→`{action:"get",itemName,className,enabled,poolSize,comment?,category?}` (comment/category omitted when empty) are unchanged; (c) the existing tool input params, defaults, and the `iris_production_item:{enable,disable,get,set}` governance keys are unchanged. New `add`/`remove`/arbitrary-setting behavior is ADDITIVE. (`adapterClassName`, which today THROWS `<PROPERTY DOES NOT EXIST>` per `17-0-api-probes.md` DISCREPANCY #1, may move to success via an Adapter `Ens.Config.Setting` — that is an additive error→success improvement and must NOT alter the 5 working keys' shape.)
- **AC 17.2.5** — Unit tests: `add` + `remove` + arbitrary-setting `set` + **back-compat mechanical assertions** (AC 17.2.4) + a governance proof through the real `McpServerBase.handleToolCall` gate (under empty `IRIS_GOVERNANCE`: `add`/`remove` DENIED keyed `iris_production_item:add`/`:remove`, handler never invoked; `enable`/`disable`/`get`/`set` ALLOWED — baseline-grandfathered). DEFAULT suite (`*.test.ts`).
- **AC 17.2.6** — **Bootstrap (Rule #24):** the `Interop.cls` `ItemManage` enhancement regenerates `bootstrap-classes.ts` (`pnpm run gen:bootstrap`) and moves `BOOTSTRAP_VERSION` IN THIS STORY (record from→to); `bootstrap.test.ts` green. **Governance baseline frozen (Rule #23/#25):** `governance-baseline.ts` stays `1e62c5ad5bf7` (141 keys); only `iris_production_item:add`/`:remove` are new (governed by `mutates`, NOT added to the baseline). Verify `pnpm run gen:governance-baseline:check` exit 0. Deploy via glob-prefixed `iris_doc_load` (Rule #17).

## Tasks / Subtasks

- [x] **Task 1 (AC 17.2.1/17.2.5)** — Extend `packages/iris-interop-mcp/src/tools/item.ts` `productionItemTool`: add `add`,`remove` to the action enum; add `mutates: { add: "write", remove: "write" }`; add optional inputs `production` (target production name for add/remove), `className` (Required for `add`); keep `settings` (now documented as accepting arbitrary host/adapter names + the existing property keys). Update the description. DO NOT change the existing `enable`/`disable`/`get`/`set` param handling.
- [x] **Task 2 (AC 17.2.2/17.2.3)** — Extend `ItemManage()` in `src/ExecuteMCPv2/REST/Interop.cls`: add `add` and `remove` branches (per `17-0-api-probes.md` Area 2a — `Ens.Config.Production.%OpenId(prod)`, `Items.Insert`/`RemoveItem`, `SaveToClass`). In the `set` branch, after applying the 5 recognized property keys, route any REMAINING (non-property) settings key to an `Ens.Config.Setting` via `FindSettingByName`/`%New()`+Insert on `tItem.Settings` (Area 2b). Preserve the existing 5-key property mapping + output shape exactly. Validate the action enum now includes `add`/`remove`. Resolve `production`: default to the namespace's active production (`##class(Ens.Director).GetActiveProductionName()`); if empty AND action is add/remove, require an explicit `production` param with a clear error. **NOTE (Rule #5 amendment):** the Area 2a recipe was corrected — a `##class(Ens.Config.Production).LoadFromClass(prod)` sync is required before `%OpenId` in BOTH add and remove (`SaveToClass` writes the class XData, not the config-object extent; without the sync a just-added item is invisible to remove). See `17-0-api-probes.md` DISCREPANCY #1b. Arbitrary-setting routing factored into a private `ApplyArbitrarySetting()` helper (shared by add+set; supports `@Host`/`@Adapter` key suffix, default Adapter).
- [x] **Task 3 (AC 17.2.1)** — Routes: the existing `/interop/production/item` POST route already dispatches to `ItemManage` — no new route needed (add/remove/set all flow through the same POST). Confirmed no route change required.
- [x] **Task 4 (AC 17.2.4/17.2.5)** — Tests in `packages/iris-interop-mcp/src/__tests__/item.test.ts` (+ governance test): add/remove request-body + output assertions; arbitrary-setting `set` routes a non-property key; **back-compat mechanical block** — `toEqual` snapshots pinning the existing enable/disable/get/set request bodies + output shapes (fails if drift). New `item-governance.test.ts` real-gate proof (add/remove denied, existing 4 allowed, opt-in flip). Tool count unchanged (20) — no count assertion bump needed.
- [x] **Task 5 (AC 17.2.6)** — Deployed `Interop.cls` to HSCUSTOM (glob `src/**/Interop.cls`, compile clean). `gen:bootstrap` BOOTSTRAP_VERSION `8c748712e247`→`39dc932907cb`. `gen:governance-baseline:check` exit 0, frozen `1e62c5ad5bf7` (141 keys, git-clean; add/remove are 2 of 43 allowed post-foundation keys). Full monorepo `turbo run test`(12/12)/`lint`(6/6)/`build`(6/6) green.

## Dev Notes

### Primary reference — READ FIRST
`_bmad-output/implementation-artifacts/17-0-api-probes.md` **Area 2** (2a add/remove recipe, 2b arbitrary-setting recipe, 2c the verbatim current `ItemManage` back-compat baseline). **DISCREPANCY #1 is critical:** `Ens.Config.Item.AdapterClassName` is a read-only calculated METHOD — `Set tItem.AdapterClassName=x` raises `<PROPERTY DOES NOT EXIST>`. So the current "6 keys" = **5 working property keys + `adapterClassName` which throws.** Framing B (recommended, additive): route `adapterClassName` (and any other non-property key) to an Adapter `Ens.Config.Setting` instead of throwing.

### The back-compat gate is the heart of this story (Rule #19)
This story modifies an EXISTING live tool with real users (the suite is published). The mechanical proof MUST fail if the existing `enable`/`disable`/`get`/`set` contract drifts. Concretely (mirror `17-0-api-probes.md` Area 2c):
- `enable` → `{"action":"enabled","itemName":<name>}`
- `disable` → `{"action":"disabled","itemName":<name>}`
- `get` → `{"action":"get","itemName","className","enabled"(bool),"poolSize"(num),"comment"?,"category"?}` (comment/category omitted when empty)
- `set` (5 property keys) → `{"action":"set","itemName","updatedSettings":[<applied keys>]}`, save via `%Save()`+`Ens.Director.UpdateProduction()`
The OFF-path (the existing actions + 5 property keys) is the back-compat promise; the ON-path (add/remove, arbitrary settings, adapterClassName→Setting) is additive. **Do not change existing param names, defaults, or output keys/types.**

### Governance (verified contract — declare `mutates` for add/remove ONLY)
The governance key universe is derived from the `action` ZodEnum (`server-base.ts rebuildGovernedKeys`: one `tool:action` key per enum value). Adding `add`/`remove` to the enum creates new keys `iris_production_item:add` / `:remove` (absent from the frozen baseline) → they MUST carry `mutates`. The existing `iris_production_item:{enable,disable,get,set}` ARE in the baseline → `assertGovernanceClassification` exempts them; do NOT add them to `mutates` and do NOT touch `governance-baseline.ts`. `mutates: { add: "write", remove: "write" }` is exactly correct and sufficient. Verify the baseline stays `1e62c5ad5bf7` (141 keys) via `gen:governance-baseline:check`.

### Bootstrap (Rule #24, per-story)
Editing `Interop.cls` (`ItemManage`) makes `bootstrap.test.ts` fail until `pnpm run gen:bootstrap` runs — expected; run it, record from→to (input baseline at story start is `8c748712e247` from Story 17.1). `bootstrap-classes.ts` is output-only (Rule #18 — never hand-edit).

### Established patterns
- `src/ExecuteMCPv2/REST/Interop.cls:326–475` (current `ItemManage` — extend in place; preserve the existing branches). Honor Rule #7 (single `RenderResponseBody` per request — the new add/remove branches each render exactly once; outer Catch restores namespace first then renders), Rule #9 (`SanitizeError` on `%Status`), namespace save/restore (NO `New $NAMESPACE`), Rule #15 (no `$Get()` on `%Get()`).
- `packages/iris-interop-mcp/src/tools/item.ts` (the tool to extend) + `packages/iris-ops-mcp/src/tools/process.ts` (`mutates` record shape) + `packages/iris-ops-mcp/src/__tests__/process-governance.test.ts` (real-gate harness).
- `Ens.Config.Item.FindSettingByName(pSettingName, pTarget="")` (`irislib/Ens/Config/Item.cls:342`) returns the Setting or `""`.
- structuredContent must be an OBJECT, not an array.

### `production` resolution for add/remove
`add`/`remove` need a target production. Default to `##class(Ens.Director).GetActiveProductionName()`; if that's empty (no active production) and the action is add/remove, return a clear error requiring an explicit `production`. Document the resolution in the tool description. (`enable`/`disable`/`get`/`set` keep operating by `itemName` only — unchanged.)

### Deploy (Rule #17)
`iris_doc_load path="c:/git/iris-execute-mcp-v2/src/ExecuteMCPv2/**/*.cls" compile=true namespace=HSCUSTOM` (glob-prefixed; never a bare path).

### Testing standards
- Unit (mocked http): add/remove bodies + outputs; arbitrary-setting set; **back-compat `toEqual` snapshots** for the existing 4 actions (fail-if-drift).
- Governance: real-gate proof (add/remove denied default; existing 4 allowed).
- Lead live-HTTP smoke (later gate): drive the deployed route — add a disposable item to a disposable/test production, set an arbitrary setting, remove it; AND confirm the existing `get`/`set`-5-keys output is unchanged on the live server (Rule #26 + Rule #19 live confirmation). Use clearly-disposable targets; clean up.

### References
- `17-0-api-probes.md` Area 2 (authoritative) + Summary discrepancy #1
- `epics.md:3606–3615` (Story 17.2 ACs + impl notes)
- `.claude/rules/project-rules.md` Rules #2, #7, #9, #15, #16, #17, #18, #19, #23, #24, #25, #26
- Patterns: `Interop.cls:326–475`, `item.ts`, `process.ts`, `process-governance.test.ts`, `irislib/Ens/Config/{Production,Item,Setting}.cls`

## Integration ACs

No NEW service introduced — this enhances an existing leaf tool (`iris_production_item`). No in-epic consumer; exercised by its own unit + governance + back-compat tests (AC 17.2.5) and the lead's live-HTTP smoke. (Rule 1 escape clause — enhancement of an existing tool with no in-epic consumers.)

## Review Findings

**Code review (2026-06-16, Opus 4.8 1M, epic-cycle code-review stage).** Three-layer adversarial review (Blind Hunter, Edge Case Hunter, Acceptance Auditor against the story + `17-0-api-probes.md` Area 2). Mechanical gates all GREEN.

### Back-compat gate (Rule #19 — HIGHEST PRIORITY) — PASS
- The 5 working property keys (`poolSize`/`enabled`/`comment`/`category`/`className`) map to `Ens.Config.Item` PROPERTIES byte-for-byte unchanged in BOTH `item.ts` and `ItemManage` (diff verified: the ONLY change to the existing `set` key-loop is the `adapterClassName` line moving from a throwing property-set to the `Else`→`ApplyArbitrarySetting` catch-all — the spec-sanctioned additive error→success per AC 17.2.4; the 5 keys' branches are identical).
- Existing output shapes unchanged: `enable`→`{action:"enabled",itemName}`, `disable`→`{action:"disabled",itemName}`, `get`→`{action:"get",itemName,className,enabled,poolSize,comment?,category?}` (comment/category omitted when empty), `set`→`{action:"set",itemName,updatedSettings}`.
- Back-compat `toEqual` snapshots are NON-VACUOUS: request-body block uses full-object `toEqual` on the 4 existing actions + the 5-property-key `set`; QA's output-shape block uses full-object `toEqual` on `structuredContent` (the verbatim REST `result` pass-through) for all 6 actions. Both fail if any key/type/omitted-when-empty behavior drifts.
- Governance: `mutates:{add:"write",remove:"write"}` ONLY; the 4 grandfathered keys carry no `mutates`. Baseline frozen `1e62c5ad5bf7` git-clean; `gen:governance-baseline:check` exit 0 (141 frozen / 186 live / 45 post-foundation). Bootstrap `8c748712e247`→`39dc932907cb`; `bootstrap.test.ts` green (41). Interop suite 219 (item 43 + item-governance 4). Governance test genuinely drives `McpServerBase.handleToolCall` (real schema+mutates, handler spied) and proves add/remove denied-by-default + enable/disable/get/set allowed + opt-in flip. **Rule #19 satisfied. No HIGH back-compat finding.**

### IRIS API verification (Rule #2/#16) — PASS
- `LoadFromClass` / `SaveToClass(pItem)` / `RemoveItem` / `FindItemByConfigName` / `FindSettingByName` all confirmed against `irislib/Ens/Config/{Production,Item}.cls` with the claimed signatures. DISCREPANCY #1b (`SaveToClass` writes class XData not the config-object extent → `LoadFromClass` sync required before `%OpenId` in add+remove) is REAL — confirmed in `Production.cls:117-186` (`SaveToClass` writes `ProductionDefinition` XData via `%Dictionary.ClassDefinition`; `LoadFromClass` reloads the extent from that XData). `SaveToClass(tItem)` (add) vs `SaveToClass()` (remove) arg usage matches the reference (the arg only triggers `OnConfigChange`). `ApplyArbitrarySetting` uses `Ens.Config.Setting` Target/Name/Value + `FindSettingByName(name,target)` correctly.
- Rule #7 (single `RenderResponseBody` per path, outer Catch restores `tOrigNS` first then renders once — no double-render), Rule #9 (`SanitizeError` on every `%Status` error path), namespace save/restore (no `New $NAMESPACE`), Rule #15 (no `$Get()` on `%Get()`) — all honored. No defects on these axes.

### Action items (deferred — see also `deferred-work.md`)
All findings below are on the NEW, default-DISABLED, write-gated `add`/`remove`/arbitrary-setting surface, or are pre-existing accepted IRIS limitations. None affect the back-compat gate. Deferred (not blocking) — the story's mechanical ACs are all met; these are robustness hardening for the new opt-in surface, several explicitly flagged as lead live-HTTP-smoke-must-cover.

- [x] [Review][Defer] `ApplyArbitrarySetting` `%Status` discarded at call sites [src/ExecuteMCPv2/REST/Interop.cls:463,528] — `Do ..ApplyArbitrarySetting(...)` ignores the returned status, so a setting-application failure is swallowed and the key is still pushed to `updatedSettings`. LOW impact: the helper only does in-memory `%New`/property-set/`Insert` (no save), so real persistence failures still surface at the checked `%Save()`/`SaveToClass`. Deferred — pre-existing-style accepted limitation (mirrors Story 5-3 "set save/update consistency", won't-fix); fix is to capture+propagate the status before `%Push` if hardened later.
- [x] [Review][Defer] `@Host`/`@Adapter` suffix parser edge cases [src/ExecuteMCPv2/REST/Interop.cls:606-615] — `$Find` matches the FIRST `@` (so `A@B@Host` mis-routes to name `A@B@Host`/Adapter); leading `@` (`@Host`) yields an empty setting Name; lowercase/typo/unknown suffix (`@host`,`@Foo`) silently folds into the name with default Adapter target. All silently reported as successful `updatedSettings`. NEW code; narrow input-robustness on the opt-in surface. No ObjectScript-layer test coverage (TS tests mock HTTP). **Lead live-HTTP smoke-must-cover:** assert `@Host`/`@Adapter` route correctly and a junk suffix is either rejected or documented.
- [x] [Review][Defer] `add` does not validate host `className` exists or that the item Name is unique in the production [src/ExecuteMCPv2/REST/Interop.cls:489-533] — a non-existent/non-host `className` writes a broken item (`SaveToClass` swallows `OnConfigChange <METHOD DOES NOT EXIST>` per `Production.cls:148-157`); the non-unique `(Production,Name)` index lets a duplicate-named item persist (add not idempotent). Out-of-scope for the additive AC (AC 17.2.3 pins the verified `Items.Insert`/`SaveToClass` recipe). Hardening; **smoke-must-cover:** add a duplicate name + a bogus className and observe behavior.
- [x] [Review][Defer] set-vs-add/remove persistence model + `LoadFromClass` side effects [src/ExecuteMCPv2/REST/Interop.cls:503,561,532-538] — `set` persists via extent `%Save()`+`UpdateProduction()`; `add`/`remove` persist via class-XData `SaveToClass`. `LoadFromClass` `%DeleteId`s + reloads the extent from XData, so (a) a just-`add`ed item is not visible to a subsequent `get`/`set` (which read the SQL extent) until the next add/remove `LoadFromClass` syncs it, and (b) sequencing `set` (extent-only) then `add`/`remove` can revert the extent to XData. This is the SAME issue closed won't-fix in Story 5-3 ("ItemManage set save/update consistency — pre-existing IRIS pattern limitation, no incidents"). The `LoadFromClass` sync is the dev's live-verified, required fix for the add→remove round-trip (DISCREPANCY #1b) — its destructive nature is inherent to the IRIS API. Deferred as pre-existing/accepted. **Smoke-must-cover:** confirm an `add` is observable (round-trip add→remove already live-verified by dev); note the extent/XData split in tool docs if it bites.
- [x] [Review][Defer] `LoadFromClass` return `%Status` ignored [src/ExecuteMCPv2/REST/Interop.cls:503,561] — invoked with `Do`, no status check; a silent `LoadFromClass` failure proceeds to `%OpenId` on a stale/half-loaded extent. The subsequent `'$IsObject(tProd)` guard catches total-open failure but not partial load. LOW; pair with the hardening above.

### Dismissed (noise / by-design)
- Tool-layer does not enforce `add`+`className` conditional-requiredness — by design ("forward verbatim, server `ValidateRequired` enforces"; tests assert the omitted-className body; Zod cannot express action-conditional requiredness and `.refine()` is project-banned on these schemas). Server returns a clean error.

## Dev Agent Record

### Agent Model Used
claude-opus-4-8[1m] (Opus 4.8, 1M context) via bmad-dev-story.

### Debug Log References
Live IRIS probes on HSCUSTOM (read-then-restore against `SessionAgent.Sample.Production`):
- **DISCREPANCY #1b found (Rule #5 NFR tripwire).** The Area 2a recipe opened the production with a bare `%OpenId` for both add and remove. Live probe proved this is broken for the add→remove round-trip: `SaveToClass(tItem)` persists the item into the production CLASS definition's `ProductionDefinition` XData (verified: XData contained the added item + its `FilePath` Setting), but does NOT update the `Ens.Config.Production` config-object extent. So a bare `%OpenId`/`FindItemByConfigName` after an add reads the STALE extent (count stayed 5, item "not found"). Fix: call `##class(Ens.Config.Production).LoadFromClass(prod)` to sync the extent from the class XData before `%OpenId`, in BOTH paths. Re-verified end-to-end: add (LoadFromClass) → count 5→6, Host `Charset=UTF-8` + Adapter setting persisted, `comment` property persisted; remove (LoadFromClass) → count 6→5, original state restored. Amendment recorded in `17-0-api-probes.md` Area 2a (DISCREPANCY #1b).
- `adapterClassName` (and any non-property key) now routes to an `Ens.Config.Setting` (additive error→success per framing B), via the shared `ApplyArbitrarySetting()` helper.
- Deploy note (Rule #17): the story's `src/ExecuteMCPv2/**/*.cls` glob maps class names to `REST.*` (drops the `ExecuteMCPv2` package) and fails to compile; the correct glob base is `src/**/Interop.cls` → `ExecuteMCPv2.REST.Interop` (compiled clean). No stray docs persisted from the failed first load.

### Completion Notes List
- **Tool (`item.ts`):** added `add`/`remove` to the action enum; `mutates: { add: "write", remove: "write" }` (the grandfathered enable/disable/get/set carry NO `mutates` — baseline-exempt); added optional `className` + `production` inputs; updated description. The handler is a pass-through — arbitrary setting keys are forwarded verbatim; the ObjectScript handler decides property-vs-Setting routing.
- **Handler (`Interop.cls` `ItemManage`):** action enum extended; `set` loop now routes any non-5-property key through `ApplyArbitrarySetting` (replacing the old `adapterClassName`→property line that threw `<PROPERTY DOES NOT EXIST>`); new `add` (Required className; production default→active, else error; `LoadFromClass`+`%OpenId`, `Items.Insert`, `SaveToClass(tItem)`) and `remove` (`LoadFromClass`+`%OpenId`, `FindItemByConfigName`, `RemoveItem`, `SaveToClass`) branches; new private `ApplyArbitrarySetting(pItem,pKey,pValue)` helper (`@Host`/`@Adapter` suffix; default Adapter). Rule #7 (single `RenderResponseBody` per path; outer Catch restores `tOrigNS` first), Rule #9 (`SanitizeError` on every `%Status`), namespace save/restore (no `New $NAMESPACE`), Rule #15 (no `$Get()` on `%Get()`) all honored. Output shapes: `add`→`{action:"added",itemName,production,className,updatedSettings}`, `remove`→`{action:"removed",itemName,production}`; the existing 4 shapes byte-for-byte unchanged.
- **Back-compat gate (Rule #19):** `item.test.ts` carries fail-if-drift `toEqual` snapshots pinning the enable/disable/get/set request bodies + the 5-property-key `set` body, plus an assertion that the four existing enum values + the two new ones are present and `mutates` is exactly `{add:"write",remove:"write"}`.
- **Governance (Rule #23/#25):** `item-governance.test.ts` proves through the REAL `McpServerBase.handleToolCall` gate that under empty `IRIS_GOVERNANCE`, add/remove are DENIED (`GOVERNANCE_DISABLED`, handler not called) and enable/disable/get/set are ALLOWED (grandfathered), and an explicit enable of `add` flips just that action. Baseline frozen `1e62c5ad5bf7` (git-clean); `gen:governance-baseline:check` exit 0.
- **Bootstrap (Rule #24):** `BOOTSTRAP_VERSION` `8c748712e247` → `39dc932907cb` (regenerated, not hand-edited).
- **Suites:** interop 208 (item 32 + item-governance 4); full monorepo test 12/12, lint 6/6, build 6/6 green.

### File List
- `packages/iris-interop-mcp/src/tools/item.ts` (modified)
- `src/ExecuteMCPv2/REST/Interop.cls` (modified)
- `packages/iris-interop-mcp/src/__tests__/item.test.ts` (modified)
- `packages/iris-interop-mcp/src/__tests__/item-governance.test.ts` (new)
- `packages/shared/src/bootstrap-classes.ts` (regenerated — output-only, Rule #18)
- `_bmad-output/implementation-artifacts/17-0-api-probes.md` (amended — Area 2a DISCREPANCY #1b, Rule #5)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status → review)

## Change Log

| Date | Change |
|---|---|
| 2026-06-16 | Story 17.2 created (lead). Grounded in `17-0-api-probes.md` Area 2 (incl. DISCREPANCY #1: AdapterClassName not settable). Extends EXISTING `iris_production_item` with `add`/`remove` (mutates:write, default-disabled) + arbitrary host/adapter settings via `Ens.Config.Setting`. Rule #19 mechanical back-compat gate pins the existing enable/disable/get/set + 5-property-key contract. Per-story bootstrap regen (Rule #24, from 8c748712e247); frozen governance baseline (Rule #23/#25 — only add/remove new). Status → ready-for-dev. |
| 2026-06-16 | Story 17.2 implemented (dev, Opus 4.8). `item.ts`: +add/remove enum, `mutates:{add,remove:"write"}`, +className/+production inputs. `Interop.cls ItemManage`: +add/+remove branches + `ApplyArbitrarySetting` helper (non-property keys → `Ens.Config.Setting`, `@Host`/`@Adapter` suffix, default Adapter; replaces throwing `adapterClassName` line). **Rule #5 amendment:** `17-0-api-probes.md` Area 2a corrected — `LoadFromClass` sync required before `%OpenId` for add/remove (live-found: `SaveToClass` writes class XData not the extent → DISCREPANCY #1b). Back-compat `toEqual` snapshots (Rule #19) + `item-governance.test.ts` real-gate proof. BOOTSTRAP_VERSION 8c748712e247→39dc932907cb (Rule #24); governance baseline frozen 1e62c5ad5bf7 git-clean, `--check` exit 0 (Rule #25). Live add→arbitrary-setting→remove round-trip verified on HSCUSTOM (production restored). Monorepo test 12/12, lint 6/6, build 6/6. Status → review. |
