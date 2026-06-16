# Deferred Work

All deferred items have been formally triaged and closed as of Story 8.0 (Epic 7 Deferred Cleanup).
This is the final feature epic; no further feature work is planned beyond Epic 8 (Documentation).

> **Epic 1-4 items formally closed in Story 7.0** (26 items). See git history for provenance.

---

## Closed Items --- Epic 5 (Interoperability MCP Tools)

### From Story 5-0 (Epic 4 Deferred Cleanup)
- ~~`pastEnd` flag added to `PaginateResult`~~ --- **Closed (Story 8.0)**: Removed as dead code. No consumer existed after 7 epics. The `pastEnd` field has been removed from `PaginateResult`, `paginate()` in server-base.ts, and related tests.

### From Story 5-2 (Production Lifecycle)
- ~~`ProductionControl` tTimeout=0 silently overridden to 120~~ --- **Closed (won't-fix, Story 8.0)**: Edge case with no reported incidents. The server-side default is acceptable for all known use cases.
- ~~`ProductionSummary` inner catch block swallows errors silently~~ --- **Closed (Story 8.0)**: Added console log for skipped namespaces with error reason in Interop.cls.
- ~~`ProductionManage` uses `%Dictionary.ClassDefinition.%ExistsId`~~ --- **Closed (won't-fix, Story 8.0)**: IRIS API limitation. Non-production classes with the same name is an unlikely edge case with no practical impact.
- ~~`productionControlTool` Zod schema marks `name` as optional for all actions~~ --- **Closed (Story 8.0)**: Added `.refine()` validation requiring `name` for `start` and `restart` actions.

### From Story 5-3 (Production Item and Auto-Start)
- ~~`ItemManage` "set" silently ignores unknown settings keys~~ --- **Closed (won't-fix, Story 8.0)**: Acceptable behavior. Unknown keys are ignored per standard IRIS configuration patterns.
- ~~`ItemManage` "set" save/update consistency~~ --- **Closed (won't-fix, Story 8.0)**: Pre-existing IRIS pattern limitation with no simple rollback mechanism. No incidents reported.

### From Story 5-5 (Credential and Lookup Table)
- ~~`LookupTransfer` import is additive/merge~~ --- **Closed (won't-fix, Story 8.0)**: Merge semantics are safer than replace. Tool description is adequate.
- ~~`CredentialManage` empty string username/password handling~~ --- **Closed (won't-fix, Story 8.0)**: Edge case. Users can delete and recreate credentials instead of clearing fields.

### From Story 5-7 (Interop Integration Tests)
- ~~`probeCustomRest` duck-typing instead of instanceof~~ --- **Closed (won't-fix, Story 8.0)**: Cosmetic improvement. Works reliably in practice.
- ~~No integration tests for interopRest/ruleGet/transformTest~~ --- **Closed (won't-fix, Story 8.0)**: Requires IRIS test production setup. Unit tests provide adequate coverage.

---

## Closed Items --- Epic 6 (Operations & Monitoring MCP Tools)

### From Story 6-0 (Epic 5 Deferred Cleanup)
- ~~No npm script for gen-bootstrap.mjs~~ --- **Closed (Story 8.0)**: Added `gen:bootstrap` script to root package.json.
- ~~No error handling in gen-bootstrap.mjs for missing .cls files~~ --- **Closed (won't-fix, Story 8.0)**: Node.js already provides clear error messages for missing files. Low value add.

### From Story 6-3 (Jobs and Locks Tools)
- ~~AC1 "start time" field~~ --- **Closed (won't-fix, Story 8.0)**: IRIS %SYS.ProcessQuery does not expose start time. Cannot be implemented without IRIS-side changes.
- ~~No ObjectScript unit test for dual-format Owner parsing~~ --- **Closed (won't-fix, Story 8.0)**: Verified by lead during review. TypeScript-side tests cover the parsing.

### From Story 6-6 (Task Scheduling Tools)
- ~~AC6 "duration" not computed~~ --- **Closed (won't-fix, Story 8.0)**: lastStart and completed timestamps are available for client-side derivation.
- ~~No schedule properties in iris.task.manage create action~~ --- **Closed (won't-fix, Story 8.0)**: Complex scheduling subsystem. No planned future enhancement epics.

### From Story 6-7 (System Configuration Tools)
- ~~Dynamic annotations via `_meta.readOnly`~~ --- **Closed (won't-fix, Story 8.0)**: Known MCP protocol limitation. Static annotations are the correct approach.
- ~~GetConfig reads only 11 hardcoded properties~~ --- **Closed (won't-fix, Story 8.0)**: Covers most common configuration needs. Full property iteration is a future enhancement.
- ~~No whitelist/validation on SetConfig property names~~ --- **Closed (won't-fix, Story 8.0)**: Config.config.Modify() validates server-side. Defense-in-depth only.
- ~~ExportConfig only includes config section~~ --- **Closed (won't-fix, Story 8.0)**: Intentional per original design. No incidents or requests for expansion.

### From Story 6-8 (Ops Integration Tests)
- ~~Duplicate getConfig()/declare global blocks~~ --- **Closed (Story 8.0)**: Extracted shared `getIntegrationConfig()` helper to `@iris-mcp/shared/test-helpers/integration-config`.
- ~~Task creation unchecked `as` cast~~ --- **Closed (won't-fix, Story 8.0)**: Low risk. Cleanup runs via afterAll regardless.

---

## Closed Items --- Epic 7 (Data & Analytics MCP Tools)

### From Story 7-3 (Analytics Tools)
- ~~`%BuildCube` synchronous with no timeout~~ --- **Closed (won't-fix, Story 8.0)**: Story spec explicitly calls for synchronous operation. Timeout/async is a future enhancement.

### From Story 7-4 (REST API Management)
- ~~`encodeURIComponent()` percent-encoding slashes~~ --- **Closed (won't-fix, Story 8.0)**: Follows spec-prescribed pattern. No reported issues.

### From Story 7-5 (Data Integration Tests)
- ~~`insertedDocId` regex only matches numeric IDs~~ --- **Closed (won't-fix, Story 8.0)**: Fallback only; structuredContent extraction is primary. Low risk.
- ~~Find-with-filter test does not assert document count~~ --- **Closed (won't-fix, Story 8.0)**: Other lifecycle tests verify content correctness. Low priority.

---

## Deferred from: code review of 8-0-epic-7-deferred-cleanup (2026-04-07)

- Duplicate `getIntegrationConfig` helper: `packages/shared/src/__tests__/integration-helpers.ts` (pre-existing, accepts overrides) and `packages/shared/src/test-helpers/integration-config.ts` (new, includes `declare global` augmentation). Both produce the same config from env vars. Functionally harmless but could be consolidated into the new cross-package helper if `integration-helpers.ts` is refactored to delegate to it.

## Deferred from: code review of 8-1-suite-level-readme-and-architecture-overview (2026-04-07)

- Per-package README links in root README.md point to files that do not yet exist (e.g., `packages/iris-dev-mcp/README.md`). These will be created in Story 8.2. Until then, links are dead. Pre-existing by design (story spec says to link ahead).

## Deferred from: code review of 8-4-mcp-client-configuration-examples (2026-04-07)

- DRY: Env var table and shell export examples (bash/PowerShell) are duplicated identically across all three client-config docs (`claude-desktop.md`, `claude-code.md`, `cursor.md`). This is a deliberate design choice for self-contained docs but creates a maintenance burden if variables change. Could be consolidated into a shared include or a single env-var reference page linked from each doc.

## Deferred from: code review of 8-6-meta-package-iris-mcp-all (2026-04-07)

- Missing `license` field in `packages/iris-mcp-all/package.json`. All packages in the monorepo may need license, repository, author, and keywords fields added before npm publish. Pre-existing publish-readiness concern applicable to all packages.

---

## Triaged via Story 9.0 (2026-04-09)

Story 9.0 formally triaged all Epic 8 retrospective action items and unclosed `deferred-work.md` entries against Epic 9 (Tool Name Flattening) scope. Epic 9 is a narrowly scoped pre-publish compatibility fix, so most deferred items fall outside its boundary and are either resolved, retained as cosmetic follow-ups, or redirected to the publishing checklist. See `9-0-epic-8-deferred-cleanup.md` for the authoritative triage tables.

### Resolved (no longer an open concern)

- **Per-package README dead links (from 8.1 code review)** — Resolved by Story 8.2, which created the per-package READMEs that the root README was linking to. The dead-link condition no longer exists. No further action required.

### Retained as cosmetic follow-ups (not tracked by any Epic 9 story)

These items remain open and visible in this file for future contributors. They are explicitly NOT in Epic 9 scope and will not be addressed by Stories 9.1, 9.2, or 9.3. They may be picked up opportunistically during a future cleanup pass or left as-is indefinitely.

- **Duplicate `getIntegrationConfig` helper (from 8.0 code review / Retro Post-Project Action #4)** — `packages/shared/src/__tests__/integration-helpers.ts` and `packages/shared/src/test-helpers/integration-config.ts` both produce the same config from env vars. Cosmetic consolidation only; both helpers are functionally correct.
- **DRY env var docs across client-config guides (from 8.4 code review / Retro Post-Project Action #5)** — Env var table and shell export examples are duplicated across `claude-desktop.md`, `claude-code.md`, and `cursor.md`. Deliberate self-contained-doc design; could be consolidated into a shared include if maintenance burden grows.

### Deferred to the publishing checklist (not Epic 9)

These items are genuine pre-publish readiness requirements but belong to the npm publishing session that happens *after* Epic 9 unblocks Claude Desktop compatibility. They are tracked in the authoritative publishing checklist, not in Epic 9 stories.

- **Missing `license`, `repository`, `author`, `keywords`, `engines`, `publishConfig` in `package.json` files (from 8.6 code review)** — Tracked in [`../planning-artifacts/research/publishing-checklist-npm-ipm.md`](../planning-artifacts/research/publishing-checklist-npm-ipm.md) item A2. To be addressed during the pre-publish session, not during Epic 9.

### Dropped (post-Epic 9 publishing work, unrelated to rename)

These retrospective action items are the publishing activity itself and live beyond Epic 9's boundary. They are not retained in `deferred-work.md` — they belong to the publishing checklist and post-project planning.

- Retro Post-Project Action #1: npm publishing session (account, org, package.json fields, publish)
- Retro Post-Project Action #2: Bootstrap drift check before every publish — already embedded as an AC in Story 9.2
- Retro Post-Project Action #3: IPM publishing via Open Exchange
- Retro Follow-Through: test production + integration tests for interopRest/ruleGet/transformTest — already formally deferred by Epic 8 retro as "too complex for cleanup"
- Retro Follow-Through: MCP test harness — already formally deferred by Epic 8 retro as "post-project"

---

## Deferred from: code review of 10-1-iris-package-list (2026-04-20)

- **`generated` query parameter ignored on the `/modified/{ts}` Atelier branch** — Both `iris_package_list` and the sibling `iris_doc_list` pass `generated` to `/docnames/{cat}/{type}` but not to `/modified/{ts}`. Atelier's `/modified/` endpoint accepts a `generated` query param, so a caller with `modifiedSince: X, generated: true` expecting generated docs gets only non-generated ones. Pre-existing inconsistency inherited from `doc.ts`; out of scope for 10.1. Fix would apply to both tools together.
- **Digit-prefixed "package" rows (e.g., a `"2"` row with 13 docs observed on USER)** — Documents with class-name stems that start with digits (typically compiled/generated artifacts like `2.SomeName.cls`) roll up under a numeric top-level package name. The rollup is technically correct — these really are dotted names — but the output looks odd. Callers can filter via `category: "CLS"` if undesired. Not worth synthetic bucketing (too speculative about intent). Leaving as observed behavior; documented in the CSP-bucketing comment on `rollupPackage`.

## Deferred from: code review of 10-2-iris-doc-export (2026-04-20)

- **`.manifest.json.tmp` cleanup on rename failure** (export.ts:742-746) — If `fsp.rename` fails (e.g., AV scanner holding the final file open on Windows), the `.manifest.json.tmp` is left behind on disk. Not a security or correctness issue — the next successful run overwrites it, and the temp name makes its purpose obvious. LOW severity. A `finally { unlink(tmp).catch(() => {}) }` could clean up, but adds complexity for a rare failure mode.
- **Weird doc-name edge cases in `docNameToFilePath`** (load.ts:148-169) — Inputs like `".cls"` (only an extension), `"Foo..cls"` (empty segment in middle), or `".LeadingDot.cls"` produce slightly unusual paths with double slashes that `path.resolve` normalizes into the right tree. Atelier is not observed to emit such names. Defensive normalization could be added if the export tool ever ingests non-Atelier sources. LOW severity.

## Deferred from: code review of 11-3-db-metrics-config-accuracy-and-bootstrap-bump (2026-04-21)

- **`%ResultSet.Close()` not called on exception path in `DatabaseList()` loop** (`src/ExecuteMCPv2/REST/Config.cls:179-213`) — The `tRS.Close()` call on line 213 only runs when the `While tRS.Next()` loop completes normally. If an exception is thrown mid-loop (e.g., from `%Set("resource", ...)` or a `Config.Databases.Get()` that returns a non-$$$OK status that the current code doesn't pre-check), the catch block restores namespace and renders an error response but leaves `tRS` unclosed. Pre-existing; not introduced by Story 11.3. Same latent pattern exists throughout the file. LOW severity — `%ResultSet` cleanup is refcount-driven in modern IRIS, so the leak is theoretical. A `finally`-equivalent would be an outer-level `If $IsObject(tRS) { Do tRS.Close() }` in the catch. Defer to a future Config-handler hardening pass.
- **`%ResultSet.Close()` not called on exception path in `SystemConfig.GetConfig` locale branch** (`src/ExecuteMCPv2/REST/SystemConfig.cls:192-201`) — Same pattern as above: `Do tRS.Close()` is conditional on the `$$$ISOK(tSC2)` branch completing, but if an exception fires inside the `While tRS.Next()` loop (or inside `%Set("current", ...)`), `tRS` is left open. Pre-existing; not introduced by Story 11.3. LOW severity. Same fix applies.

## Deferred from: code review of 11-1-objectscript-error-envelope-and-sanitization (2026-04-21)

- **Missing ObjectScript unit test for `SanitizeError` prefix-strip (Bug #11)** (`src/ExecuteMCPv2/Tests/UtilsTest.cls`) — Story 11.1 adds the `"ERROR #N: "` / `"خطأ #N: "` strip to `Utils.SanitizeError` but no unit test exercises the strip itself. `TestSanitizeErrorStripsDetails` still passes (it only checks caret-reference removal), so a future regression of the prefix-strip would not be caught by the existing test suite. AC 11.1.5 explicitly scoped tests to +2 TypeScript tests, and AC 11.1.6 defers end-to-end validation to Story 11.3, so adding a `TestSanitizeErrorStripsLeadingErrorPrefix` test is out of Story 11.1's scope. LOW–MEDIUM severity. Recommend adding as part of Story 11.3 or a follow-up test-hardening story: assert that `GetErrorText(SanitizeError($$$ERROR($$$GeneralError, "ERROR #5001: Foo")))` contains exactly one `#5001` prefix.
- **Prefix-strip only handles English `ERROR` and Arabic `خطأ`; other locales still double-wrap** (`src/ExecuteMCPv2/Utils.cls:141`) — IRIS ships `ERREUR` (French), `FEHLER` (German), and other localized prefixes from `$System.Status.GetErrorText`. The current two-entry `For tPrefix = "ERROR #", "خطأ #"` list will miss those locales and produce `ERROR #5001: ERREUR #5001: ...` chains on locale-mixed environments. AC 11.1.2 and the sprint-change-proposal explicitly name only these two variants, so this is in-scope as-specified but fragile for multi-locale installs. LOW severity. If more locales matter, generalize to a regex-style scan over a configured prefix list or use `$System.Status.DecomposeStatus` to get the code + message fields directly instead of string-parsing `GetErrorText` output.
- **`Use tInitIO` without mnemonic clause leaves mnemonic routine bound after restore** (`src/ExecuteMCPv2/REST/Command.cls:75,96`) — Line 55 binds the redirect mnemonic via `Use tInitIO::("^"_$ZNAME)`, and the restore uses bare `Use tInitIO` (no mnemonic clause). In IRIS, `Use device` without a third colon-clause does NOT unbind the previously-set mnemonic routine — it stays bound on the device even after `ReDirectIO(0)`. Since the redirect flag is disabled, writes go to the default output, so there is no observable bug today. Latent concern only: if any code further up the stack later re-enables redirect on this device without first rebinding a mnemonic, the stale `^ExecuteMCPv2.REST.Command.1` would be used. LOW severity. A belt-and-braces fix would be `Use tInitIO::("")` or `Use tInitIO:::$Select(tOldMnemonic="":"", 1:"^"_tOldMnemonic)` to explicitly clear/restore the mnemonic. Deferred because the live verification in AC 11.1.4 confirms the current restore is sufficient for the Atelier request lifecycle.

---

## Triaged via Story 12.0 (2026-04-22)

Story 12.0 formally triaged all Epic 11 retrospective action items and all unclosed `deferred-work.md` entries against Epic 12 scope. See `12-0-epic-11-deferred-cleanup.md` for the authoritative triage tables. Summary of decisions:

### Resolved by Story 12.0

- **Missing ObjectScript unit test for `SanitizeError` prefix-strip** (`src/ExecuteMCPv2/Tests/UtilsTest.cls`) — **RESOLVED in Story 12.0**. Two new test methods added: `TestSanitizeErrorStripsLeadingErrorPrefix` and `TestSanitizeErrorStripsArabicPrefix`. Both verify that calling `SanitizeError` is idempotent — repeated calls do not accumulate additional `#N:` prefix nesting. This closes the coverage gap flagged by the Epic 11 code review (CR 11.1) and codified in Rule #8. 19/19 tests pass.

### Dropped (already resolved, no further action needed)

- **Retro action item: Build publishing checklist (npm account, package.json fields)** — Already captured in `publishing-checklist-npm-ipm.md` and the `user_npm_publish_experience` memory. No Story 12.0 action needed.
- **Retro action item: Grep for stale `protocols:` references in mocks/tests** — Completed during Epic 11 Story 11.4 code review. One instance found and fixed at that time. No further action.

### Retained as open deferred items (not addressed in Story 12.0 or Epic 12)

The following items remain open. They are NOT in Epic 12 scope and will be re-triaged after Epic 12's retrospective:

**Epic 11 retrospective action items deferred:**
- Retro action #1: Run pre-publish smoke test (Story 9.3 rerun) — deferred to pre-publish session.
- Retro action #3: Update `/bmad-retrospective` skill to enforce Rules codification step — low urgency; Rule #1 is self-enforcing without formal skill update.
- Retro action #6: Generalize locale prefix-strip for non-English/Arabic (FR, DE, etc.) — low priority; scoped out pending future hardening pass.

**Code-review deferred items retained from prior epics:**
- CR 10.1: `generated` query param ignored on `/modified/{ts}` Atelier branch — pre-existing inconsistency; not Epic 12 scope.
- CR 10.1: Digit-prefixed "package" rows (e.g., `"2"`) — documented behavior with workaround; not worth synthetic bucketing.
- CR 10.2: `.manifest.json.tmp` cleanup on rename failure — LOW severity; next run overwrites.
- CR 10.2: Weird doc-name edge cases in `docNameToFilePath` — LOW severity; Atelier not observed to emit such names.
- CR 11.3: `%ResultSet.Close()` not called on exception path — `Config.cls DatabaseList()` — LOW; same pattern throughout file; defer to future Config-handler hardening pass.
- CR 11.3: `%ResultSet.Close()` not called on exception path — `SystemConfig.cls locale branch` — LOW; same shape as above.
- CR 11.1: Prefix-strip only handles English + Arabic; other locales double-wrap — LOW for this project (HSCUSTOM is `enuw` + mixed message tables).
- CR 11.1: `Use tInitIO` without mnemonic clause — stale mnemonic binding — latent concern only; live Epic 11 verification confirmed current restore is sufficient.
- Epic 8.x CR/retro legacy: Duplicate `getIntegrationConfig` helpers, DRY env-var docs, missing package.json fields — cosmetic/publishing-checklist items unchanged from Story 9.0 closure.

## Deferred from: code review of 12-1-password-change-fix-and-policy-surface (2026-04-22)

- **No test for `changePasswordOnNextLogin: false → 0` path** (`packages/iris-admin-mcp/src/__tests__/user.test.ts`) — The `false → 0` conversion is the symmetric counterpart to the tested `true → 1` path (handler: `changePasswordOnNextLogin ? 1 : 0`). LOW severity. The logic is trivial and the handler code is correct; adding a `changePasswordOnNextLogin: false` test case would fully close the branch. Could be added in a future test-hardening pass or alongside Story 12.4's live-verification tests.

## Deferred from: code review of 12-2-production-control-dynamicobject-audit (2026-04-22)

- **`tTimeout=0` silently overrides caller-supplied zero timeout** (`src/ExecuteMCPv2/REST/Interop.cls:148`) — `If tTimeout = 0 Set tTimeout = 120` treats caller-supplied `timeout: 0` (intentional immediate stop) the same as omitted timeout. Pre-existing behavior carried forward from the old `$Get(tBody.%Get("timeout"), 120)` default; not introduced by the BUG-3 fix. LOW severity. If zero-timeout is ever needed, add `If tBody.%IsDefined("timeout") { Set tTimeout = +tBody.%Get("timeout") } Else { Set tTimeout = 120 }`.
- **CHANGELOG ordering — BUG-3 entry above Story 12.1's BUG-1 in `### Fixed` block** (`CHANGELOG.md:9`) — AC 12.2.6 specified "append below any Story 12.1 entries." BUG-3 was prepended instead (appears on line 9, BUG-1 on line 10). Cosmetic; same block; no functional impact. Could be reordered in a docs-cleanup pass.
- **Test count delta +2 vs AC-stated +3-4** (`packages/iris-interop-mcp/src/__tests__/production.test.ts`) — AC 12.2.4 + AC 12.2.8 targeted +3-4 new interop tests; dev added +2. Coverage is complete because the other 2 specified cases ("stop forwards optional timeout + force", "start requires name parameter") were covered by pre-existing tests. INFO — discrepancy is in stated count only, not in actual test coverage.

## Deferred from: code review of 12-3-production-create (2026-04-22)

- **`ProductionSummary` fallback hardcodes stateCode 2 / "Stopped" for never-started productions** (`src/ExecuteMCPv2/REST/Interop.cls:924`) — The `^Ens.Config.ProductionD` fallback path assigns `state: "Stopped"` (stateCode 2) for all enumerated productions when `GetProductionStatus` returns empty name. "Stopped" is the closest valid sentinel and matches live-verified behavior; "None" (no stateCode equivalent) could be more precise but is non-standard. LOW severity. Acceptable as-is.
- **New create unit test partially duplicates pre-existing test** (`packages/iris-interop-mcp/src/__tests__/production.test.ts:123`) — `"create action returns created envelope with name"` and `"should send POST with create action and name in body"` (line 23) test the same path; only difference is the namespace value. Harmless redundancy. LOW severity.
- **Delete running-check guards only state=1 (Running), not states 4 (Troubled) or 5 (NetworkStopped)** (`src/ExecuteMCPv2/REST/Interop.cls:106`) — Both Troubled and NetworkStopped are active states that may have locks or running jobs. Pre-existing; not introduced by this story. LOW severity. A future hardening pass could extend the guard to `(tState = 1) || (tState = 4) || (tState = 5)`.
- **Orphaned `Ens.Config.Production` record without class definition not handled** (`src/ExecuteMCPv2/REST/Interop.cls:96`) — If a class was deleted externally but its `^Ens.Config.ProductionD` record remains, the exists-check (`%Dictionary.ClassDefinition.%ExistsId`) returns false and the delete returns "does not exist" without cleaning up the orphaned record. LOW severity; edge case requiring external class deletion. If this becomes an issue, add a secondary check on `Ens.Config.Production.%ExistsId` and delete the record if the class is gone.

## Deferred from: live verification of 12-4-database-modify-docdb-and-bootstrap-bump (2026-04-22)

- **`iris_docdb_find` filter translation works, but queries against typed properties return empty when values aren't auto-extracted from `%Doc`** — The filter translation fix (MongoDB-style → DocDB `{restriction: [field, value, operator]}`) IS correct: empty filter `{}` returns all docs, non-existent-field filter (e.g., `{"name": "Alice"}`) returns IRIS error `ERROR #25541: DocDB Property 'name' does not exist`, and declared-property filters reach the server. BUT: when docs are inserted with `iris_docdb_document insert {document: {"age": 30}}`, the typed `age` column in the underlying SQL table remains `0` (or NULL) — the JSON value isn't auto-extracted into the typed property. SQL probe confirms: `SELECT %DocumentId, age FROM ISC_DM.TESTMCPDocs4` returns `[1,0]` and `[2,0]` for docs that had `"age":30` and `"age":25` in their JSON. Therefore `{"age":{"$gt":26}}` returns empty — the filter hits the typed column which is all zeros. This is a DocDB property-extraction/indexing issue independent of the filter translation. LOW–MEDIUM severity — BUG-5 (type) IS fixed; BUG-6 (find) is PARTIALLY fixed (filter translation works; property value population doesn't). Needs an Epic 13 follow-up to investigate whether (a) IRIS requires an explicit `index` step after property definition before values populate, (b) the `iris_docdb_property index` action must be invoked and has its own bug (the `index` action currently errors with `ERROR #5805: ID key not unique for extent '%Dictionary.PropertyDefinition'`), or (c) a new ExecuteMCPv2 handler is needed to force re-indexing. For now, `iris_docdb_find` is usable with empty filter (`{}`) to list all documents, and the structured filter translation is in place for when the upstream property-population issue is resolved.

## Deferred from: code review of 12-4-database-modify-docdb-and-bootstrap-bump (2026-04-22)

- **`buildDocDbRestriction` JSDoc says "skipped with a console warning" for unknown operators but no `console.warn` call exists** (`packages/iris-data-mcp/src/tools/docdb.ts:~102`) — The JSDoc comment at the top of the function states "Unsupported operators are skipped with a console warning" but the implementation only has an inline comment ("Unknown operators are silently skipped — the caller will get all docs") with no actual `console.warn` call. Behavior is correct; only the JSDoc is inaccurate. LOW severity. Fix: either add `console.warn(\`buildDocDbRestriction: unsupported operator "${mongoOp}" on field "${field}" — skipped\`)` inside the branch, or update the JSDoc to say "silently skipped". Defer to a future docs-cleanup pass.

- **Config.cls create branch: no rollback if `Config.Databases.Create()` fails after `SYS.Database.CreateDatabase()` succeeds** (`src/ExecuteMCPv2/REST/Config.cls:~376`) — `CreateDatabase()` creates the physical `IRIS.DAT` file on disk. If the subsequent `Config.Databases.Create()` call fails (e.g., name collision, invalid config props), the physical file is left on disk without a CPF registration. A subsequent re-attempt to create the same DB name with the same directory would then fail at `CreateDatabase()` because the directory already has an IRIS.DAT. Pre-existing architectural pattern (the original single-step code had the same risk if Create failed internally). LOW severity — the scenario requires Config.Databases.Create to fail after CreateDatabase succeeds, which is unlikely when the directory is freshly created. A complete fix would add a `SYS.Database.DeleteDatabase(tDir)` call in the cleanup path when `Config.Databases.Create` fails. Defer to a future Config-handler hardening pass.

## Deferred from: code review of 12-5-typescript-tool-surface-cleanup (2026-04-22)

- **`iris_oauth_manage` Zod schema for `supportedScopes` accepts only `string`, but callers cannot pass an array directly** (`packages/iris-admin-mcp/src/tools/oauth.ts:81`) — The handler converts the string to an array via `/[\s,]+/` split before sending to IRIS. This is the correct caller contract (callers provide space- or comma-separated string; handler normalizes). However the schema description does not mention the splitting behavior, and an array input would be rejected by Zod. LOW informational — schema design is intentional per AC 12.5.1. Could improve by adding "split by whitespace or comma before sending to IRIS" to the description. Defer to a future docs-cleanup pass.

- **`iris_rest_manage` scope:"all" deduplication collapses apps with identical/empty name** (`packages/iris-data-mcp/src/tools/rest.ts:172`) — The deduplication `seen` set uses `String(item.name ?? "")` as the key. If multiple apps share an empty or identical name (pathological but not impossible), only the first is included and the rest are silently dropped. Pre-existing pattern introduced in the same PR as the union behavior. LOW severity — IRIS REST applications always have unique non-empty path names by construction. No fix needed unless IRIS changes its webapp naming semantics.

## Deferred from: Story 12.6 — iris_alerts_manage new tool (2026-04-22)

- **Per-alert `clear` by index — deferred to Epic 13 (if demand)**: IRIS exposes no API for removing individual lines from `alerts.log`. The `alerts.log` file is append-only text located at `$zu(12)`. A fix would require direct file I/O under `IRIS.Temp.Alerts` lock — risky, brittle, and out of Epic 12 scope. API surface research confirmed: `$SYSTEM.Monitor.GetAlerts(.tAlertData, .tMessages, .tLastAlert)` reads the file but there is no corresponding `ClearAlert(index)` method. Only `Clear()` (clear all) and `ClearAlerts()` (clear counter only) exist.

- **Alert `acknowledge` — deferred to Epic 13 (if demand)**: Not supported natively for system enterprise-monitor alerts. `%Monitor.Alert.Notified` is a `Transient` property that applies to alert *definitions*, not individual alert *instances*. Ensemble managed alerts DO have an `Acknowledge` timestamp, but that is a separate subsystem. A native-style `acknowledge` action for system alerts would require a custom `ExecuteMCPv2` tracking table (storing which alert indexes have been seen by which client, keyed by timestamp or content hash) and a new REST handler for insert/query/delete on that table. This is app-level custom state — out of Epic 12 scope.

## Deferred from: code review of 13-2-documentation-rollup (2026-04-23)

- **Pre-existing `@iris-mcp/ops` tool-count drift: section heading and Mix line say 17, but Suite-wide rollup and READMEs say 16** (`tool_support.md:145`, `tool_support.md:167`, `tool_support.md:253`, plus cross-refs at `README.md:16`, `packages/iris-mcp-all/README.md:26`, `docs/migration-v1-v2.md:30`) — The `@iris-mcp/ops` per-table section at `tool_support.md:145` reads `Operations & Monitoring (17)` and the Mix line at line 167 reads `17 ExecuteMCPv2`. Counting the ops table rows confirms 17 tools (including `iris_alerts_manage` added in Epic 12 Story 12.6, commit `a373316`). However the Suite-wide rollup at line 253 says `| \`@iris-mcp/ops\` | 0 | 16 | 0 | **16** |` and the suite/meta-package READMEs show `@iris-mcp/ops` with tool count 16. Likely root cause: Epic 12 Story 12.6 (which added `iris_alerts_manage`) updated the per-table section and Mix line but did not propagate the count change into the Suite-wide rollup or the suite READMEs. **Not in scope for Story 13.2** — dev followed the AC literally (87 → 88 suite total, based on +1 dev tool) and flagged this drift in the review context. Out-of-scope but worth fixing in a follow-up docs-rollup pass: increment ops by 1 to 17 across the rollup row (changing `@iris-mcp/ops` row from `0 | 16 | 0 | **16**` to `0 | 17 | 0 | **17**`), update suite README dev/ops row, meta-package README, migration guide. Suite total should then become 89 (not 88). LOW severity — a cosmetic count inconsistency, not a functional issue.

---

## Triaged via Story 14.0 (2026-06-15)

Story 14.0 (Epic 14 retro-review gate) formally re-triaged every open `deferred-work.md` item against Epic 14's scope. Epic 13's retrospective was skipped (commit `079ed17`), so this triage runs off `deferred-work.md`. See [`14-0-epic-13-deferred-cleanup.md`](14-0-epic-13-deferred-cleanup.md) for the authoritative per-item triage tables.

**Decision summary: 0 INCLUDE, all DEFER** (one item ROUTED). Epic 14 is a strictly-additive Platform Foundation epic (multi-server profiles, governance cascade, MCP resources); none of the open items intersect its scope, and all are LOW / INFO / cosmetic / "future hardening pass" items already triaged across Stories 7.0/8.0/9.0/12.0.

### Routed (assigned to an Epic 14 story)

- **`@iris-mcp/ops` tool-count drift (CR 13.2, from 13-2 code review)** — **ROUTED to Story 14.6 (Documentation Rollup)**. The section heading/Mix line say 17 while the suite-wide rollup and READMEs say 16 (`iris_alerts_manage` from Story 12.6 not propagated everywhere). Story 14.6 reconciles suite/per-package tool counts as part of the Epic 14 docs rollup; suite total should land at 89. Remains open here until Story 14.6 closes it.

### Retained as open deferred items (NOT in Epic 14 scope)

All remaining open items are explicitly carried forward unchanged — re-triage after Epic 14's retrospective. They are NOT addressed by any Epic 14 story:

**Carried from Story 12.0 "retained open":** Epic 11 retro #1 (pre-publish smoke → publishing checklist), #3 (retrospective-skill automation), #6 (locale prefix-strip generalization); CR 10.1 (`generated` on `/modified/{ts}`; digit-prefixed package rows); CR 10.2 (`.manifest.json.tmp` cleanup; `docNameToFilePath` edge cases); CR 11.3 (`%ResultSet.Close()` exception path — `Config.cls` + `SystemConfig.cls`); CR 11.1 (EN/AR-only prefix-strip; `Use tInitIO` mnemonic); Epic 8.x legacy (duplicate `getIntegrationConfig`, DRY env-var docs, missing `package.json` fields).

**New Epic 12 code-review deferrals:** CR 12.1 (`changePasswordOnNextLogin:false→0` test); CR 12.2 (`tTimeout=0` override; CHANGELOG ordering; test-count delta); CR 12.3 (`ProductionSummary` stateCode-2 fallback; duplicate create test; delete running-check state coverage; orphaned `Ens.Config.Production` record); live-verify 12.4 (`iris_docdb_find` typed-property population — LOW–MEDIUM, strongest future-cleanup candidate); CR 12.4 (`buildDocDbRestriction` JSDoc; `Config.cls` create no-rollback); CR 12.5 (`iris_oauth_manage` `supportedScopes` schema; `iris_rest_manage` `scope:all` dedup); Story 12.6 (per-alert `clear` by index; alert `acknowledge` — both "if demand").

---

## Deferred from: code review of story-14.1 (2026-06-15)

Origin story: **14.1** (Multi-Server Profiles — Config Model & Connection Resolution). All items LOW/MED; none block Story 14.1 (the HIGH bootstrap-flag finding and the File-List MED were auto-resolved inline during review). Several are explicitly routed to **Story 14.2**, which wires `getOrCreateClient` into `handleToolCall` and thus first creates the per-call/concurrent code path these items concern.

- **[14.1 / MED] Concurrency race in `getOrCreateClient` first-touch establishment** (`packages/shared/src/server-base.ts:566-593`) — Source: code review (Blind Hunter #1). Issue: the method is `async` with `await checkHealth(client)` + `await negotiateVersion(client)` sitting between the `profileMeta.get(name)` existence check and the `profileMeta.set(name, meta)` write, and there is no in-flight promise cache. Two concurrent first-touch calls for the same non-default profile both observe `existingMeta === undefined`, both establish, and both call `attemptProfileBootstrap` on the same shared client — defeating the documented "bootstrap at most once per profile" contract. Deferral rationale: Story 14.1 has **no production caller** of `getOrCreateClient` (it is exercised only by unit tests; `handleToolCall` calls `this.clients.getOrCreate(DEFAULT_PROFILE_NAME)` synchronously). The concurrent-dispatch path is introduced by Story 14.2 when it wires `getOrCreateClient` into per-call selection. Adding promise-caching now would be speculative infrastructure for a caller that does not yet exist and risks pre-empting 14.2's concurrency design. Suggested resolution: in **Story 14.2**, cache the establishment `Promise` per profile name (e.g. `Map<string, Promise<{client, atelierVersion}>>`) so concurrent first-touch calls await one shared establishment; add a concurrent-dispatch test (two simultaneous `getOrCreateClient(sameProfile, true)` → bootstrap called once).

- **[14.1 / MED] Non-default first-touch health-check failure caches the client but records no meta** (`packages/shared/src/server-base.ts:565` vs `:580`/`:593`) — Source: code review (Edge Case Hunter #2). Issue: `this.clients.getOrCreate(name)` caches the client at line 565; if `await checkHealth(client)` throws at line 580 (server unreachable), the throw happens before `profileMeta.set` at line 593, so no meta is recorded and the cached (un-established) client is never `destroy()`-ed. Every subsequent `getOrCreateClient` for that profile re-enters the first-touch path and re-runs health/negotiation. Deferral rationale: low impact — no session is established on a failed health check (nothing to leak), and re-trying establishment on the next call is defensible behavior (you generally *want* a transient failure to be retryable rather than permanently cached). Best revisited alongside 14.2's real call path, where the retry/error UX is observable. Suggested resolution: in 14.2, decide the desired semantics (retry vs. cache-failure-with-backoff) and either `destroy()` + drop the cached client on health-check failure, or record a `failed`-state meta; add a test that drives a non-default first-touch health-check rejection.

- **[14.1 / LOW] `port` and `timeout` accept coerced strings/booleans/arrays via `Number()` (asymmetric with strict `https`)** (`packages/shared/src/profiles.ts:140-149, 195-206`) — Source: code review (Edge Case Hunter #3/#4, Blind Hunter #5). Issue: `mergeProfile` coerces `port`/`timeout` through `Number()`, so `"443"`→443, `true`→1, `[443]`→443 pass silently, whereas `https` strictly requires `typeof === "boolean"`. Inconsistent strictness; `timeout:true` yields a 1 ms timeout that aborts every request with no validation error. Deferral rationale: not a correctness bug — NaN, fractional, zero, negative, and out-of-range values are still rejected; the coercion is forgiving rather than wrong, and `IRIS_PROFILES` is operator-authored JSON. Hardening only, strictly additive. Suggested resolution: tighten `mergeProfile` to require `typeof === "number"` for `port`/`timeout` (or to reject non-numeric/boolean/array inputs explicitly), mirroring the `https` strictness; add tests for the coercion-rejection cases.

- **[14.1 / LOW] Whitespace-only profile name registered without error; unknown/typo'd profile keys silently ignored** (`packages/shared/src/profiles.ts:277` and `mergeProfile`) — Source: code review (Edge Case Hunter #5, Blind Hunter #6). Issue: the `name === ""` guard rejects only the empty string, so a `"   "` key registers an effectively-unreachable profile (resolvable only by the exact whitespace string, since `resolveProfile` does not trim); and `mergeProfile` reads only recognized keys, so a typo'd field (`hostname` for `host`, `ssl` for `https`) is silently dropped and the profile inherits the default's value — pointing at the wrong server with no error. Deferral rationale: operational footguns, not crashes or correctness bugs; `IRIS_PROFILES` is opt-in operator config. Suggested resolution: trim-and-reject blank profile names; optionally reject unrecognized keys in a profile entry (fail-fast naming the offending key + profile), consistent with the "fail-fast on malformed `IRIS_PROFILES`" promise.

- **[14.1 / LOW] No `destroyAll()`/shutdown drain on `McpServerBase`; default-vs-override profile construction divergence** (`packages/shared/src/server-base.ts`, `packages/shared/src/profiles.ts` `mergeProfile`) — Source: code review (Blind Hunter #2/#11). Issue (a): `ProfileClientRegistry.destroyAll()` exists but `McpServerBase` never calls it — there is no `stop()`/`dispose()` that drains live `IrisHttpClient` instances (cookie jars + in-flight `AbortController`s) on teardown or re-`start()`. This is a **pre-existing** lifecycle gap, not a 14.1 regression — the former single `this.http` was likewise never destroyed by the server; the registry just makes the gap marginally larger. Issue (b): the default profile is built via `{ name, ...defaultConfig }` spread (carries every `IrisConnectionConfig` field automatically) while non-default profiles enumerate fields explicitly in `mergeProfile`'s return, so a future *optional* `IrisConnectionConfig` field would silently drop from every non-default profile (required fields are type-guarded by the `IrisProfile` return type). Deferral rationale: (a) pre-existing and unbounded only across restarts (bounded by profile count in normal single-start operation); (b) speculative — no optional `IrisConnectionConfig` field exists today and the dangerous case (new *required* field) is compile-checked. Suggested resolution: add an `McpServerBase.stop()` that calls `clients.destroyAll()` and clears `profileMeta`; and/or build non-default profiles by spreading the merged base then overriding, so new config fields propagate uniformly.

## Deferred from: code review of story-14.2 (2026-06-15)

Origin story: **14.2** (`server` Parameter Across All Tool Schemas — D2). Code review found **no HIGH findings and no D2 mismatch** (Acceptance Auditor confirmed exact D2 conformance + genuine test coverage of all 8 ACs). Two MED hardening patches (F1 reserved-field collision guard, F5 missing-extended-schema fail-fast) were auto-resolved inline. The items below are deferred — two MED that are latent/scope-bounded, one LOW pre-existing, one INFO coverage nicety.

- **[14.2 / MED] Coalesced in-flight establishment Promise ignores `needsBootstrap` variance** (`packages/shared/src/server-base.ts:726` — `getOrCreateClient` in-flight branch) — Source: code review (Blind Hunter). Issue: the `this.establishing` cache is keyed by profile name only. If an establishment that started with `needsBootstrap=false` is in flight when a second caller arrives with `needsBootstrap=true`, the second caller coalesces onto the first promise and may receive a client whose `attemptProfileBootstrap` never ran (subsequent callers re-establish + bootstrap correctly because `bootstrapAttempted` stays `false`). Deferral rationale: **latent only** — the sole production caller (`handleToolCall`) always passes the constant `this.options.needsCustomRest ?? false`, so within one server instance `needsBootstrap` never varies per profile; the hole is reachable only by a future caller passing a per-call `true` while `needsCustomRest` is false. Fixing it now would re-touch 14.2's just-landed concurrency design for a caller that does not exist. Suggested resolution: either key the in-flight cache by `(profileName, needsBootstrap)`, or have the coalesced caller re-check `bootstrapAttempted` after awaiting and run a one-shot bootstrap if still false; OR document + assert the "needsBootstrap is constant per server instance" invariant on `getOrCreateClient`. Add a test driving mixed-`needsBootstrap` concurrent first-touch.

- **[14.2 / MED] Untrimmed / mis-cased `server` value yields a confusing (but safe) "unknown profile" error** (`packages/shared/src/profiles.ts:333` `resolveProfile`, reached from `server-base.ts:396`) — Source: code review (Edge Case Hunter). Issue: `z.string().optional()` accepts `"prod "`, `" prod"`, `"PROD"`, `"   "`; `resolveProfile` does an exact `registry.get(key)` with no trim/normalize, so a copy-pasted profile name with a trailing space or wrong case throws `ProfileResolutionError` with the stray whitespace hidden inside the quotes (`Unknown server profile "prod "`). Not a crash — it surfaces as a structured `isError`. Deferral rationale: **not patched deliberately** — the QA integration suite (`server-param-integration.test.ts:366`) explicitly asserts whitespace-only `"   "` is NOT treated as default and surfaces unknown-profile; trimming at resolution would change that QA-asserted semantics, and AC 14.2 does not mandate trimming. The related 14.1 CR item already deferred whitespace-name handling to a profile-parsing hardening pass. Conservative classification (prefer defer over a speculative behavior change to tested semantics). Suggested resolution: in a profile-parsing hardening pass, decide trimming/case policy holistically (registration-time trim-and-reject blank names per the 14.1 item, and/or resolution-time trim of surrounding whitespace while preserving the original value in the error for whitespace-only input), then update the QA assertion accordingly.

- **[14.2 / LOW] `addTools()` re-adding an already-registered name throws uncaught, now after `extendedSchemas` + `tools` are mutated** (`packages/shared/src/server-base.ts:480-486`) — Source: code review (Edge Case Hunter). Issue: the MCP SDK's `registerTool` throws `Tool <name> is already registered` on a duplicate; this throw propagates uncaught out of `addTools` (no try/catch). Story 14.2 adds one more internal map (`extendedSchemas`, written at registration before the SDK call) → marginally larger partial-state-on-throw. Deferral rationale: **pre-existing** duplicate-registration behavior, not introduced by 14.2; the legitimate remove→add cycle is handled correctly (`removeTools` deletes `extendedSchemas` + the SDK entry together). Calling `addTools` with a name that is already live is a caller error. Suggested resolution: in a future server-base hardening pass, guard `registerTool` against re-registering an existing name (skip-with-warning, or delete-then-re-add), making both internal maps and the SDK registry consistent on the duplicate path.

- **[14.2 / INFO] Secondary coalescing branch (already-established client + first concurrent bootstrap) is code-correct but lacks a dedicated test** (`packages/shared/src/server-base.ts:715,788`) — Source: code review (Acceptance Auditor). Issue: the established-but-not-yet-bootstrapped + concurrent-first-bootstrap path correctly flows through `this.establishing` coalescing before `establishProfile` bootstraps once, but the existing AC 14.2.7 test exercises only first-touch (no prior meta), so this secondary interleaving is asserted-by-reasoning rather than exercised. Deferral rationale: code is correct (verified by trace); this is an optional coverage nicety, not a defect. Suggested resolution: add a test that establishes a profile via an Atelier-only (`needsBootstrap=false`) call, then fires two concurrent `getOrCreateClient(sameProfile, true)` and asserts bootstrap runs exactly once.

## Deferred from: code review of story-14.3 (2026-06-15)

Origin story: **14.3** (Governance Policy Model, Action Classification & Cascade Resolution — D3/D4/D7). Code review found **no HIGH findings and no D3/D4/D7 mismatch**. The two release-critical items were empirically verified clean: the AC 14.3.7 back-compat gate is **non-vacuous** (proves all 141 real baseline keys enable under empty `IRIS_GOVERNANCE`; non-emptiness independently asserted at `governance-edge.test.ts` `> 100`; drift test re-derives from built dists — live probe confirmed 89 tools → 141 keys, zero anomalies, byte-identical regeneration, hash `1e62c5ad5bf7`), and the cascade uses `??` not `||` (explicit-`false` precedence verified). One MED hardening cluster (prototype-member key handling) was **auto-resolved inline** (see story Review Findings CR-14.3-1). The items below are deferred — all LOW / future-hardening, none reachable in the current tool surface, none block Story 14.3 or its consumers (14.4 enforcement, 14.5 resource).

- **[14.3 / LOW] `defaultSeed` fails OPEN for an unclassified non-baseline key (a new write tool that forgets `mutates` ships ENABLED)** (`packages/shared/src/governance.ts` `defaultSeed`) — Source: code review (Blind Hunter). Issue: `mutatesLookup.get(key) === "write" ? false : true` means any NEW action absent from both the baseline and the `mutates` lookup defaults to enabled (treated as a read). For a governance engine whose purpose is making new mutating capability opt-in, a future dev who adds a destructive tool but omits its `mutates` classification would ship it enabled-by-default. Deferral rationale: this is the **D3-specified seed semantics** (in-baseline ⇒ enabled; new read ⇒ enabled; only a *classified* write ⇒ disabled) and is explicitly blessed by the dev + QA tests; not a defect against Story 14.3. The risk only materializes when Epics 15–17 add real `mutates`-bearing tools. Suggested resolution: in the epic that first adds a governed write tool (or in 14.4 enforcement wiring), add a registration-time assertion that every non-baseline tool/action key carries a `mutates` classification (fail-fast on an unclassified new key), so "forgot to classify" is caught at startup rather than silently enabling a write.

- **[14.3 / LOW] `mutates` metadata values are compile-time-only — a typo (`"wite"`) flows through unvalidated and is treated as a read (enabled)** (`packages/shared/src/governance.ts` `buildMutatesLookup`; `packages/shared/src/tool-types.ts:89`) — Source: code review (Blind + Edge). Issue: `Record<string, "read" | "write">` is erased at runtime; `buildMutatesLookup` does `lookup.set(..., cls)` with no check that `cls ∈ {"read","write"}`, and `inputSchema` is cast `as any` throughout, so a misspelled class is silently accepted and `defaultSeed`'s `=== "write"` check then enables it. Deferral rationale: not reachable today (no real tool declares `mutates` until Epics 15–17 — the Epic-14 reality check forbids classifying existing tools); purely a forward-looking robustness gap. Suggested resolution: when real `mutates` declarations arrive, validate each value in `buildMutatesLookup` (throw on anything not exactly `"read"`/`"write"`), or add a Zod/`satisfies` guard at tool-registration time.

- **[14.3 / LOW] `buildMutatesLookup` silently loses a `__proto__` action key in a `mutates` record literal** (`packages/shared/src/governance.ts` `buildMutatesLookup`) — Source: code review (Edge Case Hunter). Issue: a `mutates` map literal `{ __proto__: "write" }` sets the object's prototype rather than an own property, so `Object.entries(m)` never yields it and the classification is lost. Deferral rationale: `mutates` is **author-controlled tool metadata** (not external operator input like `IRIS_GOVERNANCE`, which was hardened inline via CR-14.3-1), and no tool would name an action `__proto__`/`constructor`. Far lower stakes than the config-parse path; not reachable until real `mutates` maps exist. Suggested resolution: when real `mutates` maps land, screen action keys against the reserved set in `buildMutatesLookup` (mirror the `RESERVED_KEYS` guard already added to `validateLayer`), or build per-action maps with `Object.create(null)` at the tool-definition site.

- **[14.3 / LOW] Generator + drift test enumeration is not independent, and several malformed-tool shapes are silently downgraded to a bare key** (`scripts/gen-governance-baseline.mjs:60-75`; `packages/shared/src/__tests__/governance.test.ts` `deriveBaselineFromDists`) — Source: code review (Blind + Edge). Issue: the drift test replicates the generator's exact `inputSchema?.shape?.action?.options` derivation, so a tool shape the introspection mishandles is misclassified identically in both (hashes still match, drift test still green). Specific unguarded shapes: a tool missing `name` → key `"undefined"`; missing `inputSchema` → bare key; an `action` that is `z.optional(z.enum(...))` (wrapper `.options` is undefined) → action keys dropped to a bare key; an empty `z.enum([])` → bare key; non-string enum options → `tool:1`. Deferral rationale: **none of these shapes exist in the current surface** — a live probe across all 5 packages confirmed 89 tools, every one with a string `name` + `inputSchema`, every `action` a non-empty bare `ZodEnum` with all-string options, zero anomalies. The non-independence mirrors the established `gen:bootstrap` drift-test pattern (also self-referential). Suggested resolution: when a future tool uses `z.enum(...).optional()` for `action` or any non-bare-enum shape, unwrap the wrapper (`action?._def?.innerType ?? action`) in BOTH the generator and the drift test, and add generator guards that throw (not silently downgrade) on a tool missing `name`/`inputSchema`, an empty action enum, or a non-string option — turning a silent baseline poisoning into a build failure.

- **[14.3 / LOW] Cross-package tool-name collisions are silently merged with no detection** (`scripts/gen-governance-baseline.mjs:35-77`) — Source: code review (Blind + Edge). Issue: governance keys accumulate into one `Set` across all five packages; if two packages ever register the same tool name (or `tool:action`), the second silently dedupes into the first while `toolCount++` double-counts, so the only signal is a `Tools enumerated: N` vs `Baseline keys: M` discrepancy in the console summary. Deferral rationale: **not reachable today** — a live probe confirmed zero duplicate tool names across the five packages. Tool names are globally unique by the suite's naming convention. Suggested resolution: have the generator throw on a duplicate tool name across packages (`if (seen.has(name)) throw …`), making an accidental cross-server collision a hard build error rather than a silent surface merge.

- **[14.3 / LOW] `SERVER_PACKAGES` list is duplicated in three places kept in sync only by comment** (`scripts/gen-governance-baseline.mjs:18-24`; `packages/shared/src/__tests__/governance.test.ts:520-526`; `packages/shared/src/__tests__/governance-edge.test.ts` note) — Source: code review (Blind). Issue: the most correctness-critical list in the feature (which packages form the baseline) is hard-coded in the generator and re-hard-coded in the drift test with a "MUST stay in sync" comment. If a sixth server package is added and only one copy is updated, the drift test would validate a different surface than the generator produced. Deferral rationale: maintainability, not a current correctness bug (the two lists are identical today, verified); the in-test drift guard would surface most divergences as a baseline mismatch. Suggested resolution: export the package list from a single shared module and import it into both the generator and the drift test.

- **[14.3 / LOW] Generator always overwrites with no `--check` mode for CI drift enforcement** (`scripts/gen-governance-baseline.mjs:141-142`) — Source: code review (Blind). Issue: the script unconditionally `writeFileSync`s `governance-baseline.ts`; determinism rests entirely on `Set` insertion + `.sort()`, and drift detection is delegated wholly to the vitest drift test. A developer who runs the generator but not the tests can commit a file without an independent reproducibility gate, and there is no `gen:governance-baseline --check` for a CI pipeline to fail on drift without writing. Deferral rationale: this mirrors the existing `gen:bootstrap` discipline (also test-enforced, no `--check`, no CI workflow file in the repo); regeneration WAS verified byte-identical during this review. Suggested resolution: if/when a CI drift-check job is added for `gen:bootstrap`, give both generators a `--check` flag that re-derives and exits non-zero on any diff (without writing), and run it in CI alongside the build.
