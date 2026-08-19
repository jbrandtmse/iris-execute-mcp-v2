# Story 35.1: HIGH - `iris_production_item:set` Composite-Key Resolution

Status: review

> **RE-OPENED 2026-08-18 (Rule SC-5, cycle_iteration=3) by Project Lead decision.** Story 35.1 closed `done` with `35-1-CR-1` carried to the ledger as a HIGH awaiting a scoping decision. The Project Lead ruled it in scope for Epic 35: it is the SAME `get`/`set` contradiction this story exists to kill, reached by a second route, and Epic 35's charter is a beta with **no known-broken tool action**. Re-opened here rather than opened as a new story so the Epic 35 sprint keeps exactly its 10 planned keys. Scope of this pass is **AC 35.1.7 only** — Tasks 1-6 are finished work and must not be re-touched.

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **agent managing an IRIS interoperability production through the MCP suite**,
I want **`iris_production_item:set` to resolve the config item by its full composite key**,
so that **a settings update actually lands on the item instead of always failing with "Config item not found" — and never lands on the wrong production's item**.

## Context — why this story exists

`iris_production_item:set` **can never succeed.** Found by the post-Epic-34 full-surface sweep (ledger item `35-SWEEP-1`, HIGH), one of only two open HIGHs in the ledger and a beta blocker.

