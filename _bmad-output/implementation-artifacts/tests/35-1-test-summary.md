# Test Automation Summary — Story 35.1 (`iris_production_item:set` Composite-Key Resolution)

**Date:** 2026-08-17
**Scope:** `src/ExecuteMCPv2/REST/Interop.cls` `ItemManage` `get`/`set` branches (composite-key
fix + optional `production` filter on `get`), and the dev-authored regression suite
`src/ExecuteMCPv2/Tests/InteropItemCompositeKeyTest.cls` (+ its two fixture productions).
Framework: `%UnitTest.TestCase` (ObjectScript, real HTTP against the deployed
`/api/executemcp/v2/interop/production/item` route) — the project's existing pattern for this
handler family (mirrors `AdvisorDataTest`).

## Baseline (dev stage, verified)

Dev delivered 4 test methods in `InteropItemCompositeKeyTest.cls`:
- `TestOneArgNameExistsCannotResolveCompositeKey` — primitive pin of the composite-index contract.
- `TestSetResolvesCompositeKeyOverRealHttp` — get → set → get proving the composite-key fix.
- `TestSetNeverWritesWrongProductionRow` — cross-production isolation (#29/#50).
- `TestSetRejectsUnknownProductionWithoutWritingAnywhere` — clean rejection, no stray write.

All 4 independently re-verified passing on the live deployed endpoint during this QA pass.

## Gap identified and closed this pass

**`get`'s new optional `production` SQL predicate had no test driving its NOT-FOUND path.**
All existing get/production coverage only exercised the FOUND case (an item present in the
named production). The not-found-with-production branch (`Interop.cls` `ItemManage` `get`,
~line 450-454: appends `" in production '<name>'"` to the error text only when a `production`
filter was supplied) was live but untested.

Added `TestGetWithProductionFilterReportsNotFoundNamingProduction`: calls `get` with a
`production` value that does not exist, and asserts the envelope's error text names both the
item and the production filter — proving the get-branch's production-aware error text (not
just a generic "not found") is what actually renders.

**Verified non-vacuous by mutation**: temporarily removed the `If tProdFilter '= "" { ... }`
line that appends the production name to the not-found message, redeployed, re-ran the new
test — failed immediately (`AssertTrue: error names the production filter...`). Reverted the
mutation, confirmed the restored file's diff is byte-identical to the pre-mutation state
(`diff` of captured `git diff` output showed no difference), redeployed, and the test passed
again.

## Result (as of this QA pass — superseded, see "Status after rework" below)

**1 new test added** (5 total in the class, up from 4):
- `src/ExecuteMCPv2/Tests/InteropItemCompositeKeyTest.cls` (+1:
  `TestGetWithProductionFilterReportsNotFoundNamingProduction`)

Full class run: 5/5 passed. Full `ExecuteMCPv2.Tests` package run: **393/393 passed, 0 failed,
0 skipped** — matches the mechanical count of `Method Test` occurrences across every
`%UnitTest.TestCase` subclass under `src/ExecuteMCPv2/Tests/` (393; fixture-only classes
`AdvisorFixture.cls`, `ClassMethodArgsFixture.cls`, `InteropCompositeKeyFixtureProd.cls`,
`InteropCompositeKeyFixtureProd2.cls`, `LocFixtureChild.cls` correctly excluded from the count
— they do not extend `%UnitTest.TestCase`). Rule #35 satisfied.

No `.ts`/vitest files were touched by this pass. `@iris-mcp/interop` (334/334) and `@iris-mcp/all`
(120/120, run standalone/isolated) were re-verified clean and are unaffected by the new
ObjectScript-only test.

## Coverage

- `set` branch composite-key resolution: comprehensively covered (primitive contract +
  real-HTTP found/not-found/cross-production/unknown-production cases).
- `get` branch optional `production` filter: now covers both FOUND (pre-existing) and
  NOT-FOUND (this pass) paths.
- **Explicitly NOT covered here, by design** — a separately-confirmed, separately-ledgered
  defect: `set`'s applied settings are written only to the `Ens.Config.Item` SQL extent
  (`tItem.%Save()`, never `tProd.SaveToClass(tItem)`), so a later `set`/`add`/`remove` call or
  a production-class recompile silently discards them (reproduced live during this QA pass —
  see the story's QA notes / deferred-work ledger). No regression test was added for this
  because the underlying behavior is a live defect, not yet fixed; adding a test that asserts
  the current (broken) behavior would misleadingly codify it as intended. The fix + its own
  RED→GREEN regression test belong to a follow-up story once the `set`-driven `className`
  update edge case (which would need the same `%Dictionary.CompiledClass` validation `add`
  already has, to avoid `SaveToClass` swallowing an `OnConfigChange` `<METHOD DOES NOT EXIST>`)
  is resolved.

## Status after rework — this document's QA-pass sections above are SUPERSEDED

Everything above records the state at the end of the QA pass (`cycle_iteration=1`). Two things
it describes as open were **closed inside Story 35.1 itself**, so read the sections above as a
historical record of the QA pass, not as the story's delivered state:

1. **The `set`-durability HIGH was FIXED in this story**, not deferred to a follow-up. The lead
   ruled it must be fixed in-story (Epic 35's goal is a beta with no known-broken tool action,
   and a silent revert is data-loss-shaped). `set` now dual-writes: `tItem.%Save()` for the SQL
   extent `get` reads, then `tProd.SaveToClass(tItem)` for XData durability — live-probed that
   neither write alone is sufficient. Regression pin:
   `TestSetSequentialMutationsBothPersistAndSurviveRecompile` (two sequential mutating `set`
   calls + a direct `$System.OBJ.Compile` survival assertion), mutation-verified RED 0/1 →
   GREEN on the real HTTP endpoint, and independently re-verified RED/GREEN at code review.
2. **The `set`-driven `className` edge case was also closed in this story**, via a shared
   `ValidateHostClassName` classmethod applied to `set`'s `settings.className` path. The code
   review then found the enumeration was still incomplete and extended the same guard to
   `add`'s `settings.className` override (CR 35.1-1).

**Delivered test state (after the code review):** `InteropItemCompositeKeyTest` has **8** `Test*`
methods, all passing; full `ExecuteMCPv2.Tests` package **396/396**. The "5 total / 393/393"
figures above are the `cycle_iteration=1` numbers.

### Test coverage added at code review

- `TestSetRejectsInvalidClassNameWithoutWriting` — drives `set`'s `settings.className` guard over
  the real HTTP endpoint on all three rejection reasons (nonexistent/uncompiled, non-`Ens.Host`,
  abstract) and asserts nothing was persisted. Closes a Rule #59 / real-runtime-evidence gap: the
  guard shipped with **no** test sending a `className` to `set` at all.
- `TestAddSettingsClassNameOverrideIsGuarded` — regression pin for CR 35.1-1.
- Strengthened the two cross-production isolation tests to assert exact checked-in baselines across
  every writable field and to check **both** fixtures, and moved fixture restoration into
  `OnBeforeOneTest` as well as `OnAfterOneTest` (with the restore status now asserted rather than
  swallowed) so the suite is order-independent and self-healing after an aborted run.

## Next steps

- No further automated-test gaps identified against Story 35.1's stated ACs at this time.
- Open items found at code review are ledgered in `deferred-work.md` under
  "Story 35.1 code review" — notably `35-1-CR-1` (an item whose host class no longer resolves is
  unreachable through `set`/`remove`), which is a HIGH carried out of this story.
