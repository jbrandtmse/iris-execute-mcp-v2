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