[Interop.cls:473](src/ExecuteMCPv2/REST/Interop.cls#L473) calls the **one-argument** form:

```objectscript
If '##class(Ens.Config.Item).NameExists(tItemName, .tID) {
```

but that index is **composite**. Verified at source in `irislib/Ens/Config/Item.cls:150`:

```objectscript
Index Name On (Production As Exact, Name As Exact);
```

So `tItemName` binds to the **Production** slot and the undefined ByRef `tID` binds to **Name** — the lookup can never match. Proven live during the sweep via `iris_execute_classmethod`: the two-key call returned `1` with id `835`; the one-key call returned `0`.

The blast radius is a **user-visible contradiction**: `get` (SQL over the extent, line 429) and `enable`/`disable` (`Ens.Director.EnableConfigItem`) do NOT use this index and work fine — so `get` happily resolves an item that `set` then reports as "not found".

This is precisely the trap **Rule #27 already codifies**. The rule existed; this call site never applied it. That makes AC 35.1.4's audit the most valuable part of the story: the question is not only "is line 473 fixed" but "where else did we do this?"

## Acceptance Criteria

1. **AC 35.1.1** — `Interop.cls:473` resolves the config item by its FULL composite key. `Ens.Config.Item`'s `Name` index is `(Production, Name)`; the current one-arg `NameExists(tItemName, .tID)` binds `tItemName` to the Production slot and can never match (Rule #27, already codified — this call site did not apply it).
2. **AC 35.1.2** — Probe-first (#16): before coding, confirm live which resolution API is correct and available — two-key `NameExists(prod, name, .id)` (verified working: returns 1, id 835 for `ExecuteMCPv2.Temp.SmokeProduction`/`SmokeFileOut`) versus `tProd.FindItemByConfigName(name)` as already used by this handler's `add`/`remove` paths (lines 609/693). Prefer consistency with the sibling paths unless the probe shows otherwise; record the probe output in Dev Notes.
3. **AC 35.1.3** — The production is resolved explicitly: from an optional `production` argument when supplied, else the namespace's active production, matching how `add`/`remove` already default it. An item name that is ambiguous across productions yields a clear error naming the candidates, never a silent wrong-row write (#29/#50).
4. **AC 35.1.4** — Audit the WHOLE handler for the same one-arg-composite pattern, not just line 473: grep every `NameExists(`/`%OpenId(`/`%ExistsId(` call in `Interop.cls` and `Security.cls` and confirm each passes a complete key. Report the audit result even if no further instances are found (#56 — enumeration completeness is a review question).
5. **AC 35.1.5** — Rule #48 mutation evidence: revert the fix, show `set` failing with "Config item not found" on a live item that `get` resolves, restore, show it passing. The regression test is pinned from LIVE behavior, not from the implementation (#36).
6. **AC 35.1.6** — Live proof on the real endpoint (#26): create a disposable production with items via class XData (`item:add` is governance-disabled), then `get` → `set` → `get` showing the mutation landed, plus `enable`/`disable` still working. Delete the production afterward.
7. **AC 35.1.7 (added at re-open, closes ledger HIGH `35-1-CR-1`)** — An item whose host `ClassName` no longer resolves to a business type MUST remain reachable through `set` AND `remove`. Today `Ens.Config.Production:findItemIdByName` skips such items outright (`irislib/Ens/Config/Production.cls:739` — `Continue:$$$eHostTypeUnknown=##class(Ens.Config.Item).GetBusinessType(tClassname,$$$NULLOREF)`), so `FindItemByConfigName` returns `$$$NULLOREF` and both actions report "not found" while `get` returns the item happily — the same `get`/`set` contradiction AC 35.1.1 exists to kill, by a second route, leaving the item **unrepairable through the tool**. The fix applies to BOTH `set` and `remove` (they share the idiom); a `set`-only fix would leave the handler internally inconsistent. The fallback must be probe-verified live, regression-pinned from a fixture whose XData names a non-host `ClassName`, and mutation-verified RED.

## Tasks / Subtasks

- [x] **Task 1 — Probe first, before writing any fix (AC: 35.1.2)**
  - [x] Stand up a disposable `ExecuteMCPv2.Temp.*` production class with at least one item via XData.
  - [x] From a Temp probe class, call BOTH candidate APIs against it and record actual return values in Dev Notes: one-arg `NameExists(name, .id)`, two-key `NameExists(prod, name, .id)`, and `tProd.FindItemByConfigName(name, .status)`.
  - [x] Confirm the composite index shape independently (`irislib/Ens/Config/Item.cls`), do not take this story's word for it.
  - [x] Delete the probe class before commit.
- [x] **Task 2 — Fix the `set` branch (AC: 35.1.1, 35.1.3)**
  - [x] Add production resolution to the `set` branch using the EXACT idiom the sibling paths already use (see Dev Notes for the verbatim lines).
  - [x] Replace the one-arg `NameExists` with the probe-selected resolution, preferring consistency with `add`/`remove`.
  - [x] Apply the Rule #27 ordering: `LoadFromClass(prod)` BEFORE `%OpenId(prod)`, as lines 591/598 and 676/684 already do.
  - [x] Ambiguity across productions → clear error naming the candidates; never a silent wrong-row write.
  - [x] Keep the error text contract for a genuinely-absent item, and include the production name in it.
- [x] **Task 3 — Enumeration audit (AC: 35.1.4)**
  - [x] Grep every `NameExists(` / `%OpenId(` / `%ExistsId(` in `Interop.cls` AND `Security.cls`; confirm each passes a complete key.
  - [x] Record the audit as a table in Dev Notes — every call site, its key completeness, verdict. **Report it even if no further instances are found.**
  - [x] Explicitly evaluate the `get` branch's unfiltered SQL (see Dev Notes — a related, separately-dispositioned observation).
- [x] **Task 4 — Regression test pinned from LIVE behavior (AC: 35.1.5, 35.1.6)**
  - [x] Add an `ExecuteMCPv2.Tests.*` test whose expected values come from the live probe, not from reading the implementation (#36).
  - [x] Mutation-verify: revert the fix → `set` fails on an item `get` resolves → restore → passes. Record both directions.
  - [x] Drive the LIVE endpoint over real HTTP (#26): `get` → `set` → `get` proving the mutation landed, plus `enable`/`disable` still working.
  - [x] Delete the disposable production afterward and verify it is gone.
- [x] **Task 5 — Bootstrap + gates**
  - [x] `Interop.cls` is a bootstrapped class — regenerate the embed IN THIS STORY (`pnpm run gen:bootstrap`) and record `BOOTSTRAP_VERSION` from→to (Rule #24). Verify regen is idempotent.
  - [x] Roster is UNCHANGED (no new `.cls`), so `scripts/gen-bootstrap.mjs` `classes[]` and the bootstrap test roster must NOT move (Rule #39).
  - [x] Verify Constraint E-2 with `pnpm gen:governance-baseline:check` ONLY.
- [x] **Task 6 — QA HIGH gap-close: `set` durability (cycle_iteration=2)**
  - [x] Probe-first (#16): confirm live whether `Ens.Config.Production:SaveToClass(pItem)` durably persists to the class XData and whether it (or `%Save()` alone) also updates the `Ens.Config.Item` SQL extent that `get` reads directly.
  - [x] Add the same class-validation guard `add` already applies (`%ExistsId` / `%Extends Ens.Host` / not-abstract) on `set`'s `className`-update path, extracted into a shared `ValidateHostClassName` classmethod so both branches call the SAME checks (not a parallel validator).
  - [x] Switch `set`'s persistence to write BOTH the SQL extent (`tItem.%Save()`, for `get`'s immediate visibility) AND the class XData (`tProd.SaveToClass(tItem)`, for durability across a later `LoadFromClass` resync or a recompile).
  - [x] Add a regression test making TWO sequential mutating `set` calls (field A, then field B) asserting field A still holds, plus a recompile-survival assertion; mutation-verify RED/GREEN on the real HTTP endpoint.
  - [x] Regenerate the bootstrap embed (`Interop.cls` changed again) and record `BOOTSTRAP_VERSION` from→to; re-verify Constraint E-2.
  - [x] Ledger the environmental parallel-`turbo`-flakiness observation in `deferred-work.md` (not this story's defect; not fixed here).
- [x] **Task 7 — Ledger HIGH `35-1-CR-1`: unresolvable-host-class items must stay reachable (AC: 35.1.7, cycle_iteration=3)**
  - [x] **Probe first (#16), before writing the fix.** Build a fixture production whose XData names a NON-host `ClassName`. Confirm live that: (a) `get` returns it, (b) `FindItemByConfigName` returns `$$$NULLOREF` for it, (c) two-arg `##class(Ens.Config.Item).NameExists(tProdName, tItemName, .tID)` DOES resolve it. Record all three outputs in Dev Notes.
  - [x] **Probe the swizzle interaction — this is the trap.** `SaveToClass` serializes `tProd`'s in-memory `Items` collection. Confirm live whether mutating an item obtained via `%OpenId(tID)` is picked up by `SaveToClass`, or whether the XData write silently persists STALE values. Take the item from `tProd.Items` — `tProd.Items.GetAt(tProd.Items.FindObjectId(tID))` — which mirrors the library's own idiom at `irislib/Ens/Config/Production.cls:725-727`. Do NOT assume; prove it.
  - [x] Add the composite-key fallback in BOTH `set` and `remove`: when `FindItemByConfigName` returns null, resolve via two-arg `NameExists` and take the item from `tProd.Items`.
  - [x] Regression-pin from a fixture production whose XData names a non-host `ClassName`; assert the item is reachable by `set` and `remove` and that a repair (setting a VALID `className`) restores normal resolution — the repair path is the user-visible point of the fix.
  - [x] Mutation-verify RED/GREEN on the REAL HTTP endpoint (#48/#59): remove the fallback → `set`/`remove` report "not found" on an item `get` returns → restore → both succeed.
  - [x] Regenerate the bootstrap embed and record `BOOTSTRAP_VERSION` from→to; re-verify Constraint E-2 check-only.
  - [x] Close `35-1-CR-1` with a TERMINAL disposition in `deferred-work.md` and recount the running tally mechanically (Rule #51).

## Dev Notes

### The defect, verified at source by the lead (do not re-derive from scratch, but DO confirm with your own probe)

Current [Interop.cls:473-479](src/ExecuteMCPv2/REST/Interop.cls#L473):

```objectscript
; Find the config item ID
If '##class(Ens.Config.Item).NameExists(tItemName, .tID) {
    Set $NAMESPACE = tOrigNS
    Set tSC = $$$ERROR($$$GeneralError, "Config item '"_tItemName_"' not found")
    ...
}
Set tItem = ##class(Ens.Config.Item).%OpenId(tID)
```

`irislib/Ens/Config/Item.cls:150` — **confirmed composite**:

```objectscript
Index Name On (Production As Exact, Name As Exact);
```

The `set` branch currently reads **only** `tItemName`; it has no `tProdName` at all. That is the root shape of the bug — not merely a wrong argument count, but a missing dimension.

### The exact idiom to copy — already in this same file, twice

`add` at [lines 523-525](src/ExecuteMCPv2/REST/Interop.cls#L523) and `remove` at [lines 656-658](src/ExecuteMCPv2/REST/Interop.cls#L656) both do:

```objectscript
Set tProdName = tBody.%Get("production")
If tProdName = "" { Set tProdName = ##class(Ens.Director).GetActiveProductionName() }
If tProdName = "" { ; ...clear error... }
```

then, **in this order** (Rule #27 — the extent is a cache, the class XData is truth):

```objectscript
Set tLoadSC = ##class(Ens.Config.Production).LoadFromClass(tProdName)   ; line 591
Set tProd   = ##class(Ens.Config.Production).%OpenId(tProdName)         ; line 598
Set tItem   = tProd.FindItemByConfigName(tItemName, .tFindStatus)       ; line 693 shape
```

**`FindItemByConfigName` is an INSTANCE method**, verified in `irislib/Ens/Config/Production.cls:674`:

```objectscript
Method FindItemByConfigName(pConfigItemName As %String, Output pStatus As %Status = {$$$OK}, pForceSwizzle As %Boolean = 0) As Ens.Config.Item
```

so it requires the production object first — which is exactly why the production-resolution step is a prerequisite, not an optional nicety.

**Note the `production` parameter already exists on this tool** for `add`/`remove`. Extending `set` to honor it is an **additive parameter on an existing action** — squarely inside Constraint E-1. It is NOT a new action key.

### Related observation for the AC 35.1.4 audit — evaluate, then disposition explicitly

The `get` branch at [line 429](src/ExecuteMCPv2/REST/Interop.cls#L429) queries:

```objectscript
SELECT Name, ClassName, Enabled, PoolSize, Comment, Category FROM Ens_Config.Item WHERE Name = ?
```

— **no Production predicate.** The sweep called `get` "unaffected", and that is true in the sense that it resolves rather than failing. But with two productions in a namespace each owning an item of the same name, `get` returns whichever row the extent yields first. That is the same incomplete-key class as the `set` defect (#50: a match key must carry every identity dimension), and it directly bears on AC 35.1.3's "never a silent wrong-row" requirement — a `get`/`set` pair could disagree about which item they are talking about.

**This is NOT automatically in scope.** Evaluate it, and either fix it consistently with `set` (preferred, if the fix stays small and back-compatible for the single-production case) or ledger it explicitly with rationale. **Do not silently ignore it** — an unreported enumeration gap is the Rule #56 failure mode, and AC 35.1.4 requires reporting the audit result either way. If you fix it, the single-production case must remain byte-identical in output (Rule #19).

### Audit surface for AC 35.1.4 (lead-enumerated starting point — verify and extend)

`Interop.cls` has ~30 `NameExists`/`%OpenId`/`%ExistsId` call sites. Most take a genuinely single-part key and are fine; these are the ones that merit real scrutiny:

| Line(s) | Call | Note |
|---|---|---|
| 473 / 481 | `Ens.Config.Item.NameExists` → `%OpenId(tID)` | **THE DEFECT.** Composite index, one-arg call. |
| 429 | `get` SQL `WHERE Name = ?` | No Production predicate — see the observation above. |
| 1398 / 1423 / 1431 / 1455 | `Ens.Config.Credentials` | Confirm `Credentials`' IdKey is genuinely single-part before declaring these clean. |
| 2375 / 2387 / 2421 / 2455 | `Ens.Config.DefaultSettings` | **Composite IdKey with `||` delimiter** (Rule #29). Confirm the key is fully assembled AND that the delimiter is rejected in user-supplied slots. |
| 58 / 96 / 547 / 579 / 666 / 1725 / 1850 / 1859 | `%Dictionary.*` class names | Single-part by nature; confirm and move on. |

Also sweep `Security.cls` per the AC. **Report the result even if the audit finds nothing further** — "no further instances" is a finding, and silence is not.

### Rule #59 — the proof path is NOT negotiable

AC 35.1.5 and 35.1.6 require evidence from the **real endpoint over real HTTP**. An in-IRIS round-trip is not acceptable substitute evidence: this epic exists because a green 2,878-test suite was blind to nine live defects, and Epic 34 shipped six separate "green badge over a dead check" incidents. **Prove the gate RED on the path it actually guards** — revert the fix and show the live failure, then restore and show the live pass. If a review layer proposes replacing the live assertion with an internal one, reject it.

### Constraints

- **Constraint E-1** — no new tool, no new action key; tool counts must not move (#31). The `production` argument on `set` is an ADDITIVE PARAMETER on an existing action. No `mutates` (#28) or preset (#53) classification is needed.
- **Constraint E-2** — `GOVERNANCE_BASELINE` frozen at `1e62c5ad5bf7` / 141 / 201 / 60. `pnpm gen:governance-baseline:check` **ONLY**; never the bare generator (#23/#25). If tripped, `git checkout --` immediately.
- **Rule #24/#39** — `Interop.cls` IS bootstrapped: regenerate in this story and record `BOOTSTRAP_VERSION` from→to; the roster does not move (no new class).
- **Rule #17** — `iris_doc_load` needs a glob-prefixed path: `c:/git/iris-execute-mcp-v2/src/**/Interop.cls`, never a bare file path.
- **Rule #55** — never generate file content through a shell heredoc; verify writes with `git diff --stat`.
- **ObjectScript** — argumented `Quit` is illegal inside Try/Catch (#1043); `$$$` not `$$`; never edit Storage sections; compile via the MCP compile tool.
- Do **not** modify `.vscode/settings.json`.

### Testing

- New/extended tests live in `ExecuteMCPv2.Tests.*` (keep classes ≤ ~500 lines; split rather than grow a large one).
- Per Rule #35, compare the returned `total` against the mechanical count of `Test*` methods; rerun per-class if short.
- Baselines to move only by the tests you add: `ExecuteMCPv2.Tests` 388/388 · `@iris-mcp/dev` 665/665 · `@iris-mcp/all` 120/120 · turbo 29/29 · epic gate 16/16, 0 skipped.
- Expected values come from the live probe (#36), never from reading the implementation.

### QA HIGH gap-close (cycle_iteration=2) — `set` does not durably persist

**QA finding (independently confirmed live three ways: sequential `set` calls, and a production-class recompile).** Root cause: pre-this-pass, `set` persisted via `tItem.%Save()` alone (the SQL extent only). Per Rule #27 the extent is a *cache* — the production class XData is the source of truth — and `add`/`remove` both persist via `tProd.SaveToClass(...)`. Because `set`/`add`/`remove` ALL begin with `LoadFromClass` (re-syncing the extent FROM the XData baseline), a `set` call that never reached XData was silently discarded by the NEXT such call (or a bare recompile).

**Probe-first (#16), live on HSCUSTOM, disposable `ExecuteMCPv2.Temp.Story351bProbe`/`Story351cProbe` (deleted before finishing):**

```
Probe 1 (SaveToClass durability + survives resync/recompile):
LoadFromClass0:OK;baselinePoolSize=1;
SaveToClass1(poolSize=5):OK;afterResync1_PoolSize=5;
SaveToClass2(comment):OK;afterResync2_PoolSize=5,Comment=story351b-probe;
afterRecompile_PoolSize=5,Comment=story351b-probe;restore:OK;
```

Confirms `SaveToClass(tItem)` durably persists to XData, survives a subsequent `LoadFromClass` resync (what the NEXT set/add/remove call does), AND survives an explicit class recompile — validating the chosen fix direction.

```
Probe 2 (does SaveToClass alone update the SQL extent 'get' reads directly, no LoadFromClass in between?):
baseline_extent_poolsize_via_property=1;
SaveToClass_only:OK;raw_sql_poolsize_after_SaveToClass_only=1;   <- extent NOT updated by SaveToClass alone
ItemSave_only(poolsize=9):OK;raw_sql_poolsize_after_ItemSave=9;  <- extent IS updated by %Save()
restore:OK;
```

**This is the trap the story flagged.** `SaveToClass` alone does not touch the SQL extent, and `%Save()` alone does not touch XData — neither write is individually sufficient. `get` reads the raw extent directly (no `LoadFromClass`), so the fix keeps BOTH writes: `tItem.%Save()` first (so an immediate `get` after `set` still sees the change — this is what AC 35.1.6's `get→set→get` round trip already depends on), then `tProd.SaveToClass(tItem)` (so the change survives the next resync/recompile — the QA HIGH).

**The className-guard hazard (QA-flagged, verified against `add`'s existing code before reuse per Rule #47).** `set` can update `className` via `settings.className`; `SaveToClass` on a bad/uncompiled className silently swallows an `OnConfigChange` `<METHOD DOES NOT EXIST>` and persists a broken item (`Production.cls:148-157`, confirmed at source). `add`'s existing guard (pre-this-pass lines ~605-637: `%Dictionary.CompiledClass.%ExistsId` → `%Extends Ens.Host` → not-abstract) already protects `add`'s top-level `className` argument, but `set`'s `settings.className` override had no equivalent guard. Rather than duplicating the three checks inline in `set` (an explicit "do not invent a parallel validator" instruction), the checks were extracted into a shared `ValidateHostClassName(pClassName) As %Status` classmethod with IDENTICAL logic/order/error text, called from BOTH `add` (mechanical extraction — same behavior, same error text) and `set`'s new `className` branch. `add`'s existing `ExecuteMCPv2.Tests.InteropHostGuardTest` (independent primitive-classification pin, doesn't call into `Interop.cls`) re-ran clean, confirming no behavior drift.

**Regression test (Rule #48/#59), `ExecuteMCPv2.Tests.InteropItemCompositeKeyTest:TestSetSequentialMutationsBothPersistAndSurviveRecompile`** — TWO sequential mutating `set` HTTP calls to DIFFERENT fields on the SAME fixture item (poolSize, then comment), asserting the first field still holds after the second call, plus a direct `$System.OBJ.Compile` recompile-survival assertion for both fields:

- **RED** (persistence line temporarily reverted to `%Save()`-only, redeployed): `iris_execute_tests` on this one method → **0/1 passed**, all three durability assertions failed (`field A must still hold after the SECOND 'set'`, `field A survives recompile`, `field B survives recompile`) — reproducing the exact QA-observed reversion live.
- **GREEN** (fix restored, redeployed): same method → **1/1 passed**; full class → **6/6 passed**.

Because `set` now durably rewrites the fixture productions' class XData, the test class also gained `OnAfterOneTest`/`RestoreFixtureBaseline` — before this pass, `OnBeforeOneTest`'s `LoadFromClass` silently undid a mutating test's write (extent-only); now it does not, so every mutating test's change would otherwise permanently drift the LIVE class definition away from its on-disk checked-in baseline. Verified post-suite via SQL (`Ens_Config.Item` extent) and `iris_doc_get` (class XData) that both fixtures are back to their checked-in baseline after a full run.

**Test evidence (this pass):**
- `ExecuteMCPv2.Tests.InteropItemCompositeKeyTest` (class): 6/6 passed (was 5 methods; +1 this pass).
- `ExecuteMCPv2.Tests` (full package, IRIS): **394/394** passed, 0 failed, 0 skipped — matches the mechanical `Test*` method count independently confirmed via `SELECT COUNT(*) FROM %Dictionary.CompiledMethod WHERE Parent %STARTSWITH 'ExecuteMCPv2.Tests.' AND Name %STARTSWITH 'Test' AND Private=0 AND ClassMethod=0` → `394` (Rule #35).
- `@iris-mcp/interop` (vitest, standalone): 334/334 passed; tool visibility `preset="full" visible=23 hidden=0` — unchanged (Constraint E-1, no new tool/action).
- `@iris-mcp/all` (vitest, standalone): 120/120 passed.
- `@iris-mcp/shared` (vitest, standalone): 1308/1308 passed, including `bootstrap.test.ts` and `governance-baseline-check.test.ts`.
- `@iris-mcp/dev` (vitest, standalone): 665/665 passed.
- `packages/shared` lint: 1 pre-existing warning (unused eslint-disable in `governance.ts`), unrelated to this pass — unchanged from cycle_iteration=1.
- Full parallel `pnpm turbo run build test lint` was NOT used as evidence here — see the ledgered `35-1-DEV-1` finding below; every suite above was run standalone per package instead, which is what actually exercised this pass's change.

**Bootstrap regen (Rule #24):** `Interop.cls` changed again in this pass (shared `ValidateHostClassName`, `set` branch guard + dual-write persistence). `pnpm run gen:bootstrap` — `BOOTSTRAP_VERSION` `b9933105994c` → `890ae82abfd2`. Re-ran a second time with an identical result (idempotent). Roster unchanged at 29 classes, `REST/Dispatch.cls` still last (Rule #39 — no new `.cls`).

**Governance baseline (Constraint E-2), re-verified:** `pnpm gen:governance-baseline:check` (check-only) — `141` frozen foundation keys / `201` live keys / `60` post-foundation new keys, unchanged, matching the frozen baseline exactly.

**Deferred-work ledger (this pass's explicit instruction):** while gathering the mutation-verify evidence above, the full parallel `pnpm turbo run build test lint` was observed to be unreliable in this dev environment independent of this story's diff (an A/B `git stash` isolation test at the pre-story baseline reproduced the same failures). Ledgered as `35-1-DEV-1` (MEDIUM) in `_bmad-output/implementation-artifacts/deferred-work.md` — NOT normalized as "known failures", not fixed here (out of this story's Interop.cls scope). Ledger state after this pass: 2 HIGH / 21 MEDIUM / 72 LOW = 95 open across 160 distinct items (65 terminal).

### Project Structure Notes

- Handler: `src/ExecuteMCPv2/REST/Interop.cls` (2,485 lines) — the `set` branch sits at ~460-520 inside the item-action dispatch.
- Tool layer: `packages/iris-interop-mcp/src/tools/` — likely NO change needed, since `production` already exists as a parameter for `add`/`remove`. Confirm before touching; a tool-layer change would need a Rule #31 count check.
- Namespace discipline: this handler switches namespaces (`SwitchNamespace`/`tOrigNS`). Restore `$NAMESPACE` on EVERY path including catch blocks, and render exactly ONE response body per request (Rule #7).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-35.1] — ACs verbatim, Constraints E-1/E-2.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#Post-Epic-34-full-surface-verification-sweep] — `35-SWEEP-1` with live evidence (returnValue 1 / id 835 two-key vs 0 one-key).
- [Source: src/ExecuteMCPv2/REST/Interop.cls#L473] — defect; #L523, #L591, #L598, #L609, #L656, #L693 — the idiom to copy.
- [Source: irislib/Ens/Config/Item.cls#L150] — the composite index, confirmed.
- [Source: irislib/Ens/Config/Production.cls#L674] — `FindItemByConfigName` signature, confirmed instance method.
- [Source: .claude/rules/project-rules.md] — #27 (Ens.Config XData-is-truth + LoadFromClass ordering), #29/#50 (key construction), #16 (probe first), #56 (enumeration completeness), #48/#36 (mutation + live oracle), #59 (proof path), #24/#39 (bootstrap), #7 (I/O + single response).
- [Source: _bmad-output/implementation-artifacts/35-0-epic-34-deferred-cleanup.md] — prior story (gate, done); its triage routes `35-SWEEP-1` here.
- [Source: irislib/Ens/Config/Production.cls#L117-L157] — `SaveToClass(pItem)` implementation, confirmed cycle_iteration=2: rewrites the class XData only, does not touch the SQL extent; the `OnConfigChange` silent-swallow on `<METHOD DOES NOT EXIST>` is at lines 148-157.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#Story-35.1-dev-pass-cycle_iteration=2] — `35-1-DEV-1`, the environmental parallel-`turbo` flakiness observation ledgered this pass.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

**AC 35.1.2 — Live probe transcript (Task 1).** Disposable `ExecuteMCPv2.Temp.Story351Prod` (production, one item `Story351Op` via XData, `EnsLib.File.PassthroughOperation`) and `ExecuteMCPv2.Temp.Story351Probe` (probe classmethod) loaded into HSCUSTOM via `iris_doc_load`/compile, then invoked via `iris_execute_classmethod`:

```
LoadFromClass:OK;
OneArgNameExists(name):return=0,id=;
TwoArgNameExists(prod,name):return=1,id=838;
FindItemByConfigName:FOUND,id=838;
```

Confirms the ledger's sweep finding (`35-SWEEP-1`: two-key → 1/id 835, one-key → 0) in a fresh session with a different disposable item (id 838). One-arg `NameExists` is unconditionally broken against a composite-key row; two-arg `NameExists` and `FindItemByConfigName` (the instance method `add`/`remove` already use) both resolve it and **agree on the same row ID** — so per AC 35.1.2's "prefer consistency with the sibling paths unless the probe shows otherwise," `FindItemByConfigName` was selected for the `set` fix. The composite index shape was independently re-read at `irislib/Ens/Config/Item.cls:150` (`Index Name On (Production As Exact, Name As Exact)`) — confirmed, matches the story's citation. Probe class and disposable productions deleted before finishing (see File List — none remain; `iris_doc_get metadataOnly` confirmed `ExecuteMCPv2.Temp.Story351Prod.cls` returns `exists:false` post-cleanup).

**AC 35.1.4 — Enumeration audit (Task 3).** Every `NameExists(`/`%OpenId(`/`%ExistsId(` call site in `Interop.cls` and `Security.cls`, mechanically enumerated via grep and individually verified against the referenced class's actual `IdKey`/`Index` definition in `irislib/`:

| Line(s) | Call | Key shape | Verdict |
|---|---|---|---|
| 473/481 (pre-fix) | `Ens.Config.Item.NameExists(tItemName,.tID)` → `%OpenId(tID)` | Composite `(Production, Name)` (`irislib/Ens/Config/Item.cls:150`); one-arg call omits Production | **THE DEFECT — FIXED** (Task 2): production resolved first, then `FindItemByConfigName` |
| 429 (pre-fix) | `get` SQL `WHERE Name = ?` | Composite key, single-column filter — with two productions sharing an item name, returns whichever row the extent yields first | **RELATED WEAKNESS — FIXED**: added an optional `production` SQL predicate, applied only when the caller supplies it (single-production/omitted case stays byte-identical, Rule #19) |
| 1398/1423/1431/1455 | `Ens.Config.Credentials.%ExistsId`/`%OpenId(tID)` | `Credentials`' `IdKey` is `SystemName` alone (`irislib/Ens/Config/Credentials.cls:64`: `Index SystemName On SystemName [ IdKey, PrimaryKey ]`) — `tID` IS that SystemName | CLEAN — genuinely single-part |
| 2375/2387/2421/2455 | `Ens.Config.DefaultSettings.%ExistsId`/`%OpenId(tId)` | Composite 4-tuple `production\|\|item\|\|hostClass\|\|setting`, fully assembled at line 2366 with a `\|\|`-delimiter-rejection guard at lines 2360-2365 (Rule #29) | CLEAN — pre-existing correct implementation; live-probed the SQL shape (`Production` column) while building the `get` fix and confirmed it matches |
| 58/96/1725/1850/1859 | `%Dictionary.ClassDefinition.%ExistsId(tName/tClassName/tSourceClass)` | `%Dictionary.ClassDefinition`'s `IdKey` is the class Name itself | CLEAN — single-part by nature |
| 547/570 | `%Dictionary.CompiledClass.%ExistsId`/`%OpenId(tClassName)` | Same — single-part class-name `IdKey` | CLEAN |
| 579/666 | `%Dictionary.ClassDefinition.%ExistsId(tProdName)` | Same — single-part | CLEAN |
| `Security.cls:1537` | `OAuth2.Server.Configuration.%OpenId(tId)` | `tId` read from the SAME row's own `ID` SQL column (`SELECT ID FROM OAuth2_Server.Configuration`) — opened by its own ID, not synthesized from an unrelated field | CLEAN |
| `Security.cls:2352` | `%SYS.X509Credentials.%OpenId(tRowAlias)` | `tRowAlias` read from the SAME row's own `Alias` column (`ListDetails` ROWSPEC); `X509Credentials` is keyed by Alias | CLEAN |
| 598/684 (pre-fix) + the new 524 | `Ens.Config.Production.%OpenId(tProdName)` | `Ens.Config.Production`'s `IdKey` is `Name` alone (`irislib/Ens/Config/Production.cls:95`: `Index indexName On Name [ IdKey ]`) — `tProdName` IS that key | CLEAN — genuinely single-part. **Added at code review (2026-08-17)**: an entire class was absent from this table (Rule #56 — a list wrong by OMISSION passes every test written against it) |
| 2422 (pre-fix) | `Ens.Config.DefaultSettings.%OpenId(tId)` | Reuses the same fully-assembled 4-tuple `tId` as line 2421 in the same branch | CLEAN — **added at code review (2026-08-17)**; the group's 5th site was omitted from the original 4-site row |

**Result (corrected at code review, 2026-08-17): 22 call sites in `Interop.cls` + 2 in `Security.cls`. 1 defect (line 473, fixed), 1 related weakness (line 429, fixed), 9 other call-site groups audited and confirmed clean. No further composite-key instances found in either file.**

> **Correction note (Rule #51/#56).** As first written this table enumerated **19** of the **22** pre-fix `Interop.cls` sites and its Result line said "7 other call-site groups … No further instances found" — a tally over an incomplete table. The three omitted sites (`Ens.Config.Production.%OpenId` ×2 and `Ens.Config.DefaultSettings.%OpenId` at 2422) were independently verified CLEAN at code review, so there is **no latent defect** — but the completeness CLAIM was wrong, which is exactly the Rule #56 failure mode the AC was written to prevent. Mechanically re-derived at review: `grep -nE "NameExists\(|%OpenId\(|%ExistsId\(" ` over both files.

**AC 35.1.3 — ambiguity-across-productions disposition.** The `set` fix always resolves to exactly ONE production first (explicit `production` argument, else `GetActiveProductionName()`, else a clear "no active production" error) before calling `FindItemByConfigName`, which is scoped to that one production. Because the lookup is never performed across multiple productions, "an item name ambiguous across productions" cannot arise as a runtime state for `set` — there is no second candidate to disambiguate BETWEEN, only "found in the resolved production" or "not found in the resolved production" (the latter now names the production in the error text). Per Rule #54 ("a branch the real system cannot reach is worse than a missing one"), no candidate-listing error branch was added for a state the design makes unreachable; this reasoning is recorded here instead. Live-proven with two productions sharing an item name (`ExecuteMCPv2.Temp.Story351Prod`/`Story351Prod2`, both named item `Story351Op`): a `set` write to `Story351Prod2` never appeared on `Story351Prod`'s same-named item, and a `set` naming a nonexistent production was rejected with `Production 'X' not found`, writing nothing anywhere.

**AC 35.1.5/35.1.6 — Rule #48/#59 mutation-verify transcript, both directions, on the REAL deployed endpoint (`iris_production_item` MCP tool → real HTTP POST `/api/executemcp/v2/interop/production/item`, per Rule #26 — the tool's `handler` calls `ctx.http.post`, confirmed by reading `packages/iris-interop-mcp/src/tools/item.ts`):**

*RED (fix reverted via `git apply -R` on the story's own diff, redeployed):*
- `get itemName:"Story351Op"` → 200, resolves the item.
- `set itemName:"Story351Op" production:"ExecuteMCPv2.Temp.Story351Prod" settings:{comment:"revert-should-fail"}` → **error**: `"Config item 'Story351Op' not found"` — the exact story defect, reproduced live on an item `get` had just resolved.
- Automated suite `ExecuteMCPv2.Tests.InteropItemCompositeKeyTest` on the reverted code: **2/4 failed** (`TestSetResolvesCompositeKeyOverRealHttp`, `TestSetNeverWritesWrongProductionRow` — both assertions tied directly to the fix); the other 2 (primitive pin, unknown-production rejection) coincidentally still pass on broken code since they don't depend on the fix.

*GREEN (fix restored via `git apply`, redeployed):*
- Same `set` call → succeeds: `{"action":"set","itemName":"Story351Op","production":"ExecuteMCPv2.Temp.Story351Prod","updatedSettings":["comment"]}`.
- Follow-up `get` confirms the mutation landed (`comment:"story-35-1-live-proof"` etc. across several rounds).
- Automated suite: **4/4 passed**.

**AC 35.1.6 — enable/disable still working.** Initial `enable` attempt (no explicit `production`) failed with `Failed to open Production definition 'ExecuteMCPv2.Temp.SmokeProduction'` — a **pre-existing environmental artifact**: `Ens.Director.GetActiveProductionName()` in this HSCUSTOM instance pointed to a class left over from an earlier (unrelated) sweep session that no longer exists on disk. This is unrelated to this story's fix — `enable`/`disable` call `Ens.Director.EnableConfigItem`, untouched by this story, which has always resolved only against the namespace's active/running production. After explicitly starting `ExecuteMCPv2.Temp.Story351Prod` (`iris_production_control action:"start"`, making it the genuinely active production), both `enable` and `disable` succeeded (`{"action":"enabled",...}` / `{"action":"disabled",...}`), and `get`/`set` continued to work correctly via both explicit `production` and default active-production resolution.

**Observed nuance (not a defect):** because the `set`/`add`/`remove` idiom calls `LoadFromClass(prod)` on every invocation (Rule #27 — the class XData is authoritative, the extent is a cache), a `set` call's settings persist only in the SQL extent (via `tItem.%Save()`, never `tProd.SaveToClass()`), so a LATER `set`/`add`/`remove` call's own `LoadFromClass` resets the item back to its XData baseline before applying that call's own settings. This is pre-existing behavior inherent to the idiom this story was instructed to copy (not introduced by this fix) — observed live when a prior `set`'s `poolSize:2` reverted to the XData baseline (`poolSize:1`) after a later `set` call. Documented here per Rule #56 rather than silently worked around.

**Bootstrap regen (Task 5, Rule #24):** `pnpm run gen:bootstrap` — `BOOTSTRAP_VERSION` `01dc15bb27df` → `b9933105994c`. Re-ran a second time with an identical result (idempotent). Roster unchanged at 29 classes (no new `.cls` — Rule #39 satisfied; `scripts/gen-bootstrap.mjs` and the bootstrap test roster were NOT touched).

### RE-OPEN cycle_iteration=3 (Task 7, AC 35.1.7) — closes ledger HIGH `35-1-CR-1`

**Probe first (#16), live on HSCUSTOM, disposable `ExecuteMCPv2.Temp.Story351dProbeProd`/`Story351dProbe` (deleted from IRIS and disk before finishing this pass).** Probe production has one item (`BadHostOp`) whose `ClassName="%Stream.GlobalCharacter"` — compiled but does not extend any recognized `Ens` business host type.

`ProbeBasics` classmethod, run via `iris_execute_classmethod`:

```
LoadFromClass:OK;get_sql_found:1,className=%Stream.GlobalCharacter,comment=probe-baseline;
GetBusinessType(%Stream.GlobalCharacter)=0,eHostTypeUnknown=0;
ProdOpened:1;
FindItemByConfigName_isObject:0,status:خطأ <Ens>ErrConfigItemNotFound: Item BadHostOp not found in Production ExecuteMCPv2.Temp.Story351dProbeProd;
TwoArgNameExists:1,id=1562;
```

Confirms all three probes the task requires: (a) `get` (raw SQL) resolves the item and reports `className=%Stream.GlobalCharacter` as-is; `GetBusinessType` for that class genuinely equals `$$$eHostTypeUnknown` (`0=0`), confirming `findItemIdByName`'s `Continue:$$$eHostTypeUnknown=...` guard fires for it; (b) `FindItemByConfigName` returns `$$$NULLOREF` with `$$$EnsErrConfigItemNotFound`; (c) two-arg `NameExists(prod, name, .id)` DOES resolve it (id `1562`).

**Swizzle-interaction probe — the trap the task flagged.** `ProbeOpenIdSwizzle` (mutate via `%OpenId(tID)` directly, then `SaveToClass`) vs `ProbeItemsCollectionSwizzle` (mutate via `tProd.Items.GetAt(tProd.Items.FindObjectId(tID))`, the library's own idiom):

```
ProbeOpenIdSwizzle:           id=1563;OpenIdOref:188@Ens.Config.Item;CollectionOref:188@Ens.Config.Item;sameOref:1;ItemSave:OK;SaveToClass:OK;afterReload_id=1564,comment=openid-swizzle-probe;
ProbeItemsCollectionSwizzle:  id=1565;CollectionFound:1;ItemSave:OK;SaveToClass:OK;afterReload_id=1566,comment=itemscollection-swizzle-probe;
```

`%OpenId(tID)` returned the **identical OREF** (`188@Ens.Config.Item`, `sameOref:1`) as the `tProd.Items` lookup — IRIS's in-process swizzling cache dedupes both paths to the same instance here, and BOTH mutations durably persisted (each `afterReload` re-check, via a fresh `LoadFromClass` + `NameExists`, shows the new comment surviving the resync). Per the task's explicit instruction ("if `%OpenId` actually works fine, say so with evidence and still prefer the `tProd.Items` idiom for consistency with the library"), the fix uses `tProd.Items.GetAt(tProd.Items.FindObjectId(tID))` — matching `irislib/Ens/Config/Production.cls:725-727` exactly — not because `%OpenId` was shown unsafe in this process, but for consistency with the library's own idiom (and because the swizzling-cache behavior that made `%OpenId` safe here is an implementation detail, not a documented guarantee).

**The fix.** A composite-key fallback added to BOTH the `set` branch (`Interop.cls` ~line 548, right after the existing `FindItemByConfigName` call) and the `remove` branch (~line 843): when `FindItemByConfigName` returns `$$$NULLOREF`, resolve via `##class(Ens.Config.Item).NameExists(tProdName, tItemName, .tFallbackID)`; if found, take the item from `tProd.Items.GetAt(tProd.Items.FindObjectId(tFallbackID))` before falling through to the pre-existing not-found error (unchanged text/shape). The fallback is scoped to the SAME already-resolved production — AC 35.1.3's cross-production guarantee is untouched, no new ambiguity path is introduced.

**Regression test**, new class `ExecuteMCPv2.Tests.InteropUnresolvableHostItemTest` (3 methods) with new fixture `ExecuteMCPv2.Tests.InteropUnresolvableHostFixtureProd` (durable, never started, two items — `UnresolvableSetOp` and `UnresolvableRemoveOp` — both `ClassName="%Stream.GlobalCharacter"`; deliberately OUT of the bootstrap manifest per Rule #39, mirroring the sibling fixtures):
- `TestGetResolvesItemWithUnresolvableHostClassName` — automates probe (a) as a permanent pin.
- `TestSetReachesUnresolvableHostItemAndRepairPersists` — the core AC 35.1.7 test. Directly asserts `FindItemByConfigName` cannot resolve the item pre-repair (not just documented — asserted), then `set`s a valid host `className` (`EnsLib.File.PassthroughOperation`) over real HTTP, asserts success + a follow-up `get` reflects it, then directly re-checks `FindItemByConfigName` now resolves the item WITHOUT the fallback — proving the repair restores NORMAL resolution, which is the user-visible point of the fix (not merely that the fallback keeps working).
- `TestRemoveReachesUnresolvableHostItem` — `remove` succeeds on the unresolvable item over real HTTP; a follow-up `get` confirms it is genuinely gone. Teardown re-creates the item directly (mirrors `ItemManage`'s own `add` idiom: `Items.Insert` + `SaveToClass`, no standalone `%Save()` on a not-yet-persisted new item).
- `OnBeforeOneTest`/`OnAfterOneTest` both restore both fixture items to their unresolvable-host-class baseline (CR 35.1-10 pattern — self-healing regardless of execution order or a prior aborted run). `RestoreFixtureItem` resolves the item using the SAME two-step approach the fix uses (`FindItemByConfigName`, then `NameExists`+`tProd.Items`), since the item may be in either state depending on which test ran last.

**Mutation-verify RED/GREEN on the REAL HTTP endpoint (Rule #48/#59).** Isolated ONLY the `Interop.cls` fallback diff via `git stash push -- src/ExecuteMCPv2/REST/Interop.cls`, redeployed, re-ran the new test class:
- **RED**: 1/3 passed. `TestSetReachesUnresolvableHostItemAndRepairPersists` and `TestRemoveReachesUnresolvableHostItem` both failed on exactly the fix-tied assertions (`"'remove'/'set' carries no errors — this is the Story 35.1 Task 7 defect: ... despite 'get' resolving the same item"`); the baseline `get`-only test still passed (correctly unaffected by the fix).
- **GREEN**: `git stash pop` restored the fix, redeployed — 3/3 passed.

**Test evidence:**
- `ExecuteMCPv2.Tests.InteropUnresolvableHostItemTest` (new class): 3/3 passed.
- `ExecuteMCPv2.Tests.InteropItemCompositeKeyTest` (sibling, Tasks 1-6, untouched): re-ran 8/8 clean — no regression.
- `ExecuteMCPv2.Tests` (full package, IRIS): **399/399** passed, 0 failed, 0 skipped — matches the mechanical `Test*` count (`SELECT COUNT(*) FROM %Dictionary.CompiledMethod WHERE Parent %STARTSWITH 'ExecuteMCPv2.Tests.' AND Name %STARTSWITH 'Test' AND Private=0 AND ClassMethod=0` → `399`) per Rule #35 (was 396; +3 new methods).
- `@iris-mcp/shared` (vitest, standalone): **1308/1308** passed, including `bootstrap.test.ts` **46/46**.
- `@iris-mcp/interop` (vitest, standalone): **336/336** passed; tool visibility `preset="full" visible=23 hidden=0` — unchanged (Constraint E-1, no new tool/action; `item.ts` and every other TS file untouched this pass).
- `@iris-mcp/all` (vitest, standalone): **120/120** passed.
- `@iris-mcp/dev` (vitest, standalone): **665/665** passed.
- Both fixture productions (`InteropCompositeKeyFixtureProd(2)` and the new `InteropUnresolvableHostFixtureProd`) verified back at their checked-in baseline via direct SQL after the full package run.

**Bootstrap regen (Rule #24):** `Interop.cls` changed again in this pass (the composite-key fallback in `set`/`remove`). `pnpm run gen:bootstrap` — `BOOTSTRAP_VERSION` `a73647f42c11` → `6846dba351a8`. Re-ran a second time; hashed `bootstrap-classes.ts` before/after — identical (idempotent). Roster unchanged at 29 classes, `REST/Dispatch.cls` still last, `scripts/gen-bootstrap.mjs`/`bootstrap.test.ts` untouched (Rule #39 — the two new `ExecuteMCPv2.Tests.*` classes stay OUT of the manifest by design).

**Governance baseline (Constraint E-2), re-verified:** `pnpm gen:governance-baseline:check` (check-only) — `141` frozen foundation keys / `201` live keys / `60` post-foundation new keys, unchanged, matching the frozen baseline exactly. Re-ran again after the bootstrap regen (which rebuilds `@iris-mcp/shared`) to be certain — still `141/201/60`.

**`35-1-CR-2` disposition (optional per the task).** Evaluated for a trivial close alongside this fix and **left deferred** — the existing in-code NOTE at the `set` branch's not-found check already documents why: `FindItemByConfigName`'s Output `%Status` reports `$$$EnsErrConfigItemNotFound` for the ORDINARY absence case too, so substituting it naively would replace the pinned AC 35.1.3 production-naming error text on the common path; correctly discriminating the genuinely-actionable causes needs real error-code inspection plus Rule #8 prefix stripping, not a drive-by. Not closed by this pass.

**Ledger (Rule #51):** `35-1-CR-1` closed with a TERMINAL "RESOLVED" disposition in `_bmad-output/implementation-artifacts/deferred-work.md` (new section "Terminal disposition — Story 35.1 (re-opened, cycle_iteration=3, Task 7) closes `35-1-CR-1`"), with the full probe/fix/test/gate evidence above summarized there too. Running tally recounted mechanically from the prior chained state: **1 HIGH / 30 MEDIUM / 75 LOW = 106 open / 173 distinct / 67 terminal** → **0 HIGH / 30 MEDIUM / 75 LOW = 105 open / 173 distinct / 68 terminal**. No open HIGHs remain in the ledger as of this pass.

**Cleanup:** both `ExecuteMCPv2.Temp.Story351dProbe(Prod).cls` deleted from IRIS (`iris_doc_delete`) and from disk (`src/ExecuteMCPv2/Temp/` removed — confirmed never git-tracked). `.vscode/settings.json` `objectscript.conn.active` was already `false`; not touched.

**Governance baseline (Constraint E-2):** `pnpm gen:governance-baseline:check` (check-only, never the bare generator) — `141` frozen foundation keys / `201` live keys / `60` post-foundation new keys, all matching the frozen baseline exactly. `governance-baseline.ts`/generated artifact untouched.

**Test evidence:**
- `ExecuteMCPv2.Tests` (full package, IRIS): **392/392** passed (0 failed, 0 skipped) — baseline 388 + 4 new methods in `InteropItemCompositeKeyTest`, matching the mechanical `Method Test` count in the new file (Rule #35).
- `@iris-mcp/interop` (vitest): **334/334** passed.
- `@iris-mcp/all` (vitest, run **in isolation** — see below): **120/120** passed.
- `@iris-mcp/dev` (vitest, via full `turbo run`): **665/665** passed.
- `pnpm turbo run build test lint` (full monorepo, parallel): build succeeded for all packages; `@iris-mcp/all` showed 4 test failures / 1 timeout when run IN PARALLEL alongside every other package's suite. **Root-caused as pre-existing test-runner flakiness, not caused by this story's change**: `git stash`'d this story's entire diff and re-ran `@iris-mcp/all` standalone at the pre-story baseline — 120/120 passed cleanly; popped the stash, rebuilt, and re-ran `@iris-mcp/all` standalone again with the fix applied — 120/120 passed cleanly. The parallel-only failures (a `preset` assertion expecting `"full"` but observing `"core"`, and a 20s timeout) are consistent with env-var/process contention across concurrently-spawned real-server test processes in `@iris-mcp/all`'s process-gate suites, not with anything this story's diff touches (no governance/preset code was changed). Flagged as a residual risk for the deferred-work ledger rather than "fixed" here — reproducing/fixing test-runner isolation is out of this story's scope (Interop.cls set/get composite-key resolution).
- `packages/iris-interop-mcp` lint: clean (0 errors). `packages/shared` lint: 1 pre-existing warning (unused eslint-disable in `governance.ts`, unrelated to this story).

### Completion Notes List

- Fixed `Interop.cls`'s `ItemManage` `set` branch: resolves the target production first (explicit `production` argument, else the namespace's active production — the same idiom `add`/`remove` already use), applies the Rule #27 `LoadFromClass` → `%OpenId` ordering, then resolves the item via `FindItemByConfigName` (an instance method, matching `add`/`remove`) instead of the broken one-arg `Ens.Config.Item.NameExists`. The `set` response envelope gained an additive `production` field (mirrors `add`/`remove`); the not-found error text now includes the production name.
- Additionally fixed the `get` branch's related weakness (AC 35.1.4 audit): added an optional `production` SQL filter, applied only when the caller supplies it — omitted stays byte-identical to the pre-story query/output (Rule #19).
- Extended the `iris_production_item` tool's TS description/parameter docs (`packages/iris-interop-mcp/src/tools/item.ts`) and README to reflect that `set` (and optionally `get`) now honor `production`; no schema/action/tool-count change (Constraint E-1 — `production` was already an optional parameter on this tool).
- Added durable fixture productions + a regression suite (`ExecuteMCPv2.Tests.InteropItemCompositeKeyTest`) covering the composite-key primitive contract and real end-to-end HTTP proof of the fix, mutation-verified in both directions.
- Regenerated the bootstrap embed and verified the frozen governance baseline; no roster or baseline drift.
- **cycle_iteration=2 (QA HIGH gap-close):** fixed `set` not durably persisting — probed live that `SaveToClass(tItem)` alone never updates the SQL extent and `%Save()` alone never updates the class XData, so `set` now performs BOTH writes. Extracted `add`'s existing className-validation guard into a shared `ValidateHostClassName` classmethod and applied it to `set`'s `className`-update path, closing the `SaveToClass`/`OnConfigChange` silent-swallow hazard QA flagged. Added a two-sequential-`set`-calls + recompile-survival regression test (`TestSetSequentialMutationsBothPersistAndSurviveRecompile`, now 6 methods total), mutation-verified RED (0/1, all 3 durability assertions failed) → GREEN (6/6) on the real HTTP endpoint. Added `OnAfterOneTest`/`RestoreFixtureBaseline` so mutating tests no longer permanently drift the live fixture classes' XData, now that `set` is durable. Bootstrap re-regenerated (`b9933105994c` → `890ae82abfd2`); governance baseline re-verified unchanged. Ledgered the pre-existing parallel-`turbo` flakiness (`35-1-DEV-1`) in `deferred-work.md` rather than fixing or normalizing it (out of this story's scope).
- **RE-OPEN cycle_iteration=3 (Task 7, AC 35.1.7, closes ledger HIGH `35-1-CR-1`):** an item whose host `ClassName` no longer resolves to a business type was skipped entirely by `Ens.Config.Production:findItemIdByName`, so `set`/`remove` reported it "not found" while `get` returned it happily — the same get/set contradiction Story 35.1 exists to kill, by a second route, leaving the item unrepairable through the tool. Probed live (disposable `Temp.Story351dProbe(Prod)`, deleted before finishing) both the defect shape and the swizzle-interaction trap the task flagged: `%OpenId(tID)` and `tProd.Items.GetAt(tProd.Items.FindObjectId(tID))` returned the identical in-process OREF and both durably persisted — `%OpenId` was not shown unsafe, but the fix still uses the `tProd.Items` idiom for consistency with the library's own code at `Production.cls:725-727`. Added a composite-key fallback (two-arg `NameExists` + `tProd.Items` lookup) to BOTH the `set` and `remove` branches, scoped to the already-resolved production. New regression class `InteropUnresolvableHostItemTest` (3 methods) + fixture `InteropUnresolvableHostFixtureProd`, mutation-verified RED (1/3) → GREEN (3/3) on the real HTTP endpoint by isolating the `Interop.cls` diff via `git stash`. `ExecuteMCPv2.Tests` 399/399 (mechanical match); sibling `InteropItemCompositeKeyTest` unaffected (8/8). Bootstrap re-regenerated (`a73647f42c11` → `6846dba351a8`, idempotent); governance baseline re-verified unchanged (141/201/60). `35-1-CR-2` evaluated and left deferred (documented rationale unchanged). `35-1-CR-1` closed RESOLVED in `deferred-work.md` with a new Terminal disposition section; ledger tally recounted mechanically (Rule #51): 106 open (1 HIGH) → 105 open (0 HIGH) — no open HIGHs remain in the ledger.

### cycle_iteration=4 (smoke-failure repair) — self-corrupting test fixture

**Trigger.** The lead's post-close re-smoke of this `done` story found `ExecuteMCPv2.Tests.InteropUnresolvableHostItemTest` failing **5/5**, root-caused by the lead to a deployed-XData corruption of `ExecuteMCPv2.Tests.InteropUnresolvableHostFixtureProd` (three `<Item d5p1:nil="true".../>` placeholders replacing `UnresolvableRemoveOp`/`DeletedHostOp`), left behind by a PRIOR run of this very test class. Scope for this pass: repair the self-corrupting test-side fixture management ONLY — no `Interop.cls` product-code change.

**Reproduce and confirm the mechanism (#16).** Ran `ExecuteMCPv2.Tests.InteropUnresolvableHostItemTest` against the lead-restored (clean, byte-identical-to-disk) fixture: **5/5 failed**, every method's teardown/setup throwing `#5659: Property 'Ens.Config.Item::ClassName(...,ID=)' required` / `'Ens.Config.Item::Name(...,ID=)' required` out of the (now-removed) `RestoreFixtureItem` helper's `tItem.%Save()` call. Read the deployed fixture XData back immediately after: **reproduced the exact corruption pattern** the lead reported — three `<Item d5p1:nil="true" xmlns:d5p1="http://www.w3.org/2001/XMLSchema-instance"/>` placeholders plus one surviving `<Item Name="UnresolvableSetOp" .../>`.

**Root cause, confirmed.** `RestoreFixtureItem` was called **three times** per `OnBeforeOneTest`/`OnAfterOneTest` invocation (once per fixture item — `UnresolvableSetOp`, `UnresolvableRemoveOp`, `DeletedHostOp`), each call independently doing its own `LoadFromClass` + `%OpenId(PRODNAME)` + item mutation + `SaveToClass`. IRIS's per-process object/swizzle cache is keyed by OID and is **not** invalidated by a *different* `LoadFromClass` (`%DeleteId` + reconstruct) cycle run earlier in the same process — so the 2nd/3rd call's `%OpenId(PRODNAME)` inside the SAME hook invocation returned a **stale cached `tProd`** left resident from the 1st call, whose `Items` collection no longer matched the just-recreated extent rows. `tProd.Items.GetAt(pos)` (taken via the `NameExists`+`FindObjectId` fallback path, exactly the code the story's own Task 7 fix pattern uses) returned an **unpopulated placeholder** `Ens.Config.Item` instead of the persisted row. `%Save()` on that placeholder failed with `#5659` (confirmed above), and the following `SaveToClass()` (which serializes the WHOLE `Items` collection via `XMLExportToStream`, `irislib/Ens/Config/Production.cls:144`) rendered that empty collection slot as an XML `xsi:nil` placeholder — permanently corrupting the deployed class XData for the next run, while the suite itself stayed loudly red (never silently green). The culprit helper is `RestoreFixtureItem` (called from `OnBeforeOneTest`/`OnAfterOneTest`), not `DropDuplicateItems` or the `remove`-test teardown as such — those ran on the SAME already-stale `tProd` handed to them.

**The fix.** Replaced the three-call, per-item, object-mutation restore machinery (`RestoreFixtureItem`, `DropDuplicateItems`, `SaveProductionForItem` — all removed) with a single `RestoreFixtureBaseline()` that rewrites the fixture class's ENTIRE `ProductionDefinition` XData directly via `%Dictionary.ClassDefinition`/`%Dictionary.XDataDefinition` (the same low-level primitive `Ens.Config.Production:SaveToClass` itself uses, `Production.cls:132-146`) from a literal known-good `BaselineXData()` string byte-identical to the checked-in `.cls`, then `$System.OBJ.Compile(..#PRODNAME,"ck-d")`, then an explicit `Ens.Config.Production:LoadFromClass` resync. This never opens or mutates an `Ens.Config.Item`/`Ens.Config.Production` OBJECT during restore, so it cannot inherit the swizzle-cache staleness that corrupted the deployed XData — the whole-text rewrite always converges to the same known-good state regardless of starting condition (satisfying "idempotent and self-restoring... from any starting state").

**Guard assertion added (Rule #58/#59 — never invisible again).** New `VerifyFixtureIntegrity()`, called at the end of every `RestoreFixtureBaseline()`, asserts the deployed XData: contains no `nil="true"` placeholder, contains all three expected `Name="..."` items, and has exactly 3 `<Item ` elements — returning a failing `%Status` (asserted loudly via `$$$AssertStatusOK` in both `OnBeforeOneTest` and `OnAfterOneTest`) if not. A future regression of this failure mode fails the CURRENT run loudly instead of silently poisoning the next one.

**A second, unrelated hazard found and resolved during verification.** The first post-fix run still showed 2/5 failing (`TestAddRejectsDuplicateOfUnresolvableHostItem`, `TestSetOnDeletedHostClassReportsTruthfully`) even though the fixture-corruption symptoms (the `#5659` errors) were gone and the deployed XData was confirmed byte-identical to disk. Diffing the DEPLOYED `Interop.cls` against the on-disk (git-uncommitted, already-reviewed) source found the deployed copy was **missing the CR 35.1-15 fix** (the `SaveToClass`-overload selection on a deleted host class) — a pre-existing live/disk deployment-sync gap in the shared HSCUSTOM instance, unrelated to this pass's fixture edit and not caused by it (git shows this as a pre-existing uncommitted diff on `Interop.cls`, untouched by this pass — confirmed via `git diff --stat`, zero lines attributable to this session). Redeployed `Interop.cls` from disk (`iris_doc_load` + compile, no source edit) to resync; both tests then passed. This redeploy is a deployment-sync action, not a product-code change — no `Interop.cls` source line was authored in this pass.

**Mutation evidence / proof (Rule #48/#59).** RED: `#5659`/nil-corruption reproduced live from the lead-restored clean baseline (5/5 failed, XData corrupted — read back and confirmed). GREEN, three consecutive full-class runs after the fix: **5/5, 5/5, 5/5** (all methods, including `TestAddRejectsDuplicateOfUnresolvableHostItem`, `TestGetResolvesItemWithUnresolvableHostClassName`, `TestRemoveReachesUnresolvableHostItem`, `TestSetOnDeletedHostClassReportsTruthfully`, `TestSetReachesUnresolvableHostItemAndRepairPersists`). After the three runs, deployed fixture XData re-read and confirmed **byte-identical** to `InteropUnresolvableHostFixtureProd.cls` on disk; direct SQL against `Ens_Config.Item` confirmed exactly 3 clean rows (`UnresolvableSetOp`/`UnresolvableRemoveOp`/`DeletedHostOp`, no duplicates, no orphans).

**Sibling and package regression.** `ExecuteMCPv2.Tests.InteropItemCompositeKeyTest` (Tasks 1-6, untouched by this pass): **8/8** clean. `ExecuteMCPv2.Tests` (full package): **401/401** passed, 0 failed, 0 skipped, matching the mechanical `Test*` method count (`SELECT COUNT(*) FROM %Dictionary.CompiledMethod WHERE Parent %STARTSWITH 'ExecuteMCPv2.Tests.' AND Name %STARTSWITH 'Test' AND Private=0 AND ClassMethod=0` → `401`, Rule #35).

**Other fixture productions verified unharmed.** `ExecuteMCPv2.Tests.InteropCompositeKeyFixtureProd` and `...Prod2` (the sibling test's fixtures) both re-read post-run and confirmed byte-identical to their checked-in `.cls` XData — this repair touched neither.

**Gates.** `pnpm gen:governance-baseline:check` (check-only): `141`/`201`/`60`, unchanged — no drift, consistent with zero governance/tool-surface changes this pass. Bootstrap NOT regenerated: neither `Interop.cls` source nor any bootstrapped class changed in this pass (only the out-of-manifest `ExecuteMCPv2.Tests.InteropUnresolvableHostItemTest.cls`, per Rule #39); `BOOTSTRAP_VERSION` stays at its cycle_iteration=3/review value (`2742ce31228a`).

**Constraint E-1/E-2:** untouched — no tool, action, schema, or governed-key change; no bare governance-baseline generator run.

**Cleanup:** no probe/temp classes created this pass (investigation was read-only against the existing deployed classes plus the one legitimate `Interop.cls` disk→IRIS resync). `.vscode/settings.json` not touched (no bulk export used — targeted `iris_doc_load` single-file uploads only).

### File List

- `src/ExecuteMCPv2/REST/Interop.cls` — modified (`set` branch composite-key fix; `get` branch optional `production` filter; cycle_iteration=2: shared `ValidateHostClassName` guard extracted from `add` and reused on `set`'s `className` path, `set` persistence switched to `%Save()` + `SaveToClass(tItem)` dual-write for durability; RE-OPEN Task 7: composite-key fallback — two-arg `NameExists` + `tProd.Items` lookup — added to BOTH `set` and `remove` for items whose `ClassName` no longer resolves to a business type; cycle_iteration=4: NO source change — redeployed the pre-existing on-disk (uncommitted) content to IRIS to resync a stale live/disk deployment gap discovered while verifying the fixture repair, see Dev Notes)
- `packages/iris-interop-mcp/src/tools/item.ts` — modified (tool description/parameter docs updated for `production` on `set`/`get`)
- `packages/iris-interop-mcp/README.md` — modified (doc note on the composite key + optional `production` filter)
- `packages/shared/src/bootstrap-classes.ts` — modified (regenerated embed; cycle_iteration=1 `BOOTSTRAP_VERSION` `01dc15bb27df` → `b9933105994c`; cycle_iteration=2 `b9933105994c` → `890ae82abfd2`; code review `890ae82abfd2` → `0a012dfaee5d`; RE-OPEN Task 7 `a73647f42c11` → `6846dba351a8`, idempotent — the story's own value was `a73647f42c11` at re-open time, post-dating Story 35.2's intervening bootstrap bump; RE-OPEN code review `6846dba351a8` → `2742ce31228a` after the two HIGH patches, idempotent)
- `src/ExecuteMCPv2/Tests/InteropCompositeKeyFixtureProd.cls` — added (durable fixture production, one item, never started)
- `src/ExecuteMCPv2/Tests/InteropCompositeKeyFixtureProd2.cls` — added (second durable fixture production, same item name, for cross-production isolation coverage)
- `src/ExecuteMCPv2/Tests/InteropItemCompositeKeyTest.cls` — modified (cycle_iteration=1: 5-method regression suite — composite-key primitive pin + 4 real-HTTP tests; cycle_iteration=2: +1 sequential-mutation/recompile-survival regression test, `OnAfterOneTest`/`RestoreFixtureBaseline` cleanup hook now required because `set` durably rewrites fixture XData; code review: +2 className-guard tests, restore moved into `OnBeforeOneTest` as well with an asserted status, strengthened cross-production assertions — now 8 methods)
- `packages/iris-interop-mcp/src/__tests__/item.test.ts` — modified at code review (re-pinned the description contract that `cycle_iteration=2` made false, +2 new contract tests — CR 35.1-13)
- `_bmad-output/implementation-artifacts/deferred-work.md` — modified (ledgered `35-1-DEV-1`, environmental parallel-`turbo` flakiness, MEDIUM, not this story's defect; code review added the 8-row "Story 35.1 code review" section, incl. the HIGH `35-1-CR-1`; RE-OPEN Task 7: new Terminal disposition section closing `35-1-CR-1` RESOLVED, ledger tally recounted mechanically to 0 open HIGH)
- `_bmad-output/implementation-artifacts/tests/35-1-test-summary.md` — modified at code review (superseded-section recording the delivered state; the QA-pass sections asserted an open HIGH that this story closed)
- `src/ExecuteMCPv2/Tests/InteropUnresolvableHostFixtureProd.cls` — added at RE-OPEN Task 7 (durable fixture production, two items both `ClassName="%Stream.GlobalCharacter"` — compiled but not an `Ens.Host` subclass — for the AC 35.1.7 unresolvable-host-class regression coverage; never started; OUT of the bootstrap manifest per Rule #39). Code review added a THIRD item `DeletedHostOp` whose className names a class that does not exist at all — a genuinely different state that reaches the `SaveToClass` `<CLASS DOES NOT EXIST>` path the other two cannot (Rule #54/#58 fixture diversity; this is what exposed HIGH `CR 35.1-15`).
- `src/ExecuteMCPv2/Tests/InteropUnresolvableHostItemTest.cls` — added at RE-OPEN Task 7 (3-method regression suite: baseline `get` sanity, `set` reaches-and-repairs, `remove` reaches-and-deletes; `OnBeforeOneTest`/`OnAfterOneTest` self-healing restore mirroring `InteropItemCompositeKeyTest`'s CR 35.1-10 pattern). Code review took it to **5 methods** (+`TestAddRejectsDuplicateOfUnresolvableHostItem`, +`TestSetOnDeletedHostClassReportsTruthfully`), added the missing remove-test precondition, strengthened the "genuinely gone" assertion against the extent and XData, guarded the envelope accessors against `<INVALID OREF>`, and made the fixture self-healing against duplicate-item corruption (`DropDuplicateItems`). **Modified at cycle_iteration=4 (smoke-failure repair):** removed the self-corrupting `RestoreFixtureItem`/`DropDuplicateItems`/`SaveProductionForItem` object-mutation restore machinery (root-caused to a stale-swizzle-cache XML `nil` corruption of the deployed fixture XData) and replaced it with a single `RestoreFixtureBaseline()` that rewrites the fixture's entire XData from a literal `BaselineXData()` string and recompiles, plus a new `VerifyFixtureIntegrity()` guard called after every restore. Method count and Test* bodies unchanged (still 5 `Test*` methods); only the fixture-restore helpers changed.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — modified at RE-OPEN Task 7 (`35-1-production-item-set-composite-key` status `in-progress` → `review`; `last_updated` header entry added; set to `done` at the code review close)
- `_bmad-output/implementation-artifacts/cycle-log-epic-35.md` — modified by the PIPELINE (lead-owned artifact; recorded here for File List completeness only, never edited by dev or review)

### Review Findings

#### Code review 2026-08-18 (RE-OPEN pass, cycle_iteration=3 — AC 35.1.7 / Task 7 scope)

_CLEAN close, 3/3 layers delivered, `review_degraded = false`, `failed_layers = none`. 0 decision-needed, 8 patch (all applied), 8 deferred, 5 dismissed._

**Cold-path swizzle verdict (the review's headline question).** The ledger's warning that `%OpenId(tID)` risks `SaveToClass` persisting stale values is **overstated — the dev's probe conclusion holds**, and it was re-verified on the COLD path, deliberately reversing the dev's probe order so `%OpenId` was the FIRST thing to touch the item in the process, before `tProd.Items` was ever referenced:

```
job=29368;ProdOref:1099@Ens.Config.Production;NameExists:1,id=1919;
OpenIdOref(cold):1056@Ens.Config.Item;pos=1;CollectionOref:1056@Ens.Config.Item;sameOref:1;
BcommentAfterAMutate=cold-openid-nosave-67799,80585;
```

Identical OREF in the cold order too, and a mutation through the `%OpenId` handle was immediately visible through the collection handle — they are literally one object, not two copies, so the "already swizzled by a prior call" masking explanation is ruled out. A second probe confirmed the XData durably received a cold-`%OpenId` mutation (`XDataHasMarker:1`). **Conclusion: the `tProd.Items` idiom is stylistic here, not load-bearing** — exactly what the dev claimed. It remains the right choice (library consistency; the swizzle-cache behavior is an implementation detail, not a documented guarantee), and no change was made.

**Two HIGHs found, both live-reproduced over real HTTP and both fixed in-story.** Each was found independently by the reviewer and corroborated by a review layer.

- [x] [Review][Patch] **`add`'s duplicate-name guard was blind to exactly the items this pass makes reachable, producing durable duplicate config items** — HIGH, Rule #56 enumeration gap. The guard resolves through the same `FindItemByConfigName` that skips unresolvable-host items, so it believed the name was FREE. Live-reproduced end-to-end: `POST add` for an existing name returned **HTTP 200 "added"** and the production class XData ended up with **two `<Item Name="DupTargetOp">` entries** — durably corrupting the production the guard's own comment ("the `(Production,Name)` index is not unique, so add is otherwise non-idempotent") exists to protect. Fixed with the same two-arg `NameExists` fallback; verified the fix rejects the duplicate AND still admits a genuinely new name (no false positive). [src/ExecuteMCPv2/REST/Interop.cls:748]
- [x] [Review][Patch] **`set` on an item whose host class does not EXIST committed the write and then reported failure** — HIGH, the story's own get/set contradiction, inverted, and NEWLY REACHABLE because of this pass. `SaveToClass(pItem)` writes the class XData FIRST (`Production.cls:146`) and only then dispatches `OnConfigChange`; its Catch swallows only `<METHOD DOES NOT EXIST>`, so a missing class raises `<CLASS DOES NOT EXIST>` and becomes `$$$EnsSystemError` after the write already landed — and the CR 35.1-3 recovery `LoadFromClass` then re-syncs the extent FROM the updated XData, cementing it. Live-reproduced: `set` returned `ERROR <Ens>ErrException: <CLASS DOES NOT EXIST>SaveToClass *No.Such.Class.Here` while the follow-up `get` returned `comment: "probe-comment-change"` — the caller told "failed" for a change that fully applied to both stores. Fixed by selecting the no-`pItem` overload (exactly what `remove` already calls) when the className does not resolve; valid-class behavior is byte-for-byte unchanged. [src/ExecuteMCPv2/REST/Interop.cls:633]
- [x] [Review][Patch] Fixture could not produce the deleted-class state the fix's own rationale names as its primary real-world cause (Rule #54/#58 fixture diversity) — added a third fixture item `DeletedHostOp` whose className genuinely does not exist. Both shapes are skipped identically by `findItemIdByName` (`GetBusinessType` returns `0` for each — live-probed) but diverge inside `SaveToClass`, which is precisely what made HIGH #2 invisible. [src/ExecuteMCPv2/Tests/InteropUnresolvableHostFixtureProd.cls]
- [x] [Review][Patch] `TestRemoveReachesUnresolvableHostItem` had no defect-precondition assertion (its `set` sibling did), so it would pass vacuously through the ordinary path if the fixture ever drifted to a resolvable className [src/ExecuteMCPv2/Tests/InteropUnresolvableHostItemTest.cls]
- [x] [Review][Patch] "genuinely gone" was asserted by "any error at all" — strengthened to pin the item's actual absence from BOTH the extent and the class XData [src/ExecuteMCPv2/Tests/InteropUnresolvableHostItemTest.cls]
- [x] [Review][Patch] `EnvelopeErrorCount`'s unguarded 3-level dereference raised `<INVALID OREF>` mid-test — **observed live** during the reviewer's own RED run — which in the destructive remove test can abort after the delete and before any restore [src/ExecuteMCPv2/Tests/InteropUnresolvableHostItemTest.cls]
- [x] [Review][Patch] `RestoreFixtureItem`'s re-create branch dropped `Category`, which its own update branch resets [src/ExecuteMCPv2/Tests/InteropUnresolvableHostItemTest.cls]
- [x] [Review][Patch] Fixture was not self-healing against the duplicate-item corruption — a mutation-verify RED run of the new `add` test durably left two `UnresolvableSetOp` rows (observed: ids 2775 and 2777). Added `DropDuplicateItems` to the restore path [src/ExecuteMCPv2/Tests/InteropUnresolvableHostItemTest.cls]

**Independent verification performed (not accepted on the dev's word):**
- Rule #59 mutation-verify of the Task 7 fallback reproduced from scratch on the real HTTP endpoint: GREEN 3/3 → revert `Interop.cls` to HEAD → **RED 1/3** (failing on exactly the fix-tied assertions) → restore → GREEN 3/3.
- Rule #59 for the two NEW tests: reverting only the two review patches gives **RED 2/5** on exactly their fix-tied assertions, with the three pre-existing tests unaffected.
- Rule #35: `ExecuteMCPv2.Tests` **401/401**, mechanical `Test*` count **401** — match.
- Bootstrap: `6846dba351a8` → **`2742ce31228a`** after the review patches; second regen byte-identical (idempotent, sha256 verified); roster 29 with `REST/Dispatch.cls` last; `gen-bootstrap.mjs`/`bootstrap.test.ts` untouched; both new `Tests.*` classes absent from the manifest.
- Constraint E-2: `pnpm gen:governance-baseline:check` (check-only) → **141/201/60**, `governance-baseline.ts` unmodified.
- Constraint E-1: no TypeScript tool/preset/governance file touched; `@iris-mcp/interop` 336/336, `@iris-mcp/shared` 1308/1308, `@iris-mcp/all` 120/120, `@iris-mcp/dev` 665/665 (per-package standalone, per `35-1-DEV-1`).
- Live hygiene: all four disposable probe classes deleted from IRIS and disk; `Ens_Config.Item` shows **no** orphaned `ExecuteMCPv2.Temp` rows and the review's own probe production is gone from the `Ens.Config.Production` extent too (production delete cascades); the fixture production is back to exactly three items at baseline values with no duplicates. No debug globals created. The extent sweep DID surface one **pre-existing** orphan that is not this story's — `Ens.Config.Production` row `ExecuteMCPv2.Temp.Story172Prod`, whose class no longer exists and which has zero item rows (Story 17.2 residue) — ledgered as `35-1-CR-28` rather than deleted on the review's own initiative.

#### Dismissed (this pass, each with evidence)

- **Fallback keys on `tProdName` rather than `tProd`'s identity (alleged casing hazard).** Probed: `%OpenId` is equally case-sensitive — `%OpenId("executemcpv2.tests....")` returns a null oref — so the handler fails at the earlier `%ExistsId`/open step and never reaches the fallback. No divergence is reachable.
- **`FindObjectId` miss sentinel never pinned.** Probed: returns `""` exactly (`isEmptyString:1, length=0`), and `GetAt("")` yields a non-object that the following `'$IsObject(tItem)` already catches — safe under either assumption.
- **Mutation-verify ran against the source path while the embed still held the fix.** The REST endpoint executes the compiled class deployed from source, which IS the guarded path; the embed is a deployment mechanism and is byte-identical to the source hunks. The reviewer re-ran RED/GREEN independently on that same path.
- **`enable`/`disable` resolve via `FindItemByConfigName`.** Factually incorrect — they delegate to `Ens.Director.EnableConfigItem`. (The underlying reachability concern is real and is ledgered separately.)
- **Undocumented gap in the bootstrap hash chain (`0a012dfaee5d` to `b54e1d265c6b`).** The cycle log does record it: `bootstrap_version=0a012dfaee5d-to-b54e1d265c6b`. Chain is complete.

#### Surfaced to the lead (no code change, not a Story 35.1 defect)

`docs/bugs-2026-08-17.md` is an untracked bug report about a DIFFERENT tool (`iris_doc_load`'s glob-to-package-prefix mapping, Rule #17 territory) that appeared in the working tree alongside `_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-17-doc-load-package-prefix.md` — the concurrent documentation course-correction this review was told to expect. It is **not** part of this story and was not edited. Flagged only because its Disposition reads "Pending triage" while this pass's ledger section states "no known-broken tool action" for the HIGH tier — the lead should confirm the course-correction story carries it, so it is not counted as closed by omission.

_Code review 2026-08-17 — CLEAN close, 3/3 layers delivered, `review_degraded = false`, `failed_layers = none`. 0 decision-needed, 13 patch (all applied), 8 deferred, 6 dismissed._

- [x] [Review][Patch] `add`'s `settings.className` override bypassed the shared `ValidateHostClassName` guard — HIGH, mutation-verified RED [src/ExecuteMCPv2/REST/Interop.cls:752]
- [x] [Review][Patch] `set`'s className guard shipped with zero test coverage on its own path — HIGH, skill-rule 3 / Rule #59 [src/ExecuteMCPv2/Tests/InteropItemCompositeKeyTest.cls]
- [x] [Review][Patch] `SaveToClass` failure left the extent holding a change XData did not have — now re-syncs before erroring [src/ExecuteMCPv2/REST/Interop.cls:589]
- [x] [Review][Patch] A no-op `set` (`settings:{}`) rewrote production XData and took the runtime lock — now short-circuits [src/ExecuteMCPv2/REST/Interop.cls:580]
- [x] [Review][Patch] `UpdateProduction()` was called unconditionally, disturbing an unrelated RUNNING production — now gated [src/ExecuteMCPv2/REST/Interop.cls:606]
- [x] [Review][Patch] `UpdateProduction()` failure read as "nothing written" although both writes had committed [src/ExecuteMCPv2/REST/Interop.cls:610]
- [x] [Review][Patch] `production` was never whitespace-stripped on `set`/`get` [src/ExecuteMCPv2/REST/Interop.cls:434,495]
- [x] [Review][Patch] `ValidateHostClassName` relied on callers to strip whitespace — now normalizes internally [src/ExecuteMCPv2/REST/Interop.cls:806]
- [x] [Review][Patch] `ValidateHostClassName` passed a null `%Dictionary.CompiledClass` open as valid (Rule #44) [src/ExecuteMCPv2/REST/Interop.cls:820]
- [x] [Review][Patch] Fixture cleanup was teardown-only and swallowed every error — restore now also runs in setup, status asserted [src/ExecuteMCPv2/Tests/InteropItemCompositeKeyTest.cls:42]
- [x] [Review][Patch] Cross-production isolation tests asserted one field against one magic string — now pin exact baselines, both fixtures [src/ExecuteMCPv2/Tests/InteropItemCompositeKeyTest.cls]
- [x] [Review][Patch] Tool description + README carried a persistence contract this story made false (Rule #30/#43) [packages/iris-interop-mcp/src/tools/item.ts:42, packages/iris-interop-mcp/README.md:149]
- [x] [Review][Patch] AC 35.1.4 audit table enumerated 19 of 22 call sites while claiming completeness (Rule #56/#51) [_bmad-output/implementation-artifacts/35-1-production-item-set-composite-key.md]
- [x] [Review][Defer] `35-1-CR-1` **HIGH** — an item whose host class no longer resolves is unreachable through `set`/`remove` while `get` returns it [src/ExecuteMCPv2/REST/Interop.cls:541] — deferred, pre-existing (shared with `remove`; needs a lead scoping decision)
- [x] [Review][Defer] `35-1-CR-2` `FindItemByConfigName`'s Output `%Status` discarded (Rule #9) [src/ExecuteMCPv2/REST/Interop.cls:540] — deferred, needs error-code discrimination + Rule #8 stripping
- [x] [Review][Defer] `35-1-CR-3` `set` is governance-grandfathered but now rewrites production class source [packages/iris-interop-mcp/src/tools/item.ts] — deferred, product decision above a code review
- [x] [Review][Defer] `35-1-CR-4` Whole-production read-modify-write with no lock — concurrent calls lose updates [src/ExecuteMCPv2/REST/Interop.cls:517] — deferred, pre-existing handler-wide concurrency design
- [x] [Review][Defer] `35-1-CR-5` Intra-production duplicate item names resolve to a ranked first match; `|`/`||` qualifiers unvalidated (Rule #29) [src/ExecuteMCPv2/REST/Interop.cls:541] — deferred, pre-existing
- [x] [Review][Defer] `35-1-CR-6` `get` without `production` still arbitrary and never echoes the resolved production [src/ExecuteMCPv2/REST/Interop.cls:435] — deferred, Rule #19 byte-identity trade-off
- [x] [Review][Defer] `35-1-CR-7` No byte-parity gate on fixture XData after `SaveToClass` re-serialization (Rule #58) [src/ExecuteMCPv2/Tests/InteropItemCompositeKeyTest.cls:69] — deferred, verified clean live at review time
- [x] [Review][Defer] `35-1-CR-8` `get` vs `set` production-name matching semantics unpinned for non-exact case [src/ExecuteMCPv2/REST/Interop.cls:437,505] — deferred, fix alongside `35-1-CR-6`

## Review Findings (code review, 2026-08-17)

**Close kind: CLEAN — 3 of 3 layers delivered** (Blind Hunter, Edge Case Hunter, Acceptance Auditor), frozen-diff snapshot captured at review start, bounded close with a real 20-minute armed clock; no layer timed out, `review_degraded = false` (Rule #57).

### Independently re-verified by the reviewer (not taken on the dev/QA record)

- **Rule #48/#59 mutation-verify, re-run from scratch.** Reverted ONLY the `tProd.SaveToClass(tItem)` line on the deployed class and re-ran `TestSetSequentialMutationsBothPersistAndSurviveRecompile`: **0/1, with exactly the three durability assertions failing**. Restored from disk → **8/8**. The recompile half is a genuine XData oracle, confirmed at source: `Ens.Production` carries `Projection Production As Ens.Projection.Production`, whose `CreateProjection` calls `Ens.Config.Production:LoadFromClass` — so `$System.OBJ.Compile` really does rebuild the extent from XData.
- **Gates.** `pnpm run gen:bootstrap` re-run → idempotent, 29 classes, `BOOTSTRAP_VERSION` unchanged at the recorded value; `scripts/gen-bootstrap.mjs` and `bootstrap.test.ts` untouched; `REST/Dispatch.cls` last; no `ExecuteMCPv2.Tests.*` class in the manifest. `pnpm gen:governance-baseline:check` → `141/201/60`, baseline artifact unmodified (Constraint E-2). `item.ts` changes are description-strings only — action enum, parameters and `mutates` untouched, `@iris-mcp/interop` visibility `preset="full" visible=23 hidden=0` (Constraint E-1 holds).
- **Rule #35.** Mechanical `Test*` count via `%Dictionary.CompiledMethod` matched the package run exactly at every stage.
- **Live hygiene.** No `ExecuteMCPv2.Temp.*` classes remain; both fixture productions verified byte-identical to their checked-in `.cls` (XData) and at baseline in the `Ens_Config.Item` extent. One **pre-existing, unrelated** residue found and cleaned: a stale `^ClineDebug` global left by an Epic 34 probe class (`ExecuteMCPv2.Tests.Temp34ProbeTest`, itself already deleted).

### HIGH findings fixed in review

1. **CR 35.1-1 — `add`'s `settings.className` override completely bypassed the new shared guard.** `add` validated only its top-level `className`; the settings iterator then did `Set tItem.ClassName = tValue` unguarded, and THAT is what `SaveToClass` persisted — reinstating the exact `OnConfigChange <METHOD DOES NOT EXIST>` swallow (`irislib/Ens/Config/Production.cls:148-157`) the guard exists to stop, returning HTTP 200 over a durably-broken item while reporting the *validated* className. This is a Rule #56 enumeration miss inside this pass's own stated task ("a shared validator so both branches call the SAME checks"): there were **three** className write paths, not two. Fixed by routing the override through `ValidateHostClassName`, and the `add` response now reports the className actually persisted. Mutation-verified RED.
2. **CR 35.1-12 — the `set` className guard shipped with zero test coverage on its own path.** No test anywhere sent a `className` to `set` — neither accepting nor rejecting; the pre-existing `InteropHostGuardTest` pins the classification primitives independently and never calls into `Interop.cls`. Deleting the guard call left all 394 tests green (skill-rule 3 / Rule #59). Fixed by adding `TestSetRejectsInvalidClassNameWithoutWriting` (all three rejection reasons over real HTTP) and `TestAddSettingsClassNameOverrideIsGuarded`. Both mutation-verified RED against a guard-reverted deployment.

### MEDIUM/LOW findings fixed in review

- **CR 35.1-3** — on `SaveToClass` failure the already-committed `%Save()` left the extent holding a change XData did not have (the original defect, re-created on the error path). Now re-syncs via `LoadFromClass` before returning the error, so both sides agree with what the caller is told. The write ORDER is documented as load-bearing and must not be swapped — `FindItemByConfigName` can return an item that is not the `tProd.Items` member `SaveToClass` serializes, which is why `%Save()` must come first.
- **CR 35.1-5** — a no-op `set` (`settings: {}`) regenerated the whole production XData and took the runtime lock. Now short-circuits; response shape unchanged.
- **CR 35.1-6** — `UpdateProduction()` was called unconditionally. It always acts on whichever production is *running*, so editing a stopped production took a 30s runtime lock on, and could restart the hosts of, an unrelated running production. Now gated to the case where the written production is the running one.
- **CR 35.1-7** — an `UpdateProduction()` failure was reported after both durable writes had committed, reading as "nothing was written". The error now says the settings were saved, with the real cause attached via `$System.Status.AppendStatus` (Rule #9 without Rule #8 hand-splicing).
- **CR 35.1-4** — `production` is now whitespace-stripped on both `set` and `get`, matching `add`'s existing `className` handling.
- **CR 35.1-8 / CR 35.1-9** — `ValidateHostClassName` now normalizes whitespace internally (rather than documenting the obligation outward) and rejects, instead of passing, a null `%Dictionary.CompiledClass` open (Rule #44 fail-safe direction).
- **CR 35.1-10 — fixture cleanup was teardown-only and silent.** `%UnitTest.Manager` skips `OnAfterOneTest` entirely when `OnBeforeOneTest` errors, and an aborted run skips it too — so a single failed cleanup would permanently drift the live fixture class XData and surface later as an unrelated-looking baseline failure. Restoration now runs in `OnBeforeOneTest` as well (order-independent, self-healing) and `RestoreFixtureBaseline` returns a `%Status` that `OnAfterOneTest` asserts. This immediately proved its worth: during the CR 35.1-1 mutation-verify it fired loudly with "fixture item 'FixtureOp' not found … during restore".
- **CR 35.1-11** — the two cross-production isolation tests asserted only that one field was not one magic string, with a disjunct that also passed whenever the field was absent. Both now pin exact checked-in baselines across every writable field, `TestSetNeverWritesWrongProductionRow` confirms the write DID land where addressed (otherwise it would pass if `set` wrote nothing at all), and `...WithoutWritingAnywhere` now actually checks both fixtures.
- **Docs (Rule #30/#43)** — the tool description and README carried a persistence contract that this story made false (`'get'/'set' read the SQL extent`; `an item created by 'add' is NOT visible to an immediate 'get'/'set'`). Both corrected, and the README now documents `set`'s new rejection behavior, the no-op short-circuit, the running-production gating, and that `set` rewrites production class source (source-control drift).
- **AC 35.1.4 audit table** — completed from 19 to 22 `Interop.cls` call sites with an explicit correction note (see the audit section above).
- **`tests/35-1-test-summary.md`** — the QA artifact still asserted the `set`-durability HIGH was unfixed and belonged to a follow-up story, and recorded 5 methods / 393. Superseded-section added recording the delivered state.

### Gate state AFTER the review's patches (re-verified, supersedes the cycle_iteration=2 figures above)

- **Bootstrap (Rule #24):** `Interop.cls` changed again in review, so `pnpm run gen:bootstrap` was re-run — `BOOTSTRAP_VERSION` **`890ae82abfd2` → `0a012dfaee5d`**. Re-ran a second time with an identical result (idempotent). Roster unchanged at 29 classes, `REST/Dispatch.cls` still last, `scripts/gen-bootstrap.mjs` and `bootstrap.test.ts` untouched (Rule #39).
- **Governance baseline (Constraint E-2):** `pnpm gen:governance-baseline:check` → `141` / `201` / `60`, unchanged; generated artifact unmodified.
- **`ExecuteMCPv2.Tests` (IRIS):** **396/396** passed, 0 failed, 0 skipped — matches the mechanical `Test*` count (`SELECT COUNT(*) FROM %Dictionary.CompiledMethod …` → `396`) per Rule #35. `InteropItemCompositeKeyTest` is now **8** methods (6 + 2 added in review).
- **Vitest, standalone per package:** `@iris-mcp/interop` **336/336** (334 + 2 description-contract tests added in review), `@iris-mcp/shared` **1308/1308**, `@iris-mcp/all` **120/120**, `@iris-mcp/dev` **665/665**. `@iris-mcp/interop` build + lint clean.
- **Constraint E-1:** tool visibility still `preset="full" visible=23 hidden=0`; `item.ts` action enum, parameters and `mutates` untouched — description strings only.

> **CR 35.1-13 (worth recording).** `packages/iris-interop-mcp/src/__tests__/item.test.ts` had an assertion pinning the exact string `"NOT visible to an immediate 'get'/'set'"`. That claim became FALSE the moment `set` gained its own `LoadFromClass`/`SaveToClass` in `cycle_iteration=2`, yet the test stayed green through dev and QA because it pinned the STRING, not the behaviour — the doc rot was invisible until the string itself was corrected in review. Re-pinned against the corrected contract, plus a negative assertion that the stale wording cannot come back and two new assertions covering `set`'s rejection and running-production-gating behaviour.

### Deferred (ledgered in `deferred-work.md` → "Story 35.1 code review")

`35-1-CR-1` **(HIGH)**, `35-1-CR-2`, `35-1-CR-3`, `35-1-CR-4`, `35-1-CR-5`, `35-1-CR-6` (MEDIUM), `35-1-CR-7`, `35-1-CR-8` (LOW).

**`35-1-CR-1` needs a lead decision.** An item whose host `ClassName` no longer resolves to a business type is skipped by `findItemIdByName`, so `set` and `remove` both report it as "not found" while `get` returns it — the same user-visible `get`/`set` contradiction Story 35.1 exists to eliminate, reached by a second route, and the broken item is unrepairable through the tool. It was **reproduced live** during this review. It is not a Story 35.1 regression (the story followed AC 35.1.2's instruction to prefer the sibling API, and `remove` shares the behavior), and Story 35.1's new guard now stops the tool from *creating* the state — but against Epic 35's "no known-broken tool action before beta" goal, the lead should decide whether it needs its own story.

### Dismissed

`ValidateHostClassName`'s new Try/Catch technically alters `add`'s exception surface, but the `%ExistsId` gate precedes the only throwing call, so no reachable behavior differs. `set`'s production check using `%Dictionary.ClassDefinition` rather than verifying an `Ens.Production` subclass is the identical idiom `add`/`remove` already use (verified at source) and `LoadFromClass` fails safely on a non-production class. AC 35.1.3's "naming the candidates" clause is correctly closed by Rule #54 rationale — the lookup resolves exactly one production, so a second candidate cannot exist. The permanent (rather than disposable) fixture productions are disclosed and mirror `AdvisorFixture`.

### Surfaced to the lead (no code change)

`cycle-log-epic-35.md` records an unadjudicated contradiction on the turbo gate: `lead_interim_verification` says `turbo=29of29 … dev_claimed_parallel_flakiness=DID_NOT_REPRODUCE`, while `qa_complete` says `turbo_flakiness=REPRODUCED_by_qa`. The substance is ledgered as `35-1-DEV-1` (verified present, accurate, and correctly scoped as environmental), but the two passes' contradictory observations are recorded and never reconciled. The cycle log is lead-owned and was not edited.

## Change Log

| Date | Change |
|---|---|
| 2026-08-17 | Story 35.1 implemented: fixed `iris_production_item:set`'s composite-key resolution (Interop.cls:473 defect); additionally fixed the related `get`-branch unfiltered-SQL weakness found during the AC 35.1.4 audit; added regression coverage; bootstrap regenerated (`01dc15bb27df` → `b9933105994c`); governance baseline verified unchanged (141/201/60). |
| 2026-08-17 | cycle_iteration=2 (QA HIGH gap-close): fixed `set` not durably persisting — pre-fix it wrote only the SQL extent (`tItem.%Save()`), never the production class XData (Rule #27's source of truth), so a later `set`/`add`/`remove` call's own `LoadFromClass` resync (or a bare recompile) silently discarded the change; live-probed that neither `%Save()` nor `SaveToClass` alone is sufficient, so `set` now does both. Extracted `add`'s existing className guard into a shared `ValidateHostClassName` classmethod and applied it to `set`'s `className`-update path (closes the SaveToClass `OnConfigChange` silent-swallow hazard QA flagged). Added a two-sequential-mutations + recompile-survival regression test, mutation-verified RED/GREEN on the real HTTP endpoint. Bootstrap regenerated again (`b9933105994c` → `890ae82abfd2`); governance baseline re-verified unchanged (141/201/60). Ledgered the pre-existing parallel-`turbo` test flakiness (`35-1-DEV-1`, MEDIUM) rather than normalizing it. |
| 2026-08-17 | Code review (CLEAN, 3/3 layers): 13 findings patched in-story (2 HIGH incl. `add`'s `settings.className` override bypassing the guard; 11 MEDIUM/LOW incl. no-op `set` short-circuit, `UpdateProduction()` running-production gating, whitespace stripping); 8 deferred to `deferred-work.md` (incl. HIGH `35-1-CR-1`, carried to the ledger awaiting a lead scoping decision). Bootstrap regenerated again (`890ae82abfd2` → `0a012dfaee5d`); governance baseline unchanged (141/201/60). |
| 2026-08-18 | **RE-OPENED (Rule SC-5, cycle_iteration=3)** solely to close ledger HIGH `35-1-CR-1` (AC 35.1.7 / Task 7). Probed live (disposable `Temp.Story351dProbe(Prod)`, deleted before finishing) both the defect (an item with a non-host `ClassName` is skipped by `findItemIdByName`, so `FindItemByConfigName` returns `$$$NULLOREF` for it while `get` still resolves it) and the swizzle-interaction trap (`%OpenId(tID)` and `tProd.Items` lookup returned the identical in-process OREF and both durably persisted — `tProd.Items` idiom kept for library consistency regardless). Added a composite-key fallback (two-arg `NameExists` + `tProd.Items` lookup) to BOTH `set` and `remove`. New regression class `InteropUnresolvableHostItemTest` (3 methods) + fixture `InteropUnresolvableHostFixtureProd`; mutation-verified RED (1/3) → GREEN (3/3) on the real HTTP endpoint via `git stash` isolation. `ExecuteMCPv2.Tests` 399/399 (mechanical match); sibling suite unaffected (8/8). Bootstrap regenerated (`a73647f42c11` → `6846dba351a8`, idempotent); governance baseline unchanged (141/201/60). `35-1-CR-2` evaluated, left deferred (documented rationale). `35-1-CR-1` closed RESOLVED in `deferred-work.md` with a new Terminal disposition section; ledger tally recounted mechanically (Rule #51) to 0 open HIGH. Status: in-progress → review. |
| 2026-08-18 | **Code review of the RE-OPEN pass (CLEAN, 3/3 layers, `review_degraded=false`): 8 patched in-story, 7 deferred, 5 dismissed.** Settled the review's headline question by re-probing the COLD path (reversing the dev's probe order so `%OpenId` touched the item first): identical OREF, mutation visible through both handles, XData durably updated — the ledger's stale-value hazard was **overstated**, the dev's conclusion holds, and the `tProd.Items` idiom is stylistic rather than load-bearing; no change made. Found and fixed **two HIGHs**, both live-reproduced over real HTTP: (1) Rule #56 — `add`'s duplicate-name guard resolves through the same `FindItemByConfigName` that skips unresolvable-host items, so it returned HTTP 200 "added" for an existing name and wrote a SECOND `<Item>` with the same Name into the class XData (durable production corruption); fixed with the same two-arg `NameExists` fallback, verified it still admits genuinely-new names. (2) A `set` that does not repair `className`, on an item whose host class does not EXIST, committed the XData and THEN reported failure — `SaveToClass` writes the class first and only then dispatches `OnConfigChange`, whose `<CLASS DOES NOT EXIST>` its Catch does not swallow (only `<METHOD DOES NOT EXIST>`) — so the caller was told "failed" for a change `get` then reported as applied, the story's own get/set contradiction inverted and newly reachable via the Task 7 fallback; fixed by selecting the no-`pItem` `SaveToClass` overload when the className does not resolve. Added a third fixture item (`DeletedHostOp`, genuinely missing class) closing the Rule #54/#58 fixture-diversity gap that hid HIGH #2, plus 2 new tests (suite now 5 methods) and 4 test-robustness fixes. Independently reproduced the Task 7 mutation-verify (GREEN 3/3 → RED 1/3 → GREEN 3/3) and proved the two new tests RED (2/5) on the paths they guard. `ExecuteMCPv2.Tests` **401/401** (mechanical count 401); shared 1308, interop 336, all 120, dev 665 standalone; bootstrap `6846dba351a8` → `2742ce31228a` (idempotent, roster 29, Dispatch last); governance baseline unchanged (141/201/60). All probe classes and probe productions deleted from IRIS and disk, no orphaned extents or globals. Status: review → done. |
| 2026-08-18 | **Smoke-failure repair (cycle_iteration=4): fixed a self-corrupting test fixture found by the lead's post-close re-smoke** (`InteropUnresolvableHostItemTest` 5/5 failed against a fixture whose deployed XData had been corrupted with three XML `nil="true"` `<Item>` placeholders by a PRIOR run of the same class). Reproduced and confirmed the mechanism live: the removed `RestoreFixtureItem` helper opened the fixture production 3× per hook invocation (once per item); IRIS's per-process object/swizzle cache returned a STALE cached `tProd` on the 2nd/3rd open within the same hook call (unaffected by an intervening `LoadFromClass` elsewhere in the process), so `tProd.Items.GetAt(...)` returned an unpopulated placeholder item — `%Save()` failed `#5659`, and the following `SaveToClass()` serialized that empty slot as an XML `nil` placeholder, durably corrupting the deployed class XData. Replaced the per-item object-mutation restore machinery (`RestoreFixtureItem`/`DropDuplicateItems`/`SaveProductionForItem`, removed) with a single `RestoreFixtureBaseline()` that rewrites the ENTIRE fixture XData from a literal known-good string and recompiles — never touching an `Ens.Config.Item`/`Ens.Config.Production` object during restore, so it is immune to the cache-staleness root cause — plus a new `VerifyFixtureIntegrity()` guard asserted after every restore (Rule #58/#59: a future recurrence now fails loudly instead of silently poisoning the next run). Also found and resolved, during verification, an UNRELATED pre-existing live/disk deployment-sync gap (the deployed `Interop.cls` was missing the already-reviewed, disk-resident CR 35.1-15 fix); resynced via redeploy from disk — no `Interop.cls` source line authored this pass. Proof: 3 consecutive full-class runs **5/5, 5/5, 5/5**; sibling `InteropItemCompositeKeyTest` unaffected (8/8); full package `ExecuteMCPv2.Tests` **401/401** (mechanical match); deployed fixture XData re-confirmed byte-identical to disk after all runs; sibling fixtures (`InteropCompositeKeyFixtureProd`/`Prod2`) confirmed unharmed; governance baseline unchanged (141/201/60); no bootstrap regen needed (no bootstrapped-class change). Status: done → review (pending lead re-smoke). |
