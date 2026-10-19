# Deferred Work Ledger

See _bmad/custom/skill-rules.md Rule 15 (entry grammar) and Rule 17 (the drain).

### DW-1: [L5.0-pastend-flag] pastEnd flag added to PaginateResult
- source: legacy:5.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Removed as dead code; no consumer existed after 7 epics; field removed from PaginateResult, paginate() and tests.
- 2026-10-14T10:47:48Z status=resolved-by:8-0-epic-7-deferred-cleanup owner=5-0-epic-4-deferred-cleanup by=migration note=Removed as dead code; no consumer existed after 7 epics; field removed from PaginateResult, paginate() and tests.

### DW-2: [L5.2-productioncontrol-timeout-zero-override] tTimeout=0 silently overrides caller-supplied zero timeout (Interop.cls:148)
- source: legacy:5.2 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: If tTimeout=0 Set 120 treats an intentional immediate stop as omitted; pre-existing; fix is a %IsDefined presence check.
- 2026-10-14T10:47:48Z status=routed owner=burndown by=migration note=If tTimeout=0 Set 120 treats an intentional immediate stop as omitted; pre-existing
- 2026-10-15T11:47:31Z status=wontfix-accepted by=x0 note=reopen_if=a caller reports iris_production_control stop/restart with timeout:0 waiting 120s, or requests a 0-second graceful stop; Still present Interop.cls:180-181 (If tTimeout=0 Set tTimeout=120) - the Rule #15 sanctioned coercion+default idiom; timeout:0 immediate stop is not a documented use

### DW-3: [L5.2-productionsummary-inner-catch-swallow] ProductionSummary inner catch block swallows errors silently
- source: legacy:5.2 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Added console log for skipped namespaces with error reason in Interop.cls.
- 2026-10-14T10:47:48Z status=resolved-by:8-0-epic-7-deferred-cleanup owner=5-2-production-lifecycle-tools by=migration note=Added console log for skipped namespaces with error reason in Interop.cls.

### DW-4: [L5.2-productionmanage-classdef-existsid] ProductionManage uses %Dictionary.ClassDefinition.%ExistsId
- source: legacy:5.2 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: IRIS API limitation; non-production class with the same name is an unlikely edge case with no practical impact.
- 2026-10-14T10:47:48Z status=wontfix-accepted owner=5-2-production-lifecycle-tools by=migration note=IRIS API limitation; same-name non-production class is unlikely; reopen_if=unknown

### DW-5: [L5.2-productioncontrol-zod-name-optional] productionControlTool Zod schema marks name optional for all actions
- source: legacy:5.2 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Added .refine() validation requiring name for start and restart actions.
- 2026-10-14T10:47:48Z status=resolved-by:8-0-epic-7-deferred-cleanup owner=5-2-production-lifecycle-tools by=migration note=Added .refine() validation requiring name for start and restart actions.

### DW-6: [L5.3-itemmanage-set-ignores-unknown-keys] ItemManage set silently ignores unknown settings keys
- source: legacy:5.3 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Acceptable behavior; unknown keys are ignored per standard IRIS configuration patterns.
- 2026-10-14T10:47:48Z status=by-design owner=5-3-production-item-and-auto-start-tools by=migration note=Acceptable behavior; unknown keys are ignored per standard IRIS configuration patterns.

### DW-7: [L5.3-itemmanage-set-save-consistency] ItemManage set save/update consistency
- source: legacy:5.3 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Pre-existing IRIS pattern limitation with no simple rollback mechanism; no incidents reported.
- 2026-10-14T10:47:49Z status=wontfix-accepted owner=5-3-production-item-and-auto-start-tools by=migration note=no rollback mechanism exists in IRIS; no incidents; reopen_if=a partial-save inconsistency is reported on item set

### DW-8: [L5.5-lookuptransfer-import-additive-merge] LookupTransfer import is additive/merge
- source: legacy:5.5 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Merge semantics are safer than replace; tool description is adequate.
- 2026-10-14T10:47:49Z status=by-design owner=5-5-credential-and-lookup-table-tools by=migration note=Merge semantics are safer than replace; tool description is adequate.

### DW-9: [L5.5-credentialmanage-empty-username-password] CredentialManage empty string username/password handling
- source: legacy:5.5 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Edge case; users can delete and recreate credentials instead of clearing fields.
- 2026-10-14T10:47:49Z status=wontfix-accepted owner=5-5-credential-and-lookup-table-tools by=migration note=Edge case; users can delete and recreate credentials instead of clearing fields; reopen_if=unknown

### DW-10: [L5.7-probecustomrest-duck-typing] probeCustomRest duck-typing instead of instanceof
- source: legacy:5.7 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Cosmetic improvement; works reliably in practice.
- 2026-10-14T10:47:49Z status=wontfix-accepted owner=5-7-iris-interop-mcp-unit-and-integration-tests by=migration note=Cosmetic improvement; works reliably in practice; reopen_if=unknown

### DW-11: [L5.7-no-integration-tests-interoprest-ruleget-transformtest] Retro Follow-Through: test production + integration tests
- source: legacy:5.7 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Requires IRIS test production setup; unit tests provide adequate coverage.
- 2026-10-14T10:47:49Z status=wontfix-accepted owner=5-7-iris-interop-mcp-unit-and-integration-tests by=migration note=Requires IRIS test production setup; reopen_if=an integration test production fixture exists in the repo

### DW-12: [L6.0-no-npm-script-gen-bootstrap] No npm script for gen-bootstrap.mjs
- source: legacy:6.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Added gen:bootstrap script to root package.json.
- 2026-10-14T10:47:49Z status=resolved-by:8-0-epic-7-deferred-cleanup owner=6-0-epic-5-deferred-cleanup by=migration note=Added gen:bootstrap script to root package.json.

### DW-13: [L6.0-gen-bootstrap-missing-cls-handling] No error handling in gen-bootstrap.mjs for missing .cls files
- source: legacy:6.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Node already provides clear error messages for missing files; low value add.
- 2026-10-14T10:47:49Z status=wontfix-accepted owner=6-0-epic-5-deferred-cleanup by=migration note=Node already provides clear error messages for missing files; low value add; reopen_if=unknown

### DW-14: [L6.3-ac1-start-time-field] AC1 start time field (jobs list)
- source: legacy:6.3 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: IRIS %SYS.ProcessQuery does not expose start time; cannot be implemented without IRIS-side changes.
- 2026-10-14T10:47:49Z status=wontfix-accepted owner=6-3-jobs-and-locks-tools by=migration note=IRIS %SYS.ProcessQuery does not expose start time; reopen_if=%SYS.ProcessQuery exposes a process start time property

### DW-15: [L6.3-no-os-unit-test-dual-format-owner-parsing] No ObjectScript unit test for dual-format Owner parsing
- source: legacy:6.3 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Verified by lead during review; TypeScript-side tests cover the parsing.
- 2026-10-14T10:47:49Z status=wontfix-accepted owner=6-3-jobs-and-locks-tools by=migration note=Verified by lead during review; TypeScript-side tests cover the parsing; reopen_if=unknown

### DW-16: [L6.6-ac6-duration-not-computed] AC6 duration not computed (task history)
- source: legacy:6.6 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: lastStart and completed timestamps are available for client-side derivation.
- 2026-10-14T10:47:49Z status=wontfix-accepted owner=6-6-task-scheduling-tools by=migration note=lastStart and completed timestamps are available for client-side derivation; reopen_if=unknown

### DW-17: [L6.6-no-schedule-properties-task-manage-create] No schedule properties in iris.task.manage create action
- source: legacy:6.6 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Complex scheduling subsystem; no planned future enhancement epics.
- 2026-10-14T10:47:49Z status=wontfix-accepted owner=6-6-task-scheduling-tools by=migration note=Complex scheduling subsystem; no planned future enhancement epics; reopen_if=unknown

### DW-18: [L6.7-dynamic-annotations-meta-readonly] Dynamic annotations via _meta.readOnly
- source: legacy:6.7 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Known MCP protocol limitation; static annotations are the correct approach.
- 2026-10-14T10:47:49Z status=by-design owner=6-7-system-configuration-tools by=migration note=Known MCP protocol limitation; static annotations are the correct approach.

### DW-19: [L6.7-getconfig-only-11-hardcoded-properties] GetConfig reads only 11 hardcoded properties
- source: legacy:6.7 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Covers most common configuration needs; full property iteration is a future enhancement.
- 2026-10-14T10:47:49Z status=wontfix-accepted owner=6-7-system-configuration-tools by=migration note=Covers most common configuration needs; reopen_if=a user requests a config property outside the 11 exposed

### DW-20: [L6.7-setconfig-no-property-name-whitelist] No whitelist/validation on SetConfig property names
- source: legacy:6.7 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Config.config.Modify() validates server-side; defense-in-depth only.
- 2026-10-14T10:47:49Z status=wontfix-accepted owner=6-7-system-configuration-tools by=migration note=Config.config.Modify() validates server-side; defense-in-depth only; reopen_if=unknown

### DW-21: [L6.7-exportconfig-config-section-only] ExportConfig only includes config section
- source: legacy:6.7 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Intentional per original design; no incidents or requests for expansion.
- 2026-10-14T10:47:49Z status=by-design owner=6-7-system-configuration-tools by=migration note=Intentional per original design; no incidents or requests for expansion.

### DW-22: [L6.8-duplicate-getconfig-declare-global-blocks] Duplicate getConfig()/declare global blocks in ops integration tests
- source: legacy:6.8 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Extracted shared getIntegrationConfig() helper to @iris-mcp/shared/test-helpers/integration-config.
- 2026-10-14T10:47:49Z status=resolved-by:8-0-epic-7-deferred-cleanup owner=6-8-iris-ops-mcp-unit-and-integration-tests by=migration note=Extracted shared getIntegrationConfig() helper to @iris-mcp/shared/test-helpers/integration-config.

### DW-23: [L6.8-task-creation-unchecked-as-cast] Task creation unchecked as cast (ops integration test)
- source: legacy:6.8 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Low risk; cleanup runs via afterAll regardless.
- 2026-10-14T10:47:49Z status=wontfix-accepted owner=6-8-iris-ops-mcp-unit-and-integration-tests by=migration note=Low risk; cleanup runs via afterAll regardless; reopen_if=unknown

### DW-24: [L7.3-buildcube-synchronous-no-timeout] %BuildCube synchronous with no timeout
- source: legacy:7.3 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Story spec explicitly calls for synchronous operation; timeout/async is a future enhancement.
- 2026-10-14T10:47:49Z status=by-design owner=7-3-analytics-tools by=migration note=Story spec explicitly calls for synchronous operation; timeout/async is a future enhancement.

### DW-25: [L7.4-encodeuricomponent-percent-encoding-slashes] encodeURIComponent() percent-encoding slashes (REST app paths)
- source: legacy:7.4 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Follows spec-prescribed pattern; no reported issues.
- 2026-10-14T10:47:49Z status=by-design owner=7-4-rest-api-management-and-debug-placeholders by=migration note=Follows spec-prescribed pattern; no reported issues.

### DW-26: [L7.5-inserteddocid-regex-numeric-only] insertedDocId regex only matches numeric IDs (test helper)
- source: legacy:7.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Fallback only; structuredContent extraction is primary. Low risk.
- 2026-10-14T10:47:49Z status=wontfix-accepted owner=7-5-iris-data-mcp-unit-and-integration-tests by=migration note=fallback only; structuredContent extraction is primary; reopen_if=unknown

### DW-27: [L7.5-find-with-filter-test-no-count-assert] Find-with-filter test does not assert document count
- source: legacy:7.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Other lifecycle tests verify content correctness; low priority.
- 2026-10-14T10:47:49Z status=wontfix-accepted owner=7-5-iris-data-mcp-unit-and-integration-tests by=migration note=Other lifecycle tests verify content correctness; low priority; reopen_if=unknown

### DW-28: [L8.0-duplicate-getintegrationconfig-helper] Duplicate getIntegrationConfig helper
- source: legacy:8.0 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Both helpers produce the same config from env vars; functionally harmless; could consolidate if integration-helpers.ts is refactored.
- 2026-10-14T10:47:49Z status=routed owner=burndown by=migration note=Both helpers produce the same config from env vars; functionally harmless
- 2026-10-15T11:47:31Z status=wontfix-accepted by=x0 note=reopen_if=AC 42.1.3 changes how integration tests import ./test-helpers, or a shared-package integration test needs an env var only one helper forwards; Both still exist (shared/src/__tests__/integration-helpers.ts:17, test-helpers/integration-config.ts:29); already diverged: only the latter forwards IRIS_ACCEPT_LANGUAGE; test-only

### DW-29: [L8.1-readme-dead-links-per-package] Per-package README links in root README point to files that do not yet exist
- source: legacy:8.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Story 8.2 created the per-package READMEs that the root README links to; dead-link condition no longer exists.
- 2026-10-14T10:47:49Z status=resolved-by:8-2-per-package-readmes-and-tool-references owner=8-1-suite-level-readme-and-architecture-overview by=migration note=Story 8.2 created the per-package READMEs that the root README links to; dead-link condition no longer exists.

### DW-30: [L8.4-dry-env-var-docs-client-config-guides] DRY: env var table and shell export examples duplicated across three client-config docs
- source: legacy:8.4 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Deliberate self-contained-doc design; duplication across the three client-config guides is intentional (ledger).
- 2026-10-14T10:47:49Z status=by-design owner=8-4-mcp-client-configuration-examples by=migration note=Deliberate self-contained-doc design; duplication across the three client-config guides is intentional (ledger).

### DW-31: [L8.6-package-json-missing-license-metadata] Missing license/repository/author/keywords fields in package.json files (publish readiness)
- source: legacy:8.6 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Pre-existing publish-readiness concern across all packages; later routed to the publishing checklist item A2.
- 2026-10-14T10:47:49Z status=wontfix-accepted owner=8-6-meta-package-iris-mcp-all by=migration note=reopen_if=the npm publish decision is taken and a package.json still lacks license/repository/author
- 2026-10-15T02:51:51Z status=routed owner=42-1-pre-publish-package-fixes by=correct-course note=reopened - reopen_if fired: npm publish decided (decision-record-2026-10-14)

### DW-32: [L8.retro-post-project-1-npm-publishing-session] Retro Post-Project Action #1: npm publishing session
- source: legacy:8.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Publishing activity itself; belongs to the publishing checklist and post-project planning, not retained in the ledger.
- 2026-10-14T10:47:49Z status=dropped owner=8-0-epic-7-deferred-cleanup by=migration note=not pipeline work: publishing session

### DW-33: [L8.retro-post-project-2-bootstrap-drift-check-before-publish] Retro Post-Project Action #2: bootstrap drift check before every publish
- source: legacy:8.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Already embedded as an AC in Story 9.2; not retained in the ledger.
- 2026-10-14T10:47:49Z status=dropped owner=8-0-epic-7-deferred-cleanup by=migration note=already covered by Story 9.2 AC

### DW-34: [L8.retro-post-project-3-ipm-publishing-open-exchange] Retro Post-Project Action #3: IPM publishing via Open Exchange
- source: legacy:8.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Publishing activity; belongs to the publishing checklist and post-project planning.
- 2026-10-14T10:47:49Z status=dropped owner=8-0-epic-7-deferred-cleanup by=migration note=not pipeline work: IPM publishing
- 2026-10-15T02:51:51Z status=routed owner=42-4-ipm-package-revival by=correct-course note=reopened by D6 (decision-record-2026-10-14): revive IPM, generated manifest, offline install proof, publish

### DW-35: [L8.retro-followthrough-mcp-test-harness] Retro Follow-Through: MCP test harness
- source: legacy:8.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Post-project work; not retained in the ledger.
- 2026-10-14T10:47:49Z status=dropped owner=8-0-epic-7-deferred-cleanup by=migration note=not pipeline work: post-project MCP test harness

### DW-36: [L10.1-generated-param-ignored-modified-branch] generated query parameter ignored on the /modified/{ts} Atelier branch
- source: legacy:10.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Atelier /modified/ accepts generated but tools do not pass it; pre-existing inconsistency inherited from doc.ts; fix applies to both tools together.
- 2026-10-14T10:47:49Z status=routed owner=burndown by=migration note=Atelier /modified/ accepts generated but tools do not pass it; pre-existing inconsistency inherited from doc.ts
- 2026-10-15T11:47:31Z status=resolved-by:10-6-typescript-docs-cleanup-post-retro-polish by=x0 note=Commit 1b7b874: doc.ts:411 and packages.ts:203-205 now send generated on the /modified branch. Separate, unverified: export.ts:398-403 modified branch still omits it

### DW-37: [L10.1-digit-prefixed-package-rows] Digit-prefixed package rows (e.g. a '2' row with 13 docs on USER)
- source: legacy:10.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Rollup is technically correct (dotted names); documented in rollupPackage; ledger decision: leave as observed behavior, not worth synthetic bucketing.
- 2026-10-14T10:47:49Z status=by-design owner=10-1-iris-package-list by=migration note=Rollup is technically correct (dotted names); documented in rollupPackage

### DW-38: [L10.2-manifest-json-tmp-cleanup-rename-failure] .manifest.json.tmp cleanup on rename failure (export.ts)
- source: legacy:10.2 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Temp file left behind if fsp.rename fails (e.g. AV on Windows); next successful run overwrites; finally/unlink would fix.
- 2026-10-14T10:47:49Z status=routed owner=burndown by=migration note=Temp file left behind if fsp.rename fails (e.g. AV on Windows); next successful run overwrites
- 2026-10-15T11:47:31Z status=wontfix-accepted by=x0 note=reopen_if=a stray .manifest.json.tmp is found in an iris_doc_export destinationDir after a failed export; Still present export.ts:828-829 (writeFile tmp then rename, no unlink on failure); the next successful export overwrites the tmp

### DW-39: [L10.2-docnametofilepath-edge-cases] Weird doc-name edge cases in docNameToFilePath (.cls only, Foo..cls, .LeadingDot.cls)
- source: legacy:10.2 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Produce unusual paths that path.resolve normalizes; Atelier not observed to emit such names.
- 2026-10-14T10:47:49Z status=routed owner=burndown by=migration note=Produce unusual paths that path.resolve normalizes; Atelier not observed to emit such names.
- 2026-10-15T11:47:31Z status=wontfix-theoretical by=x0 note=load.ts:236-272 unchanged but Atelier never emits such names and export.ts:189/526 containment still blocks escape; real only if Atelier returned names like Foo..cls or .cls

### DW-40: [L11.3-resultset-close-exception-path-databaselist] %ResultSet.Close() not called on exception path in DatabaseList() loop (Config.cls)
- source: legacy:11.3 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Leak is theoretical (refcount-driven cleanup); same pattern throughout file; outer-level close in catch would fix.
- 2026-10-14T10:47:49Z status=routed owner=burndown by=migration note=Leak is theoretical (refcount-driven cleanup); same pattern throughout file; outer-level close in catch would fix.
- 2026-10-15T11:47:31Z status=wontfix-theoretical by=x0 note=%Library.ResultSet %OnClose = 'If i%IsOpened Quit ..Close()' (live %SYS doc_search); method-local tRS (ProcedureBlock) closes on exit/catch; real only if tRS escaped to a %/public var

### DW-41: [L11.3-resultset-close-exception-path-getconfig-locale] %ResultSet.Close() not called on exception path in SystemConfig.GetConfig locale
- source: legacy:11.3 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Same pattern as DatabaseList; tRS left open if exception fires inside the loop.
- 2026-10-14T10:47:49Z status=routed owner=burndown by=migration note=Same pattern as DatabaseList; tRS left open if exception fires inside the loop.
- 2026-10-15T11:47:31Z status=wontfix-theoretical by=x0 note=Same as DW-40 (SystemConfig.cls GetConfig): %ResultSet %OnClose closes the cursor when the method-local tRS is released; real only if tRS outlived the method

### DW-42: [L11.1-sanitizeerror-prefix-strip-unit-test] Missing ObjectScript unit test for SanitizeError prefix-strip (Bug #11)
- source: legacy:11.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Two new test methods added (StripsLeadingErrorPrefix, StripsArabicPrefix) verifying SanitizeError idempotence; 19/19 tests pass.
- 2026-10-14T10:47:49Z status=resolved-by:12-0-epic-11-deferred-cleanup owner=11-1-objectscript-error-envelope-and-sanitization by=migration note=Two new test methods added (StripsLeadingErrorPrefix, StripsArabicPrefix) verifying SanitizeError idempotence

### DW-43: [L11.1-prefix-strip-en-ar-only] Epic 11 retro action #6: generalize locale prefix-strip for non-English/Arabic (FR, DE, etc.)
- source: legacy:11.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Utils.SanitizeError list covers only two prefixes; FR/DE locales would double-wrap; generalize via DecomposeStatus or prefix list.
- 2026-10-14T10:47:49Z status=wontfix-accepted owner=11-1-objectscript-error-envelope-and-sanitization by=migration note=reopen_if=an IRIS locale other than English/Arabic yields a doubled ERROR # prefix in a tool error

### DW-44: [L11.1-use-tinitio-mnemonic-not-cleared] Use tInitIO without mnemonic clause leaves mnemonic routine bound after restore (Command.cls)
- source: legacy:11.1 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: No observable bug today (redirect flag disabled); live verification AC 11.1.4 confirms current restore sufficient.
- 2026-10-14T10:47:49Z status=routed owner=burndown by=migration note=No observable bug today (redirect flag disabled); live verification AC 11.1.4 confirms current restore sufficient.
- 2026-10-15T11:47:31Z status=resolved-by:34-2-handler-capture-byref-markers-20-arg-ladder by=x0 note=Mnemonic now bound on a separate null device (Command.cls:101-118), never on tInitIO; TeardownRedirect closes it (:45-54). Fixed by c2b5bec (2026-04-23 >8KB fix), hardened 959ca72 (34.2)

### DW-45: [L11.retro-build-publishing-checklist] Retro action item: build publishing checklist (npm account, package.json fields)
- source: legacy:11.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Already captured in publishing-checklist-npm-ipm.md and a memory note; no Story 12.0 action needed.
- 2026-10-14T10:47:49Z status=dropped owner=burndown by=migration note=already captured in publishing checklist

### DW-46: [L11.retro-grep-stale-protocols-refs] Retro action item: grep for stale protocols: references in mocks/tests
- source: legacy:11.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Completed during Epic 11 Story 11.4 code review; one instance found and fixed then.
- 2026-10-14T10:47:49Z status=resolved-by:11-4-typescript-tool-fixes owner=burndown by=migration note=Completed during Epic 11 Story 11.4 code review; one instance found and fixed then.

### DW-47: [L11.retro-1-prepublish-smoke-test] Epic 11 retro action #1: run pre-publish smoke test (Story 9.3 rerun)
- source: legacy:11.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Deferred to the pre-publish session; routed to publishing checklist.
- 2026-10-14T10:47:49Z status=decision-pending owner=burndown by=migration note=human=run the pre-publish smoke test (Story 9.3 rerun) in the pre-publish session
- 2026-10-15T02:51:51Z status=routed owner=42-6-tarball-smoke-and-1-0-0-publish by=correct-course note=decided D2 (decision-record-2026-10-14): local tarball smoke required before 1.0.0

### DW-48: [L11.retro-3-retrospective-skill-rules-enforcement] Epic 11 retro action #3: update /bmad-retrospective skill to enforce Rules codification
- source: legacy:11.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Rule #1 is self-enforcing without a formal skill update; low urgency.
- 2026-10-14T10:47:49Z status=wontfix-accepted owner=burndown by=migration note=Rule #1 is self-enforcing; low urgency; reopen_if=a retrospective closes without the Rules-codification step

### DW-49: [L12.1-no-test-changepasswordonnextlogin-false] No test for changePasswordOnNextLogin: false -> 0 path (user.test.ts)
- source: legacy:12.1 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Symmetric counterpart of the tested true->1 path; handler logic trivial and correct; one test case would close the branch.
- 2026-10-14T10:47:49Z status=routed owner=burndown by=migration note=Symmetric counterpart of the tested true->1 path; handler logic trivial and correct
- 2026-10-15T11:47:31Z status=wontfix-theoretical by=x0 note=user.ts:118-119 ternary (x ? 1 : 0) is mechanically symmetric to the pinned true->1 test (user.test.ts:794-816); real only if the ternary were rewritten

### DW-50: [L12.2-changelog-ordering-bug3-above-bug1] CHANGELOG ordering: BUG-3 entry above Story 12.1's BUG-1 in Fixed block
- source: legacy:12.2 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: AC 12.2.6 said append below 12.1 entries; BUG-3 was prepended; cosmetic, same block, no functional impact.
- 2026-10-14T10:47:49Z status=routed owner=burndown by=migration note=AC 12.2.6 said append below 12.1 entries; BUG-3 was prepended; cosmetic, same block, no functional impact.
- 2026-10-15T11:47:31Z status=wontfix-theoretical by=x0 note=Still CHANGELOG.md:1167-1168 (BUG-3 above BUG-1 in the same Fixed block); cosmetic; AC 42.1.4 consolidates into one 1.0.0 section; real only if order carried meaning

### DW-51: [L12.2-test-count-delta-plus2-vs-plus3-4] Test count delta +2 vs AC-stated +3-4 (production.test.ts)
- source: legacy:12.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Coverage complete (the other two specified cases were already covered by pre-existing tests); discrepancy is in stated count only.
- 2026-10-14T10:47:49Z status=dropped owner=12-2-production-control-dynamicobject-audit by=migration note=invalid: coverage complete; the discrepancy is in the stated test count only

### DW-52: [L12.3-productionsummary-stopped-fallback-never-started] ProductionSummary fallback hardcodes stateCode 2 / Stopped for never-started
- source: legacy:12.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Stopped is the closest valid sentinel and matches live-verified behavior; ledger: acceptable as-is.
- 2026-10-14T10:47:49Z status=by-design owner=12-3-production-create by=migration note=Stopped is the closest valid sentinel and matches live-verified behavior; ledger: acceptable as-is.

### DW-53: [L12.3-duplicate-create-unit-test] New create unit test partially duplicates pre-existing test (production.test.ts:123)
- source: legacy:12.3 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Two tests cover the same create path; only the namespace value differs.
- 2026-10-14T10:47:49Z status=routed owner=burndown by=migration note=Two tests cover the same create path; only the namespace value differs.
- 2026-10-15T11:47:31Z status=wontfix-theoretical by=x0 note=production.test.ts:23 and :123 overlap but both assert the same create path; redundancy cannot mask a regression; real only if one were edited to diverge silently

### DW-54: [L12.3-delete-running-check-states-4-5] Production delete running-check guards only state=1, not Troubled (4) or NetworkStopped (5)
- source: legacy:12.3 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Both are active states that may hold locks or jobs; pre-existing; extend guard to states 1, 4, 5.
- 2026-10-14T10:47:49Z status=routed owner=burndown by=migration note=Both are active states that may hold locks or jobs; pre-existing; extend guard to states 1, 4, 5.
- 2026-10-15T11:47:31Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=fix in 38.0 [PRODDEL]: Interop.cls:106 delete guard tState=1 -> any non-Stopped state (1,3,4,5); pin via a small state-predicate test
- 2026-10-15T14:29:56Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-11: predicate + message pinned; the handler wiring residual is DW-531 (escalated); commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-55: [L12.3-orphaned-ens-config-production-record] Orphaned Ens.Config.Production record without class definition not handled on delete
- source: legacy:12.3 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Requires external class deletion; delete reports does-not-exist without cleaning the orphan; add a secondary %ExistsId check.
- 2026-10-14T10:47:49Z status=routed owner=burndown by=migration note=Requires external class deletion; delete reports does-not-exist without cleaning the orphan
- 2026-10-15T11:47:31Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=fix in 38.0 [PRODDEL]: On delete with the class absent but Ens.Config.Production %ExistsId(name), remove the orphan extent row instead of returning does-not-exist
- 2026-10-15T14:29:56Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-11: fixed; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-56: [L12.4-docdb-find-typed-property-population] iris_docdb_find typed-property queries return empty because values are not auto-extracted
- source: legacy:12.4 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Filter translation fixed but typed columns stay 0/NULL after insert (SQL probe on ISC_DM.TESTMCPDocs4); index action also errors; needs investigation.
- 2026-10-14T10:47:49Z status=routed owner=burndown by=migration note=Filter translation fixed but typed columns stay 0/NULL after insert (SQL probe on ISC_DM.TESTMCPDocs4)
- 2026-10-15T11:47:31Z status=wontfix-accepted by=x0 note=reopen_if=a throwaway IRIS with %Service_DocDB enabled exists (Story 42.3 scripts/ci-throwaway.sh) or a user reports an empty typed-property iris_docdb_find; cut from 38.0 by orchestrator; docdb.ts:688 sends only ?type=; %Api.DocDB.v1 httpPostProperty reads type/path/unique from %request.Data (path default ''); index POSTs an ignored {index:true} body

### DW-57: [L12.4-builddocdbrestriction-jsdoc-warn] buildDocDbRestriction JSDoc says skipped with a console warning but no console.warn exists
- source: legacy:12.4 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Behavior correct; only JSDoc inaccurate; add console.warn or reword JSDoc.
- 2026-10-14T10:47:49Z status=routed owner=burndown by=migration note=Behavior correct; only JSDoc inaccurate; add console.warn or reword JSDoc.
- 2026-10-15T11:47:31Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=fix in 38.0 [DOCFIX]: Reword docdb.ts:83 JSDoc to 'silently skipped' (matches docdb.ts:105)
- 2026-10-15T14:29:56Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-14: fixed; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-58: [L12.4-config-create-no-rollback] Config.cls database create: no rollback if Config.Databases.Create() fails after
- source: legacy:12.4 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Physical IRIS.DAT left without CPF registration; unlikely with a fresh directory; fix would DeleteDatabase in the cleanup path.
- 2026-10-14T10:47:49Z status=wontfix-accepted owner=12-4-database-modify-docdb-and-bootstrap-bump by=migration note=reopen_if=database create fails after CreateDatabase and leaves an orphan IRIS.DAT

### DW-59: [L12.5-oauth-supportedscopes-schema-description] iris_oauth_manage supportedScopes schema accepts only string and does not mention
- source: legacy:12.5 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Schema design intentional per AC 12.5.1; description could say split by whitespace or comma.
- 2026-10-14T10:47:49Z status=routed owner=burndown by=migration note=Schema design intentional per AC 12.5.1; description could say split by whitespace or comma.
- 2026-10-15T11:47:31Z status=wontfix-theoretical by=x0 note=oauth.ts:197-199 splits on /[s,]+/ so the described space form and an undescribed comma form both work; real only if a documented form failed

### DW-60: [L12.5-rest-manage-scope-all-dedup-empty-name] iris_rest_manage scope:all dedup collapses apps with identical/empty name (rest.ts:172)
- source: legacy:12.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: IRIS REST applications always have unique non-empty path names by construction.
- 2026-10-14T10:47:49Z status=dropped owner=12-5-typescript-tool-surface-cleanup by=migration note=invalid: IRIS REST applications always have unique non-empty path names by construction.

### DW-61: [L12.6-alerts-per-alert-clear-by-index] Per-alert clear by index for iris_alerts_manage (deferred to Epic 13 if demand)
- source: legacy:12.6 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: IRIS exposes no API to remove individual alerts.log lines (append-only file); only Clear() and ClearAlerts() exist; direct file I/O is risky.
- 2026-10-14T10:47:49Z status=decision-pending owner=burndown by=migration note=call: IRIS exposes no API to remove individual alerts.log lines (append-only file)
- 2026-10-15T11:47:31Z status=wontfix-accepted by=x0 note=decided=orchestrator(Lead-away) reopen_if=a user requests per-alert clear, or an IRIS release adds a per-alert delete API (check the alert classes on upgrade); IRIS has no per-alert removal API (alerts.log append-only; only Clear/ClearAlerts); rewriting the file is risky. Alt: app-level tracking table + REST handler

### DW-62: [L12.6-alerts-acknowledge] Alert acknowledge action for iris_alerts_manage (deferred to Epic 13 if demand)
- source: legacy:12.6 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Not supported natively for system alerts; would need a custom ExecuteMCPv2 tracking table and REST handler.
- 2026-10-14T10:47:49Z status=decision-pending owner=burndown by=migration note=call: build an app-level alert-ack tracking table plus REST handler, or leave unsupported
- 2026-10-15T11:47:31Z status=wontfix-accepted by=x0 note=decided=orchestrator(Lead-away) reopen_if=a user requests alert acknowledge, or IRIS adds a native alert-ack API; system alerts have no native acknowledge; building one means a custom ExecuteMCPv2 table + handler for no requested use. Alt: build the ack table now

### DW-63: [L13.2-ops-tool-count-drift-16-vs-17] Pre-existing @iris-mcp/ops tool-count drift: heading and Mix line say 17
- source: legacy:13.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Story 14.6 reconciled ops to 17 and suite total to 89 across tool_support.md, README.md, iris-mcp-all README and migration guide; independently recounted.
- 2026-10-14T10:47:49Z status=resolved-by:14-6-documentation-rollup owner=13-2-documentation-rollup by=migration note=Story 14.6 reconciled ops to 17 and suite total to 89 across tool_support.md, README.md

### DW-64: [L14.1-getorcreateclient-concurrency-race] Concurrency race in getOrCreateClient first-touch establishment (no in-flight promise cache)
- source: legacy:14.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Story 14.2 added the per-profile in-flight establishment promise cache (CR 14.2 describes this.establishing); mixed-caller residue is tracked as L14.2-inflight-establishment-needsbootstrap-variance.
- 2026-10-14T10:47:49Z status=resolved-by:14-2-server-parameter-across-all-tools owner=14-1-multi-server-profiles-config-and-resolution by=migration note=Story 14.2 added the per-profile in-flight establishment promise cache (CR 14.2 describes this.establishing)

### DW-65: [L14.1-healthcheck-failure-caches-client-no-meta] Non-default first-touch health-check failure caches the client but records no meta
- source: legacy:14.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: establishProfile drops the client on failure and retries on every touch (AC 14.2.8; cf. 37-1-CR-3); inferred from later ledger text.
- 2026-10-14T10:47:49Z status=resolved-by:14-2-server-parameter-across-all-tools owner=14-1-multi-server-profiles-config-and-resolution by=migration note=establishProfile drops the client on failure and retries on every touch (AC 14.2.8; cf. 37-1-CR-3)

### DW-66: [L14.1-port-timeout-number-coercion] port and timeout accept coerced strings/booleans/arrays via Number() (asymmetric with strict https)
- source: legacy:14.1 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: timeout:true yields a 1ms timeout with no validation error; hardening only, IRIS_PROFILES is operator-authored JSON.
- 2026-10-14T10:47:49Z status=routed owner=burndown by=migration note=timeout:true yields a 1ms timeout with no validation error; hardening only, IRIS_PROFILES is operator-authored JSON.
- 2026-10-15T11:47:31Z status=wontfix-accepted by=x0 note=reopen_if=an operator reports a non-numeric IRIS_PROFILES port/timeout accepted silently (e.g. timeout:true yielding 1ms timeouts); Still present profiles.ts:271-273,333-336 (Number() of non-numbers); IRIS_PROFILES is operator-authored and a bogus value fails loudly on first call

### DW-67: [L14.1-whitespace-profile-name-typo-keys-ignored] Whitespace-only profile name registered without error
- source: legacy:14.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Typo'd field (hostname for host) silently inherits the default; operational footgun, opt-in operator config; fix: trim-and-reject, reject unknown keys.
- 2026-10-14T10:47:49Z status=wontfix-accepted owner=14-1-multi-server-profiles-config-and-resolution by=migration note=a typo'd profile key silently falls back; reopen_if=an operator reports a typo'd IRIS_PROFILES key silently ignored

### DW-68: [L14.1-no-destroyall-shutdown-drain] No destroyAll()/shutdown drain on McpServerBase; default-vs-override profile construction divergence
- source: legacy:14.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Pre-existing lifecycle gap: live IrisHttpClient instances never drained on teardown; mergeProfile enumerates fields so a future optional field would drop.
- 2026-10-14T10:47:49Z status=wontfix-accepted owner=14-1-multi-server-profiles-config-and-resolution by=migration note=no stop()/drain of live profile clients; reopen_if=profile clients leak across restarts in a long-lived host process

### DW-69: [L14.2-inflight-establishment-needsbootstrap-variance] Coalesced in-flight establishment Promise ignores needsBootstrap variance
- source: legacy:14.2 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: establishing cache keyed by profile name only; a caller needing bootstrap may coalesce onto one that skips it; sole production caller passes a constant.
- 2026-10-14T10:47:49Z status=routed owner=burndown by=migration note=establishing cache keyed by profile name only; a caller needing bootstrap may coalesce onto one that skips
- 2026-10-15T11:47:31Z status=wontfix-theoretical by=x0 note=Every getOrCreateClient caller passes the per-server constant options.needsCustomRest (server-base.ts:1528-1531,1564-1567); real only if a caller passed a differing per-call value

### DW-70: [L14.2-untrimmed-miscased-server-value] Untrimmed / mis-cased server value yields a confusing (but safe) unknown profile error
- source: legacy:14.2 | severity: med | fix-risk: low | footprint: out-of-footprint
- evidence: resolveProfile does an exact registry.get with no trim/normalize; surfaces as a structured isError, not a crash; tested semantics.
- 2026-10-14T10:47:49Z status=routed owner=burndown by=migration note=resolveProfile does an exact registry.get with no trim/normalize; surfaces as a structured isError, not a crash
- 2026-10-15T11:47:31Z status=wontfix-theoretical by=x0 note=resolveProfile throws ProfileResolutionError listing every valid name (profiles.ts:637-641) -> structured isError the agent self-corrects from; real if names differed only by case

### DW-71: [L14.2-addtools-readd-throws-partial-state] addTools() re-adding an already-registered name throws uncaught after extendedSchemas + tools
- source: legacy:14.2 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Pre-existing duplicate-registration behavior; 14.2 adds one more map so partial-state-on-throw is marginally larger.
- 2026-10-14T10:47:49Z status=routed owner=burndown by=migration note=Pre-existing duplicate-registration behavior; 14.2 adds one more map so partial-state-on-throw is marginally larger.
- 2026-10-15T11:47:31Z status=wontfix-theoretical by=x0 note=addTools has zero production callers (server-base.ts:1811-1814 banner; grep finds tests only); real only if a package starts adding tools dynamically

### DW-72: [L14.2-secondary-coalescing-branch-no-test] Secondary coalescing branch (established client + first concurrent bootstrap) lacks a dedicated
- source: legacy:14.2 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Code correct by trace; AC 14.2.7 test covers first-touch only; optional coverage nicety, not a defect.
- 2026-10-14T10:47:50Z status=routed owner=burndown by=migration note=Code correct by trace; AC 14.2.7 test covers first-touch only; optional coverage nicety, not a defect.
- 2026-10-15T11:47:31Z status=wontfix-accepted by=x0 note=reopen_if=getOrCreateClient's coalescing block (server-base.ts:2263-2287) is modified (e.g. an establishment deadline for DW-516 or Story 43.1); Coverage nicety; branch correct by trace (server-base.ts:2263-2287)

### DW-73: [L14.3-defaultseed-fails-open-unclassified-key] defaultSeed fails OPEN for an unclassified non-baseline key
- source: legacy:14.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Registration-time assertGovernanceClassification throws naming the key when a non-baseline tool/action lacks a mutates classification.
- 2026-10-14T10:47:50Z status=resolved-by:15-0-epic-14-deferred-cleanup owner=14-3-governance-policy-model-and-cascade by=migration note=Registration-time assertGovernanceClassification throws naming the key when a non-baseline tool/action lacks

### DW-74: [L14.3-mutates-typo-unvalidated] mutates metadata values are compile-time-only; a typo (wite) is treated as a read (enabled)
- source: legacy:14.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: buildMutatesLookup now throws via assertMutationClass on any value not exactly read/write.
- 2026-10-14T10:47:50Z status=resolved-by:15-0-epic-14-deferred-cleanup owner=14-3-governance-policy-model-and-cascade by=migration note=buildMutatesLookup now throws via assertMutationClass on any value not exactly read/write.

### DW-75: [L14.3-buildmutateslookup-proto-key-lost] buildMutatesLookup silently loses a __proto__ action key in a mutates record literal
- source: legacy:14.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: buildMutatesLookup screens record-form action keys against the reserved set and throws on a reserved key.
- 2026-10-14T10:47:50Z status=resolved-by:15-0-epic-14-deferred-cleanup owner=14-3-governance-policy-model-and-cascade by=migration note=buildMutatesLookup screens record-form action keys against the reserved set and throws on a reserved key.

### DW-76: [L14.3-generator-drift-test-malformed-shapes] Generator + drift test enumeration is not independent
- source: legacy:14.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Wrapped-enum case fixed by lock-step unwrap; other malformed shapes now throw in the generator.
- 2026-10-14T10:47:50Z status=resolved-by:15-0-epic-14-deferred-cleanup owner=14-3-governance-policy-model-and-cascade by=migration note=Wrapped-enum case fixed by lock-step unwrap; other malformed shapes now throw in the generator.

### DW-77: [L14.3-cross-package-tool-name-collisions-merged] Cross-package tool-name collisions silently merged with no detection (baseline generator)
- source: legacy:14.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Generator tracks a seen map across all five packages and throws on a duplicate tool or tool:action key.
- 2026-10-14T10:47:50Z status=resolved-by:15-0-epic-14-deferred-cleanup owner=14-3-governance-policy-model-and-cascade by=migration note=Generator tracks a seen map across all five packages and throws on a duplicate tool or tool:action key.

### DW-78: [L14.3-server-packages-list-duplicated] SERVER_PACKAGES list duplicated across generator + drift test (sync-by-comment)
- source: legacy:14.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Story 22.1 extracted SERVER_PACKAGES into governance-baseline-derivation.ts shared by the generator and the drift guard (CR 16.0-1).
- 2026-10-14T10:47:50Z status=resolved-by:22-1-deferred-work-burn-down owner=14-3-governance-policy-model-and-cascade by=migration note=Story 22.1 extracted SERVER_PACKAGES into governance-baseline-derivation.ts shared by the generator and the drift

### DW-79: [L14.3-governance-generator-no-check-mode] Governance baseline generator always overwrites; no --check mode for CI drift enforcement
- source: legacy:14.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Story 16.0 added the --check (no-write drift) and gated --force modes to gen-governance-baseline.mjs.
- 2026-10-14T10:47:50Z status=resolved-by:16-0-epic-15-deferred-cleanup owner=14-3-governance-policy-model-and-cascade by=migration note=Story 16.0 added the --check (no-write drift) and gated --force modes to gen-governance-baseline.mjs.

### DW-80: [L14.4-computegovernancekey-optional-enum-downgrade] computeGovernanceKey degrades per-action governance to whole-tool
- source: legacy:14.4 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Shared unwrapActionOptions helper peels ZodOptional/Default/Nullable, applied identically in computeGovernanceKey, rebuildGovernedKeys and the generator.
- 2026-10-14T10:47:50Z status=resolved-by:15-0-epic-14-deferred-cleanup owner=14-4-call-time-governance-enforcement by=migration note=Shared unwrapActionOptions helper peels ZodOptional/Default/Nullable, applied identically in computeGovernanceKey

### DW-81: [L14.5-urlencoded-profile-name-not-decoded-resource-template] URL-encoded profile name not decoded in the iris-governance://{profile}
- source: legacy:14.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: SDK match does not percent-decode (a%20b stays a%20b); a profile name with special chars cannot be addressed; realistic names are identity-encoded.
- 2026-10-14T10:47:50Z status=wontfix-accepted owner=14-5-governance-resource-and-capability by=migration note=reopen_if=a profile name needing percent-encoding is read via iris-governance://{profile}

### DW-82: [L14.6-migration-guide-dotted-tool-names] docs/migration-v1-v2.md documents v2 tool naming as dot-namespaced (iris.execute.command)
- source: legacy:14.6 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Corrected Tool naming row and converted every remaining dotted v2 name in the file; zero dotted references remain.
- 2026-10-14T10:47:50Z status=resolved-by:15-0-epic-14-deferred-cleanup owner=14-6-documentation-rollup by=migration note=Corrected Tool naming row and converted every remaining dotted v2 name in the file; zero dotted references remain.

### DW-83: [L14.6-architecture-md-stale-tool-counts] architecture.md retains stale ops/suite tool counts ((16 tools) and 86 tools)
- source: legacy:14.6 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Routed to Story 15.6, which reconciled architecture.md counts under AC 15.6.5 (CR 15.6-2 fixed :319 inline); inferred from the CR 15.6 text.
- 2026-10-14T10:47:50Z status=resolved-by:15-6-bootstrap-bump-verification-and-docs owner=14-6-documentation-rollup by=migration note=Routed to Story 15.6, which reconciled architecture.md counts under AC 15.6.5 (CR 15.6-2 fixed :319 inline)

### DW-84: [L14.retro-ai3-verify-write-seed-disables-first-write-tool] Epic 14 retro AI#3: verify the mutates:write seed actually disables the first
- source: legacy:14.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Add a governance AC to Story 15.1 (iris_service_manage) exercising a real write action denied-by-default and re-enabled via IRIS_GOVERNANCE.
- 2026-10-14T10:47:50Z status=routed owner=burndown by=migration note=Add a governance AC to Story 15.1 (iris_service_manage) exercising a real write action denied-by-default
- 2026-10-15T11:47:32Z status=resolved-by:15-1-iris_service_manage-iris-service-configuration by=x0 note=iris-admin-mcp/src/__tests__/service-governance.test.ts:1-19,161 proves via the real handleToolCall gate that iris_service_manage:enable is denied by default (commit 5d59d83)

### DW-85: [L14.retro-ai4-regenerate-baseline-per-new-tool] Epic 14 retro AI#4: regenerate governance-baseline.ts whenever Epic 15 adds a tool
- source: legacy:14.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Regenerate after each tool lands; drift test in governance.test.ts enforces.
- 2026-10-14T10:47:50Z status=dropped owner=14-0-epic-13-deferred-cleanup by=migration note=superseded: the baseline is frozen (Rule #23); regenerating it is prohibited

### DW-86: [CR-15.0-2] Gate unwrapActionOptions does not type-validate option elements (gate String() vs generator throws)
- source: legacy:15.0 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Reachable only via a non-Zod field with numeric .options; generator hard-stops such a tool at build time before any baseline ships.
- 2026-10-14T10:47:50Z status=routed owner=burndown by=migration note=Reachable only via a non-Zod field with numeric .options; generator hard-stops such a tool at build time before any
- 2026-10-15T11:47:32Z status=wontfix-theoretical by=x0 note=Only a non-Zod field with numeric .options reaches it and gen-governance-baseline hard-stops such a tool at build; real only if a non-Zod action schema shipped

### DW-87: [CR-15.0-3] unwrapActionOptions peels only unwrap()/innerType; ZodEffects/ZodPipeline fall back to the bare key
- source: legacy:15.0 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Outside the declared wrapper set; .refine() forbidden on MCP schemas by project rule; gate and generator fail identically.
- 2026-10-14T10:47:50Z status=routed owner=burndown by=migration note=Outside the declared wrapper set; .refine() forbidden on MCP schemas by project rule
- 2026-10-15T11:47:32Z status=wontfix-theoretical by=x0 note=Zod 4 .refine() keeps the schema class (no ZodEffects); only .transform/.pipe would fall back and gate+generator fail identically; real if an action enum used .transform()

### DW-88: [CR-15.0-4] unwrapActionOptions calls field.unwrap() unguarded; a throwing accessor would propagate out of the constructor
- source: legacy:15.0 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Not reachable for real Zod types.
- 2026-10-14T10:47:50Z status=routed owner=burndown by=migration note=Not reachable for real Zod types.
- 2026-10-15T11:47:32Z status=wontfix-theoretical by=x0 note=governance.ts:146-167: real Zod wrappers' .unwrap() never throws; reachable only by a hand-built schema object with a throwing accessor

### DW-89: [CR-15.0-5] Drift test governance.test.ts:540 derives keys without the shared unwrapActionOptions (lock-step gap)
- source: legacy:15.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: CR 16.0-1 resolution: generator and drift guard now import the same derivation, which reuses unwrapActionOptions.
- 2026-10-14T10:47:50Z status=resolved-by:22-1-deferred-work-burn-down owner=15-0-epic-14-deferred-cleanup by=migration note=CR 16.0-1 resolution: generator and drift guard now import the same derivation, which reuses unwrapActionOptions.

### DW-90: [CR-15.0-6] buildMutatesLookup silently accepts a mutates map key that is not an enum member (stale/typo'd action key)
- source: legacy:15.0 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Missing REAL action is still caught by the registration assertion; only a dead entry goes unflagged; cosmetic.
- 2026-10-14T10:47:50Z status=routed owner=burndown by=migration note=Missing REAL action is still caught by the registration assertion; only a dead entry goes unflagged; cosmetic.
- 2026-10-15T11:47:32Z status=wontfix-theoretical by=x0 note=Key universe derives from the action enum (server-base.ts:728-747) so a stale mutates key is inert; a missing real key still throws; real only if lookup keys fed the universe

### DW-91: [CR-15.1-1] ServiceList list-path does not tRS.Close() on in-loop exception path (codebase-wide result-set-Close-in-catch pattern)
- source: legacy:15.1 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Pre-existing pattern shared by every Security.cls list method and the REST handler tree; leaks the handle for that request only.
- 2026-10-14T10:47:50Z status=routed owner=burndown by=migration note=Pre-existing pattern shared by every Security.cls list method and the REST handler tree
- 2026-10-15T11:47:32Z status=wontfix-theoretical by=x0 note=Same as DW-40 (Security.cls ServiceList): %ResultSet %OnClose closes the cursor when the method-local tRS is released; real only if tRS outlived the method

### DW-92: [CR-15.1-2] ClientSystems get->set round-trip format unverified against live IRIS (semicolon vs ListBuild)
- source: legacy:15.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Security.Services.ClientSystems is a list Of %String; if Modify expects a different delimiter than Get emits a round-trip could corrupt the allowed-IP list; tests mock REST.
- 2026-10-14T10:47:50Z status=wontfix-accepted owner=15-1-iris-service-manage by=migration note=reopen_if=a ClientSystems get->set round-trip alters the allowed-IP list on live IRIS

### DW-93: [CR-15.2-1] BuildLdapValidity flags blank LDAPHostNames as invalid but it is not a Required property (Windows default-domain case)
- source: legacy:15.2 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: A host-blank Windows AD config reports valid:false from the heuristic test action; test is explicitly non-authoritative and never blocks a real bind.
- 2026-10-14T10:47:50Z status=routed owner=burndown by=migration note=A host-blank Windows AD config reports valid:false from the heuristic test action
- 2026-10-15T11:47:32Z status=wontfix-accepted by=x0 note=reopen_if=a Windows-hosted IRIS user reports valid:false from iris_ldap_manage test for a working blank-LDAPHostNames AD configuration; Still present Security.cls:2325-2326; the test action is explicitly non-authoritative (note field :2346) and never blocks a bind

### DW-94: [CR-15.2-2] LdapList does not tRS.Close() on in-loop exception path
- source: legacy:15.2 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Same pre-existing pattern as CR 15.1-1 and every Security.cls list method; Security.cls:LdapList.
- 2026-10-14T10:47:50Z status=routed owner=burndown by=migration note=Same pre-existing pattern as CR 15.1-1 and every Security.cls list method; Security.cls:LdapList.
- 2026-10-15T11:47:32Z status=wontfix-theoretical by=x0 note=Same as DW-40 (Security.cls LdapList): %ResultSet %OnClose closes the cursor when the method-local tRS is released; real only if tRS outlived the method

### DW-95: [CR-15.2-3] LDAP test config-validity needs a separate GET round-trip; no combined redacted-config + validity call
- source: legacy:15.2 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Cosmetic/ergonomic only; each call correct and cheap; defer to a future LDAP-tool refinement if a combined shape is requested.
- 2026-10-14T10:47:50Z status=routed owner=burndown by=migration note=Cosmetic/ergonomic only; each call correct and cheap; defer to a future LDAP-tool refinement if a combined shape
- 2026-10-15T11:47:32Z status=wontfix-accepted by=x0 note=reopen_if=a user or prompt needs redacted config plus validity in one iris_ldap_manage call; Ergonomic only; each call correct and cheap

### DW-96: [CR-15.3-4] x509 import does not validate that the decoded certificate is a real DER X.509 cert before Save()
- source: legacy:15.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Junk base64/PEM-armored body could persist a credential with empty SubjectDN/Thumbprint; operator is the trust boundary; overwrite guard prevents clobbering.
- 2026-10-14T10:47:50Z status=wontfix-accepted owner=15-3-iris-x509-manage by=migration note=reopen_if=iris_x509_manage import persists a credential with empty SubjectDN/Thumbprint

### DW-97: [CR-15.3-5] Raw IRIS timestamps in x509 notBefore/notAfter are not ISO-8601-converted (Rule #11)
- source: legacy:15.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: ValidityNotBefore/After emitted as readable %TimeStamp verbatim with no Raw companion; lower urgency than horolog; future timestamp-normalization pass.
- 2026-10-14T10:47:50Z status=wontfix-accepted owner=15-3-iris-x509-manage by=migration note=%TimeStamp is already human-readable; reopen_if=a client needs ISO-8601 notBefore/notAfter from iris_x509_manage

### DW-98: [CR-15.3-6] namespace schema field declared but never forwarded on the wire in x509 and sibling %SYS admin tools
- source: legacy:15.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: ldap.ts, service.ts, mapping.ts, user.ts, webapp.ts all declare a vestigial namespace field; cross-tool cleanup: wire it through or drop it.
- 2026-10-14T10:47:50Z status=wontfix-accepted owner=15-3-iris-x509-manage by=migration note=reopen_if=a caller passes namespace to a %SYS-scoped admin tool expecting an effect

### DW-99: [CR-15.4-3] audit export has no bounded-scope requirement (unlike purge)
- source: legacy:15.4 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: AC 15.4.5 scopes export safety to PATH control (satisfied); a full compliance export is legitimate and non-destructive; file lands only in fixed auditexport dir.
- 2026-10-14T10:47:50Z status=by-design owner=15-4-iris-audit-manage by=migration note=AC 15.4.5 scopes export safety to PATH control (satisfied); a full compliance export is legitimate

### DW-100: [CR-15.4-4] audit export overwrites an existing same-named file in the auditexport dir with no overwrite guard
- source: legacy:15.4 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: %XML.Writer.OutputToFile truncates; confined to controlled dir; caller clobbers own prior export; fix: timestamp suffix or explicit overwrite flag.
- 2026-10-14T10:47:50Z status=routed owner=burndown by=migration note=%XML.Writer.OutputToFile truncates; confined to controlled dir; caller clobbers own prior export
- 2026-10-15T11:47:32Z status=wontfix-accepted by=x0 note=reopen_if=a user reports a prior audit export overwritten by a same-named export; Still present: audit export writes via %XML.Writer with no existence check (Security.cls ~3030-3053); confined to mgr/auditexport; caller overwrites only its own export

### DW-101: [CR-15.4-5] audit export fileName accepts Windows reserved device names (CON, NUL, LPT1) and trailing dot/space
- source: legacy:15.4 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Pass the separator/../: blacklist and containment check; can resolve to an OS device producing a confusing failure; traversal IS blocked.
- 2026-10-14T10:47:50Z status=routed owner=burndown by=migration note=Pass the separator/../: blacklist and containment check; can resolve to an OS device producing a confusing failure
- 2026-10-15T11:47:32Z status=wontfix-theoretical by=x0 note=audit.ts:356 blocks separators and ..; Security.cls containment check holds; real only if a caller names the file CON/NUL/LPTn on a Windows-hosted IRIS

### DW-102: [CR-15.4-6] audit view paginates client-side over a server result capped at maxRows; count is page length, cursor never reaches IRIS
- source: legacy:15.4 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Caller cannot distinguish server-cap truncation from end of results; same pattern as sibling admin list tools; fold into pagination-semantics pass.
- 2026-10-14T10:47:50Z status=wontfix-accepted owner=15-4-iris-audit-manage by=migration note=reopen_if=an agent cannot tell cap truncation from end of results on iris_audit_manage view

### DW-103: [CR-15.4-7] audit enable/disable echo the requested value rather than re-reading Security.System.Get after Modify
- source: legacy:15.4 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Very low likelihood (BooleanYN 1/0 not coerced); fix: re-read AuditEnabled into the response.
- 2026-10-14T10:47:50Z status=routed owner=burndown by=migration note=Very low likelihood (BooleanYN 1/0 not coerced); fix: re-read AuditEnabled into the response.
- 2026-10-15T11:47:32Z status=wontfix-theoretical by=x0 note=Security.cls:2901 sets AuditEnabled 1/0 (BooleanYN, no coercion) and the Modify status is checked; real only if Modify returned OK without applying the value

### DW-104: [CR-15.4-8] AuditStatus reuses tRS for two sequential result sets; catch closes only the most recent
- source: legacy:15.4 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Same pre-existing list-Close-in-catch pattern tracked under CR 15.1-1 / 15.2-2 / 15.3-3; Security.cls:AuditStatus.
- 2026-10-14T10:47:50Z status=routed owner=burndown by=migration note=Same pre-existing list-Close-in-catch pattern tracked under CR 15.1-1 / 15.2-2 / 15.3-3; Security.cls:AuditStatus.
- 2026-10-15T11:47:32Z status=wontfix-theoretical by=x0 note=Reassigning tRS releases the first %ResultSet, whose %OnClose closes it; second closed on method exit; real only if tRS outlived the method

### DW-105: [CR-15.6-3] docs/tool-annotation-audit.md is a dated point-in-time snapshot with stale counts and dotted v1 names
- source: legacy:15.6 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Historical dated audit artifact; rolling counts forward would falsify the record; left as-is by decision.
- 2026-10-14T10:47:50Z status=wontfix-accepted owner=15-6-bootstrap-bump-verification-and-docs by=migration note=reopen_if=the dated tool-annotation-audit snapshot is cited as current documentation

### DW-106: [CR-15.6-4] architecture.md:35 FR-distribution prose (iris-admin-mcp FR40-FR62, 23 FRs) not updated
- source: legacy:15.6 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: An FR count, not a tool count; 109-FR baseline fixed pre-Epic-15; FR to tool is not 1:1; out of scope for the tool-count rollup.
- 2026-10-14T10:47:50Z status=dropped owner=15-6-bootstrap-bump-verification-and-docs by=migration note=invalid: FR count, not a tool count

### DW-107: [L15.6-planning-artifacts-stale-suite-counts] Planning artifacts (prd.md, epics.md, product-brief) still carry pre-Epic-15 suite/admin
- source: legacy:15.6 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Planning artifacts, not release-facing published docs; correctly out of the docs-rollup scope.
- 2026-10-14T10:47:50Z status=wontfix-accepted owner=15-6-bootstrap-bump-verification-and-docs by=migration note=planning artifacts, not release-facing; reopen_if=planning artifacts are republished as release-facing documentation

### DW-108: [CR-16.0-1] Generator --check vs governance.test.ts lock-step divergence (bare action.options read vs unwrapActionOptions)
- source: legacy:16.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Extracted deriveKeysForTool/computeBaselineDrift/SERVER_PACKAGES/VANISHED_HINT into governance-baseline-derivation.ts shared by generator and drift guard.
- 2026-10-14T10:47:50Z status=resolved-by:22-1-deferred-work-burn-down owner=16-0-epic-15-deferred-cleanup by=migration note=Extracted deriveKeysForTool/computeBaselineDrift/SERVER_PACKAGES/VANISHED_HINT into governance-baseline-derivation.ts

### DW-109: [CR-16.0-2] --check failure branch (vanished frozen key, exit 1 + VANISHED_HINT) has no direct CLI-level test
- source: legacy:16.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: New governance-baseline-derivation.test.ts unit-tests computeBaselineDrift vanished-key detection with synthetic sets.
- 2026-10-14T10:47:50Z status=resolved-by:22-1-deferred-work-burn-down owner=16-0-epic-15-deferred-cleanup by=migration note=New governance-baseline-derivation.test.ts unit-tests computeBaselineDrift vanished-key detection with synthetic sets.

### DW-110: [CR-16.0-3] --check --force together silently runs --check only; unknown/typo flags fall to refusal path
- source: legacy:16.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Safe path always wins and refusal is non-destructive; flag-conflict validation is gold-plating for a build-time generator.
- 2026-10-14T10:47:50Z status=by-design owner=16-0-epic-15-deferred-cleanup by=migration note=Safe path always wins and refusal is non-destructive; flag-conflict validation is gold-plating for a build-time

### DW-111: [CR-16.1-1] iris_process_manage declares optional namespace and forwards it, but ProcessGet/ProcessManage never read it (hard-switch %SYS)
- source: legacy:16.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Descriptions now state NO EFFECT; param retained for back-compat; TS unit test per tool asserts description and acceptance.
- 2026-10-14T10:47:50Z status=resolved-by:18-0-epic-17-deferred-cleanup owner=16-1-iris-process-manage by=migration note=Descriptions now state NO EFFECT; param retained for back-compat

### DW-112: [CR-16.1-2] ProcessManage TOCTOU window across three live process-state queries
- source: legacy:16.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: TOCTOU is inherent to SYS.Process; now fails CLOSED with a benign refusal; ledger (Epic 18 gate): accepted standard pattern.
- 2026-10-14T10:47:50Z status=by-design owner=16-1-iris-process-manage by=migration note=TOCTOU is inherent to SYS.Process; now fails CLOSED with a benign refusal

### DW-113: [CR-16.1-3] ProcessGet reads MemoryUsed via %SYS.ProcessQuery.%OpenId (mailbox message, may take seconds)
- source: legacy:16.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Live probe: MemoryUsed read via %SYS.ProcessQuery = 4.8 ms/call (10 iters); immaterial, no fix.
- 2026-10-14T10:47:50Z status=wontfix-theoretical owner=16-1-iris-process-manage by=migration note=MemoryUsed read measured 4.8 ms/call; real_if=ProcessGet MemoryUsed read latency exceeds ~1s per call

### DW-114: [CR-16.1-4] Self-PID guard protects $JOB (worker) rather than the external MCP-client process
- source: legacy:16.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: $JOB is the only meaningfully self-protectable PID and matches AC 16.1.4 intent; out of the tool's scope.
- 2026-10-14T10:47:50Z status=by-design owner=16-1-iris-process-manage by=migration note=$JOB is the only meaningfully self-protectable PID and matches AC 16.1.4 intent; out of the tool's scope.

### DW-115: [CR-16.2-1] iris_database_action declares optional namespace and forwards it, but DatabaseAction never reads it (hard-switch %SYS)
- source: legacy:16.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Descriptions now state NO EFFECT; param retained for back-compat.
- 2026-10-14T10:47:50Z status=resolved-by:18-0-epic-17-deferred-cleanup owner=16-2-iris-database-action by=migration note=Descriptions now state NO EFFECT; param retained for back-compat.

### DW-116: [CR-16.2-2] No range validation on numeric params percentFull/targetSize/initialSize (bare z.number())
- source: legacy:16.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Zod .min(1).max(100) percentFull, .min(0) targetSize, .min(1) initialSize in database.ts; bounds-rejection unit test.
- 2026-10-14T10:47:50Z status=resolved-by:22-1-deferred-work-burn-down owner=16-2-iris-database-action by=migration note=Zod .min(1).max(100) percentFull, .min(0) targetSize, .min(1) initialSize in database.ts; bounds-rejection unit test.

### DW-117: [CR-16.2-3] compact/truncate ByRef outputs pre-initialized to 0 so a failure is indistinguishable from a genuine zero
- source: legacy:16.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: On failure the SanitizeError envelope is rendered and the zeroed success object is never rendered; invisible to caller.
- 2026-10-14T10:47:50Z status=by-design owner=16-2-iris-database-action by=migration note=On failure the SanitizeError envelope is rendered and the zeroed success object is never rendered

### DW-118: [L17.retro-ai4-backup-restore-scriptable-path] iris_backup_manage restore action (scriptable path) intentionally not implemented
- source: legacy:16.3 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Backup.General has no RestoreDatabase/Restore/RestoreTask/RestoreJournal/StartRestore classmethod; handler rejects action=restore clearly.
- 2026-10-14T10:47:50Z status=wontfix-accepted owner=16-3-iris-backup-manage by=migration note=Backup.General has no scriptable restore classmethod; reopen_if=Backup.General exposes a scriptable restore classmethod

### DW-119: [CR-16.3-namespace] iris_backup_manage declares optional namespace and forwards it but BackupManage hard-switches %SYS and never reads it
- source: legacy:16.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Descriptions now state NO EFFECT; param retained for back-compat.
- 2026-10-14T10:47:50Z status=resolved-by:18-0-epic-17-deferred-cleanup owner=16-3-iris-backup-manage by=migration note=Descriptions now state NO EFFECT; param retained for back-compat.

### DW-120: [CR-16.3-device] backup run reads device but calls StartTask without it - caller-supplied device silently dropped
- source: legacy:16.3 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: StartTask 4th Device arg is Internal/undocumented so not wired; param retained, description states NO EFFECT; desc unit test.
- 2026-10-14T10:47:50Z status=resolved-by:22-1-deferred-work-burn-down owner=16-3-iris-backup-manage by=migration note=StartTask 4th Device arg is Internal/undocumented so not wired; param retained, description states NO EFFECT

### DW-121: [CR-16.3-thaw-password] thaw forwards password to ExternalThaw; non-OK status via SanitizeError might echo the submitted password
- source: legacy:16.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Backup.General.ExternalThaw body is empty (kernel-generated); ObjectScript layer constructs no error text so the password cannot be echoed.
- 2026-10-14T10:47:50Z status=wontfix-theoretical owner=16-3-iris-backup-manage by=migration note=ExternalThaw body is empty; real_if=ExternalThaw error text is observed to embed the submitted password

### DW-122: [CR-17.1-1] || IdKey-delimiter injection guard in DefaultSettingsManage has no automated test
- source: legacy:17.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Guard already coded; live REST with a || slot returned ERROR #5001 'Key slot values may not contain the || delimiter', result {} (no write).
- 2026-10-14T10:47:50Z status=resolved-by:22-1-deferred-work-burn-down owner=17-1-iris-default-settings-manage by=migration note=Guard already coded; live REST with a || slot returned ERROR #5001 'Key slot values may not contain the ||

### DW-123: [CR-17.1-2] Explicit empty-string key slot is coerced to the wildcard * row (same as omitting the slot)
- source: legacy:17.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Class InitialExpression is *; documented contract is omit for the * default; TS schema is z.string(); deliberate-caller path.
- 2026-10-14T10:47:50Z status=by-design owner=17-1-iris-default-settings-manage by=migration note=Class InitialExpression is *; documented contract is omit for the * default; TS schema is z.string()

### DW-124: [CR-17.1-3] deployable coerced via +tBody.%Get at the REST layer: a direct REST caller sending string true stores Deployable=0
- source: legacy:17.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: MCP callers safe via z.boolean(); mirrors the established + coercion in ItemManage/AutoStart; cross-handler concern.
- 2026-10-14T10:47:50Z status=by-design owner=17-1-iris-default-settings-manage by=migration note=MCP callers safe via z.boolean(); mirrors the established + coercion in ItemManage/AutoStart; cross-handler concern.

### DW-125: [CR-17.2-1] ApplyArbitrarySetting returns a %Status that both call sites discard
- source: legacy:17.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Both call sites capture and propagate the %Status via SanitizeError before pushing to updatedSettings.
- 2026-10-14T10:47:50Z status=resolved-by:18-0-epic-17-deferred-cleanup owner=17-2-production-item-add-remove-and-settings by=migration note=Both call sites capture and propagate the %Status via SanitizeError before pushing to updatedSettings.

### DW-126: [CR-17.2-2] @Host/@Adapter suffix parser edge cases (first @ matched, leading @, unknown suffix silently folded)
- source: legacy:17.2 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Scans LAST @, rejects empty setting Name and unknown suffix with a clear error; lead live-HTTP smoke to assert.
- 2026-10-14T10:47:50Z status=resolved-by:18-0-epic-17-deferred-cleanup owner=17-2-production-item-add-remove-and-settings by=migration note=Scans LAST @, rejects empty setting Name and unknown suffix with a clear error; lead live-HTTP smoke to assert.

### DW-127: [CR-17.2-3] production_item add does not validate host className exists/compiles or item Name uniqueness
- source: legacy:17.2 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Add branch pre-checks CompiledClass.%ExistsId and FindItemByConfigName duplicate before Items.Insert/SaveToClass.
- 2026-10-14T10:47:51Z status=resolved-by:18-0-epic-17-deferred-cleanup owner=17-2-production-item-add-remove-and-settings by=migration note=Add branch pre-checks CompiledClass.%ExistsId and FindItemByConfigName duplicate before Items.Insert/SaveToClass.

### DW-128: [CR-17.2-4] set-vs-add/remove persistence-model split (extent vs class XData) + LoadFromClass side effects
- source: legacy:17.2 | severity: med | fix-risk: high | footprint: out-of-footprint
- evidence: Tool-description NOTE added to iris_production_item with a pinning TS test; underlying split NOT re-architected (pre-existing IRIS limitation).
- 2026-10-14T10:47:51Z status=decision-pending owner=burndown by=migration note=call: accept the extent/XData persistence split (documented) or re-architect add/remove/set onto one path
- 2026-10-15T11:47:32Z status=resolved-by:35-1-high-iris_production_item-set-composite-key-resolution by=x0 note=decided=orchestrator(Lead-away) re-architected: set now uses LoadFromClass->SaveToClass like add/remove (Interop.cls:520-523,649-664, 3c7adec); only get's extent read remains, documented item.ts:42-48

### DW-129: [CR-17.2-5] LoadFromClass return %Status ignored in ItemManage add/remove
- source: legacy:17.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Add and remove branches capture the status and fail cleanly instead of proceeding on a stale extent.
- 2026-10-14T10:47:51Z status=resolved-by:18-0-epic-17-deferred-cleanup owner=17-2-production-item-add-remove-and-settings by=migration note=Add and remove branches capture the status and fail cleanly instead of proceeding on a stale extent.

### DW-130: [CR-18.0-1] add className guard hardening: whitespace half resolved; abstract/%-package host guard half deferred
- source: legacy:18.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Added %Extends Ens.Host + CompiledClass.Abstract guard in ItemManage add; live REST confirmed non-host and abstract rejected, concrete host passes.
- 2026-10-14T10:47:51Z status=resolved-by:22-1-deferred-work-burn-down owner=18-0-epic-17-deferred-cleanup by=migration note=Added %Extends Ens.Host + CompiledClass.Abstract guard in ItemManage add

### DW-131: [CR-18.0-2] add duplicate-name check relies on FindItemByConfigName index collation (case-variant may not be detected)
- source: legacy:18.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Ens.Config.Item Name index is case-SENSITIVE (Exact); a case-variant is a distinct item, so the guard already matches IRIS semantics.
- 2026-10-14T10:47:51Z status=by-design owner=18-0-epic-17-deferred-cleanup by=migration note=Ens.Config.Item Name index is case-SENSITIVE (Exact); a case-variant is a distinct item

### DW-132: [CR-19.0-1] Discovery does not validate profile when allProfiles:true (typo silently ignored)
- source: legacy:19.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: computeServerDiscovery now calls resolveProfile for an explicit non-empty profile with allProfiles:true and throws ProfileResolutionError.
- 2026-10-14T10:47:51Z status=resolved-by:unknown owner=19-0-server-and-governance-discovery-tool by=migration note=computeServerDiscovery now calls resolveProfile for an explicit non-empty profile with allProfiles:true and throws

### DW-133: [CR-19.0-2] Invalid framework server arg hard-fails the discovery tool
- source: legacy:19.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: handleToolCall catches the server->profile ProfileResolutionError for the discovery tool only and falls back to the default profile.
- 2026-10-14T10:47:51Z status=resolved-by:unknown owner=19-0-server-and-governance-discovery-tool by=migration note=handleToolCall catches the server->profile ProfileResolutionError for the discovery tool only and falls back

### DW-134: [L20.retro-action2-rebuild-reload-mcp-servers] Epic 20 retro Action #2: rebuild + reload running MCP servers so the 7aca352 F2/clean build
- source: legacy:20.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Running iris-interop-mcp governance registers iris_production_control:clean:true, confirming the post-7aca352 build is live; no rebuild needed.
- 2026-10-14T10:47:51Z status=dropped owner=20-0-production-clean-action by=migration note=operational: verified live, not pipeline work

### DW-135: [CR-21.1-1] Episode-tier rule-A unwind gated on Kind=arrow: pairloop after an abandoned sync frame does not unwind it
- source: legacy:21.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Stakeholder Option A: EpisodeCore unwinds an abandoned sync frame on a pairloop too; symmetric-grouping fixture added.
- 2026-10-14T10:47:51Z status=resolved-by:22-1-deferred-work-burn-down owner=21-1-episode-compression-dedup-and-docs by=migration note=Stakeholder Option A: EpisodeCore unwinds an abandoned sync frame on a pairloop too; symmetric-grouping fixture added.

### DW-136: [CR-21.1-2] Repeated unanswered sync self-calls (Src=Dst) grow the depth stack and land in one episode
- source: legacy:21.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: EpisodeCore no longer pushes a frame for an unpaired sync self-call; Src=Dst boundary fixture added.
- 2026-10-14T10:47:51Z status=resolved-by:22-1-deferred-work-burn-down owner=21-1-episode-compression-dedup-and-docs by=migration note=EpisodeCore no longer pushes a frame for an unpaired sync self-call; Src=Dst boundary fixture added.

### DW-137: [CR-21.0-1] Queue fallback pairing fires on EMPTY ReturnQueueName
- source: legacy:21.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: ReturnQueueName fallback fires only when both values are non-empty and equal; fixture tests in DiagramCorrelatorTest.
- 2026-10-14T10:47:51Z status=resolved-by:21-1-episode-compression-dedup-and-docs owner=21-0-message-diagram-core by=migration note=ReturnQueueName fallback fires only when both values are non-empty and equal; fixture tests in DiagramCorrelatorTest.

### DW-138: [CR-21.0-2] Correlator pairing is O(n^2) with no iteration bound
- source: legacy:21.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Live probe: default maxRows=2000 -> 0.136 s; 10000 -> 4.6 s functional; cap and index-map upgrade path documented in Correlator.cls.
- 2026-10-14T10:47:51Z status=wontfix-accepted owner=21-0-message-diagram-core by=migration note=default maxRows 2000 measured 0.136 s; cap documented; reopen_if=Correlate at default maxRows 2000 takes more than ~1 s

### DW-139: [CR-20.0-1] recover still accepts and forwards force, which the server now ignores
- source: legacy:20.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Per-action documentation states timeout/force honored only by stop/restart; doc-only preserves the AC 20.0.7 back-compat gate; doc unit test.
- 2026-10-14T10:47:51Z status=resolved-by:22-1-deferred-work-burn-down owner=20-0-production-clean-action by=migration note=Per-action documentation states timeout/force honored only by stop/restart

### DW-140: [CR-22.0-D1] Generate.Count aborts the ENTIRE scan when one document's ScanDoc errors (enumerate-to-retrieve TOCTOU)
- source: legacy:22.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Documented the all-or-nothing facade contract in iris_loc_count description + Generate.cls doc banner; no behavior change.
- 2026-10-14T10:47:51Z status=by-design owner=22-0-loc-counter-tool by=migration note=Documented the all-or-nothing facade contract in iris_loc_count description + Generate.cls doc banner

### DW-141: [CR-22.0-D2] StudioOpenDialog multi-part spec order sensitivity: exact name before overlapping wildcard silently drops docs
- source: legacy:22.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Source read of RoutineMgr.StudioOpenDialogExecute confirms each comma part is parsed independently - genuine native behavior; documented in Scanner.cls EnumerateDocs.
- 2026-10-14T10:47:51Z status=by-design owner=22-0-loc-counter-tool by=migration note=Source read of RoutineMgr.StudioOpenDialogExecute confirms each comma part is parsed independently

### DW-142: [CR-22.1-1] EpisodeCore rule-A pairloop unwind leaves tReqSrc empty when a pairloop event has a non-object .Req
- source: legacy:22.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Added (tReqSrc '= '') to the rule-A While in EpisodeCore; Diagram OS tests green.
- 2026-10-14T10:47:51Z status=resolved-by:26-4-deferred-work-ledger-burndown owner=22-1-deferred-work-burn-down by=migration note=Added (tReqSrc '= '') to the rule-A While in EpisodeCore; Diagram OS tests green.

### DW-143: [CR-22.1-2] Shared derivation dist/source split: generator imports compiled dist while drift guard imports TS source (stale-dist divergence)
- source: legacy:22.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Added pregen:governance-baseline[:check] npm pre-hooks (turbo build @iris-mcp/shared); live-verified; frozen baseline exit 0.
- 2026-10-14T10:47:51Z status=resolved-by:26-4-deferred-work-ledger-burndown owner=22-1-deferred-work-burn-down by=migration note=Added pregen:governance-baseline[:check] npm pre-hooks (turbo build @iris-mcp/shared); live-verified

### DW-144: [CR-22.1-3] iris_backup_manage restore rejection message names ^DBREST / CLUMENU^JRNRESTO, which SanitizeError strips to ( / )
- source: legacy:22.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: POST /monitor/backup/manage {action:restore} now renders the full message with both entry-point names intact.
- 2026-10-14T10:47:51Z status=resolved-by:23-1-health-endpoint-objectscript owner=22-1-deferred-work-burn-down by=migration note=POST /monitor/backup/manage {action:restore} now renders the full message with both entry-point names intact.

### DW-145: [CR-24.0-1] No mechanical guarantee that a read classification in BASELINE_ACTION_CLASSIFICATIONS is truthfully a pure query
- source: legacy:24.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Folded into Story 25.1 at the Epic 25 gate: the readOnlyHint cross-check test (Rule #44) was added there.
- 2026-10-14T10:47:51Z status=resolved-by:25-1-prompt-skill-content-and-generators owner=24-0-baseline-classifications by=migration note=Folded into Story 25.1 at the Epic 25 gate: the readOnlyHint cross-check test (Rule #44) was added there.

### DW-146: [L24.0-iris-transform-test-reclassified-write] SPEC-DIVERGENCE FLAG: iris_transform_test reclassified read to write
- source: legacy:24.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: write stands: DTL can embed sql/code and readOnlyHint is false; binding spec 02-governance-presets 2.1 never blessed test as read; the story AC was the outlier.
- 2026-10-14T10:47:51Z status=by-design owner=24-0-baseline-classifications by=migration note=write stands: DTL can embed sql/code and readOnlyHint is false; binding spec 02-governance-presets 2.1 never blessed

### DW-147: [CR-23.0-1] databases space-health is INERT when maxSize=0 (vendor-recommended unlimited) - no disk-exhaustion signal
- source: legacy:23.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Free-% health for maxSize-configured mounted DBs only; unlimited/unmounted report notApplicable; documented in tool description with pointer to iris_database_check.
- 2026-10-14T10:47:51Z status=resolved-by:23-2-health-tool-and-docs owner=23-0-health-probe-and-thresholds by=migration note=Free-% health for maxSize-configured mounted DBs only; unlimited/unmounted report notApplicable

### DW-148: [CR-23.0-2] license numerator CSPUsers() may under-count license consumption
- source: legacy:23.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: evaluateLicense prefers IRIS-authoritative licenseCurrentPct, falls back to CSPUsers/userLimit; unit-tested.
- 2026-10-14T10:47:51Z status=resolved-by:23-2-health-tool-and-docs owner=23-0-health-probe-and-thresholds by=migration note=evaluateLicense prefers IRIS-authoritative licenseCurrentPct, falls back to CSPUsers/userLimit; unit-tested.

### DW-149: [CR-23.0-3] No health-level criteria for applicable-but-unhealthy mirror, ecp, interop, system areas
- source: legacy:23.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Informational-only in v1 (always ok or notApplicable), documented; queue-depth/mirror-status threshold is a documented future enhancement.
- 2026-10-14T10:47:51Z status=resolved-by:23-2-health-tool-and-docs owner=23-0-health-probe-and-thresholds by=migration note=Informational-only in v1 (always ok or notApplicable), documented

### DW-150: [CR-23.0-4] databases per-DB to single-area finding aggregation rule unspecified
- source: legacy:23.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Worst-DB drives the area level; full per-DB breakdown stays in raw.databases; deterministic tie-break.
- 2026-10-14T10:47:51Z status=resolved-by:23-2-health-tool-and-docs owner=23-0-health-probe-and-thresholds by=migration note=Worst-DB drives the area level; full per-DB breakdown stays in raw.databases; deterministic tie-break.

### DW-151: [CR-23.0-5] databases %OpenId open-FAILURE indistinguishable from notApplicable
- source: legacy:23.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: HealthCheckDatabases emits per-DB openFailed boolean distinguishing a %OpenId throw from legitimate notApplicable; live-verified 15 DBs openFailed:false.
- 2026-10-14T10:47:51Z status=resolved-by:23-1-health-endpoint-objectscript owner=23-0-health-probe-and-thresholds by=migration note=HealthCheckDatabases emits per-DB openFailed boolean distinguishing a %OpenId throw from legitimate notApplicable

### DW-152: [CR-23.0-6] Tool-input validation gaps: dropped memory enum value, areas:[] semantics, threshold override range/ordering
- source: legacy:23.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Zod areas enum excludes memory, areas:[] means all-9, NaN rejected by z.number(); extreme thresholds allowed.
- 2026-10-14T10:47:51Z status=resolved-by:23-2-health-tool-and-docs owner=23-0-health-probe-and-thresholds by=migration note=Zod areas enum excludes memory, areas:[] means all-9, NaN rejected by z.number(); extreme thresholds allowed.

### DW-153: [CR-23.1-1] HealthCheck dispatcher request-parsing permissiveness
- source: legacy:23.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Zod enum is the authoritative validator; memory/unknown/mis-cased rejected before the HTTP call; the tool always sends well-formed comma-separated input.
- 2026-10-14T10:47:51Z status=resolved-by:23-2-health-tool-and-docs owner=23-1-health-endpoint-objectscript by=migration note=Zod enum is the authoritative validator; memory/unknown/mis-cased rejected before the HTTP call

### DW-154: [CR-23.1-2] Health endpoint unit tests assert field presence (%IsDefined), not values; dispatcher parsing untested
- source: legacy:23.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Every fixture test asserts deterministic values (exact level/value/threshold/verdict); 76 health.test.ts + 3 governance tests.
- 2026-10-14T10:47:51Z status=resolved-by:23-2-health-tool-and-docs owner=23-1-health-endpoint-objectscript by=migration note=Every fixture test asserts deterministic values (exact level/value/threshold/verdict)

### DW-155: [CR-23.1-3] Result-set close hygiene in Health.cls (Ens.Queue:Enumerate never closed; DB/System close only on success path)
- source: legacy:23.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Added Do:$IsObject(...) .Close() on success AND Catch paths in HealthCheckSystem/Databases/Interop; HealthCheckTest 15/15.
- 2026-10-14T10:47:51Z status=resolved-by:26-4-deferred-work-ledger-burndown owner=23-1-health-endpoint-objectscript by=migration note=Added Do:$IsObject(...) .Close() on success AND Catch paths in HealthCheckSystem/Databases/Interop

### DW-156: [CR-23.1-4] HealthCheck discards the %Status of HealthCheckParseAreas; later If tWant(area) assumes all 9 subscripts exist
- source: legacy:23.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: HealthCheck now captures and checks the %Status, returning a sanitized error envelope on failure; HealthCheckTest 15/15.
- 2026-10-14T10:47:51Z status=resolved-by:26-4-deferred-work-ledger-burndown owner=23-1-health-endpoint-objectscript by=migration note=HealthCheck now captures and checks the %Status, returning a sanitized error envelope on failure

### DW-157: [CR-23.1-5] GET repeated areas query params read only the first value (documented contract is comma-separated)
- source: legacy:23.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: GET branch loops %request.Count('areas') occurrences and joins with commas; live-verified over HTTP after review corrected the defective first fix.
- 2026-10-14T10:47:51Z status=resolved-by:26-4-deferred-work-ledger-burndown owner=23-1-health-endpoint-objectscript by=migration note=GET branch loops %request.Count('areas') occurrences and joins with commas

### DW-158: [CR-23.2-1] server output field omitted from iris_health_check structuredContent (spec 2 shows server profile name)
- source: legacy:23.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: ToolContext/IrisConnectionConfig expose no profile-name field (Rule #16); amended 01-health-check.md 2 to drop server from the v1 output example.
- 2026-10-14T10:47:51Z status=by-design owner=23-2-health-tool-and-docs by=migration note=ToolContext/IrisConnectionConfig expose no profile-name field (Rule #16)

### DW-159: [CR-23.2-2] Unknown errors key (outside the 9-area enum) silently dropped by evaluate(), could yield a false healthy
- source: legacy:23.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Source read of Health.cls confirms every pErrors.%Set uses one of the 9 canonical literal area names - not live-reachable.
- 2026-10-14T10:47:51Z status=wontfix-theoretical owner=23-2-health-tool-and-docs by=migration note=Health.cls only sets the 9 canonical error; real_if=Health.cls emits an errors key outside the 9 canonical area names

### DW-160: [CR-23.2-3] A 200 response missing the result object throws a raw TypeError instead of the tool's error envelope
- source: legacy:23.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Added explicit response.result undefined/null guard in health.ts returning a clean isError envelope; +2 regression tests.
- 2026-10-14T10:47:51Z status=resolved-by:26-4-deferred-work-ledger-burndown owner=23-2-health-tool-and-docs by=migration note=Added explicit response.result undefined/null guard in health.ts returning a clean isError envelope

### DW-161: [CR-24.1-1] presetApplied attribution is not strictly but-for under read-only (new non-defaultEnabled write key denied without any preset)
- source: legacy:24.1 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Denial carries presetApplied:read-only although defaultSeed would deny the same key with no preset; attribution accuracy only.
- 2026-10-14T10:47:51Z status=routed owner=burndown by=migration note=Denial carries presetApplied:read-only although defaultSeed would deny the same key with no preset
- 2026-10-15T11:47:32Z status=by-design by=x0 note=Under read-only the presetSeed layer precedes defaultSeed in the cascade (governance.ts:845-846) so the preset genuinely resolved the key; attribution per AC 24.1.4c

### DW-162: [CR-24.2-1] IRIS_SQL_MAX_ROWS is a post-fetch display slice, not a wire/memory resource cap
- source: legacy:24.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Handler materializes the entire Atelier query result before slice(); docs market it as a hard resource cap but it gives no transfer/memory protection.
- 2026-10-14T10:47:51Z status=wontfix-accepted owner=24-2-sql-caps-docs-and-smokes by=migration note=reopen_if=an unbounded Atelier SQL result exhausts memory/transfer despite IRIS_SQL_MAX_ROWS

### DW-163: [CR-25.0-4] registerPrompt callback has no try/catch: a throwing PromptDefinition.build() surfaces as an opaque -32603 InternalError
- source: legacy:25.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Wrapped def.build(...) in try/catch in server-base render; rethrown as McpError(InternalError); +1 regression test.
- 2026-10-14T10:47:51Z status=resolved-by:26-4-deferred-work-ledger-burndown owner=25-0-prompts-framework-plumbing by=migration note=Wrapped def.build(...) in try/catch in server-base render; rethrown as McpError(InternalError); +1 regression test.

### DW-164: [CR-25.0-5] Two PromptDefinition.arguments entries with the same name silently collapse (last-wins)
- source: legacy:25.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Fail-fast duplicate-argument-name check added in registerPrompt argsShape loop; +1 regression test.
- 2026-10-14T10:47:51Z status=resolved-by:26-4-deferred-work-ledger-burndown owner=25-0-prompts-framework-plumbing by=migration note=Fail-fast duplicate-argument-name check added in registerPrompt argsShape loop; +1 regression test.

### DW-165: [CR-25.1-5] (LOW, dismissed in Story 25.1 review; ledger gives no further detail)
- source: legacy:25.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Mentioned only as 'One LOW dismissed (CR 25.1-5)' in the review summary.
- 2026-10-14T10:47:51Z status=dropped owner=25-1-prompt-skill-content-and-generators by=migration note=dismissed in review; ledger gives no detail

### DW-166: [CR-25.1-3] gen-skills.mjs --check cannot detect extra files in a valid skill directory or an orphan directory lacking SKILL.md
- source: legacy:25.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: listAllOnDiskFiles() recursively enumerates skills/; --check flags any stray path, write-mode removes it; +2 live regression tests.
- 2026-10-14T10:47:51Z status=resolved-by:26-4-deferred-work-ledger-burndown owner=25-1-prompt-skill-content-and-generators by=migration note=listAllOnDiskFiles() recursively enumerates skills/; --check flags any stray path, write-mode removes

### DW-167: [CR-25.1-4] arg() collapses empty-string to a placeholder but note-branch logic keys on !== undefined (renders literal <query>)
- source: legacy:25.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Shared prompt-helpers.ts isArgProvided/argOrPlaceholder used by all 9 prompt files; +8 unit and +5 regression tests.
- 2026-10-14T10:47:51Z status=resolved-by:26-4-deferred-work-ledger-burndown owner=25-1-prompt-skill-content-and-generators by=migration note=Shared prompt-helpers.ts isArgProvided/argOrPlaceholder used by all 9 prompt files; +8 unit and +5 regression tests.

### DW-168: [CR-25.1-6] All-optional-argument prompts reject a prompts/get that OMITS arguments entirely (must send {})
- source: legacy:25.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Accepted the documented SDK limitation (@modelcontextprotocol/sdk@1.29.0); doc comment in server-base.ts; 2 regression tests pin the accepted behavior.
- 2026-10-14T10:47:51Z status=wontfix-accepted owner=25-1-prompt-skill-content-and-generators by=migration note=reopen_if=the MCP SDK accepts getPrompt without arguments for all-optional prompts

### DW-169: [CR-25.2-1] Prose count numbers in the prompts docs are not mechanically asserted against the registered catalog
- source: legacy:25.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: 2 mechanical tests added to docs-prompt-sync.test.ts: README prompt-count heading vs prompts.length and tool_support.md tallies vs live catalog.
- 2026-10-14T10:47:51Z status=resolved-by:26-4-deferred-work-ledger-burndown owner=25-2-prompts-docs-and-client-smoke by=migration note=2 mechanical tests added to docs-prompt-sync.test.ts: README prompt-count heading vs prompts.length

### DW-170: [CR-26.1-1] dryRun coerces a non-boolean/truthy-string encoding to execute-eligible (safety flag defaults unsafe)
- source: legacy:26.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Confirmed at MessageResend.cls:507; fails safe since confirm still needs a real true; a bootstrap bump for a non-active-defect LOW is disproportionate.
- 2026-10-14T10:47:51Z status=wontfix-accepted owner=26-1-resend-objectscript-handler by=migration note=reopen_if=a caller is shown to execute a resend by sending dryRun as a string with confirm true

### DW-171: [CR-26.1-2] Bare-date to silently excludes the entire final day in resendFiltered
- source: legacy:26.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: NormalizeTimestamp appends 00:00:00 to a bare date; fails safe (under-resends) and visible in the dry-run sample; accepted limitation.
- 2026-10-14T10:47:51Z status=wontfix-accepted owner=26-1-resend-objectscript-handler by=migration note=fails safe: under-resends and is visible; reopen_if=an operator reports final-day messages excluded by a bare-date to

### DW-172: [CR-26.1-3] headerIds as a non-empty JSON object (not array) is silently accepted
- source: legacy:26.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: ValidateHeaderIds guards only '$IsObject; values still numeric+bounds-validated; TS Zod z.array already rejects a non-array.
- 2026-10-14T10:47:51Z status=wontfix-accepted owner=26-1-resend-objectscript-handler by=migration note=values still numeric-bounded; reopen_if=a direct REST caller resends unintended header IDs via a JSON object

### DW-173: [CR-26.1-4] resendFiltered filtered-execute composition (TOP-N fetch to ResendBatch) not driven by a single unit test
- source: legacy:26.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Needs a running scratch interop production with seeded messages; the 26.3 live smoke covered only refusals plus plain resend - accepted coverage gap, genuine live execute smoke recommended.
- 2026-10-14T10:47:51Z status=wontfix-accepted owner=26-1-resend-objectscript-handler by=migration note=reopen_if=a live resendFiltered dryRun:false+confirm:true execute smoke is run and fails

### DW-174: [CR-26.1-5] Non-integer maxMessages passes bounds and flows into SELECT TOP (e.g. TOP 2.5)
- source: legacy:26.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Confirmed +tBody.%Get('maxMessages') not floored at :490; fails safe (IRIS errors or caps lower, never over-resends).
- 2026-10-14T10:47:52Z status=wontfix-accepted owner=26-1-resend-objectscript-handler by=migration note=reopen_if=maxMessages with a fractional value causes an over-resend or confusing error

### DW-175: [CR-26.1-6] A fetch-query failure on the resendFiltered execute path is silently swallowed (reports success, resends nothing)
- source: legacy:26.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Confirmed no error branch at :560 for a non-object/negative-SQLCODE fetch RS; fails safe (no wrong resend) but under-reported.
- 2026-10-14T10:47:52Z status=wontfix-accepted owner=26-1-resend-objectscript-handler by=migration note=reopen_if=an execute-path fetch failure is observed reporting success with zero resends

### DW-176: [CR-26.2-1] message-resend.ts dereferences result.summary and branches on result.dryRun without the defensive guard siblings get
- source: legacy:26.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: renderResendSummary guarded with EMPTY_SUMMARY fallback; dryRun discriminant normalized to === true; +3 regression tests, mutation-verified.
- 2026-10-14T10:47:52Z status=resolved-by:29-3-deferred-work-burndown owner=26-2-resend-ts-tool by=migration note=renderResendSummary guarded with EMPTY_SUMMARY fallback; dryRun discriminant normalized to === true

### DW-177: [CR-26.4-1] Compressor (tReqSrc '= '') guard also gates the arrow branch (shared arrow||pairloop loop)
- source: legacy:26.4 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: For arrows tReqSrc=tEv.Src which the arrow producer always sets; the empty-Src arrow is unreachable in practice.
- 2026-10-14T10:47:52Z status=wontfix-theoretical owner=26-4-deferred-work-ledger-burndown by=migration note=the arrow producer always sets Src; real_if=an arrow event with empty Src is produced by the Diagram pipeline

### DW-178: [CR-26.4-2] closed-with-evidence lacks the in-code doc note the original finding requested (health.ts evaluate)
- source: legacy:26.4 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Added one-line doc note at the checked filter in health.ts evaluate(); health.test.ts 81/81 green.
- 2026-10-14T10:47:52Z status=resolved-by:29-3-deferred-work-burndown owner=26-4-deferred-work-ledger-burndown by=migration note=Added one-line doc note at the checked filter in health.ts evaluate(); health.test.ts 81/81 green.

### DW-179: [CR-26.4-3] gen-skills.mjs --check now flags/removes ANY non-generated file under skills/ (.gitkeep, editor scratch)
- source: legacy:26.4 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: By-design for a 100%-generated tree with DO-NOT-EDIT headers; scope contained to skills/.
- 2026-10-14T10:47:52Z status=by-design owner=26-4-deferred-work-ledger-burndown by=migration note=By-design for a 100%-generated tree with DO-NOT-EDIT headers; scope contained to skills/.

### DW-180: [L26.retro-action1-rebuild-reload-mcp-servers] Epic 26 retro Action #1: rebuild + reload running MCP servers so iris_message_resend +
- source: legacy:26.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Not a dev story; also gates Epic 27 live MCP-client smoke and the promote:execute enable+reload dance.
- 2026-10-14T10:47:52Z status=dropped owner=26-0-resend-api-probe by=migration note=operational: servers verified reloaded at the Epic 31 gate (L30 retro action 1)

### DW-181: [L27.0-gen-skills-stray-file-test-crlf-windows] gen-skills --check line-ending sensitivity: gen-skills-stray-file.test.ts fails
- source: legacy:27.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Added .gitattributes (* text=auto eol=lf) at repo root; zero renormalization churn.
- 2026-10-14T10:47:52Z status=resolved-by:unknown owner=27-0-profile-client-and-documents-diff by=migration note=Added .gitattributes (* text=auto eol=lf) at repo root; zero renormalization churn.

### DW-182: [CR-27.0-1] CheckWideSpec (EnvSync.cls) refuses only a bare * part; whole-TYPE scans (*.cls) bypass the Rule #38 wide-spec gate
- source: legacy:27.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Ambiguous design call (strengthen the gate vs document the escape hatch), OS-touching, documented example *.mac is intentional; contested call closed rather than silently picked.
- 2026-10-14T10:47:52Z status=wontfix-accepted owner=27-0-profile-client-and-documents-diff by=migration note=contested design call; the *.mac example; reopen_if=a whole-type env_diff scan times out or is misused in the field

### DW-183: [CR-27.0-2] resolveProfileClient establishment errors escape the tool's own error envelope in env-diff.ts
- source: legacy:27.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: env-diff.ts:1088-1097 already catches IrisApiError in the resolve-phase and returns the tool envelope; passing test cites CR 27.0-2; ledger bookkeeping gap.
- 2026-10-14T10:47:52Z status=resolved-by:unknown owner=27-0-profile-client-and-documents-diff by=migration note=env-diff.ts:1088-1097 already catches IrisApiError in the resolve-phase and returns the tool envelope

### DW-184: [CR-27.0-3] Omitting namespace silently compares each profile's (possibly different) default namespace and the report hides it
- source: legacy:27.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: env-diff now echoes each profile's resolved namespace; per-profile routing proven live (HSCUSTOM/SADEMO).
- 2026-10-14T10:47:52Z status=resolved-by:27-0-profile-client-and-documents-diff owner=27-0-profile-client-and-documents-diff by=migration note=env-diff now echoes each profile's resolved namespace; per-profile routing proven live (HSCUSTOM/SADEMO).

### DW-185: [CR-27.0-4] A single unreadable/deleted document aborts the entire env diff (ComputeHashes quits on any HashDoc error)
- source: legacy:27.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: ComputeHashes (:174-175) quits the whole loop on a HashDoc error; fail-loud is acceptable with no correctness impact.
- 2026-10-14T10:47:52Z status=wontfix-accepted owner=27-0-profile-client-and-documents-diff by=migration note=fail-loud is acceptable with no correctness; reopen_if=a routine env_diff fails because one document vanishes mid-scan

### DW-186: [CR-27.0-5] Explicit namespace:'' bypasses the never-blank guarantee of the CR 27.0-3 fix (nullish coalescing)
- source: legacy:27.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: env-diff.ts:1108 input.namespace?.trim() || undefined already coerces blank; passing test 'CR 27.0-5' green; ledger bookkeeping gap.
- 2026-10-14T10:47:52Z status=resolved-by:unknown owner=27-0-profile-client-and-documents-diff by=migration note=env-diff.ts:1108 input.namespace?.trim() || undefined already coerces blank; passing test 'CR 27.0-5' green

### DW-187: [L27.4-hscustom-sademo-share-code-databases] ENV: on this dev instance HSCUSTOM and SADEMO SHARE code databases so documents-domain drift
- source: legacy:27.0 | severity: high | fix-risk: med | footprint: out-of-footprint
- evidence: Story 27.4 capstone seeded drift through namespace-scoped domains (mappings), option (a) of the finding; see 34-4-R9 evidence of the clean capstone re-run.
- 2026-10-14T10:47:52Z status=resolved-by:27-4-env-docs-and-capstone-smokes owner=27-0-profile-client-and-documents-diff by=migration note=Story 27.4 capstone seeded drift through namespace-scoped domains (mappings), option (a) of the finding

### DW-188: [CR-27.0-6] EnvSync.cls SwitchNamespace-failure error text is truncated (empty tail, bad namespace not named)
- source: legacy:27.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Failure path (:82-87) renders a sanitized envelope without the target namespace or root cause; guard works and mutates nothing; only the diagnostic is thin.
- 2026-10-14T10:47:52Z status=wontfix-accepted owner=27-0-profile-client-and-documents-diff by=migration note=the guard works and mutates nothing; reopen_if=a user cannot diagnose a failed namespace switch from the error text

### DW-189: [CR-27.1-2] Credential name list narrower than the real interop credential surface (isCredentialSetting matches only password|secret|key)
- source: legacy:27.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: SDS rows carrying Token/AccessToken/Passphrase/Pwd/Credential names slipped past the redaction regex; widened in rework cycle 2.
- 2026-10-14T10:47:52Z status=resolved-by:27-1-diff-domains-and-redaction owner=27-1-diff-domains-and-redaction by=migration note=SDS rows carrying Token/AccessToken/Passphrase/Pwd/Credential names slipped past the redaction regex

### DW-190: [CR-27.1-3] No per-domain error isolation: one subsystem-absent namespace fails the WHOLE env diff
- source: legacy:27.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Five domain blocks shared one try/catch; per-domain isolation added and re-smoke-confirmed live.
- 2026-10-14T10:47:52Z status=resolved-by:27-1-diff-domains-and-redaction owner=27-1-diff-domains-and-redaction by=migration note=Five domain blocks shared one try/catch; per-domain isolation added and re-smoke-confirmed live.

### DW-191: [CR-27.1-4] Unguarded response.result in fetchConfig and fetchDefaultSettings (siblings use ?? [])
- source: legacy:27.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Guarded with response.result?... ?? empty; +2 regression tests; mutation-verified.
- 2026-10-14T10:47:52Z status=resolved-by:29-3-deferred-work-burndown owner=27-1-diff-domains-and-redaction by=migration note=Guarded with response.result?... ?? empty; +2 regression tests; mutation-verified.

### DW-192: [CR-27.1-5] defaultSettings diff compares only value; a deployable/description flip reads as identical
- source: legacy:27.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Spec Task 2 defines the compared value as value - spec-faithful by design; widening is a scope decision, not a bug fix.
- 2026-10-14T10:47:52Z status=by-design owner=27-1-diff-domains-and-redaction by=migration note=Spec Task 2 defines the compared value as value - spec-faithful by design

### DW-193: [CR-27.1-7] A mapping row missing database yields MappingValue.database undefined against a non-optional string (type-lie, spurious differs)
- source: legacy:27.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: MappingEntry/MappingValue.database made optional; mappingValuesEqual normalizes missing to ''; +2 regression tests, mutation-verified.
- 2026-10-14T10:47:52Z status=resolved-by:29-3-deferred-work-burndown owner=27-1-diff-domains-and-redaction by=migration note=MappingEntry/MappingValue.database made optional; mappingValuesEqual normalizes missing to ''

### DW-194: [CR-27.1-8] Promise.all mixed-rejection non-determinism: a genuine TypeError can be masked by an IrisApiError from the other side
- source: legacy:27.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: No unhandledRejection risk; residual is a rare simultaneous dual-failure edge; Promise.allSettled refactor is a larger structural change deferred as by-design.
- 2026-10-14T10:47:52Z status=wontfix-accepted owner=27-1-diff-domains-and-redaction by=migration note=reopen_if=a genuine TypeError is observed masked by an IrisApiError in an env_diff run

### DW-195: [CR-27.1-9] Raw-args domains:[] yields a vacuous '0 drifted, 0 identical' all-clear
- source: legacy:27.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: input.domains?.length ? input.domains : DEFAULT; +1 regression test, mutation-verified.
- 2026-10-14T10:47:52Z status=resolved-by:29-3-deferred-work-burndown owner=27-1-diff-domains-and-redaction by=migration note=input.domains?.length ? input.domains : DEFAULT; +1 regression test, mutation-verified.

### DW-196: [CR-27.1-10] config onlyInTarget text render omits the 'informational - NOT a deletion signal' annotation the other four domains carry
- source: legacy:27.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Annotation added to renderConfigSection; +1 regression test, mutation-verified.
- 2026-10-14T10:47:52Z status=resolved-by:29-3-deferred-work-burndown owner=27-1-diff-domains-and-redaction by=migration note=Annotation added to renderConfigSection; +1 regression test, mutation-verified.

### DW-197: [CR-27.1-11] env-diff domains run sequentially, not concurrently (latency)
- source: legacy:27.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: By-design: sequential order makes abort ordering deterministic in tests; concurrency is a latency optimization, not a correctness fix.
- 2026-10-14T10:47:52Z status=by-design owner=27-1-diff-domains-and-redaction by=migration note=By-design: sequential order makes abort ordering deterministic in tests

### DW-198: [CR-27.1-12] Within-mappings partial failure discards the succeeded types (3-way Promise.all)
- source: legacy:27.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Rare path; Promise.allSettled + merge is a structural change with its own test surface, disproportionate for an additive burn-down.
- 2026-10-14T10:47:52Z status=wontfix-accepted owner=27-1-diff-domains-and-redaction by=migration note=reopen_if=a mappings domain is reported errored although two of three mapping types fetched fine

### DW-199: [CR-27.2-1] computePlanHash can throw on BigInt/circular input; the plan handler has no try/catch
- source: legacy:27.2 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Unreachable for plan over the JSON MCP transport; relevant if execute re-derives the hash from an in-process object.
- 2026-10-14T10:47:52Z status=routed owner=burndown by=migration note=Unreachable for plan over the JSON MCP transport; relevant if execute re-derives the hash from an in-process object.
- 2026-10-15T11:47:32Z status=wontfix-theoretical by=x0 note=computePlanHash input arrives as JSON-RPC args (env-promote.ts:1031,1479), which cannot carry BigInt or cycles; real only if execute re-derived the hash from an in-process object

### DW-200: [CR-27.2-2] source/target params advisory for plan: a mismatch vs the diff's own profile refs is silently resolved in favor of the diff
- source: legacy:27.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: executeAction refuses before any write when the diff's own source/target profile ref mismatches the caller's args; regression test added.
- 2026-10-14T10:47:52Z status=resolved-by:27-3-promote-execute owner=27-2-promote-plan by=migration note=executeAction refuses before any write when the diff's own source/target profile ref mismatches the caller's args

### DW-201: [CR-27.3-1] documents batch under-reports an applied doc as skipped after an earlier compile/put failure
- source: legacy:27.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Deliberate, documented, tested dev choice that errs conservative; a re-run is idempotent; spec-conformant by design.
- 2026-10-14T10:47:52Z status=by-design owner=27-3-promote-execute by=migration note=Deliberate, documented, tested dev choice that errs conservative; a re-run is idempotent; spec-conformant by design.

### DW-202: [CR-27.3-2] updateMapping delete+create is non-atomic (no rollback if create fails after delete)
- source: legacy:27.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Inherent IRIS-API constraint (Config.cls has no update op; mirrors iris_mapping_manage); gated by a source re-fetch so only a mapping the source also has is replaced.
- 2026-10-14T10:47:52Z status=by-design owner=27-3-promote-execute by=migration note=Inherent IRIS-API constraint (Config.cls has no update op; mirrors iris_mapping_manage)

### DW-203: [CR-27.3-3] webapps plan detail says create but the dispatched op is modify
- source: legacy:27.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Spec-faithful (feature spec line 109 states webapp modify) and deliberately tested; whether promoting a NEW webapp belongs in v1 is a lead scope call.
- 2026-10-14T10:47:52Z status=by-design owner=27-3-promote-execute by=migration note=Spec-faithful (feature spec line 109 states webapp modify) and deliberately tested

### DW-204: [CR-27.3-4] Empty configured namespace yields a misattributing per-step error in promote execute
- source: legacy:27.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Refuse-before-any-write guard on srcNs/targetNs === '' in executeAction; +3 regression tests, mutation-verified.
- 2026-10-14T10:47:52Z status=resolved-by:29-3-deferred-work-burndown owner=27-3-promote-execute by=migration note=Refuse-before-any-write guard on srcNs/targetNs === '' in executeAction; +3 regression tests, mutation-verified.

### DW-205: [CR-27.4-1] docs/migration-v1-v2.md states '100 tools' (suite is 104)
- source: legacy:27.4 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Both occurrences changed to 104 tools; +1 mechanical regression test in docs-prompt-sync.test.ts, mutation-verified.
- 2026-10-14T10:47:52Z status=resolved-by:29-3-deferred-work-burndown owner=27-4-env-docs-and-capstone-smokes by=migration note=Both occurrences changed to 104 tools; +1 mechanical regression test in docs-prompt-sync.test.ts, mutation-verified.

### DW-206: [CR-28.0-1] parsePlanIndexes() conflates temp-file tokens with real index names (unused-index heuristic hazard)
- source: legacy:28.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: unused-index compares fully-qualified schema.table.indexName tokens while a temp-file token is a bare label; they cannot collide; changing the shared regex would break the Rule #19 snapshot.
- 2026-10-14T10:47:52Z status=wontfix-theoretical owner=28-0-advisor-probe-matrix by=migration note=qualified vs bare index tokens never collide; real_if=unused-index starts comparing bare index-name tokens

### DW-207: [CR-28.0-2] AC 28.0.1 subquery strategy not separately captured (inferred, not reference-captured)
- source: legacy:28.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Live-captured a correlated IN-subquery plan as Fixture 9 plus a test; index map line recognized so unused-index correctly does not fire.
- 2026-10-14T10:47:52Z status=resolved-by:29-3-deferred-work-burndown owner=28-0-advisor-probe-matrix by=migration note=Live-captured a correlated IN-subquery plan as Fixture 9 plus a test

### DW-208: [CR-28.1-1] ResolveClassForTable bare Catch masks a genuine dictionary-query failure as 'table not found' (SqlAdvisor.cls)
- source: legacy:28.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Not an active defect on pinned IRIS 2026.1 (dictionary resolve live-verified); failure is a hypothetical future dictionary-column rename; a bootstrap bump is disproportionate.
- 2026-10-14T10:47:52Z status=wontfix-theoretical owner=28-1-advise-data-endpoint by=migration note=real_if=a future IRIS version changes the %Dictionary.CompiledClass columns used by ResolveClassForTable

### DW-209: [CR-28.1-2] ExtractTables returns zero tables for a bitmap/bitslice-only plan (only master/index-map markers recognized)
- source: legacy:28.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Only 'Read master map'/'Read index map' recognized; graceful (verbatim plan still returned); needs a live bitmap-plan capture to fix responsibly.
- 2026-10-14T10:47:52Z status=wontfix-accepted owner=28-1-advise-data-endpoint by=migration note=reopen_if=a bitmap-only plan advise call is reported returning empty tables for a real table

### DW-210: [CR-28.1-3] ExtractTables mis-splits/never-resolves delimited/quoted/schema-less plan tokens
- source: legacy:28.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: No live evidence IRIS 2026.1 emits these forms for normal persistent-class tables; graceful, no crash.
- 2026-10-14T10:47:52Z status=wontfix-theoretical owner=28-1-advise-data-endpoint by=migration note=real_if=IRIS emits delimited, quoted or schema-less map tokens for persistent-class tables

### DW-211: [CR-28.1-4] Whitespace-only namespace drives a switch failure instead of defaulting to current (AdviseData)
- source: legacy:28.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: AdviseData tNamespace is not ZStrip-ped; clean error (no crash) and matches sibling EnvSync.cls behavior.
- 2026-10-14T10:47:52Z status=wontfix-accepted owner=28-1-advise-data-endpoint by=migration note=reopen_if=a client sends a whitespace-only namespace and expects the current namespace

### DW-212: [CR-28.2-1] Multi-table JOIN: plan-global predicate attribution + duplicate self-join findings in the advisor
- source: legacy:28.2 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Not a defect for the single-table queries targeted today (all 9 fixtures single-table); real fix needs a live 2-table plan capture and a predicate-to-scan rework.
- 2026-10-14T10:47:52Z status=wontfix-accepted owner=28-2-heuristic-engine by=migration note=reopen_if=advise on a multi-table join plan misattributes full-scan or missing-index findings

### DW-213: [CR-28.2-2] missing-index confidence is plan-order-dependent for a column carrying both = and a range op
- source: legacy:28.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: missingPredicates.every(p => p.op === '=') makes confidence deterministic; +2 order-swapped regression tests.
- 2026-10-14T10:47:52Z status=resolved-by:29-3-deferred-work-burndown owner=28-2-heuristic-engine by=migration note=missingPredicates.every(p => p.op === '=') makes confidence deterministic; +2 order-swapped regression tests.

### DW-214: [CR-28.2-3] isSystemSchema INFORMATION_SCHEMA branch untested at the missing-index suppression point
- source: legacy:28.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Closed via the live-captured INFORMATION_SCHEMA fixture asserting missing-index/unused-index do not fire.
- 2026-10-14T10:47:52Z status=resolved-by:29-3-deferred-work-burndown owner=28-2-heuristic-engine by=migration note=Closed via the live-captured INFORMATION_SCHEMA fixture asserting missing-index/unused-index do not fire.

### DW-215: [CR-28.2-4] FULL_SCAN_RE under-detects master-map scans that loop on a composite/non-ID idkey (false negative)
- source: legacy:28.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Live-captured the false-negative plan; widened FULL_SCAN_RE looping clause to tolerate composite key columns; new fixture.
- 2026-10-14T10:47:52Z status=resolved-by:29-3-deferred-work-burndown owner=28-2-heuristic-engine by=migration note=Live-captured the false-negative plan; widened FULL_SCAN_RE looping clause to tolerate composite key columns

### DW-216: [CR-28.3-1] query-mode 'malformed SQL isError' test scenario and Dev-Notes claim contradict the live-captured endpoint behavior
- source: legacy:28.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Test renamed to describe the transport-level IrisApiError path; query fixture changed; the story's Dev Agent Record claim corrected.
- 2026-10-14T10:47:52Z status=resolved-by:29-3-deferred-work-burndown owner=28-3-advise-tool-docs-smokes by=migration note=Test renamed to describe the transport-level IrisApiError path; query fixture changed

### DW-217: [CR-28.3-2] Workload total-outage (every per-statement call an IrisApiError) renders a benign 'no findings'
- source: legacy:28.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: errorCount tracked; rows>0 && analyzed==0 && errorCount>0 returns isError naming the outage; partial failures and all-blank sets unaffected (tested).
- 2026-10-14T10:47:52Z status=resolved-by:29-3-deferred-work-burndown owner=28-3-advise-tool-docs-smokes by=migration note=errorCount tracked; rows>0 && analyzed==0 && errorCount>0 returns isError naming the outage

### DW-218: [CR-29.1-1] deriveAuditAction reads pre-Zod rawArgs.action so a future defaulted-action enum would log action:null while governance keys
- source: legacy:29.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Blanket .default() ban rejected (deliberately supported shape); added actionFieldHasDefault helper and a cross-package pin in iris-mcp-all; mutation-verified.
- 2026-10-14T10:47:52Z status=resolved-by:29-3-deferred-work-burndown owner=29-1-audit-outcome-fidelity by=migration note=Blanket .default() ban rejected (deliberately supported shape); added actionFieldHasDefault helper

### DW-219: [30-0-1] addTools() dynamic-add bypasses named-preset roster curation (runtime-added tool defaults to visible under core/developer)
- source: legacy:30.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: addTools has ZERO production callers (grep 2026-07-26); default-visible fallback is the spec 2.2 documented cascade; assertPresetCoverage forbids the real risk; decision recorded in addTools doc comment.
- 2026-10-14T10:47:52Z status=by-design owner=30-0-visibility-engine by=migration note=addTools has ZERO production callers (grep 2026-07-26); default-visible fallback is the spec 2.2 documented cascade

### DW-220: [30-0-2] A named preset against a package with UNWIRED rosters is a silent no-op (log reports hidden=0, no warning)
- source: legacy:30.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Finding was scoped to the 30.0-30.1 window; all 5 server packages now ship src/tools/presets.ts and wire toolPresets (verified mechanically); condition unreachable for shipped packages.
- 2026-10-14T10:47:53Z status=wontfix-theoretical owner=30-0-visibility-engine by=migration note=all 5 packages now wire preset rosters; real_if=a server package ships without wired preset rosters

### DW-221: [30-0-3] AC 30.0.4 back-compat capstone snapshot is transcribed from spec 2.5, not source-derived from the leaf tools arrays
- source: legacy:30.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Snapshot single-sourced into pre-feature-tool-snapshot.ts; new cross-package drift gate tool-visibility-snapshot-drift.test.ts deep-equals each package's live built-dist tools; mutation-verified.
- 2026-10-14T10:47:53Z status=resolved-by:32-3-deferred-work-burn-down owner=30-0-visibility-engine by=migration note=Snapshot single-sourced into pre-feature-tool-snapshot.ts; new cross-package drift gate

### DW-222: [30-0-4] Spec 2.2 'config hiding EVERY package tool => startup warning' not implemented in resolveVisibleTools
- source: legacy:30.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Warning added at server-base construction; 4 tests in tool-visibility.test.ts; red-green cycle.
- 2026-10-14T10:47:53Z status=resolved-by:32-3-deferred-work-burn-down owner=30-0-visibility-engine by=migration note=Warning added at server-base construction; 4 tests in tool-visibility.test.ts; red-green cycle.

### DW-223: [30-2-1] 'No hidden name leaks' tests use substring not.toContain(hiddenName) and could false-FAIL if a hidden name is a substring
- source: legacy:30.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: New exact-match expectToolNameAbsent walker replaces 4 substring assertions; mutation-verified.
- 2026-10-14T10:47:53Z status=resolved-by:32-3-deferred-work-burn-down owner=30-2-surfacing-and-measurement by=migration note=New exact-match expectToolNameAbsent walker replaces 4 substring assertions; mutation-verified.

### DW-224: [CR-30.3-MED-2] Blind Hunter claim that the admin core prompt-pack note omits iris_role_list
- source: legacy:30.3 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Verified against source: iris_role_list is in admin core include (presets.ts:32); the note is accurate.
- 2026-10-14T10:47:53Z status=dropped owner=30-3-visibility-docs-and-smokes by=migration note=invalid: false positive, verified against source

### DW-225: [CR-30.3-LOW-5] #2.5 appears in a link's display text while the href targets the spec file
- source: legacy:30.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Not a broken link; standard section-reference style.
- 2026-10-14T10:47:53Z status=by-design owner=30-3-visibility-docs-and-smokes by=migration note=Not a broken link; standard section-reference style.

### DW-226: [L30.retro-ai1-rebuild-reload-mcp-servers] Epic 30 retro action #1: rebuild + reload running MCP servers so tool visibility
- source: legacy:30.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Running iris-dev-mcp iris_server_profiles returns toolVisibility {preset:full, visibleTools:29, hiddenTools:0} and lists iris_sql_analyze:advise - the reload has happened.
- 2026-10-14T10:47:53Z status=dropped owner=30-0-visibility-engine by=migration note=operational: verified live, not pipeline work

### DW-227: [L30.retro-ai2-review-spawn-read-layer-output-files] Epic 30 retro action #2: pre-instruct the code-review spawn to read its layers'
- source: legacy:30.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Folded into every Epic 31 /bmad-code-review spawn prompt as an explicit directive; process change only, no code or story.
- 2026-10-14T10:47:53Z status=resolved-by:unknown owner=30-0-visibility-engine by=migration note=Folded into every Epic 31 /bmad-code-review spawn prompt as an explicit directive

### DW-228: [L30.retro-ai3-consider-deferred-v1-items-at-next-seeding] Epic 30 retro action #3: consider deferred v1 out-of-scope items
- source: legacy:30.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Epics 31-33 were seeded on a different axis; none of the candidates was selected; they stay recorded in the Epic 30 retro section 6.
- 2026-10-14T10:47:53Z status=wontfix-accepted owner=30-0-visibility-engine by=migration note=reopen_if=a future epic seeding selects per-action visibility, runtime toggling

### DW-229: [31-0-1] Unresolved (password-less) higher-precedence entry shadows a resolvable same-named entry in a lower-precedence file
- source: legacy:31.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: 31.1 chose the rescue option (a later lower-precedence entry may claim a claimed-but-unresolved slot only if it resolves); two two-file fixture tests added; review corrected a whole-definition replacement.
- 2026-10-14T10:47:53Z status=resolved-by:31-1-credential-chain owner=31-0-settings-discovery by=migration note=31.1 chose the rescue option

### DW-230: [31-0-2] smBase clears only password; username inherited from local default config (mismatched pair can lock out the remote account)
- source: legacy:31.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: 31.1 chose treat-as-unresolved; review found the chain re-paired the local username with a remote password, so the entry is now not imported at all.
- 2026-10-14T10:47:53Z status=resolved-by:31-1-credential-chain owner=31-0-settings-discovery by=migration note=31.1 chose treat-as-unresolved; review found the chain re-paired the local username with a remote password

### DW-231: [31-0-3] In auto mode the workspace candidate defaults to process CWD (chosen by the MCP client)
- source: legacy:31.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: New sourceFile on IrisProfile set where the winning definition is chosen, surfaced via the roster allow-list; pinned by a discriminating assertion. The CWD-opt-in half moved to 31-3-9.
- 2026-10-14T10:47:53Z status=resolved-by:31-3-registry-integration owner=31-0-settings-discovery by=migration note=New sourceFile on IrisProfile set where the winning definition is chosen, surfaced via the roster allow-list

### DW-232: [31-0-4] pathPrefix applied as post-merge baseUrl suffix only, so baseUrl === deriveBaseUrl(host,port,https) no longer holds
- source: legacy:31.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: pathPrefix is a structured optional field and baseUrl is derived in one place; deriveBaseUrl byte-unchanged so env profiles unaffected (Rule #19).
- 2026-10-14T10:47:53Z status=resolved-by:31-3-registry-integration owner=31-0-settings-discovery by=migration note=pathPrefix is a structured optional field and baseUrl is derived in one place

### DW-233: [31-0-5] normalizePathPrefix does not reject a prefix containing ?, # or embedded // (e.g. ?debug=1 swallows the path)
- source: legacy:31.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: isInvalidPathPrefix in server-manager-source.ts warns naming file+server+value and IGNORES the prefix; 5 new normalization rows; red-green.
- 2026-10-14T10:47:53Z status=resolved-by:32-3-deferred-work-burn-down owner=31-0-settings-discovery by=migration note=isInvalidPathPrefix in server-manager-source.ts warns naming file+server+value and IGNORES the prefix

### DW-234: [31-1-1] IRIS_SERVER_MANAGER=required silently succeeds with ZERO imported servers when every definition is structurally invalid
- source: legacy:31.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Third required check (results.length === 0) positioned after the two existing checks; verified it fires on the reproduced defect (sole port:not-a-port definition).
- 2026-10-14T10:47:53Z status=resolved-by:31-3-registry-integration owner=31-1-credential-chain by=migration note=Third required check (results.length === 0) positioned after the two existing checks

### DW-235: [31-1-2] The 31-0-1 rescue may change the connection TARGET: a lower-precedence entry with a deprecated inline password replaces
- source: legacy:31.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: First-file-wins: rescue REMOVED; a password-bearing skipped lower-precedence definition warns naming both hosts; 2 rescue tests rewritten.
- 2026-10-14T10:47:53Z status=resolved-by:32-3-deferred-work-burn-down owner=31-1-credential-chain by=migration note=First-file-wins: rescue REMOVED; a password-bearing skipped lower-precedence definition warns naming both hosts

### DW-236: [31-1-3] No aggregate startup budget for the credential helper: spawnSync blocks the event loop up to 10s per password-less profile
- source: legacy:31.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Per-link 10s timeout is AC-mandated, helper link only runs for opted-in operators, IRIS_SM_SERVERS narrows, credentials test validates a helper; cost documented in shared README.
- 2026-10-14T10:47:53Z status=wontfix-accepted owner=31-1-credential-chain by=migration note=reopen_if=an operator reports a startup stall caused by an unreachable credential helper

### DW-237: [31-1-4] AC 31.1.1 says helper receives server name as argv[1]; implementation appends it as the FINAL argv entry
- source: legacy:31.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: AC 31.1.1 amended in place in epics.md with a dated parenthetical: name appended as FINAL argv entry (argv[1] for a single-token command). Docs-only.
- 2026-10-14T10:47:53Z status=resolved-by:31-3-registry-integration owner=31-1-credential-chain by=migration note=AC 31.1.1 amended in place in epics.md with a dated parenthetical: name appended as FINAL argv entry

### DW-238: [31-1-5] Debug line 'N profile(s) have no password yet' over-counts entries later discarded by the registry shadow filter
- source: legacy:31.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Summary moved to loadProfileRegistry post collision-filter; source-module line deleted; profiles.test.ts pins shadowed names are not counted.
- 2026-10-14T10:47:53Z status=resolved-by:32-3-deferred-work-burn-down owner=31-1-credential-chain by=migration note=Summary moved to loadProfileRegistry post collision-filter; source-module line deleted

### DW-239: [31-2-1] credentials test --connect validates the registry's password, not the credential the chain just resolved
- source: legacy:31.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: connect.credentialSource names the probed registry profile's provenance; fixture where chain and registry disagree; mutation cycle.
- 2026-10-14T10:47:53Z status=resolved-by:32-3-deferred-work-burn-down owner=31-2-credentials-cli by=migration note=connect.credentialSource names the probed registry profile's provenance; fixture where chain and registry disagree

### DW-240: [31-2-2] redactSecret matches only the plaintext substring, not the base64 Authorization: Basic form
- source: legacy:31.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: IrisConnectionError/IrisApiError carry no request headers today so no error shape can embed base64(user:pass); add encoded variants when http-client error shape changes.
- 2026-10-14T10:47:53Z status=wontfix-theoretical owner=31-2-credentials-cli by=migration note=errors carry no request headers today; real_if=http-client.ts errors start carrying request headers

### DW-241: [31-2-3] test --connect reports attempted:false/ok:false indistinguishably for 'probe failed' vs 'probe never ran'
- source: legacy:31.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: ok is boolean|null (null when the probe never ran); attempted reflects the real stage; 3 payload assertions updated; 9 CLI tests red against pre-fix.
- 2026-10-14T10:47:53Z status=resolved-by:32-3-deferred-work-burn-down owner=31-2-credentials-cli by=migration note=ok is boolean|null (null when the probe never ran); attempted reflects the real stage; 3 payload assertions updated

### DW-242: [31-2-4] credentials set prints the same message whether it created or silently replaced an existing password
- source: legacy:31.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: KeyringPort.exists(account) boolean-only plus 'Replaced the existing password for' message; fresh-vs-replace fixture.
- 2026-10-14T10:47:53Z status=resolved-by:32-3-deferred-work-burn-down owner=31-2-credentials-cli by=migration note=KeyringPort.exists(account) boolean-only plus 'Replaced the existing password for' message; fresh-vs-replace fixture.

### DW-243: [31-2-5] readStdinPassword accumulates the whole stream with no size cap (misdirected pipe is an unbounded allocation)
- source: legacy:31.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: 64 KiB cap; over-cap fails exit 2 naming the cap; keyring never written; 70 KiB rejected, 64 KiB accepted fixtures.
- 2026-10-14T10:47:53Z status=resolved-by:32-3-deferred-work-burn-down owner=31-2-credentials-cli by=migration note=64 KiB cap; over-cap fails exit 2 naming the cap; keyring never written; 70 KiB rejected, 64 KiB accepted fixtures.

### DW-244: [31-2-6] --stdin decodes bytes as UTF-8 unconditionally; a UTF-16LE file is stored NUL-interleaved
- source: legacy:31.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Decoded input containing U+0000 is REJECTED (exit 2 naming UTF-16); UTF-16LE fixtures with and without BOM; mutation cycle.
- 2026-10-14T10:47:53Z status=resolved-by:32-3-deferred-work-burn-down owner=31-2-credentials-cli by=migration note=Decoded input containing U+0000 is REJECTED (exit 2 naming UTF-16); UTF-16LE fixtures with and without BOM

### DW-245: [31-3-1] IRIS_SERVER_MANAGER=required starts with ZERO Server-Manager profiles when every definition is discarded by a name collision
- source: legacy:31.3 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: loadProfileRegistry throws under required when every SM definition was collision-discarded; AC 31.0.3 amended in epics.md; fixtures for reserved-default collision and partial survival.
- 2026-10-14T10:47:53Z status=resolved-by:32-3-deferred-work-burn-down owner=31-3-registry-integration by=migration note=loadProfileRegistry throws under required when every SM definition was collision-discarded

### DW-246: [31-3-2] Structurally-unusable intersystems.servers entries are dropped silently in parseIntersystemsServers before definitionsFound++
- source: legacy:31.3 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: parseIntersystemsServers gains {fileLabel, dropped}: one warn per dropped entry, drops counted so required check 3 fires; fixtures per drop reason.
- 2026-10-14T10:47:53Z status=resolved-by:32-3-deferred-work-burn-down owner=31-3-registry-integration by=migration note=parseIntersystemsServers gains {fileLabel, dropped}: one warn per dropped entry

### DW-247: [31-3-3] A name marked terminally 'invalid' on first sighting is never reconsidered; a valid lower-precedence definition is never examined
- source: legacy:31.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Terminal-invalid kept as deliberate design; required check-3 message now says a rejected name is NOT reconsidered in lower-precedence files; fixture pins it.
- 2026-10-14T10:47:53Z status=resolved-by:32-3-deferred-work-burn-down owner=31-3-registry-integration by=migration note=Terminal-invalid kept as deliberate design; required check-3 message now says a rejected name is NOT reconsidered

### DW-248: [31-3-4] sourceFile is a real local path returned to the MCP client, disclosing the OS account name / workspace directory
- source: legacy:31.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Keep the full path (a basename is useless - every candidate is settings.json); non-credential, documented, never reaches the audit log; add a degrading opt-out only if a user asks.
- 2026-10-14T10:47:53Z status=wontfix-accepted owner=31-3-registry-integration by=migration note=full path kept (a basename would be useless); reopen_if=a user asks for an opt-out that degrades the sourceFile path

### DW-249: [31-3-5] sourceFile is relative when the operator supplies a relative IRIS_SM_SETTINGS_PATHS entry or IRIS_SM_WORKSPACE (no path.resolve)
- source: legacy:31.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: discoverSettingsFiles resolves every candidate to absolute; 3 new tests; exact-list pins unaffected.
- 2026-10-14T10:47:53Z status=resolved-by:32-3-deferred-work-burn-down owner=31-3-registry-integration by=migration note=discoverSettingsFiles resolves every candidate to absolute; 3 new tests; exact-list pins unaffected.

### DW-250: [31-3-6] IRIS_SM_SERVERS set to a value that trims to empty means import ALL (indistinguishable from unset)
- source: legacy:31.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Set-but-empty == unset, matching the suite-wide empty-string convention (IRIS_PROFILES='' also absent); documented in shared README env table.
- 2026-10-14T10:47:53Z status=by-design owner=31-3-registry-integration by=migration note=Set-but-empty == unset, matching the suite-wide empty-string convention (IRIS_PROFILES='' also absent)

### DW-251: [31-3-7] webServer.host containing URL userinfo (admin:hunter2@host) is accepted and lands verbatim in baseUrl
- source: legacy:31.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: mergeProfile rejects @, / and whitespace in host without echoing the value; 5 hostile IRIS_PROFILES hosts + userinfo SM fixture; Rule #19 gate re-proven.
- 2026-10-14T10:47:53Z status=resolved-by:32-3-deferred-work-burn-down owner=31-3-registry-integration by=migration note=mergeProfile rejects @, / and whitespace in host without echoing the value

### DW-252: [31-3-8] Epic 31 capstone is a one-time human-run artifact: smoke script deleted, no raw log retained
- source: legacy:31.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: New keychain-free process-level gate server-manager-process-gate.test.ts spawns the BUILT iris-dev-mcp with a real settings fixture; ran live against IRIS; mutation-verified.
- 2026-10-14T10:47:53Z status=resolved-by:32-3-deferred-work-burn-down owner=31-3-registry-integration by=migration note=New keychain-free process-level gate server-manager-process-gate.test.ts spawns the BUILT iris-dev-mcp with a real

### DW-253: [31-3-9] packages/shared/README.md has zero mentions of IRIS_SERVER_MANAGER, IRIS_CREDENTIAL_HELPER or the credentials CLI
- source: legacy:31.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: New shared README section with all 5 env vars and defaults; CWD-opt-in recorded as architecture decision J1 in architecture.md.
- 2026-10-14T10:47:53Z status=resolved-by:32-3-deferred-work-burn-down owner=31-3-registry-integration by=migration note=New shared README section with all 5 env vars and defaults; CWD-opt-in recorded as architecture decision J1

### DW-254: [31-4-1] Concurrent resolveEnvForLabel calls are not coalesced: cold start can stack multiple modal credential prompts for the same server
- source: legacy:31.4 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: In-flight promise cache keyed by server name evicted on settle; 5 parallel resolves call getSession once; stacking case not exercised in the GUI smoke so the fix stands on the unit test.
- 2026-10-14T10:47:53Z status=resolved-by:32-3-deferred-work-burn-down owner=31-4-broker-extension by=migration note=In-flight promise cache keyed by server name evicted on settle; 5 parallel resolves call getSession once

### DW-255: [31-4-2] Launcher extension has no refresh mechanism
- source: legacy:31.4 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Keep reload semantics: AC 31.5.6 deliberately specifies them; limitation documented in extension README/CHANGELOG; a future refresh story would amend the AC first.
- 2026-10-14T10:47:53Z status=by-design owner=31-4-broker-extension by=migration note=Keep reload semantics: AC 31.5.6 deliberately specifies them; limitation documented in extension README/CHANGELOG

### DW-256: [31-4-3] Launcher synthesizes and passes through an EMPTY username when the spec has none
- source: legacy:31.4 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Decision (a) refuse-with-message: status no-username on both branches with a warning naming the server and the Server Manager username field; per-branch tests; mutation-verified.
- 2026-10-14T10:47:53Z status=resolved-by:32-3-deferred-work-burn-down owner=31-4-broker-extension by=migration note=Decision (a) refuse-with-message: status no-username on both branches with a warning naming the server and the Server

### DW-257: [31-4-4] Under combineProfiles a Server Manager server named 'default' is emitted as an IRIS_PROFILES key that overrides the reserved
- source: legacy:31.4 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: resolveEnvForLabel warns ONCE naming the reserved shadowing and the rename remedy; deliberately not auto-renamed; tests incl. no warning in single-profile mode.
- 2026-10-14T10:47:53Z status=resolved-by:32-3-deferred-work-burn-down owner=31-4-broker-extension by=migration note=resolveEnvForLabel warns ONCE naming the reserved shadowing and the rename remedy; deliberately not auto-renamed

### DW-258: [31-4-5] Authentication scope array [serverName, spec.username ?? ''] may miss a session cached under the real username (re-prompting)
- source: legacy:31.4 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Scope semantics are provider-specific and not determinable from @types/vscode; GUI smoke exercised only specs WITH usernames; matches the mandated reference implementation verbatim.
- 2026-10-14T10:47:53Z status=wontfix-accepted owner=31-4-broker-extension by=migration note=reopen_if=a no-username Server Manager server re-prompts for credentials after an MCP server restart

### DW-259: [31-4-6] CancellationToken is ignored in both provider methods; extension keeps prompting servers 3..N after cancel
- source: legacy:31.4 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Token threaded into resolveEnvForLabel and checked at each multi-server loop top returning undefined silently; cancelled token => 0 getSession calls; mutation-verified.
- 2026-10-14T10:47:53Z status=resolved-by:32-3-deferred-work-burn-down owner=31-4-broker-extension by=migration note=Token threaded into resolveEnvForLabel and checked at each multi-server loop top returning undefined silently

### DW-260: [31-4-7] Launcher definition sets no cwd and spawns npx -y @iris-mcp/<pkg> unpinned (local node_modules can shadow; latest always resolved)
- source: legacy:31.4 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Both halves are publish-coupled product decisions assigned to the end-of-Epic-32 merge gate with the @iris-mcp/* publish decision; minimum remediation named (neutral cwd + packageVersion setting).
- 2026-10-14T10:47:53Z status=wontfix-accepted owner=31-4-broker-extension by=migration note=reopen_if=the @iris-mcp/* publish decision is taken and the launcher spawns published packages
- 2026-10-15T02:51:51Z status=routed owner=42-1-pre-publish-package-fixes by=correct-course note=reopened - reopen_if fired: publish decided; D3 (decision-record-2026-10-14) major pin @1; neutral-cwd half probed in 42.1

### DW-261: [31-4-8] extension.exports cached without shape validation: a truthy-but-wrong Server Manager API is cached permanently
- source: legacy:31.4 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: getServerManagerApi duck-types the three methods before caching; mismatch => no cache plus a version-mismatch message; structural pin in packaging.test.ts; mutation-verified.
- 2026-10-14T10:47:54Z status=resolved-by:32-3-deferred-work-burn-down owner=31-4-broker-extension by=migration note=getServerManagerApi duck-types the three methods before caching; mismatch => no cache plus a version-mismatch

### DW-262: [31-4-9] AC 31.4.4 Copilot consumer hop (final hop inside Copilot's own UI) unverified; rest of the GUI smoke confirmed
- source: legacy:31.4 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Project Lead ran the six-step GUI smoke in real VS Code 1.128.0 (all six confirmed, commit b7a27a1); the Copilot-consumer hop remains a documented residual deferred to an external Copilot user.
- 2026-10-14T10:47:54Z status=wontfix-accepted owner=31-4-broker-extension by=migration note=six-step GUI smoke passed; reopen_if=a Copilot Chat user reports the iris-dev-mcp tool set is not listed

### DW-263: [31-5-1] no real-runtime (Extension-Host) test evidence for the launcher's user-facing UI surface (src/extension.ts imported by zero tests)
- source: legacy:31.5 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Compensating controls in place: the Project Lead's 6/6 GUI smoke in real VS Code and Story 31.6's localSpawnIntegration.test.ts (real child, real handshake, live IRIS); a dedicated Extension-Host story needs a new dev dependency.
- 2026-10-14T10:47:54Z status=wontfix-accepted owner=31-5-launcher-selection-ui by=migration note=reopen_if=an extension UI regression ships that the manual smoke and localSpawnIntegration miss

### DW-264: [31-5-2] Status bar count is the raw settings.servers.length, which can diverge from the number of MCP definitions actually registered
- source: legacy:31.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Decision: report the EFFECTIVE count via registeredServerCount(), fall back to raw when planning fails; divergence note 'N of M selected servers currently registered'; tests per branch.
- 2026-10-14T10:47:54Z status=resolved-by:32-3-deferred-work-burn-down owner=31-5-launcher-selection-ui by=migration note=Decision: report the EFFECTIVE count via registeredServerCount(), fall back to raw when planning fails

### DW-265: [31-5-3] Unchecking every item in the server picker writes [], which means 'expose ALL servers' (inverse of the gesture)
- source: legacy:31.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Decision: confirm-before-empty modal (confirmExposeAll) when unchecking everything from a non-empty selection; [] keeps meaning expose-all; tests per branch.
- 2026-10-14T10:47:54Z status=resolved-by:32-3-deferred-work-burn-down owner=31-5-launcher-selection-ui by=migration note=Decision: confirm-before-empty modal (confirmExposeAll) when unchecking everything from a non-empty selection

### DW-266: [31-5-4] onDidChangeMcpServerDefinitions is never supplied or fired, so a saved selection has no effect until reload
- source: legacy:31.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Same decision as 31-4-2: AC 31.5.6 deliberately specifies reload semantics; keeping them; documented.
- 2026-10-14T10:47:54Z status=by-design owner=31-5-launcher-selection-ui by=migration note=Same decision as 31-4-2: AC 31.5.6 deliberately specifies reload semantics; keeping them; documented.

### DW-267: [31-5-5] $(...) in Server Manager metadata renders as a theme icon in QuickPick rows
- source: legacy:31.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: VS Code source probe: iconLabels.ts honors a preceding backslash escape; escapeThemeIcons applied to label/description/detail while the raw name is written back; round-trip test.
- 2026-10-14T10:47:54Z status=resolved-by:32-3-deferred-work-burn-down owner=31-5-launcher-selection-ui by=migration note=VS Code source probe: iconLabels.ts honors a preceding backslash escape

### DW-268: [31-5-6] Both launcher source-file rosters (containment.test.ts, packaging.test.ts) are non-recursive readdirSync
- source: legacy:31.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: containment.test.ts and packaging.test.ts enumerate readdirSync recursive excluding __tests__; nested-file test; mutation-verified.
- 2026-10-14T10:47:54Z status=resolved-by:32-3-deferred-work-burn-down owner=31-5-launcher-selection-ui by=migration note=containment.test.ts and packaging.test.ts enumerate readdirSync recursive excluding __tests__; nested-file test

### DW-269: [31-6-1] The two new launcher warnings (stale 'all', developmentRepoPath) re-fire on every providePlannedDefinitions() call
- source: legacy:31.6 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: One warnedOnce dedupe set keyed by message text covers all three warnings plus the 31-4-4 warning; repeated-provide tests; mutation-verified.
- 2026-10-14T10:47:54Z status=resolved-by:32-3-deferred-work-burn-down owner=31-6-local-package-path by=migration note=One warnedOnce dedupe set keyed by message text covers all three warnings plus the 31-4-4 warning

### DW-270: [31-6-2] Synchronous fs validation (existsSync/statSync) blocks the VS Code extension host on a network/UNC path
- source: legacy:31.6 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: isExistingDirectory/isExistingFile converted to fs/promises.stat with Promise.all fan-out; concurrency test proves both probes in flight at once.
- 2026-10-14T10:47:54Z status=resolved-by:32-3-deferred-work-burn-down owner=31-6-local-package-path by=migration note=isExistingDirectory/isExistingFile converted to fs/promises.stat with Promise.all fan-out

### DW-271: [31-6-3] command 'node' is resolved from the extension host's PATH and never validated (opaque ENOENT at spawn)
- source: legacy:31.6 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: AC 31.6.1 amended; local plans spawn process.execPath + ELECTRON_RUN_AS_NODE=1; live proof in localSpawnIntegration.test.ts with a real MCP handshake.
- 2026-10-14T10:47:54Z status=resolved-by:32-3-deferred-work-burn-down owner=31-6-local-package-path by=migration note=AC 31.6.1 amended; local plans spawn process.execPath + ELECTRON_RUN_AS_NODE=1

### DW-272: [31-6-4] Status bar tooltip claims development mode is spawning local builds even when it registered nothing (typo'd path)
- source: legacy:31.6 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Dev-mode line worded from the registered count: 0 => 'NO servers were registered from it'; >0 => 'spawning from local build'; tests per branch.
- 2026-10-14T10:47:54Z status=resolved-by:32-3-deferred-work-burn-down owner=31-6-local-package-path by=migration note=Dev-mode line worded from the registered count: 0 => 'NO servers were registered from it'

### DW-273: [31-6-5] Live IRIS credentials (_SYSTEM/SYS) hardcoded in committed localSpawnIntegration.test.ts
- source: legacy:31.6 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Credentials read from IRIS_TEST_* env with documented dev defaults as fallback; repo-wide decision: __tests__ stays OUT of the containment grep roster.
- 2026-10-14T10:47:54Z status=resolved-by:32-3-deferred-work-burn-down owner=31-6-local-package-path by=migration note=Credentials read from IRIS_TEST_* env with documented dev defaults as fallback

### DW-274: [31-6-6] The launcher extension's unit tests now hard-require the monorepo packages/ tree on disk
- source: legacy:31.6 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Decision: keep the disk oracle (Rule #51); guarded readdir yields a named diagnostic; README claim narrowed to build-time/runtime with the test-tier exception named.
- 2026-10-14T10:47:54Z status=resolved-by:32-3-deferred-work-burn-down owner=31-6-local-package-path by=migration note=Decision: keep the disk oracle (Rule #51); guarded readdir yields a named diagnostic

### DW-275: [31-7-1] Every MCP server start logs a double 'CSRF preflight completed but no X-CSRF-Token header was returned' warning
- source: legacy:31.7 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Live probe: HEAD /api/atelier/ on IRIS 2026.1 returns no X-CSRF-Token (Atelier has no CSRF-token contract); WARN was noise, downgraded to logger.debug naming the condition; test updated.
- 2026-10-14T10:47:54Z status=resolved-by:32-3-deferred-work-burn-down owner=burndown by=migration note=Live probe: HEAD /api/atelier/ on IRIS 2026.1 returns no X-CSRF-Token (Atelier has no CSRF-token contract)

### DW-276: [32-0-1] iris_env_promote Gate 4 calls loadGovernanceFile() on EVERY execute while D5/resource/server_profiles use the startup snapshot
- source: legacy:32.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Design option (a): startup governance snapshot threaded through ToolContext (not the memoized accessor) - hermetic, no module-level mutable cache.
- 2026-10-14T10:47:54Z status=resolved-by:32-1-governance-cli owner=32-0-governance-file-loader by=migration note=Design option (a): startup governance snapshot threaded through ToolContext (not the memoized accessor) - hermetic

### DW-277: [32-3-R1] Parser-dropped names claim seenNames but never nameStates, so a lower-precedence valid definition is reconsidered
- source: legacy:32.3 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Decision (a): parser drops are TERMINAL like mergeProfile-invalid; nameStates.set(drop.name,'invalid') on first sighting; check-3 message states both halves.
- 2026-10-14T10:47:54Z status=resolved-by:32-4-late-findings-cleanup owner=32-3-deferred-work-burn-down by=migration note=Decision (a): parser drops are TERMINAL like mergeProfile-invalid

### DW-278: [32-3-R2] toAbsolute mangles posix-absolute candidates under win32 simulation (posix.isAbsolute never consulted)
- source: legacy:32.3 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Probe: path.win32.isAbsolute('/tmp/x') is true so the mangling mechanism does not reproduce; explicit path.posix.isAbsolute disjunct shipped as defense-in-depth.
- 2026-10-14T10:47:54Z status=resolved-by:32-4-late-findings-cleanup owner=32-3-deferred-work-burn-down by=migration note=Probe: path.win32.isAbsolute('/tmp/x') is true so the mangling mechanism does not reproduce

### DW-279: [32-3-R3] shape-mismatch warning (apiShapeWarningSink) has no dedupe and misattributes a version mismatch
- source: legacy:32.3 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Once-per-session dedupe (apiShapeWarned) plus lastApiFailure attribution; on shape-mismatch the generic 'should be installed' warning is suppressed.
- 2026-10-14T10:47:54Z status=resolved-by:32-4-late-findings-cleanup owner=32-3-deferred-work-burn-down by=migration note=Once-per-session dedupe (apiShapeWarned) plus lastApiFailure attribution

### DW-280: [32-3-R4] Activation eagerly activates the third-party Server Manager extension at every window load (refreshStatusBar replan)
- source: legacy:32.3 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Eager activation PREDATES 32.3 (extensionDependencies + onStartupFinished make VS Code activate it anyway); 32.3 only added the activation-time plan that 31-5-2's effective-count status bar needs.
- 2026-10-14T10:47:54Z status=wontfix-accepted owner=32-3-deferred-work-burn-down by=migration note=reopen_if=window-load activation cost of the launcher plan is reported as a problem

### DW-281: [32-3-R5] Zero-state status bar (servers: [] = expose-ALL) shows 'none / no servers selected yet' while N definitions are live
- source: legacy:32.3 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: [] state reports the EFFECTIVE registered count when known and non-zero; none only for count-zero/unknown; fresh-install signal kept in the tooltip; 3 unit tests.
- 2026-10-14T10:47:54Z status=resolved-by:32-4-late-findings-cleanup owner=32-3-deferred-work-burn-down by=migration note=[] state reports the EFFECTIVE registered count when known and non-zero; none only for count-zero/unknown

### DW-282: [32-3-R6] host hardening covers only override.host; guard omits backslash and colon (IRIS_HOST userinfo/host:port reaches baseUrl)
- source: legacy:32.3 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Bare-hostname guard runs on the FINAL host in mergeProfile (override or inherited), extended to backslash and colon; loadConfig fails fast on a hostile IRIS_HOST naming the var.
- 2026-10-14T10:47:54Z status=resolved-by:32-4-late-findings-cleanup owner=32-3-deferred-work-burn-down by=migration note=Bare-hostname guard runs on the FINAL host in mergeProfile (override or inherited), extended to backslash and colon

### DW-283: [32-3-R7] warnOnce full-text keying: static-text warnings never re-fire after fix-then-rebreak
- source: legacy:32.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: warnOnRisingEdge(conditionKey, condition, messageThunk) applied to the four static-text sites; message-variable sites stay on warnOnce.
- 2026-10-14T10:47:54Z status=resolved-by:32-4-late-findings-cleanup owner=32-3-deferred-work-burn-down by=migration note=warnOnRisingEdge(conditionKey, condition, messageThunk) applied to the four static-text sites

### DW-284: [32-3-R8] refreshStatusBar has no debounce/monotonic id: overlapping async refreshes can render stale text
- source: legacy:32.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Monotonic refreshSeq guard abandons the render of an older refresh; activationFlow race test with two gated activations; mutation-verified.
- 2026-10-14T10:47:54Z status=resolved-by:32-4-late-findings-cleanup owner=32-3-deferred-work-burn-down by=migration note=Monotonic refreshSeq guard abandons the render of an older refresh

### DW-285: [32-3-R9] Process-gate child env hygiene: no PATH/SystemRoot; IRIS_ scrub is uppercase-only on case-insensitive Windows env
- source: legacy:32.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: All three gate files scrub IRIS_* case-insensitively; the two fresh-built envs inherit the ambient env minus IRIS_*; iris-mcp-all 16 files/105 tests green.
- 2026-10-14T10:47:54Z status=resolved-by:32-4-late-findings-cleanup owner=32-3-deferred-work-burn-down by=migration note=All three gate files scrub IRIS_* case-insensitively; the two fresh-built envs inherit the ambient env minus IRIS_*

### DW-286: [32-3-R10] expectToolNameAbsent misses tool:action composite leaks in string VALUES
- source: legacy:32.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: String branch applies the same name: composite-prefix check as the object-key branch; self-test pins an array-value leak; mutation-verified.
- 2026-10-14T10:47:54Z status=resolved-by:32-4-late-findings-cleanup owner=32-3-deferred-work-burn-down by=migration note=String branch applies the same name: composite-prefix check as the object-key branch

### DW-287: [32-3-R11] Dead empty afterEach hook referencing a nonexistent afterAll in server-manager-process-gate.test.ts
- source: legacy:32.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Deleted; import cleaned; gate re-run green.
- 2026-10-14T10:47:54Z status=resolved-by:32-4-late-findings-cleanup owner=32-3-deferred-work-burn-down by=migration note=Deleted; import cleaned; gate re-run green.

### DW-288: [32-3-R12] .changeset/server-manager-first-file-wins.md omits the same-bump user-facing CLI changes
- source: legacy:32.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Changeset now covers the 64 KiB cap, UTF-16/NUL rejection, connect.ok nullable, connect.credentialSource, create-vs-replace messaging and probe provenance.
- 2026-10-14T10:47:54Z status=resolved-by:32-4-late-findings-cleanup owner=32-3-deferred-work-burn-down by=migration note=Changeset now covers the 64 KiB cap, UTF-16/NUL rejection, connect.ok nullable, connect.credentialSource

### DW-289: [32-3-R13] credentials CLI cmdSet exists()-then-setPassword() TOCTOU; 64 KiB password + newline rejected with the misleading file-pipe
- source: legacy:32.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Stream cap carries newline slack and the password is measured after the single-trailing-newline strip; 2 fixtures; the exists()-then-set TOCTOU is message-only and accepted.
- 2026-10-14T10:47:54Z status=resolved-by:32-4-late-findings-cleanup owner=32-3-deferred-work-burn-down by=migration note=Stream cap carries newline slack and the password is measured after the single-trailing-newline strip; 2 fixtures

### DW-290: [32-3-R14] Coalesced-credential residuals: unexpected resolveServerCredentials throw fans out uncontained
- source: legacy:32.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: resolveCredentialsCoalesced contains an unexpected rejection into a status unavailable outcome and freezes the shared result and its profile; tests.
- 2026-10-14T10:47:54Z status=resolved-by:32-4-late-findings-cleanup owner=32-3-deferred-work-burn-down by=migration note=resolveCredentialsCoalesced contains an unexpected rejection into a status unavailable outcome and freezes the shared

### DW-291: [32-3-R15] vscodeMock.authentication.getSession resolves undefined unconditionally for createIfNone (real API rejects on cancel)
- source: legacy:32.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Current tree: vscodeMock getSession REJECTS for createIfNone/forceNewSession unless scripted via mockState.nextSession - the committed 32.3 review's patch #5; blind layer read a pre-patch tree.
- 2026-10-14T10:47:54Z status=resolved-by:32-3-deferred-work-burn-down owner=32-3-deferred-work-burn-down by=migration note=Current tree: vscodeMock getSession REJECTS for createIfNone/forceNewSession unless scripted

### DW-292: [32-1-R1] Case G of governance-file-process-gate.test.ts spawns the CLI without the scrubbed env (ambient IRIS_GOVERNANCE can flip results)
- source: legacy:32.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: All three Case G spawnSync calls use the case-insensitively-scrubbed childEnv({}); live gate 8/8.
- 2026-10-14T10:47:54Z status=resolved-by:32-4-late-findings-cleanup owner=32-1-governance-cli by=migration note=All three Case G spawnSync calls use the case-insensitively-scrubbed childEnv({}); live gate 8/8.

### DW-293: [32-1-R2] validate --file '' phantom-valid
- source: legacy:32.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: resolveFilePath treats an empty --file as unset with a unit pin - the committed 32.1 review's patch; no change.
- 2026-10-14T10:47:54Z status=resolved-by:32-1-governance-cli owner=32-1-governance-cli by=migration note=resolveFilePath treats an empty --file as unset with a unit pin - the committed 32.1 review's patch; no change.

### DW-294: [32-1-R3] governance set/unset silently DROP unknown top-level keys on rewrite (a typo'd globals layer never takes effect nor is flagged)
- source: legacy:32.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: serializeConfigPreservingUnknown round-trips unknown top-level keys verbatim; a layer-shaped unknown key (globals, profile) earns a stderr warning; 4 fixtures.
- 2026-10-14T10:47:54Z status=resolved-by:32-4-late-findings-cleanup owner=32-1-governance-cli by=migration note=serializeConfigPreservingUnknown round-trips unknown top-level keys verbatim

### DW-295: [32-1-R4] runCli pre-dispatch argv.includes(-h/--help) breaks the parser's dash-value contract (get -- -h, --file --help)
- source: legacy:32.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: helpRequested() mirrors the parser state machine (-- terminator, valued-option values); 3 tests; mutation-verified.
- 2026-10-14T10:47:54Z status=resolved-by:32-4-late-findings-cleanup owner=32-1-governance-cli by=migration note=helpRequested() mirrors the parser state machine (-- terminator, valued-option values); 3 tests; mutation-verified.

### DW-296: [32-1-R5] Case H header overstates 'no surface re-reads'; no process-level Gate-4 mid-session proof
- source: legacy:32.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Case H header reworded; Case F extended with a mid-session file rewrite showing Gate 4 still refuses.
- 2026-10-14T10:47:54Z status=resolved-by:32-4-late-findings-cleanup owner=32-1-governance-cli by=migration note=Case H header reworded; Case F extended with a mid-session file rewrite showing Gate 4 still refuses.

### DW-297: [32-1-R6] Atomic write severs symlinks: temp+rename over a symlinked governance file replaces the link
- source: legacy:32.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: resolveWriteTarget: when the path is a symlink the temp+rename lands beside the real target; symlink fixture; mutation-verified.
- 2026-10-14T10:47:54Z status=resolved-by:32-4-late-findings-cleanup owner=32-1-governance-cli by=migration note=resolveWriteTarget: when the path is a symlink the temp+rename lands beside the real target; symlink fixture

### DW-298: [32-1-R7] Rollback bytes read in a second, later operation than the parse (approximate byte-for-byte restore contract)
- source: legacy:32.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: set/unset read the pre-image ONCE and reuse the same text for validation (parseGovernanceFileText) and rollback; fs-spy pin.
- 2026-10-14T10:47:54Z status=resolved-by:32-4-late-findings-cleanup owner=32-1-governance-cli by=migration note=set/unset read the pre-image ONCE and reuse the same text for validation (parseGovernanceFileText) and rollback

### DW-299: [32-2-R1] Sync statSync on the extension host in the governance engine/panel path (defaultFileExists, fileExists adapter)
- source: legacy:32.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: resolveGovernanceCli, FileExistsProbe, the panel fileExists dep and describe are async end-to-end via fs/promises.stat; tsc clean, 327/327 tests.
- 2026-10-14T10:47:54Z status=resolved-by:32-4-late-findings-cleanup owner=32-2-governance-ui by=migration note=resolveGovernanceCli, FileExistsProbe, the panel fileExists dep and describe are async end-to-end

### DW-300: [L34.retro7-4-npm-publish-after-beta] Epic 34 retro #4: npm publish after beta feedback
- source: legacy:32.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Nothing on npm; npx -y @iris-mcp/<pkg> fails for external users; published-mode paths remain dev-mode-only; Epic 33 docs must target the local-path reality.
- 2026-10-14T10:47:54Z status=decision-pending owner=burndown by=migration note=human=Project Lead decision to npm-publish the @iris-mcp packages
- 2026-10-15T02:51:51Z status=routed owner=42-6-tarball-smoke-and-1-0-0-publish by=correct-course note=decided D1/D2/D7 (decision-record-2026-10-14): publish 1.0.0 through the CI release workflow

### DW-301: [32-4-R1] helpRequested valuedOptions set is a second hand-maintained mirror of parseArgs's per-command valued options
- source: legacy:32.4 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Landed in commit 86bc6eb: single-sourced exported VALUED_OPTIONS in cli/governance.ts plus a mechanical source-scan pin in governance-cli.test.ts.
- 2026-10-14T10:47:54Z status=resolved-by:unknown owner=32-4-late-findings-cleanup by=migration note=Landed in commit 86bc6eb: single-sourced exported VALUED_OPTIONS in cli/governance.ts plus a mechanical source-scan

### DW-302: [32-2-U1] Governance editor columns zigzag row-to-row within a package group (a separate <table> per tool)
- source: legacy:32.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: renderGroups now emits ONE table per package group; multi-action tools get a spanning tool-header row; structural pin in governanceView.test.ts.
- 2026-10-14T10:47:54Z status=resolved-by:unknown owner=32-2-governance-ui by=migration note=renderGroups now emits ONE table per package group; multi-action tools get a spanning tool-header row

### DW-303: [33-1-R1] Stale stash record survives an already-in-state enable no-op (runEdit skips updateState)
- source: legacy:33.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: runEdit RunEditArgs gained updateStateOnNoop so a no-op enable still drops a stale stash record; engine test plus no-write spy; mutation-verified.
- 2026-10-14T10:47:55Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=33-1-write-engine by=migration note=runEdit RunEditArgs gained updateStateOnNoop so a no-op enable still drops a stale stash record

### DW-304: [33-1-R2] CRLF TOML set-flag splices LF-only lines (mixed line endings around the toggled line)
- source: legacy:33.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Dev fix missed the commonest CRLF writes (a first apply into a CRLF config.toml came out 1 CRLF + 8 bare LF); write.ts now falls back to the file's own convention and terminates the previously-final line.
- 2026-10-14T10:47:55Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=33-1-write-engine by=migration note=Dev fix missed the commonest CRLF writes (a first apply into a CRLF config.toml came out 1 CRLF + 8 bare LF)

### DW-305: [33-1-R3] Comments INSIDE a manager-owned JSONC entry are not stash-round-tripped across disable then enable
- source: legacy:33.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Manager-owned entries are manager-rendered; a raw-text stash variant is disproportionate for a LOW; doc note added to the client-config README.
- 2026-10-14T10:47:55Z status=wontfix-accepted owner=33-1-write-engine by=migration note=reopen_if=a user reports hand-added comments inside a manager-owned entry lost across disable/enable

### DW-306: [33-1-R4] Backup names collide within the same millisecond (stamp() is ms-precision ISO)
- source: legacy:33.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: doctor's stale-backup check could not age a -N backup because its timestamp regex lacked the suffix; fixed and pinned; mutation -> RED.
- 2026-10-14T10:47:55Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=33-1-write-engine by=migration note=doctor's stale-backup check could not age a -N backup because its timestamp regex lacked the suffix

### DW-307: [33-1-R5] state.json loss orphans non-canonical manager-created entries (unmanageable until repaired)
- source: legacy:33.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: iris-mcp-clients doctor reports present iris-namespaced non-canonical entries failing ownership and offers typed-confirmation repair.
- 2026-10-14T10:47:55Z status=resolved-by:33-2-clients-cli owner=33-1-write-engine by=migration note=iris-mcp-clients doctor reports present iris-namespaced non-canonical entries failing ownership and offers

### DW-308: [33-5-L1] Native-flag strict-equality (disabled: 1 reads enabled) in entryPresence
- source: legacy:33.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Probed: Cline/Roo JS truthiness treats disabled:1 as disabled while Codex/Goose serde fail to deserialize; format-aware isFlagDisabled(adapter, entry) single-sourced into status.ts and diff.ts.
- 2026-10-14T10:47:55Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=33-5-late-findings-cleanup by=migration note=Probed: Cline/Roo JS truthiness treats disabled:1 as disabled while Codex/Goose serde fail to deserialize

### DW-309: [33-5-L2] Tests shipped in dist (package tsc emits __tests__)
- source: legacy:33.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: tsconfig.base.json __tests__ exclude reverted (gate proven RED->GREEN on type-check and build); tarball exclusion now files: [dist, !dist/**/__tests__] in all 7 publishable packages; npm and pnpm verified.
- 2026-10-14T10:47:55Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=33-5-late-findings-cleanup by=migration note=tsconfig.base.json __tests__ exclude reverted (gate proven RED->GREEN on type-check and build)

### DW-310: [33-5-L3] Proof-surface gaps: not every engine seam carries a no-write spy; foreign-secret marker sweep not exhaustive
- source: legacy:33.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Leg 1 engine no-write spy stands; leg 2 (iterate FOREIGN_SECRET_MARKERS x fixtures) done via a new plantForeignSecrets helper that plants a genuine foreign entry in any adapter's config.
- 2026-10-14T10:47:55Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=33-5-late-findings-cleanup by=migration note=Leg 1 engine no-write spy stands; leg 2 (iterate FOREIGN_SECRET_MARKERS x fixtures) done via a new

### DW-311: [33-5-L4] Shareable pin forces codex shareable:true; whether codex project configs are share-worthy is a spec decision
- source: legacy:33.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Binding spec 3.2 defines shareable generically and is silent on Codex; every other adapter's project scope is shareable:true; spec doc amended in place with a decision marker.
- 2026-10-14T10:47:55Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=33-5-late-findings-cleanup by=migration note=Binding spec 3.2 defines shareable generically and is silent on Codex

### DW-312: [33-5-L5] Duplicate JSON keys: jsonc-parser keeps the LAST silently while another tool may honor the first
- source: legacy:33.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Duplicate-key check narrowed from refusing the whole file to a duplicated root key, a duplicate under the root key, and a duplicate inside a manager-owned canonical entry.
- 2026-10-14T10:47:55Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=33-5-late-findings-cleanup by=migration note=Duplicate-key check narrowed from refusing the whole file to a duplicated root key, a duplicate under the root key

### DW-313: [33-5-L6] Non-object canonical-named value is invisible (status matrix reports absent, not mis-shaped)
- source: legacy:33.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Refusal for a newly surfaced non-object entry is now form-aware (JSON/YAML vs TOML guidance), pinned for claude-code string/null and goose number; mutation -> RED.
- 2026-10-14T10:47:55Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=33-5-late-findings-cleanup by=migration note=Refusal for a newly surfaced non-object entry is now form-aware (JSON/YAML vs TOML guidance)

### DW-314: [33-5-L7] No mechanical pin that every adapter's appDir detection rule covers all three platforms
- source: legacy:33.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Registry-sweep test in adapters.test.ts asserts every adapter declares non-empty win32/darwin/linux appDir paths; mutation-verified.
- 2026-10-14T10:47:55Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=33-5-late-findings-cleanup by=migration note=Registry-sweep test in adapters.test.ts asserts every adapter declares non-empty win32/darwin/linux appDir paths

### DW-315: [33-5-L8] parseTomlSurface top-not-object branch is unreachable (smol-toml always returns a table)
- source: legacy:33.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Probed smol-toml: TOML has no non-object document root so the branch was provably unreachable; removed; oracle test probes smol-toml.parse() directly.
- 2026-10-14T10:47:55Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=33-5-late-findings-cleanup by=migration note=Probed smol-toml: TOML has no non-object document root so the branch was provably unreachable; removed

### DW-316: [33-5-L9] certify: restore-ladder rung 2 unexercised; flags Set-as-map; excerpt truncates mid-token; --skip-agent ignored for claude
- source: legacy:33.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Rung-2 decision, word-boundary excerpt and Set-vs-Map (argv parser moved into certify-record.mjs as parseCertifyArgs with 4 tests) are resolved; at least one leg is closed by decision with lighter evidence.
- 2026-10-14T10:47:55Z status=wontfix-accepted owner=33-5-late-findings-cleanup by=migration note=most legs fixed; remaining leg closed; reopen_if=certify's claude-code verifier misbehaves under --skip-agent

### DW-317: [33-5-L10] certify: no mutual exclusion for concurrent passes; timedOut unconsumed; dangling-symlink config path breaks snapshot read
- source: legacy:33.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Dangling-symlink refusal and timedOut surfacing are code-fixed and mutation-verified; the concurrent-pass lock is closed by decision (single-operator, never-CI-invoked script).
- 2026-10-14T10:47:55Z status=wontfix-accepted owner=33-5-late-findings-cleanup by=migration note=Dangling-symlink refusal and timedOut surfacing are code-fixed; reopen_if=certify.mjs is run concurrently or from CI

### DW-318: [33-5-L11] doctor shell-expansion regex treats a literal $$ (PID) as an env reference; walkEntry recurses without a depth guard
- source: legacy:33.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: The (?<!\$) lookbehind missed shell $$$VAR and hid Claude-mode $${VAR}; shell mode now uses an even-run prefix, Claude mode none; pinned; mutation -> RED.
- 2026-10-14T10:47:55Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=33-5-late-findings-cleanup by=migration note=The (?<!\$) lookbehind missed shell $$$VAR and hid Claude-mode $${VAR}

### DW-319: [33-5-L12] Tally disagreements in the 33.4 notes (dev 17 files/350 vs review 18/372)
- source: legacy:33.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Mechanically reconstructed 2026-07-28: the dev note undercounted by 1 file and 21 tests; history-only bookkeeping, no suggested action.
- 2026-10-14T10:47:55Z status=dropped owner=33-5-late-findings-cleanup by=migration note=bookkeeping: 33.4 test-tally disagreement; history only, no action

### DW-320: [33-5-R1] TOML merge-update splices LF-only lines into a CRLF file
- source: legacy:33.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: See 33-1-R2 (code review).
- 2026-10-14T10:47:55Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=33-5-late-findings-cleanup by=migration note=See 33-1-R2 (code review).

### DW-321: [33-5-R2] merge-update drops comments on CHANGED managed lines / inside a CHANGED env table
- source: legacy:33.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: tomlMergeUpdate carries the old trailing comment forward and renders the env sub-table as per-key spans so untouched keys and comments are never touched.
- 2026-10-14T10:47:55Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=33-5-late-findings-cleanup by=migration note=tomlMergeUpdate carries the old trailing comment forward and renders the env sub-table as per-key spans so untouched

### DW-322: [34-0-R1] {review_degraded} and {failed_layers} have no durable persistence during the code-review wait window
- source: legacy:34.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Skill steps re-read; cycle-log-epic-36 records layers_mode=sequential_sync (each layer launched and awaited synchronously with its own armed timer) as an established pattern since Epic 35.
- 2026-10-14T10:47:55Z status=wontfix-accepted owner=34-0-epic-33-deferred-cleanup by=migration note=reopen_if=a code-review session is interrupted mid-wait and loses degraded/failed-layer state

### DW-323: [34-0-R2] {story_key} is never discovered on the invocation-text branch of step-01 instruction 1 (sprint sync self-skips)
- source: legacy:34.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: step-01-gather-context.md instruction 1 now consults sprint-status silently on the invocation-text branch and sets story_key when it matches a review-status story or exactly one story is in review.
- 2026-10-14T10:47:55Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=34-0-epic-33-deferred-cleanup by=migration note=step-01-gather-context.md instruction 1 now consults sprint-status silently on the invocation-text branch and sets

### DW-324: [34-1-R1] By-ref out-value shapes unpinned: UNDEFINED, SUBSCRIPTED-ARRAY ($Data=10, the idiomatic Output shape) and OREF out-values
- source: legacy:34.1 | severity: high | fix-risk: med | footprint: out-of-footprint
- evidence: $Data-driven byRefValues encoding in Utils.BuildByRefNode: 0 omits, 1 raw scalar, 10/11 {value?,subscripts?} recursively; OREF renders as <Object:Class>; pinned by six OS tests plus live HTTP.
- 2026-10-14T10:47:55Z status=resolved-by:34-2-handler-capture-byref-20args owner=34-1-classmethod-invocation-probe by=migration note=$Data-driven byRefValues encoding in Utils.BuildByRefNode: 0 omits, 1 raw scalar

### DW-325: [34-1-R2] Capture never validated at >8KB nor at <MAXSTRING> on %ExecuteMCPOutput concatenation
- source: legacy:34.1 | severity: high | fix-risk: med | footprint: out-of-footprint
- evidence: Capture-buffer overflow returns partial success with truncated:true; a target's own <MAXSTRING> is a real error; tests TestMaxStringTruncation, TestTargetOwnMaxStringIsRealError.
- 2026-10-14T10:47:55Z status=resolved-by:34-2-handler-capture-byref-20args owner=34-1-classmethod-invocation-probe by=migration note=Capture-buffer overflow returns partial success with truncated:true; a target's own <MAXSTRING> is a real error

### DW-326: [34-1-R3] A target that itself redirects I/O (%SYS.Capture, ReDirectIO, Open/Use) is unprobed against the capture endpoint
- source: legacy:34.1 | severity: high | fix-risk: med | footprint: out-of-footprint
- evidence: A target that redirects I/O steals its own writes but the endpoint's capture/redirect state is provably not corrupted; pinned by two OS tests and re-verified over real HTTP.
- 2026-10-14T10:47:55Z status=by-design owner=34-1-classmethod-invocation-probe by=migration note=A target that redirects I/O steals its own writes but the endpoint's capture/redirect state is provably

### DW-327: [34-1-R4] The endpoint's OWN namespace switch was never active during any capture probe
- source: legacy:34.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Closed at code review by live HTTP against namespace USER with a ZN-ing, writing, ByRef-mutating target (Rule #34).
- 2026-10-14T10:47:55Z status=resolved-by:34-2-handler-capture-byref-20args owner=34-1-classmethod-invocation-probe by=migration note=Closed at code review by live HTTP against namespace USER with a ZN-ing, writing, ByRef-mutating target (Rule #34).

### DW-328: [34-1-R5] Combined paths unprobed: ZN-then-throw, and ZN to a nonexistent/inaccessible namespace
- source: legacy:34.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Probed live with two new fixtures and pinning tests in new ClassMethodEdgeTest: both combined paths already worked correctly under the existing catch-block discipline.
- 2026-10-14T10:47:55Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=34-1-classmethod-invocation-probe by=migration note=Probed live with two new fixtures and pinning tests in new ClassMethodEdgeTest: both combined paths already worked

### DW-329: [34-1-R6] Argument-value space beyond string scalars unprobed (numbers, booleans, JSON null vs empty string, long strings, control chars)
- source: legacy:34.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: value omitted => undefined-in; value:null => rejected; value:'' => empty string; extended to a bare null array element; TestBareNullArgRejected.
- 2026-10-14T10:47:55Z status=resolved-by:34-2-handler-capture-byref-20args owner=34-1-classmethod-invocation-probe by=migration note=value omitted => undefined-in; value:null => rejected; value:'' => empty string

### DW-330: [34-1-R7] Marker-recognition edge shapes unenumerated (Rule #56): byRef:false, string 'true', case, missing byRef, {}, bare array entry
- source: legacy:34.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Marker-shape enumeration exhaustive as of 2026-08-15; 13 shapes with explicit branches and tests (review found the bare-null element missing, Rule #56).
- 2026-10-14T10:47:55Z status=resolved-by:34-2-handler-capture-byref-20args owner=34-1-classmethod-invocation-probe by=migration note=Marker-shape enumeration exhaustive as of 2026-08-15; 13 shapes with explicit branches and tests

### DW-331: [34-1-R8] Arity mismatch against the target's declared formals is unprobed (over/under-supply)
- source: legacy:34.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: New fixture TargetTwoFormals plus 2 tests; live probe: over-supplying 3 args against a 2-formal target raises <PARAMETER> (error name depends on the target); error surface pinned.
- 2026-10-14T10:47:55Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=34-1-classmethod-invocation-probe by=migration note=New fixture TargetTwoFormals plus 2 tests; live probe: over-supplying 3 args against a 2-formal target raises

### DW-332: [34-1-R9] Composition never exercised (20 by-ref args inside an active redirect; ZN mid-execution plus ByRef mutation)
- source: legacy:34.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: TestZNMidExecutionWithByRefThroughDispatch and TestTwentyArgsAllMutated compose the cases through the real dispatch chain; re-driven live over HTTP.
- 2026-10-14T10:47:55Z status=resolved-by:34-2-handler-capture-byref-20args owner=34-1-classmethod-invocation-probe by=migration note=TestZNMidExecutionWithByRefThroughDispatch and TestTwentyArgsAllMutated compose the cases through the real dispatch

### DW-333: [34-1-R12] args that is not a JSON array is silently mis-counted into phantom empty arguments (%Size on %DynamicObject)
- source: legacy:34.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Non-array args rejected with "'args' must be a JSON array"; residual args:''/null accepted as zero args tracked as 34-2-R7.
- 2026-10-14T10:47:55Z status=resolved-by:34-2-handler-capture-byref-20args owner=34-1-classmethod-invocation-probe by=migration note=Non-array args rejected with "'args' must be a JSON array"; residual args:''/null accepted as zero args tracked

### DW-334: [34-1-R10] Output contract unpinned: trailing newline, and thrown-target errText shape
- source: legacy:34.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: New fixture TargetWriteNewlineThenThrow plus TestOutputContractPreservesTrailingNewlineOnThrownTarget pinning byte-exact captured output up to a mid-execution throw.
- 2026-10-14T10:47:55Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=34-1-classmethod-invocation-probe by=migration note=New fixture TargetWriteNewlineThenThrow plus TestOutputContractPreservesTrailingNewlineOnThrownTarget pinning

### DW-335: [34-1-R11] Redirect teardown proven only by inference; $IO never compared to tInitIO
- source: legacy:34.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: The hard-error path is now the throwing-Use test (mutation-verified); the dev-stage CloseAlreadyHappened test does not exercise step independence and its doc comment says so.
- 2026-10-14T10:47:55Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=34-1-classmethod-invocation-probe by=migration note=The hard-error path is now the throwing-Use test (mutation-verified)

### DW-336: [34-1-R13] A target doing argumentless KILL silently truncates the capture (%ExecuteMCPOutput is a public local)
- source: legacy:34.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Same documented limitation and doc lines as 34-3-R3; truncated reflects only this process's own <MAXSTRING> detection, not third-party interference.
- 2026-10-14T10:47:55Z status=wontfix-accepted owner=34-1-classmethod-invocation-probe by=migration note=documented limitation; truncated cannot see; reopen_if=a legitimate workflow loses captured output to a target's KILL

### DW-337: [34-1-R14] %All mapping preconditions unprobed (namespace created after bootstrap; bootstrap never ran)
- source: legacy:34.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Live probe in %SYS: Config.MapPackages.Exists('%ALL','ExecuteMCPv2')=1 and CompiledClass.%ExistsId=1 for ExecuteMCPv2.Utils and Command; the %ALL mapping reaches every namespace incl. %SYS on this instance.
- 2026-10-14T10:47:55Z status=wontfix-theoretical owner=34-1-classmethod-invocation-probe by=migration note=real_if=an instance is found where the %ALL ExecuteMCPv2 package mapping is absent

### DW-338: [34-1-R15] Open tNull timeout $Test unchecked (re-deferred, folded into 34-2-R5)
- source: legacy:34.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Closed by the untimed-Open probe in 34-2-R5 leg (i), not by '34-2-R5 is RESOLVED for both call sites'.
- 2026-10-14T10:47:55Z status=wontfix-theoretical owner=34-1-classmethod-invocation-probe by=migration note=untimed Open never sets $Test; real_if=the null-device Open is changed to a timed open

### DW-339: [34-1-R16] The ZN probe is a simplified version of bug repro 3's shape (multiple ZNs with interleaved output)
- source: legacy:34.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: New fixture TargetMultiZNInterleaved (USER, %SYS, USER) with narration and ByRef mutation; new OS test plus gate leg 'repro 3b' through the real HTTP endpoint.
- 2026-10-14T10:47:55Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=34-1-classmethod-invocation-probe by=migration note=New fixture TargetMultiZNInterleaved (USER, %SYS, USER) with narration and ByRef mutation

### DW-340: [34-2-R1] A capture <MAXSTRING> swallowed by the TARGET's own Try/Catch produces a silent partial (truncated stays 0)
- source: legacy:34.2 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Redirects() labels wrap each concatenating Set in Try/Catch recording the overflow in %ExecuteMCPTruncated so a target's own Try/Catch cannot swallow it first.
- 2026-10-14T10:47:55Z status=resolved-by:34-3-ts-tool-docs-smokes owner=34-2-handler-capture-byref-20args by=migration note=Redirects() labels wrap each concatenating Set in Try/Catch recording the overflow in %ExecuteMCPTruncated so

### DW-341: [34-2-R2] No size cap on output or byRefValues - the partial-success path deliberately returns a 2-4 MB response body
- source: legacy:34.2 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: ExecuteMCPv2.Utils.ApplyOutputCeiling bounds output to OUTPUTCEILING (32768 chars) on /command and /classmethod with a machine-detectable elision marker.
- 2026-10-14T10:47:55Z status=resolved-by:34-6-pre-publish-release-hardening owner=34-2-handler-capture-byref-20args by=migration note=ExecuteMCPv2.Utils.ApplyOutputCeiling bounds output to OUTPUTCEILING (32768 chars) on /command and /classmethod

### DW-342: [34-2-R3] RenderResponseBody's returned %Status is discarded; a mid-stream serialization failure ships truncated invalid JSON with HTTP 200
- source: legacy:34.2 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: ExecuteMCPv2.REST.Base intercepts the single inherited RenderResponseBody entry point for 738 call sites across 15 re-parented handlers; pre-flight serialization substitutes a clean minimal envelope; mutation-verified live.
- 2026-10-14T10:47:55Z status=resolved-by:34-4-response-integrity-gate-durability owner=34-2-handler-capture-byref-20args by=migration note=ExecuteMCPv2.REST.Base intercepts the single inherited RenderResponseBody entry point for 738 call sites across 15

### DW-343: [34-2-R4] BuildByRefNode deep-copies with Merge at every level (O(nodes x depth)) and has no recursion-depth bound
- source: legacy:34.2 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Live-measured: IRIS hard-caps references at 255 subscripts so a pathologically deep Output array cannot exceed 254 levels regardless of BYREFNODECEILING (1000); Merge cost measured acceptable.
- 2026-10-14T10:47:56Z status=wontfix-theoretical owner=34-2-handler-capture-byref-20args by=migration note=real_if=BuildByRefNode cost is measured as a problem on a realistic large Output array

### DW-344: [34-2-R5] Open tNull:::1 $Test unchecked AND tRedirected set only AFTER the Use, so a failed Open/Use leaks the null device (two call sites)
- source: legacy:34.2 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Leg (i): Open tNull:::1 is an UNTIMED open (1 fills the mnemonic slot) so $Test passes through unchanged and a timeout branch is never reached; leg (ii) tRedirected-before-Use is applied.
- 2026-10-14T10:47:56Z status=wontfix-theoretical owner=34-2-handler-capture-byref-20args by=migration note=untimed Open; the $Test timeout branch; real_if=the null-device Open is changed to a timed open whose $Test can be 0

### DW-345: [34-2-R6] Success-path I/O teardown (ReDirectIO(0)/Use tInitIO/Close tNull) is unguarded
- source: legacy:34.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: New ClassMethodEdgeTest.TestTeardownRedirectClosesCaptureDeviceEvenWhenUseThrows with a temp file standing in for the null device; mutation-verified live.
- 2026-10-14T10:47:56Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=34-2-handler-capture-byref-20args by=migration note=New ClassMethodEdgeTest.TestTeardownRedirectClosesCaptureDeviceEvenWhenUseThrows with a temp file standing

### DW-346: [34-2-R7] args '' and args null bypass the R12 non-array rejection and are accepted as zero arguments
- source: legacy:34.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: The MCP schema accepts only an array or omitted args so no regression; the null/'' alias is a documented server-side direct-REST behavior (Rule #19); tool description now reads 'Omitting args and passing [] are the same zero-argument call'.
- 2026-10-14T10:47:56Z status=by-design owner=34-2-handler-capture-byref-20args by=migration note=The MCP schema accepts only an array or omitted args so no regression

### DW-347: [34-2-R8] byRef:false provides no by-value protection - every position is dot-passed so the flag only gates read-back
- source: legacy:34.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: iris_execute_classmethod description states byRef controls only whether the post-call value is reported back; every position is bound by reference regardless.
- 2026-10-14T10:47:56Z status=resolved-by:34-3-ts-tool-docs-smokes owner=34-2-handler-capture-byref-20args by=migration note=iris_execute_classmethod description states byRef controls only whether the post-call value is reported back

### DW-348: [34-2-R9] No endpoint-level regression for ClassMethod()'s own response shape (all 48 tests drive Utils.InvokeWithArgs directly)
- source: legacy:34.2 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Endpoint-level regression drives the real /classmethod handler over HTTP in custom-rest.integration.test.ts (later found to be gate-excluded, see 34-3-R4).
- 2026-10-14T10:47:56Z status=resolved-by:34-3-ts-tool-docs-smokes owner=34-2-handler-capture-byref-20args by=migration note=Endpoint-level regression drives the real /classmethod handler over HTTP in custom-rest.integration.test.ts

### DW-349: [34-2-R10] InvokeWithArgs runs the by-ref read-back in whatever namespace the target ZN'd into
- source: legacy:34.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Confirmed duplicate concern of 34-1-R14 (the %All mapping precondition); closed citing that disposition.
- 2026-10-14T10:47:56Z status=dropped owner=34-2-handler-capture-byref-20args by=migration note=dup of 34-1-R14

### DW-350: [34-3-R1] The truncated flag is computed and then discarded on every ERROR response path
- source: legacy:34.3 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: truncated surfaced on the ERROR envelope of /command and /classmethod on every failure path after capture began; verified live by curl; pre-capture validation exception documented.
- 2026-10-14T10:47:56Z status=resolved-by:34-4-response-integrity-gate-durability owner=34-3-ts-tool-docs-smokes by=migration note=truncated surfaced on the ERROR envelope of /command and /classmethod on every failure path after capture began

### DW-351: [34-3-R2] The unbounded ~3.6 MB success response is newly reachable on /command
- source: legacy:34.3 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Same fix as 34-2-R2: Execute() success path applies ApplyOutputCeiling before rendering; under-ceiling responses byte-identical.
- 2026-10-14T10:47:56Z status=resolved-by:34-6-pre-publish-release-hardening owner=34-3-ts-tool-docs-smokes by=migration note=Same fix as 34-2-R2: Execute() success path applies ApplyOutputCeiling before rendering

### DW-352: [34-3-R3] Re-entrancy: a target driving %UnitTest/ExecuteMCPv2.Tests through the endpoint wipes the outer request's capture buffer
- source: legacy:34.3 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Documented limitation: iris_execute_classmethod description and the dev README now state a target that KILLs the capture slots silently loses output and truncated does not report it; run unit-test suites with iris_execute_tests.
- 2026-10-14T10:47:56Z status=wontfix-accepted owner=34-3-ts-tool-docs-smokes by=migration note=reopen_if=a legitimate workflow needs nested %UnitTest runs through /classmethod

### DW-353: [34-3-R4] AC 34.3.4 (b) Output-param, (c) 20-arg and (d) second-namespace coverage lives only in custom-rest.integration.test.ts
- source: legacy:34.3 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Legs added to execute-classmethod-epic-gate.test.ts which the DEFAULT suite collects; confirmed to execute (no SKIP, real HTTP) and mutation-verified RED.
- 2026-10-14T10:47:56Z status=resolved-by:34-4-response-integrity-gate-durability owner=34-3-ts-tool-docs-smokes by=migration note=Legs added to execute-classmethod-epic-gate.test.ts which the DEFAULT suite collects

### DW-354: [34-3-R5] toStructured() array and scalar branches cannot be produced by the real /classmethod endpoint and are pinned by no test (Rule #54)
- source: legacy:34.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Confirmed live and by source that /classmethod's result is always a JSON object; toStructured simplified to a pass-through cast; new test pins the real shape; mutation-verified.
- 2026-10-14T10:47:56Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=34-3-ts-tool-docs-smokes by=migration note=Confirmed live and by source that /classmethod's result is always a JSON object

### DW-355: [34-3-R6] Execute() and ClassMethod() outer Catch blocks each Kill only one of the two process-private slots
- source: legacy:34.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Same evidence as 34-4-R5: latent only, no stale value observable; InvokeWithArgs' entry Kill initializes the flag on every ClassMethod() call under the same mutation-verified pin.
- 2026-10-14T10:47:56Z status=wontfix-theoretical owner=34-3-ts-tool-docs-smokes by=migration note=latent only; no stale slot value is observable; real_if=a stale capture slot value is observed across requests

### DW-356: [34-3-R7] TestTwentyArgsAllMutated read-back asserts positions 0 and 19 only
- source: legacy:34.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Mutation-verified live: Target20 made to mutate position 10 wrongly and the test went RED; the pre-story assertions would have stayed green.
- 2026-10-14T10:47:56Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=34-3-ts-tool-docs-smokes by=migration note=Mutation-verified live: Target20 made to mutate position 10 wrongly and the test went RED

### DW-357: [34-3-R8] args: z.array(z.any()).max(20) is looser than the contract its own description states
- source: legacy:34.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: args tightened to a structural union (scalar or {byRef:boolean,value?:scalar} marker) matching Utils.ParseArgEntry's exhaustive enumeration; confirmed the SDK dispatch validates against it.
- 2026-10-14T10:47:56Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=34-3-ts-tool-docs-smokes by=migration note=args tightened to a structural union (scalar or {byRef:boolean,value?:scalar} marker) matching Utils.ParseArgEntry's

### DW-358: [34-3-R9] TestRedirectsSetsTruncatedFlagOnCaptureOverflow's > 1000000 length assertion is coupled to instance long-string configuration
- source: legacy:34.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: The hard-coded > 1000000 floor in CommandTest and ClassMethodArgsTest now derives from $SYSTEM.SYS.MaxLocalLength() \ 2 (3,641,144 on this instance).
- 2026-10-14T10:47:56Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=34-3-ts-tool-docs-smokes by=migration note=The hard-coded > 1000000 floor in CommandTest and ClassMethodArgsTest now derives from $SYSTEM.SYS.MaxLocalLength() \

### DW-359: [34-4-R1] Gate leg (d) cannot fail for the property it claims (GetVersion() is namespace-invariant; loose regex)
- source: legacy:34.4 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Leg (d) now uses fixture target TargetReturnNamespace (Quit $NAMESPACE) asserting the value equals the requested USER and differs from IRIS_NAMESPACE.
- 2026-10-14T10:47:56Z status=resolved-by:34-6-pre-publish-release-hardening owner=34-4-response-integrity-gate-durability by=migration note=Leg (d) now uses fixture target TargetReturnNamespace (Quit $NAMESPACE) asserting the value equals the requested USER

### DW-360: [34-4-R2] Gate leg (c) is named reads back every position but asserts only positions 0 and 19 of 20
- source: legacy:34.4 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Gate leg (c) now loops all 20 positions' values and asserts exactly 20 keys; mutation-verified live against HSCUSTOM.
- 2026-10-14T10:47:56Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=34-4-response-integrity-gate-durability by=migration note=Gate leg (c) now loops all 20 positions' values and asserts exactly 20 keys; mutation-verified live against HSCUSTOM.

### DW-361: [34-4-R3] Epic gate silent-skip vector: IRIS_REQUIRE_LIVE set nowhere; fixture probe catch collapses connection/credential/licence faults
- source: legacy:34.4 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: fixtureIsDeployed's catch re-throws anything that is not an IrisApiError with statusCode 404, so beforeAll reports the real cause instead of a misleading skip.
- 2026-10-14T10:47:56Z status=resolved-by:34-6-pre-publish-release-hardening owner=34-4-response-integrity-gate-durability by=migration note=fixtureIsDeployed's catch re-throws anything that is not an IrisApiError with statusCode 404

### DW-362: [34-4-R4] truncated is on the REST error envelope but never reaches the MCP tool caller (IrisApiError drops the envelope result)
- source: legacy:34.4 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: IrisApiError gained an optional result constructor parameter; http-client passes envelope.result; iris_execute_command/classmethod surface structuredContent.truncated on the error path.
- 2026-10-14T10:47:56Z status=resolved-by:34-5-tool-layer-truncated-and-test-runner-guard owner=34-4-response-integrity-gate-durability by=migration note=IrisApiError gained an optional result constructor parameter; http-client passes envelope.result

### DW-363: [34-4-R5] %ExecuteMCPTruncated can survive a request in a reused CSP worker (outer Catch blocks do not Kill it)
- source: legacy:34.4 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Not observable: every reader resets the slot before capture (InvokeWithArgs entry Kill; Execute()'s two unconditional Sets); pinned by TestStaleTruncatedFlagFromAnEarlierRequestIsNeverObserved; closes 36-3-QA-2 for this row.
- 2026-10-14T10:47:56Z status=wontfix-theoretical owner=34-4-response-integrity-gate-durability by=migration note=every reader resets the slot before capture; real_if=a stale truncated flag is observed on an unrelated later call

### DW-364: [34-4-R6] Every response across 15 handlers now serializes its message and result a second time into a %Stream.TmpCharacter (738 renders)
- source: legacy:34.4 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Live-measured 200 iterations: a ~32KB envelope 781.3us vs 620.7us per call (~160us overhead), a 2-byte envelope 46.9us vs 37.9us; three orders of magnitude below any threshold.
- 2026-10-14T10:47:56Z status=wontfix-accepted owner=34-4-response-integrity-gate-durability by=migration note=measured ~160 us overhead per 32 KB envelope; reopen_if=pre-flight serialization overhead exceeds about 1 ms per call

### DW-365: [34-4-R7] Execute() outer Catch restores I/O inside a swallowing Try; if Use tInitIO throws the error render goes to the null device
- source: legacy:34.4 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Closed by the independent Close (closing the current device reverts $IO to $PRINCIPAL, which is tInitIO in a CSP request), not by TeardownRedirect's boolean or retry; banner and handler comments corrected.
- 2026-10-14T10:47:56Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=34-4-response-integrity-gate-durability by=migration note=Closed by the independent Close

### DW-366: [34-4-R8] ExecuteMCPv2.Tests.BaseTest.StartCapture issues Open tNull:::1 without checking $TEST
- source: legacy:34.4 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: StartCapture's open is the same untimed open; it never sets $Test and has no timeout so the item's premise cannot occur; the doc comment was corrected.
- 2026-10-14T10:47:56Z status=wontfix-theoretical owner=34-4-response-integrity-gate-durability by=migration note=untimed Open; the item's premise cannot occur; real_if=BaseTest.StartCapture is changed to a timed open

### DW-367: [34-4-R9] tests/test-summary.md was overwritten wholesale, deleting the Story 27.4 record including the note that AC 27.4.2/27.4.3 lead
- source: legacy:34.4 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: test-summary.md is a per-story rolling file; the underlying concern is answered YES with dated evidence (cycle-log-epic-27.md line 49 smoke_complete: AC27.4.2 proven live; capstone caught and fixed a HIGH mappings-key bug).
- 2026-10-14T10:47:56Z status=dropped owner=34-4-response-integrity-gate-durability by=migration note=invalid: 27.4 smokes were run (cycle-log-epic-27 line 49)

### DW-368: [34-4-R10] iris_execute_tests reports total 0, passed 0, failed 0 with no error when a class- or method-level run matches nothing
- source: legacy:34.4 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Zero-result guard added mirroring the package-level guard; verified live against the real Atelier /work unittest endpoint.
- 2026-10-14T10:47:56Z status=resolved-by:34-5-tool-layer-truncated-and-test-runner-guard owner=34-4-response-integrity-gate-durability by=migration note=Zero-result guard added mirroring the package-level guard; verified live against the real Atelier /work unittest

### DW-369: [34-5-R1] The zero-result guard is invisible to isError and structuredContent consumers
- source: legacy:34.5 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Guard now carries isError:true and structuredContent via one shared zeroResultGuardResponse() helper applied identically to both guard sites.
- 2026-10-14T10:47:56Z status=resolved-by:34-6-pre-publish-release-hardening owner=34-5-tool-layer-truncated-and-test-runner-guard by=migration note=Guard now carries isError:true and structuredContent via one shared zeroResultGuardResponse() helper applied

### DW-370: [34-5-R2] target.split(':') at level method silently discards segments after the second and does not trim whitespace
- source: legacy:34.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: execute.ts trims both segments and rejects more than one colon or an empty class segment with an explicit malformed-target error via the shared zeroResultGuardResponse helper.
- 2026-10-14T10:47:56Z status=resolved-by:36-1-execute-tests-running-contract-and-handles owner=34-5-tool-layer-truncated-and-test-runner-guard by=migration note=execute.ts trims both segments and rejects more than one colon or an empty class segment with an explicit

### DW-371: [34-5-R3] A test method named exactly Test is unrunnable and misreported (empty filter on the wire; row dropped on the return leg)
- source: legacy:34.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Row filter and poll-loop accumulator key changed from truthiness to presence (r.method !== undefined); the request leg toAtelierMethodFilter('Test') was already correct and got no code change.
- 2026-10-14T10:47:56Z status=resolved-by:36-1-execute-tests-running-contract-and-handles owner=34-5-tool-layer-truncated-and-test-runner-guard by=migration note=Row filter and poll-loop accumulator key changed from truthiness to presence (r.method !== undefined)

### DW-372: [34-5-R4] Prefix aliasing is many-to-one: Class:Validate and Class:TestValidate both send filter Validate
- source: legacy:34.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: At level method the drained rows' restored names are compared against the raw requested name; a mismatch adds an additive methodMismatch signal.
- 2026-10-14T10:47:56Z status=resolved-by:36-1-execute-tests-running-contract-and-handles owner=34-5-tool-layer-truncated-and-test-runner-guard by=migration note=At level method the drained rows' restored names are compared against the raw requested name

### DW-373: [34-5-R5] cycle-log-epic-34.md dev_complete entry records tests_added=18 (final-diff count) where the dev-stage figure is 14
- source: legacy:34.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Mechanical derivation: execute.test.ts 40->56 (+16), errors +3, http-client +3; CR +6, QA +2; dev stage = 16-6-2 = 8 plus 6 shared = 14; the cycle-log corrigendum is the lead's call.
- 2026-10-14T10:47:56Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=34-5-tool-layer-truncated-and-test-runner-guard by=migration note=Mechanical derivation: execute.test.ts 40->56 (+16), errors +3, http-client +3; CR +6, QA +2

### DW-374: [34-6-QA-1] AC 34.6.3 prepublishOnly gate was wired only into @iris-mcp/dev; the fixed changeset group publishes every @iris-mcp/* package
- source: legacy:34.6 | severity: high | fix-risk: med | footprint: out-of-footprint
- evidence: New scripts/verify-iris-reachable.mjs wired as prepublishOnly on shared, admin, data, interop, ops and all.
- 2026-10-14T10:47:56Z status=resolved-by:34-6-pre-publish-release-hardening owner=34-6-pre-publish-release-hardening by=migration note=New scripts/verify-iris-reachable.mjs wired as prepublishOnly on shared, admin, data, interop, ops and all.

### DW-375: [34-6-QA-2] tools.integration.test.ts iris_doc_list category=CLS assertion checked only page 1 of an unfiltered call
- source: legacy:34.6 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Added filter Test.MCPIntegration to the handler call; 19/19 tests pass (was 18/19).
- 2026-10-14T10:47:56Z status=resolved-by:34-6-pre-publish-release-hardening owner=34-6-pre-publish-release-hardening by=migration note=Added filter Test.MCPIntegration to the handler call; 19/19 tests pass (was 18/19).

### DW-376: [34-6-CR-1] @iris-mcp/client-config was publishable, ungated, and FIRST in publish order
- source: legacy:34.6 | severity: high | fix-risk: med | footprint: out-of-footprint
- evidence: Reproduced live: a dry-run produced a complete 278.3 kB client-config tarball with zero gate output before shared's gate failed closed; fixed by wiring the gate script.
- 2026-10-14T10:47:56Z status=resolved-by:34-6-pre-publish-release-hardening owner=34-6-pre-publish-release-hardening by=migration note=Reproduced live: a dry-run produced a complete 278.3 kB client-config tarball with zero gate output before shared's

### DW-377: [34-6-CR-2] The Story 34.6 headline output-ceiling feature had ZERO regression coverage at its integration point
- source: legacy:34.6 | severity: high | fix-risk: med | footprint: out-of-footprint
- evidence: Mutation (both ApplyOutputCeiling calls deleted) returned 50,000 untruncated chars while CommandTest 18/18, dev vitest 643/643 and integration 12/12 stayed GREEN; gate legs added.
- 2026-10-14T10:47:56Z status=resolved-by:34-6-pre-publish-release-hardening owner=34-6-pre-publish-release-hardening by=migration note=Mutation (both ApplyOutputCeiling calls deleted) returned 50,000 untruncated chars while CommandTest 18/18

### DW-378: [34-6-CR-3] Epic-gate leg (d) had two false-RED modes that would BLOCK the release (hard-coded USER second namespace)
- source: legacy:34.6 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Reproduced with IRIS_NAMESPACE=USER ('expected USER not to be USER'); second namespace now derived (USER or %SYS) in both gate and integration files.
- 2026-10-14T10:47:56Z status=resolved-by:34-6-pre-publish-release-hardening owner=34-6-pre-publish-release-hardening by=migration note=Reproduced with IRIS_NAMESPACE=USER ('expected USER not to be USER')

### DW-379: [34-6-CR-4] Two TS test fixtures encoded shapes the real server cannot produce (Rule #54): overCeilingOutput 32769 chars
- source: legacy:34.6 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Marker length pinned live as 36+digits(ceiling); fixtures corrected with an in-test arithmetic self-check.
- 2026-10-14T10:47:56Z status=resolved-by:34-6-pre-publish-release-hardening owner=34-6-pre-publish-release-hardening by=migration note=Marker length pinned live as 36+digits(ceiling); fixtures corrected with an in-test arithmetic self-check.

### DW-380: [34-6-CR-5] returnValue is completely unbounded on /classmethod (ceiling covers output and byRefValues only)
- source: legacy:34.6 | severity: high | fix-risk: med | footprint: out-of-footprint
- evidence: ClassMethod() applies ApplyOutputCeiling to returnValue with the same ceiling/marker, surfaced via additive returnValueTruncated (also on error envelopes); closure confirmed by gate leg (e-2) mutation.
- 2026-10-14T10:47:56Z status=resolved-by:34-6-pre-publish-release-hardening owner=34-6-pre-publish-release-hardening by=migration note=ClassMethod() applies ApplyOutputCeiling to returnValue with the same ceiling/marker

### DW-381: [34-6-CR-6] byRef byte-budget exhaustion DESTROYS every subsequent position's small value and replaces it with a LARGER marker
- source: legacy:34.6 | severity: high | fix-risk: med | footprint: out-of-footprint
- evidence: ApplyOutputCeiling falls back to a marker-less hard cut when the marker would not fit; AddByRefPosition budget pre-check omits over-budget positions; both halves mutation-confirmed.
- 2026-10-14T10:47:57Z status=resolved-by:34-6-pre-publish-release-hardening owner=34-6-pre-publish-release-hardening by=migration note=ApplyOutputCeiling falls back to a marker-less hard cut when the marker would not fit

### DW-382: [34-6-CR-7] Non-ASCII JSON request bodies are silently mis-decoded (UTF-8 read as Latin-1) across all 14 REST handler classes sharing
- source: legacy:34.6 | severity: high | fix-risk: med | footprint: out-of-footprint
- evidence: Fixed centrally in Utils.ReadRequestBody via DecodeUtf8Stream / IncompleteUtf8TailLength / SanitizeUnpairedSurrogates; reviewer-independent live evidence on HSCUSTOM incl. Rule #19 byte-identity.
- 2026-10-14T10:47:57Z status=resolved-by:34-8-request-body-utf8-decoding owner=34-6-pre-publish-release-hardening by=migration note=Fixed centrally in Utils.ReadRequestBody via DecodeUtf8Stream / IncompleteUtf8TailLength /

### DW-383: [34-6-CR-8] ApplyOutputCeiling returns a string LONGER than the ceiling for every ceiling in 0..37
- source: legacy:34.6 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: CR-6's rework implemented CR-8's suggested resolution verbatim (return the first tCeiling characters) and its test passes.
- 2026-10-14T10:47:57Z status=resolved-by:34-6-pre-publish-release-hardening owner=34-6-pre-publish-release-hardening by=migration note=CR-6's rework implemented CR-8's suggested resolution verbatim (return the first tCeiling characters) and its test

### DW-384: [34-6-CR-9] The advertised elision-marker literal never appears for a truncated byRef leaf (marker embeds the effective ceiling)
- source: legacy:34.6 | severity: med | fix-risk: low | footprint: out-of-footprint
- evidence: Tool description and README now state the ceiling suffix varies; what remains: CHANGELOG and the changeset advertise only the fixed literal and no site names the stable [IRIS-MCP-TRUNCATED prefix.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=Tool description and README now state the ceiling suffix varies; what remains: CHANGELOG and the changeset advertise
- 2026-10-15T11:47:32Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=fix in 38.0 [DOCFIX]: CHANGELOG.md:236 + .changeset/execute-response-ceiling-and-gate-hardening.md:14: state byRef leaves carry ceiling=<N>; detect via the stable [IRIS-MCP-TRUNCATED prefix
- 2026-10-15T14:29:56Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-13: fixed; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-385: [34-6-CR-10] A truncation cut through a surrogate pair emits invalid UTF-8 on the wire
- source: legacy:34.6 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: ApplyOutputCeiling routes every retained-length computation through SurrogateSafeCutLength which backs off one UTF-16 code unit when it would end on an unpaired high surrogate; pinned at ObjectScript level and by gate leg.
- 2026-10-14T10:47:57Z status=resolved-by:34-7-publish-blockers-utf8-budget-build-gate owner=34-6-pre-publish-release-hardening by=migration note=ApplyOutputCeiling routes every retained-length computation through SurrogateSafeCutLength which backs off one UTF-16

### DW-386: [34-6-CR-11] No prepublish gate verifies that the package being published was actually built
- source: legacy:34.6 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: New scripts/lib/dist-freshness.mjs checkDistFresh verifies per-package and self-referentially that dist/ exists, is non-empty and is at least as new as its own src/.
- 2026-10-14T10:47:57Z status=resolved-by:34-7-publish-blockers-utf8-budget-build-gate owner=34-6-pre-publish-release-hardening by=migration note=New scripts/lib/dist-freshness.mjs checkDistFresh verifies per-package and self-referentially that dist/ exists

### DW-387: [34-6-CR-12] Per-package prepublishOnly hooks structurally cannot gate a multi-package release
- source: legacy:34.6 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Publish order client-config, shared, admin, data, dev, interop, ops, all; add a root-level pre-flight release script that runs the full gate set once before pnpm -r publish.
- 2026-10-14T10:47:57Z status=decision-pending owner=burndown by=migration note=call: add a root-level pre-flight release script as the sole supported publish command
- 2026-10-15T02:51:51Z status=routed owner=42-5-release-workflow by=correct-course note=decided D7 (decision-record-2026-10-14): release workflow with root pre-flight script as sole publish command

### DW-388: [34-6-CR-13] verify-iris-reachable.mjs silently falls back to hard-coded local dev credentials when env vars are unset
- source: legacy:34.6 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: On a maintainer machine the gate passes regardless of the intended release target; fail-closed direction preserved; require IRIS_HOST/USERNAME/PASSWORD explicitly at the publish boundary.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=On a maintainer machine the gate passes regardless of the intended release target; fail-closed direction preserved
- 2026-10-15T11:47:32Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=fix in 38.0 [VERIFYSCRIPT]: verify-iris-reachable.mjs:115-121: drop the ?? local-dev defaults; fail closed naming IRIS_HOST/IRIS_USERNAME/IRIS_PASSWORD when unset
- 2026-10-15T14:29:56Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-7: fixed; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-389: [34-6-CR-14] Rule #56 enumeration gap: extensions/iris-mcp-launcher is npm-publishable and ungated (unscoped global name, publisher TBD)
- source: legacy:34.6 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: 9 non-private publishable manifests not 8; add private:true after confirming vsce package/publish still work; replace the publisher placeholder before any marketplace release.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=9 non-private publishable manifests not 8; add private:true after confirming vsce package/publish still work
- 2026-10-15T02:51:51Z status=routed owner=42-7-vs-code-extension-publish by=correct-course note=decided D5 (decision-record-2026-10-14): project-name publisher on Marketplace + Open VSX; private:true for npm

### DW-390: [34-6-CR-15] The TS tool layer discards byRefTruncated on the error path (execute.ts extracts only truncated)
- source: legacy:34.6 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Command.cls sets it on both error envelopes (confirmed live); extend the error-path extraction and update the README failure-path paragraph.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=Command.cls sets it on both error envelopes (confirmed live); extend the error-path extraction and update the README
- 2026-10-15T11:47:32Z status=wontfix-theoretical by=x0 note=TS error path returns only the error text (execute.ts:1487-1497), never byRefValues, so byRefTruncated would describe absent data; README:1150-1153 truthful; real if failures returned byRefValues

### DW-391: [34-6-CR-16] verify-iris-reachable.mjs aborts with a Windows crash code instead of exiting 1 on the credential-fault path
- source: legacy:34.6 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: process.exit(1) with a live socket triggers UV_HANDLE_CLOSING assertion exit -1073740791; abort() could hang the publish on a WER/AeDebug modal; destroy the agent first.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=process.exit(1) with a live socket triggers UV_HANDLE_CLOSING assertion exit -1073740791
- 2026-10-15T11:47:32Z status=wontfix-accepted by=x0 note=reopen_if=the publish/prepublish gate runs on a Windows host (CI matrix or maintainer) and exits -1073740791; UV_HANDLE_CLOSING abort is Windows-only; maintainer env is macOS and Epic 42 CI targets GitHub-hosted runners

### DW-392: [34-6-CR-17] The byRef budget's central design property has no test; the node-budget test assertion is too loose
- source: legacy:34.6 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: TestByRefValueNodeBudgetTruncatesManySubscripts asserts only <=1000 and >0 though the exact value (999) was known; add a multi-position case.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=TestByRefValueNodeBudgetTruncatesManySubscripts asserts only <=1000 and >0 though the exact value (999) was known
- 2026-10-15T11:47:32Z status=wontfix-theoretical by=x0 note=Shared multi-position byRef budget pinned live by gate leg e-4 (execute-classmethod-epic-gate.test.ts:677-730); loose <=1000 bound (ClassMethodArgsTest.cls:832) still fails over-budget

### DW-393: [34-6-CR-18] ApplyOutputCeiling's pCeiling sentinel accepts the whole negative range, not the documented single -1
- source: legacy:34.6 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Not currently reachable; use If pCeiling = -1 so an arithmetic slip fails loudly instead of silently disabling the ceiling.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=Not currently reachable; use If pCeiling = -1 so an arithmetic slip fails loudly instead of silently disabling
- 2026-10-15T11:47:32Z status=wontfix-theoretical by=x0 note=Every computed budget is clamped >=0 before reaching pCeiling (Utils.cls:502,513,828); only the -1 default is negative; real if a new caller passed unclamped arithmetic

### DW-394: [34-6-CR-19] The changeset marks feat-shaped changes as patch across seven packages
- source: legacy:34.6 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: New response fields and a newly truthy isError are feat-shaped; decide the initial minor/patch boundary before the first publish (free now, uncorrectable afterwards); consider stripping prepublishOnly via publishConfig.
- 2026-10-14T10:47:57Z status=decision-pending owner=burndown by=migration note=human=Project Lead decides the initial minor/patch version boundary before the first npm publish
- 2026-10-15T02:51:51Z status=routed owner=42-1-pre-publish-package-fixes by=correct-course note=decided D2 (decision-record-2026-10-14): align every @iris-mcp/* package at 1.0.0
- 2026-10-18T17:35:49Z occurrence=40-3-testproduction-runs

### DW-395: [34-6-CR-20] Documentation and bookkeeping accuracy cluster: (a) error envelope can carry truncated:true for an absent output
- source: legacy:34.6 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Individually trivial but grouped so none is lost; (a) apply the ceiling on the success path only, (b) route three sibling early-returns through a shared helper, (c) drop the live gate from pure-unit tests.
- 2026-10-14T10:47:57Z status=wontfix-accepted owner=34-6-pre-publish-release-hardening by=migration note=reopen_if=an error envelope carries truncated:true with no output, or the pure-unit tests need live IRIS

### DW-396: [34-6-CR2-1] The byRefValues 32768-character budget did not bound byRefValues (subscript KEYS and OREF placeholders emitted free)
- source: legacy:34.6 | severity: high | fix-risk: med | footprint: out-of-footprint
- evidence: BuildByRefNode now charges every emitted piece (OREF placeholder and each subscript key before descending); found independently by all three layers and live probes.
- 2026-10-14T10:47:57Z status=resolved-by:34-6-pre-publish-release-hardening owner=34-6-pre-publish-release-hardening by=migration note=BuildByRefNode now charges every emitted piece (OREF placeholder and each subscript key before descending)

### DW-397: [34-6-CR2-2] Published byRef elision contract was a false dichotomy (tool description and README)
- source: legacy:34.6 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Both surfaces now describe omitted / marker / unmarked prefix; byRefTruncated is the only signal in the unmarked case.
- 2026-10-14T10:47:57Z status=resolved-by:34-6-pre-publish-release-hardening owner=34-6-pre-publish-release-hardening by=migration note=Both surfaces now describe omitted / marker / unmarked prefix; byRefTruncated is the only signal in the unmarked case.

### DW-398: [34-6-CR2-3] Two shipping artifacts still asserted the client-config exclusion that 34-6-CR-1 reversed
- source: legacy:34.6 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: verify-iris-reachable.mjs banner and the changeset paragraph rewritten to state the wiring and why it was reversed.
- 2026-10-14T10:47:57Z status=resolved-by:34-6-pre-publish-release-hardening owner=34-6-pre-publish-release-hardening by=migration note=verify-iris-reachable.mjs banner and the changeset paragraph rewritten to state the wiring and why it was reversed.

### DW-399: [34-6-CR2-4] Ledger row 34-6-CR-8 was STALE-OPEN
- source: legacy:34.6 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Row superseded; tally corrected.
- 2026-10-14T10:47:57Z status=resolved-by:34-6-pre-publish-release-hardening owner=34-6-pre-publish-release-hardening by=migration note=Row superseded; tally corrected.

### DW-400: [34-6-CR2-5] TestByRefValueBudgetExhaustionOmitsRatherThanDestroys' total-across-positions assertion measured one position and could
- source: legacy:34.6 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Assertion now sums the whole serialized byRefValues structure against the documented budget plus a scaffolding allowance.
- 2026-10-14T10:47:57Z status=resolved-by:34-6-pre-publish-release-hardening owner=34-6-pre-publish-release-hardening by=migration note=Assertion now sums the whole serialized byRefValues structure against the documented budget plus a scaffolding

### DW-401: [34-6-CR2-6] The per-field 32768 ceilings do not bound the response
- source: legacy:34.6 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: returnValue, byRefValues and output now share ONE 32768-character response budget spent in the lead-decided order returnValue, byRefValues, output (additive pOutputBudget).
- 2026-10-14T10:47:57Z status=resolved-by:34-7-publish-blockers-utf8-budget-build-gate owner=34-6-pre-publish-release-hardening by=migration note=returnValue, byRefValues and output now share ONE 32768-character response budget spent in the lead-decided order

### DW-402: [34-6-CR2-7] The gate's fixture probe checks only that the fixture CLASS exists, not that it carries this story's methods
- source: legacy:34.6 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: A pre-34.6 fixture copy on an instance would fail closed (the safe direction); add a FixtureVersion() classmethod and treat a mismatch as not deployed.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=A pre-34.6 fixture copy on an instance would fail closed (the safe direction)
- 2026-10-15T11:47:32Z status=wontfix-accepted by=x0 note=reopen_if=a gate run goes red because a stale pre-34.6 ExecuteMCPv2.Tests fixture is deployed and is misdiagnosed as a regression; A pre-34.6 fixture copy fails closed (tests go RED, not skip), the safe direction; Tests.* fixtures are hand-loaded (Rule #39)

### DW-403: [34-6-CR2-8] returnValueTruncated is discarded by the TS error path though the CHANGELOG/changeset advertise it on error envelopes
- source: legacy:34.6 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Same error-path structuredContent shape change as 34-6-CR-15; README already truthful; fold into CR-15.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=Same error-path structuredContent shape change as 34-6-CR-15; README already truthful; fold into CR-15.
- 2026-10-15T11:47:32Z status=wontfix-theoretical by=x0 note=Same shape as DW-390: returnValue is never returned on the TS error path (execute.ts:1487-1497); CHANGELOG:252 describes the REST envelope, which does carry it

### DW-404: [34-6-CR2-9] ApplyOutputCeiling leaves pTruncated UNDEFINED when nothing is truncated
- source: legacy:34.6 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Every current caller pre-initializes; the banner invites the unsafe pattern; Set:'$Data(pTruncated) pTruncated=0 at entry; costs a BOOTSTRAP_VERSION regen.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=Every current caller pre-initializes; the banner invites the unsafe pattern
- 2026-10-15T11:47:32Z status=wontfix-theoretical by=x0 note=All callers pre-initialize the flag (Command.cls:154,358; Utils.cls:679-680,825) before ApplyOutputCeiling (Utils.cls:297-318); real only if a new caller skipped the init

### DW-405: [34-6-CR2-10] BuildByRefNode gained three REQUIRED positional parameters; a pre-34.6 one-argument call dies with <UNDEFINED>
- source: legacy:34.6 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: No known external caller; internal serialization helper not documented as an API; give the three parameters defaults.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=No known external caller; internal serialization helper not documented as an API; give the three parameters defaults.
- 2026-10-15T11:47:32Z status=wontfix-theoretical by=x0 note=BuildByRefNode's only callers are Utils.cls:553,586 (same class, deployed together by bootstrap); real only for an external caller of this undocumented helper

### DW-406: [34-6-CR2-11] Gate leg (e-4) is arithmetically hard-pinned to OUTPUTCEILING = 32768
- source: legacy:34.6 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Any ceiling change turns the leg red for the wrong reason; derive the 20-char remainder from the ceiling in-test.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=Any ceiling change turns the leg red for the wrong reason; derive the 20-char remainder from the ceiling in-test.
- 2026-10-15T11:47:32Z status=wontfix-accepted by=x0 note=reopen_if=ExecuteMCPv2.Utils OUTPUTCEILING (Utils.cls) changes from 32768; Leg e-4 hard-codes CEILING=32768 (execute-classmethod-epic-gate.test.ts:686); a ceiling change turns it RED (fail-closed), never vacuously green

### DW-407: [34-6-CR2-12] expect(structuredContent).toEqual(parsed) is tautological at every new zero-result-guard call site
- source: legacy:34.6 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Both sides originate from the same literal in zeroResultGuardResponse; sibling assertions carry the weight; assert total === 0 and error directly.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=Both sides originate from the same literal in zeroResultGuardResponse; sibling assertions carry the weight
- 2026-10-15T11:47:32Z status=wontfix-theoretical by=x0 note=9 toEqual(parsed) sites in execute.test.ts are tautological but sibling total/error assertions carry the weight; real only if those siblings were removed

### DW-408: [34-6-CR2-13] Two shipped %UnitTest doc comments still encode the pre-fix mental model
- source: legacy:34.6 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Comment-only; assertions are correct and green; rewrite or delete the stale sentence.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=Comment-only; assertions are correct and green; rewrite or delete the stale sentence.
- 2026-10-15T11:47:32Z status=wontfix-theoretical by=x0 note=Comment-only in ExecuteMCPv2.Tests (assertions correct, green); the two sites were never recorded in ledger or story file; real only if a dev acted on the stale sentence

### DW-409: [34-6-CR2-14] The 'identical existing convention' reuse claim behind fixtureIsDeployed's 404 discriminator does not hold
- source: legacy:34.6 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Behavior is correct and arguably better; only the justifying comment is wrong (Rules #47/#16); name the one real precedent and the deliberate 403 divergence.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=Behavior is correct and arguably better; only the justifying comment is wrong (Rules #47/#16)
- 2026-10-15T11:47:33Z status=wontfix-theoretical by=x0 note=Comment-only (execute-classmethod-epic-gate.test.ts:105-108); behavior correct and red-proven; real only if someone aligned the code to the false precedent

### DW-410: [34-6-CR2-15] QA Results' Rule #38 doc-surface tally overcounts (root README documents the ceiling nowhere)
- source: legacy:34.6 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: AC 34.6.1's 'and in the README' is satisfied by the package README; claim defect only; correct the 'x2' in the story's QA Results.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=AC 34.6.1's 'and in the README' is satisfied by the package README; claim defect
- 2026-10-15T11:47:33Z status=wontfix-theoretical by=x0 note=Closed Story 34.6 QA record tally only; AC 34.6.1 satisfied by the package README; no code or doc consumer; real only if a later gate re-read the tally

### DW-411: [34-7-QA-1] The shared budget reduces but does not restore the 50,031-character safety margin for metacharacter-heavy content
- source: legacy:34.7 | severity: med | fix-risk: high | footprint: out-of-footprint
- evidence: 98,410 raw chars confirmed accurate but not the true ceiling; closing it needs measuring/truncating against SERIALIZED size (re-serialize pass or a 6x escape-cost multiplier).
- 2026-10-14T10:47:57Z status=decision-pending owner=burndown by=migration note=call: bound by serialized size (6x escape cost) or document the raw-char budget; pre-publish contract change
- 2026-10-15T11:47:33Z status=wontfix-accepted by=x0 note=decided=orchestrator(Lead-away) reopen_if=a client reports a diverted or failed iris_execute_* response for metacharacter-heavy output (serialized body >50,031 chars); raw-char budget documented everywhere (README:1028-1051, execute.ts:54-61,1364-1368, CHANGELOG:340-347). Alt: serialized-size bound (6x escape multiplier), high fix-risk

### DW-412: [34-7-CR-1] SurrogateSafeCutLength backs off exactly ONE code unit with no re-check (adjacent malformed high surrogates)
- source: legacy:34.7 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: The lone surrogate pre-exists in the source data; well-formed input is fully correct; convert the If to a While and add an adjacent-high-surrogate fixture.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=The lone surrogate pre-exists in the source data; well-formed input is fully correct
- 2026-10-15T11:47:33Z status=wontfix-theoretical by=x0 note=Adjacent unpaired high surrogates mean the SOURCE is already invalid UTF-16 (WTF-8 regardless of the cut); well-formed input fully handled (Utils.cls:337-347)

### DW-413: [34-7-CR-2] checkDistFresh skips unless files contains the EXACT string 'dist' (dist/, dist/**, ./dist, absent files silently skip)
- source: legacy:34.7 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Fail-open where the gate matters; mechanically verified not present today (all 7 dist-declaring packages use the exact string).
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=Fail-open where the gate matters; mechanically verified not present today
- 2026-10-15T11:47:33Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=fix in 38.0 [DISTFRESH]: dist-freshness.mjs: accept dist, dist/, ./dist, dist/** (normalized) instead of files.includes('dist')
- 2026-10-15T14:29:56Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-5: fixed; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-414: [34-7-CR-3] checkDistFresh JSDoc promises it never throws but JSON.parse/readdirSync throw on malformed package.json or a dist file
- source: legacy:34.7 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Exit code is still non-zero so publish aborts; only the promised message shape is false; wrap in try/catch or correct the JSDoc.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=Exit code is still non-zero so publish aborts; only the promised message shape is false
- 2026-10-15T11:47:33Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=fix in 38.0 [DISTFRESH]: Wrap JSON.parse/readdirSync/statSync in try/catch returning {ok:false,reason} as the JSDoc promises
- 2026-10-15T14:29:56Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-5: fixed; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-415: [34-7-CR-4] newestMtimeMs handles only isDirectory()/isFile() so a symlinked file under src/ is skipped (stale dist can pass)
- source: legacy:34.7 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: No symlinks in the repo today; add an else branch that stats symlinks or fail closed on an unexpected entry type.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=No symlinks in the repo today; add an else branch that stats symlinks or fail closed on an unexpected entry type.
- 2026-10-15T11:47:33Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=fix in 38.0 [DISTFRESH]: newestMtimeMs: add an else branch that statSync()s (follows) symlinks, or fail closed on an unexpected entry type
- 2026-10-15T14:29:56Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-5: fixed; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-416: [34-7-CR-5] No clock-skew guard in checkDistFresh: a future-mtime dist file makes every src edit compare older
- source: legacy:34.7 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Requires an unusual filesystem/clock state; add a distNewest > Date.now()+tolerance check failing closed.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=Requires an unusual filesystem/clock state; add a distNewest > Date.now()+tolerance check failing closed.
- 2026-10-15T11:47:33Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=fix in 38.0 [DISTFRESH]: Fail closed when distNewest > Date.now() + tolerance (clock skew)
- 2026-10-15T14:29:56Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-5: fixed; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-417: [34-7-CR-6] The dist-freshness gate never verifies the declared entry points (main/module/exports/bin) exist inside dist
- source: legacy:34.7 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: The fully-empty-dist case IS caught (verified live); one stray recent file satisfies the other checks; existsSync each declared entry point.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=The fully-empty-dist case IS caught (verified live); one stray recent file satisfies the other checks
- 2026-10-15T11:47:33Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=fix in 38.0 [DISTFRESH]: existsSync each declared main/module/exports/bin target inside dist
- 2026-10-15T14:29:56Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-5: fixed; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-418: [34-7-CR-7] Freshness is per-package src vs own dist only, so cross-package staleness (rebuilt shared, stale dev) is invisible
- source: legacy:34.7 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: A full pnpm turbo run build before publish (the documented flow) avoids it; include workspace-dependency dist mtimes or delegate to turbo's cache state.
- 2026-10-14T10:47:57Z status=wontfix-accepted owner=34-7-publish-blockers-utf8-budget-build-gate by=migration note=reopen_if=a release ships a stale embedded BOOTSTRAP_VERSION after rebuilding only shared

### DW-419: [34-7-CR-8] Epic-gate leg (e-5) works only because of cut-position parity (32768-41 = 32727 is odd)
- source: legacy:34.7 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Currently effective (reviewer mutation run reproduced the defect through this leg); assert the cut lands on a high surrogate or drive both parities; correct the false comment.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=Currently effective (reviewer mutation run reproduced the defect through this leg)
- 2026-10-15T11:47:33Z status=wontfix-accepted by=x0 note=reopen_if=OUTPUTCEILING or the [IRIS-MCP-TRUNCATED ceiling=Nchars] marker length changes (re-derive legs e-4/e-5 then); Leg e-5's cut parity (32768-41 odd) exercises the backoff today (reviewer mutation reproduced the defect); its 'regardless of arithmetic' comment overclaims

### DW-420: [34-7-CR-9] The ONE 32768-char shared budget is not a hard bound on total RAW response: BuildByRefNode does not charge ~30 KB of per-node
- source: legacy:34.7 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Pre-existing 34.6 behavior documented at the method banner; the 1000-node ceiling bounds it deterministically; charge scaffolding or state the +30 KB residue in docs.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=Pre-existing 34.6 behavior documented at the method banner; the 1000-node ceiling bounds it deterministically
- 2026-10-15T11:47:33Z status=by-design by=x0 note=Story 34.7 decision: per-node scaffolding bounded by the 1000-node ceiling, documented at every site (README:1112, CHANGELOG:277-279, Utils.cls:452)

### DW-421: [34-8-CR-1] The UTF-8 request-body decode is unconditional and never consults %request.CharSet
- source: legacy:34.8 | severity: med | fix-risk: high | footprint: out-of-footprint
- evidence: No client in this suite sends a charset parameter (CharSet empty for every real call); adding negotiation hours before first publish adds an untested path; translate when CharSet names a non-UTF-8 charset.
- 2026-10-14T10:47:57Z status=decision-pending owner=burndown by=migration note=call: honor non-UTF-8 %request.CharSet now, or wait for beta evidence (retro trigger)
- 2026-10-15T11:47:33Z status=wontfix-accepted by=x0 note=decided=orchestrator(Lead-away) reopen_if=a caller other than IrisHttpClient is supported for /api/executemcp/v2, or a request with a non-UTF-8 %request.CharSet is observed; sole client of /api/executemcp/v2 is IrisHttpClient: JSON.stringify body, application/json, fetch encodes UTF-8 (http-client.ts:330); beta users still use it. Alt: honor CharSet

### DW-422: [34-8-CR-2] No end-to-end test crosses the production 1,000,000-char decode chunk boundary
- source: legacy:34.8 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Largest HTTP test body is ~5,400 raw bytes (0.5% of UTF8CHUNKSIZE); reviewer exercised 4.5 MB and 11.25 MB and found exact; add a >1 MB non-ASCII round-trip test.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=Largest HTTP test body is ~5,400 raw bytes (0.5% of UTF8CHUNKSIZE)
- 2026-10-15T11:47:33Z status=wontfix-theoretical by=x0 note=DecodeUtf8Stream is chunk-size-parameterized and swept at small sizes + large body (Utf8DecodeTest.cls:167-226,397); 4.5/11.25MB live exact; real if HTTP framing depended on chunk size

### DW-423: [34-8-CR-3] GetMimeData('BODY') branch is decoded unconditionally though the story's own probe proves it is never reached
- source: legacy:34.8 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Unreachable for this project's application/json POSTs (mimeIsObject=0 on every call); a multipart part carries its own CharSet; Rule #54 shape; drop the decode or consult the part CharSet.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=Unreachable for this project's application/json POSTs (mimeIsObject=0 on every call)
- 2026-10-15T11:47:33Z status=wontfix-theoretical by=x0 note=GetMimeData('BODY') unreachable for application/json POSTs (probe 2026-08-16, Utils.cls:1118-1120); IrisHttpClient never sends multipart; real if multipart bodies were supported

### DW-424: [34-8-CR-4] A CESU-8/WTF-8 surrogate PAIR decodes differently depending on chunk alignment
- source: legacy:34.8 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Malformed input only; both outcomes are valid UTF-8 on the wire; decide and document one disposition and pin at two chunk alignments.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=Malformed input only; both outcomes are valid UTF-8 on the wire; decide and document one disposition and pin at two
- 2026-10-15T11:47:33Z status=wontfix-theoretical by=x0 note=Malformed CESU-8/WTF-8 input only; IrisHttpClient emits well-formed UTF-8; both outcomes are valid UTF-8; real if a non-IrisHttpClient caller were supported

### DW-425: [34-8-CR-5] The request body is materialized a SECOND time in IRISTEMP with no size guard (peak temp usage roughly doubles)
- source: legacy:34.8 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Inherent to the decode design; measured modest (11.25 MB in 0.785s); a ceiling is a product decision; check tStream.Size against a documented maximum if wanted.
- 2026-10-14T10:47:57Z status=decision-pending owner=burndown by=migration note=call: set a documented max body size for the IRISTEMP decode copy, or accept the doubling
- 2026-10-15T11:47:33Z status=wontfix-accepted by=x0 note=decided=orchestrator(Lead-away) reopen_if=an IRISTEMP growth or <STORE> incident, or a request body >50MB, is reported against /api/executemcp/v2; doubling measured modest (11.25MB in 0.785s); a ceiling is a new limit on doc_put/load bodies. Alt: documented max body size checked via tStream.Size

### DW-426: [34-8-CR-6] The malformed-byte candidate set is closed by example, not stated exhaustive (Rule #56)
- source: legacy:34.8 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Reviewer probed F5/F8/FF/above-U+10FFFF/ED BF BF live and found CLEAN; state the set exhaustive as of the probe date and pin F5-FF and above-U+10FFFF fixtures.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=Reviewer probed F5/F8/FF/above-U+10FFFF/ED BF BF live and found CLEAN
- 2026-10-15T11:47:33Z status=wontfix-accepted by=x0 note=reopen_if=DecodeUtf8Stream or SanitizeUnpairedSurrogates (Utils.cls) is modified - add the F5-FF and above-U+10FFFF pins in that change; Reviewer probed F5/F8/FF/above-U+10FFFF/ED BF BF live and found clean

### DW-427: [34-8-CR-7] cycle-log-epic-34.md line 90 carries an impossible timestamp 2026-08-16T25:00:00Z in a machine-parsed TSV
- source: legacy:34.8 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Pure metadata owned by the Project Lead; suggested correction 2026-08-17T01:00:00Z plus a timestamp format check.
- 2026-10-14T10:47:57Z status=routed owner=burndown by=migration note=Pure metadata owned by the Project Lead; suggested correction 2026-08-17T01:00:00Z plus a timestamp format check.
- 2026-10-15T11:47:33Z status=wontfix-theoretical by=x0 note=Still cycle-log-epic-34.md:90 (and :91 spawn_at T25:05); Epic 34 closed so never resume-parsed; telemetry gate reads only model_tier_checkpoint rows; true times unknowable

### DW-428: [35-SWEEP-1] iris_production_item:set can never succeed
- source: legacy:unknown | severity: high | fix-risk: med | footprint: out-of-footprint
- evidence: set resolves the item by the full composite key via LoadFromClass, OpenId, FindItemByConfigName like add/remove; lead-verified LIVE on the real endpoint.
- 2026-10-14T10:47:57Z status=resolved-by:35-1-production-item-set-composite-key owner=burndown by=migration note=set resolves the item by the full composite key via LoadFromClass, OpenId, FindItemByConfigName like add/remove

### DW-429: [35-SWEEP-2] iris_analytics_cubes:build returns unparseable non-JSON
- source: legacy:unknown | severity: high | fix-risk: med | footprint: out-of-footprint
- evidence: CubeAction build wraps %BuildCube in the Command.cls null-device redirect (mnemonic on a throw-away device, unconditional restore, one render); mutation-verified on the RAW HTTP wire; error and success paths proven live.
- 2026-10-14T10:47:57Z status=resolved-by:35-2-analytics-cubes-build-device-output owner=burndown by=migration note=CubeAction build wraps %BuildCube in the Command.cls null-device redirect

### DW-430: [35-SWEEP-3] Localized error prefixes come from an unpinned request locale (Accept-Language never set; * resolves to the araw locale)
- source: legacy:unknown | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: IrisHttpClient.executeFetch sends an explicit operator-overridable Accept-Language (IRIS_ACCEPT_LANGUAGE, default en-US,en;q=0.9) on every request; exactly one fetch( exists in runtime source.
- 2026-10-14T10:47:57Z status=resolved-by:35-3-pin-request-locale-error-text owner=burndown by=migration note=IrisHttpClient.executeFetch sends an explicit operator-overridable Accept-Language

### DW-431: [35-SWEEP-4] iris_resource_manage:listPrivileges is unbounded (grantee _SYSTEM returns 15,341 rows / 2.9 MB)
- source: legacy:unknown | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: SqlPrivilegeList bounds both materialization loops with a maxRows cap (default 100, max 1000) and omits the %All-derived cross-product via the Rule #6 exact-piece check.
- 2026-10-14T10:47:57Z status=resolved-by:35-4-bound-list-privileges owner=burndown by=migration note=SqlPrivilegeList bounds both materialization loops with a maxRows cap

### DW-432: [35-SWEEP-5] DocDB tool family (4 tools) is dead on a default IRIS install (%Service_DocDB disabled; bare ERROR #822 Access Denied)
- source: legacy:unknown | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: All four DocDB tools translate the disabled-%Service_DocDB failure into an actionable error naming the cause and both remedy routes (Management Portal; iris_service_manage enable with its governance override example).
- 2026-10-14T10:47:57Z status=resolved-by:35-7-docdb-prerequisite-error-and-docs owner=burndown by=migration note=All four DocDB tools translate the disabled-%Service_DocDB failure into an actionable error naming the cause and both

### DW-433: [35-SWEEP-6] iris_oauth_manage client-create leaks a raw <PARAMETER> (serverName not validated against a real server definition)
- source: legacy:unknown | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Premise corrected: RegisterClient is 1-arg on this instance so the old 2-arg call died on ARITY before any server lookup (client-create never worked); client-create branch fixed.
- 2026-10-14T10:47:57Z status=resolved-by:35-5-validate-before-delegating-oauth-restname owner=burndown by=migration note=Premise corrected: RegisterClient is 1-arg on this instance so the old 2-arg call died on ARITY before any server

### DW-434: [35-SWEEP-7] iris_interop_rest rejects its own documented example name '/myapi' (package-name validator)
- source: legacy:unknown | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: name description now states the package-name contract (e.g. MyApi) validated via $ZNAME(name,4) with /myapi documented as the rejected form; interop README example corrected.
- 2026-10-14T10:47:57Z status=resolved-by:35-5-validate-before-delegating-oauth-restname owner=burndown by=migration note=name description now states the package-name contract (e.g. MyApi) validated via $ZNAME(name,4) with /myapi

### DW-435: [35-SWEEP-8] iris_doc_xml_export:import reports success but does not compile (action/xml/load loads without compiling)
- source: legacy:unknown | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Additive compile parameter (default false) plus optional flags mirroring iris_doc_load; live-probed that Atelier action/xml/load accepts a native flags param.
- 2026-10-14T10:47:57Z status=resolved-by:35-6-xml-import-compile-and-legacy-rest-get owner=burndown by=migration note=Additive compile parameter (default false) plus optional flags mirroring iris_doc_load

### DW-436: [35-SWEEP-9] iris_rest_manage:get fails misleadingly (404 'Check the IRIS web server configuration') on legacy apps that list scope:all
- source: legacy:unknown | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: On a Mgmnt API 404 (matched by HTTP status) get falls back to the legacy webapp list via fetchLegacyApps and returns {name, dispatchClass, namespace, swaggerSpec:null, explanation}.
- 2026-10-14T10:47:57Z status=resolved-by:35-6-xml-import-compile-and-legacy-rest-get owner=burndown by=migration note=On a Mgmnt API 404 (matched by HTTP status) get falls back to the legacy webapp list via fetchLegacyApps and returns

### DW-437: [L34.retro7-1-sc4-merge-epic34] Epic 34 retro #1: SC-4 merge epic34 into the feature branch (prerequisite for beta)
- source: legacy:34.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Merge landed 2026-08-17 as 6fe1763; this IS AC 35.0.2, re-verified; no carry.
- 2026-10-14T10:47:58Z status=resolved-by:unknown owner=34-0-epic-33-deferred-cleanup by=migration note=Merge landed 2026-08-17 as 6fe1763; this IS AC 35.0.2, re-verified; no carry.

### DW-438: [L34.retro7-2-decide-beta-visible-branch] Epic 34 retro #2: decide the beta-visible branch
- source: legacy:34.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: The beta-visible branch question was resolved when wave-4 reached main (60be515).
- 2026-10-14T10:47:58Z status=resolved-by:unknown owner=34-0-epic-33-deferred-cleanup by=migration note=The beta-visible branch question was resolved when wave-4 reached main (60be515).

### DW-439: [L34.retro7-3-beta-distribution] Epic 34 retro #3: beta distribution to the test group (git clone + build; plain hand-off)
- source: legacy:34.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Gated on Epic 35 completing (Stories 35.1-35.8 make the hand-off safe); jointly blocked with #2.
- 2026-10-14T10:47:58Z status=decision-pending owner=burndown by=migration note=human=Project Lead runs the beta distribution to the test group
- 2026-10-15T02:51:51Z status=dropped by=correct-course note=not pipeline work - human action complete: git-clone beta ran by 2026-09-11 (epic-36-retro-2026-09-11.md:62-63); public beta declined by D2 (decision-record-2026-10-14)

### DW-440: [L33.retro4-3-kimi-code-vscode-extension-half] Epic 33 retro section 4 #3: Kimi Code VS Code extension half
- source: legacy:33.4 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Requires the Kimi Code extension installed; unchanged since the Epic 33 retro.
- 2026-10-14T10:47:58Z status=decision-pending owner=burndown by=migration note=human=verify the Kimi Code VS Code extension half with the extension installed
- 2026-10-15T11:47:33Z status=routed owner=42-9-install-docs-and-client-re-certification by=x0 note=decided=orchestrator(Lead-away) owned by named story (orchestrator decision 2): AC 42.9.2 re-certifies every adapter on published 1.0.0 and marks human-only rows with the date - this row. Alt: wontfix-accepted until someone installs the extension

### DW-441: [L33.retro4-4-post-publish-recertification] Epic 33 retro section 4 #4: post-publish re-certification
- source: legacy:33.4 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Deliberately re-sequenced behind beta; blocked on the Epic 33 publish decision (section 4 #1).
- 2026-10-14T10:47:58Z status=decision-pending owner=burndown by=migration note=human=re-run client certification after the npm publish happens
- 2026-10-15T02:51:51Z status=routed owner=42-9-install-docs-and-client-re-certification by=correct-course note=decided (decision-record-2026-10-14 story 8); human-only client rows recorded as such

### DW-442: [L33.retro4-6-find-a-copilot-user] Epic 33 retro section 4 #6: find a Copilot user
- source: legacy:33.4 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Needs a consenting GitHub Copilot user; same class of blocker as section 4 #3; recorded for Rule #56 enumeration completeness.
- 2026-10-14T10:47:58Z status=decision-pending owner=burndown by=migration note=human=find a consenting GitHub Copilot user to verify the launcher in Copilot Chat
- 2026-10-15T11:47:33Z status=routed owner=42-9-install-docs-and-client-re-certification by=x0 note=decided=orchestrator(Lead-away) owned by named story (orchestrator decision 2): AC 42.9.2 marks the Copilot Chat row human-only with a date during post-publish re-certification. Alt: wontfix-accepted until a consenting Copilot user exists

### DW-443: [35-0-CR-1] Publish-time gates are wired to prepublishOnly only - nothing on prepack/prepare
- source: legacy:35.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Correctly inert for a git clone + build beta hand-off; add the gates to prepack/prepare and prove the gate RED on the tarball path specifically (Rule #59).
- 2026-10-14T10:47:58Z status=routed owner=burndown by=migration note=Correctly inert for a git clone + build beta hand-off; add the gates to prepack/prepare and prove the gate RED
- 2026-10-15T02:51:51Z status=routed owner=42-3-ci-workflow by=correct-course note=D7 (decision-record-2026-10-14): CI gates; prove RED on the tarball path (Rule #59)

### DW-444: [35-1-DEV-1] The full parallel turbo run build test lint is not reliably green in this dev environment
- source: legacy:35.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: A/B git stash isolation proves the failures exist at the pre-story baseline; consistent with env-var/port contention among concurrently spawned real-server test processes.
- 2026-10-14T10:47:58Z status=routed owner=burndown by=migration note=A/B git stash isolation proves the failures exist at the pre-story baseline
- 2026-10-15T11:47:33Z status=wontfix-accepted by=x0 note=reopen_if=a clean-tree pnpm turbo run build test lint fails twice in a row locally, or the Story 42.3 CI gates job fails on a rerun of an unchanged commit; Env/port contention among concurrently spawned real-server tests; A/B stash shows it pre-existing; not reproducible read-only here
- 2026-10-16T17:57:29Z occurrence=38-7-epic-38-burn-down
- 2026-10-16T17:57:29Z note=38.7: the repo-root turbo run test still runs the dev and all vitest suites concurrently, so their live gates can overlap on the shared instance even though @iris-mcp/all is now serial; same reopen_if

### DW-445: [35-1-CR-1] A config item whose host ClassName no longer resolves to a business type is UNREACHABLE through set and remove
- source: legacy:35.1 | severity: high | fix-risk: med | footprint: out-of-footprint
- evidence: Composite-key fallback (two-arg NameExists + tProd.Items lookup) in both set and remove; live-probed incl. the swizzle trap; mutation-verified RED/GREEN over real HTTP; ExecuteMCPv2.Tests 399/399.
- 2026-10-14T10:47:58Z status=resolved-by:35-1-production-item-set-composite-key owner=35-1-production-item-set-composite-key by=migration note=Composite-key fallback (two-arg NameExists + tProd.Items lookup) in both set and remove

### DW-446: [35-1-CR-2] FindItemByConfigName's Output %Status is captured into tFindStatus and never read
- source: legacy:35.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Rule #9 violation, but the library also returns an error status for ordinary absence so naive propagation would replace the pinned AC 35.1.3 text; inspect error codes and AppendStatus for others.
- 2026-10-14T10:47:58Z status=routed owner=burndown by=migration note=Rule #9 violation, but the library also returns an error status for ordinary absence so naive propagation would
- 2026-10-15T11:47:33Z status=wontfix-accepted by=x0 note=reopen_if=a user reports a misleading 'not found' from set/remove for a '|'/'||'-qualified itemName or during an SQL fault; Still unread by design (Interop.cls:546-585 in-code note); only the SQL-fault and '|'/'||'-qualified-name cases get a generic not-found; still an error, no wrong write

### DW-447: [35-1-CR-3] set is governance-grandfathered/always-enabled but Story 35.1 escalated it to a durable rewrite of the production CLASS source
- source: legacy:35.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: add/remove do the same class of write and are mutates:write default-disabled; re-classifying a grandfathered action is a product decision above a review's authority.
- 2026-10-14T10:47:58Z status=decision-pending owner=burndown by=migration note=call: ratify set as an always-enabled XData write, or add a separate opt-in gate for that half
- 2026-10-15T11:47:33Z status=by-design by=x0 note=decided=orchestrator(Lead-away) set stays grandfathered (Rule #23) but is classified write (baseline-classifications.ts:172) so read-only blocks it; 35.1 made it durable as advertised. Alt: separate opt-in gate

### DW-448: [35-1-CR-4] Whole-production read-modify-write with no lock: concurrent set/add/remove silently lose updates
- source: legacy:35.1 | severity: med | fix-risk: high | footprint: out-of-footprint
- evidence: LoadFromClass -> OpenId -> mutate -> SaveToClass with no LOCK; pre-existing shape inherited from add/remove, window wider now that ungated set shares it; add a bounded LOCK around the span.
- 2026-10-14T10:47:58Z status=routed owner=burndown by=migration note=LoadFromClass -> OpenId -> mutate -> SaveToClass with no LOCK; pre-existing shape inherited from add/remove
- 2026-10-15T11:47:33Z status=wontfix-accepted by=x0 note=reopen_if=a lost update under concurrent iris_production_item set/add/remove on one production is observed or reported; cut from 38.0 by orchestrator; No LOCK (Interop.cls:523-649,749-822,855-895); parallel agent tool calls on one production silently lose an update; lock leak in a reused CSP job is the risk

### DW-449: [35-1-CR-5] Intra-production duplicate item names resolve silently to a preference-ranked first match
- source: legacy:35.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: AC 35.1.3 closed only the cross-production dimension; needs a product decision (reject as ambiguous vs expose a comment qualifier) plus schema/doc change.
- 2026-10-14T10:47:58Z status=decision-pending owner=burndown by=migration note=call: reject duplicate item names as ambiguous, or expose a comment qualifier parameter
- 2026-10-15T11:47:33Z status=by-design by=x0 note=decided=orchestrator(Lead-away) preference-ranked first match is FindItemByConfigName's own platform resolution (Interop.cls:547); add blocks new dups. Alt: reject as ambiguous or accept an Item|Class qualifier

### DW-450: [35-1-CR-6] get with production omitted still returns an arbitrary row and never echoes the resolved production
- source: legacy:35.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Omitted-production path left byte-identical under Rule #19 and disclosed in docs; preferred fix: add production to the get response envelope (additive).
- 2026-10-14T10:47:58Z status=routed owner=burndown by=migration note=Omitted-production path left byte-identical under Rule #19 and disclosed in docs
- 2026-10-15T11:47:33Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=fix in 38.0 [PRODITEM]: Add Production to the get SELECT and echo production in the get response (Interop.cls:438,463-474); additive; TS + live test
- 2026-10-15T14:29:56Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-10: fixed; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-451: [35-1-CR-7] No gate asserts the fixture production classes are byte-identical to their checked-in .cls after a suite run (Rule #58)
- source: legacy:35.1 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: RestoreFixtureBaseline restores values then SaveToClass re-serializes the XData; verified byte-identical now; add a post-suite comparison against iris_doc_get.
- 2026-10-14T10:47:58Z status=routed owner=burndown by=migration note=RestoreFixtureBaseline restores values then SaveToClass re-serializes the XData; verified byte-identical now
- 2026-10-15T11:47:34Z status=wontfix-accepted by=x0 note=reopen_if=git diff shows a change after exporting the InteropCompositeKeyFixtureProd*/InteropUnresolvableHostFixtureProd classes from the server post-suite; Fixture XData verified byte-identical after a suite run at Story 35.1

### DW-452: [35-1-CR-8] get and set may disagree on production-name matching semantics for a non-exact-case name (SQL collation vs dictionary ID lookup)
- source: legacy:35.1 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Same get/set disagreement family as 35-1-CR-6; set matches the add/remove idiom; pin with a differently-cased test then normalize across set/get/add/remove together.
- 2026-10-14T10:47:58Z status=routed owner=burndown by=migration note=Same get/set disagreement family as 35-1-CR-6; set matches the add/remove idiom
- 2026-10-15T11:47:34Z status=wontfix-theoretical by=x0 note=Production names are case-sensitive class names: a mis-cased set gets a clear not-found while get's SQL collation is lenient; no wrong-target write; real if two productions differed only by case

### DW-453: [35-2-DEV-1] ExecuteMCPv2.REST.UnitTest.RunTests() binds its I/O-redirect mnemonic on $IO itself instead of a throw-away null device
- source: legacy:35.2 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: The exact pattern Command.cls's historical >8KB bug documents; out of Story 35.2's Analytics-only scope; apply the null-device discipline and live-reproduce the RED oracle first (Rule #59).
- 2026-10-14T10:47:58Z status=routed owner=burndown by=migration note=The exact pattern Command.cls's historical >8KB bug documents; out of Story 35.2's Analytics-only scope
- 2026-10-15T11:47:34Z status=routed owner=40-1-line-coverage-probe-and-engine by=x0 note=owned by named story (orchestrator decision 2): UnitTest.cls:80-96 still binds the mnemonic on tInitIO, but POST /tests has no tool caller today; AC 40.1.2 + 40.1.4 choose and own that route for coverage
- 2026-10-18T07:31:54Z status=wontfix-accepted by=adjudication note=decision 40: coverage uses its own job-owned /dev/test/coverage routes and never calls RunTests; POST /tests keeps no tool caller and its class comment says so; RunTests code byte-identical; reopen_if=a tool caller is added for POST /tests, or a direct caller reports a truncated or mis-routed response from it

### DW-454: [35-2-CR-4] %BuildCube's narration is captured in full into %ExecuteMCPOutput (O(n^2) wstr) and then discarded; the obvious fix is forbidden
- source: legacy:35.2 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Cost real but bounded and negligible on observed builds; pVerbose=0 would destroy the gate's oracle; bound the capture at the sink while keeping pVerbose=1.
- 2026-10-14T10:47:58Z status=decision-pending owner=burndown by=migration note=call: bound the %BuildCube capture at the sink without losing the gate oracle, or accept O(n^2) narration
- 2026-10-15T11:47:34Z status=wontfix-accepted by=x0 note=decided=orchestrator(Lead-away) reopen_if=an iris_analytics_cubes:build is reported slow vs a terminal %BuildCube, or hits <MAXSTRING>/<STORE> in %ExecuteMCPOutput; cost bounded and negligible on observed builds; pVerbose=0 would destroy the gate oracle. Alt: bound the capture at the sink while keeping pVerbose=1

### DW-455: [35-2-CR-5] Redirect-restore sequence has two failure shapes in BOTH Command.cls and Analytics.cls
- source: legacy:35.2 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Inherited verbatim from Command.cls per AC 35.2.2 ('do not invent a mechanism'); fix in ONE cross-cutting story touching Command, Analytics and UnitTest (see 35-2-DEV-1).
- 2026-10-14T10:47:58Z status=routed owner=burndown by=migration note=Inherited verbatim from Command.cls per AC 35.2.2 ('do not invent a mechanism')
- 2026-10-15T11:47:34Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=fix in 38.0 [REDIRECT]: Replace Analytics.cls:272-274 and :323-325 restore sequences with Command.cls TeardownRedirect(tInitIO,tNull)
- 2026-10-15T14:29:56Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-8: Analytics.cls restores through Command.cls TeardownRedirect; BOOTSTRAP_VERSION 2159ec9e6f69 -> 3af8ca401e7c; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-456: [35-2-CR-6] AC 35.2.4's device-write audit is incomplete (Rule #56): grepping ReDirectIO cannot find APIs that write to the current device
- source: legacy:35.2 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Assessing ExternalThaw needs a real backup thaw on the shared dev instance; re-run by enumerating every external API call in the 17 REST classes and checking FormalSpec for verbosity/quiet parameters.
- 2026-10-14T10:47:58Z status=routed owner=burndown by=migration note=Assessing ExternalThaw needs a real backup thaw on the shared dev instance
- 2026-10-15T11:47:34Z status=wontfix-accepted by=x0 note=reopen_if=any REST handler returns a non-JSON or corrupted envelope traceable to an external API writing to the current device; Completing the audit needs a real backup thaw on the shared instance (forbidden); no stray device write observed

### DW-457: [35-2-CR-7] The SUCCESS path of iris_analytics_cubes:build has no permanent automated coverage (proven live twice, never re-proven)
- source: legacy:35.2 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Documented trade-off: a real DeepSee cube per default-suite run is a heavy dependency; add a success leg behind the availability probe if a DeepSee fixture is ever created.
- 2026-10-14T10:47:58Z status=routed owner=burndown by=migration note=Documented trade-off: a real DeepSee cube per default-suite run is a heavy dependency
- 2026-10-15T11:47:34Z status=wontfix-accepted by=x0 note=reopen_if=a DeepSee fixture cube is added to the repo, or a cube-build regression is reported; Success path proven live twice; a real DeepSee cube per default-suite run is a heavy dependency

### DW-458: [35-1-CR-21] enable/disable cannot reach an item whose host ClassName no longer resolves (Ens.Director.EnableConfigItem skips it)
- source: legacy:35.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Arguably correct (enabling a nonexistent class is meaningless) and the repair path now exists (set a valid className first); decide to document 'repair className first' or add a production parameter and a targeted error.
- 2026-10-14T10:47:58Z status=decision-pending owner=burndown by=migration note=call: document 'repair className first, then enable', or add a production param plus a targeted error
- 2026-10-15T11:47:34Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=decided=orchestrator(Lead-away) fix in 38.0 [DOCFIX]: Document in item.ts description + interop README: enable/disable skip items whose host class no longer resolves; repair with set settings.className first
- 2026-10-15T14:29:56Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-13: fixed; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-459: [35-1-CR-22] remove has no extent/XData re-sync when SaveToClass() fails
- source: legacy:35.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Pre-existing in remove; needs SaveToClass itself to fail (locked class, concurrent compile, read-only DB); on error call LoadFromClass to restore agreement; fault-injection test.
- 2026-10-14T10:47:58Z status=routed owner=burndown by=migration note=Pre-existing in remove; needs SaveToClass itself to fail (locked class, concurrent compile, read-only DB)
- 2026-10-15T11:47:34Z status=wontfix-accepted by=x0 note=reopen_if=a remove returns a SaveToClass error (locked class, concurrent compile, read-only DB) - then mirror set's LoadFromClass-on-error; remove (Interop.cls:894-897) returns SaveToClass's error without the LoadFromClass re-sync set does (:664); needs a locked class or read-only DB to fail

### DW-460: [35-1-CR-23] Composite-key fallback resolves only ONE of N same-named items (arbitrary $order-first)
- source: legacy:35.1 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Less reachable now that 35-1-CR-14 closed the add path that manufactured duplicates; remaining routes are direct Ens.Config.Item writes or a Management Portal edit.
- 2026-10-14T10:47:58Z status=routed owner=burndown by=migration note=Less reachable now that 35-1-CR-14 closed the add path that manufactured duplicates
- 2026-10-15T11:47:34Z status=wontfix-theoretical by=x0 note=Fallback runs only when FindItemByConfigName skips an unresolvable-class item; needs 2+ same-named items whose host classes BOTH no longer resolve

### DW-461: [35-1-CR-24] On the fallback path tFindStatus still holds ErrConfigItemNotFound though tItem was resolved
- source: legacy:35.1 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Coupled to 35-1-CR-2; close together by clearing tFindStatus to OK on fallback success.
- 2026-10-14T10:47:58Z status=routed owner=burndown by=migration note=Coupled to 35-1-CR-2; close together by clearing tFindStatus to OK on fallback success.
- 2026-10-15T11:47:34Z status=wontfix-theoretical by=x0 note=tFindStatus is never read after the fallback (Interop.cls:546-585), so its stale value is inert; becomes real only if DW-446 starts reading it (fix together then)

### DW-462: [35-1-CR-25] The 8-line composite-key fallback block is duplicated verbatim into set and remove
- source: legacy:35.1 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Both copies byte-identical and correct; extract ResolveItemWithFallback(pProd,pProdName,pItemName) helper; extraction touches finished Tasks 1-6 code for no behavioral gain.
- 2026-10-14T10:47:58Z status=routed owner=burndown by=migration note=Both copies byte-identical and correct; extract ResolveItemWithFallback(pProd,pProdName,pItemName) helper
- 2026-10-15T11:47:34Z status=wontfix-accepted by=x0 note=reopen_if=a third copy of the composite-key fallback is needed, or the two copies diverge; Two byte-identical, correct copies (Interop.cls:565-573, 877-885)

### DW-463: [35-1-CR-26] is listed in the File List but not updated and carries three false statements
- source: legacy:35.1 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: QA agent's artifact, out of the reviewer's remit; add a superseded-section entry recording 401/401, the two review HIGHs and 35-1-CR-1 terminal.
- 2026-10-14T10:47:58Z status=routed owner=burndown by=migration note=QA agent's artifact, out of the reviewer's remit; add a superseded-section entry recording 401/401
- 2026-10-15T11:47:34Z status=wontfix-theoretical by=x0 note=Closed Story 35.1 QA artifact; record-only with no code or doc consumer; Epic 35 retro already done; real only if a later gate re-read it

### DW-464: [35-1-CR-27] Every 'ledger state after this pass' figure is chained delta arithmetic mislabeled mechanical
- source: legacy:35.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Base terms are inherited claims; registry rows and per-revision rows mix; add a machine-readable row-type marker then re-baseline once from a real count.
- 2026-10-14T10:47:58Z status=dropped owner=35-1-production-item-set-composite-key by=migration note=obsolete: the new ledger tool derives counts mechanically

### DW-465: [35-1-CR-28] Orphaned Ens.Config.Production extent row ExecuteMCPv2.Temp.Story172Prod on the live HSCUSTOM instance (class gone, zero items)
- source: legacy:35.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Leftover disposable-probe residue from Story 17.2; deleting another story's live-server residue is a lead call; add an extent-level check to the probe cleanup convention.
- 2026-10-14T10:47:58Z status=decision-pending owner=burndown by=migration note=human=lead deletes the orphan Ens.Config.Production row on the live HSCUSTOM instance
- 2026-10-15T11:47:34Z status=dropped by=x0 note=decided=orchestrator(Lead-away) obsolete: orphan already gone: live read-only SELECT on HSCUSTOM Ens_Config.Production (2026-10-15) returns only the 3 Tests fixture rows, no ExecuteMCPv2.Temp.* row

### DW-466: [35-3-CR-1] No per-profile acceptLanguage override; an unrecognized IRIS_PROFILES key is dropped in silence
- source: legacy:35.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Explicitly scoped out by the story; silent-drop is pre-existing generic behavior; either add acceptLanguage to ProfileOverride or warn per entry on unrecognized keys.
- 2026-10-14T10:47:58Z status=wontfix-accepted owner=35-3-pin-request-locale-error-text by=migration note=reopen_if=an operator needs a per-profile Accept-Language or loses a typo'd IRIS_PROFILES key

### DW-467: [35-3-CR-2] The effective Accept-Language pin is not observable at runtime (not in the roster allow-list; nothing logs it)
- source: legacy:35.3 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: A roster field would move a documented response shape (Constraint E-1 forbids); a logger.debug at IrisHttpClient construction is safe but a product call.
- 2026-10-14T10:47:58Z status=routed owner=burndown by=migration note=A roster field would move a documented response shape (Constraint E-1 forbids)
- 2026-10-15T11:47:34Z status=wontfix-accepted by=x0 note=reopen_if=a user reports locale-mismatched %Status text and cannot tell which Accept-Language was sent; Constraint E-1 forbids a roster field; a logger.debug is safe but nobody has needed it

### DW-468: [35-3-CR-3] The default literal en-US,en;q=0.9 is hand-duplicated across 7 doc surfaces with no doc-rot guard
- source: legacy:35.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Same shape as every env-var default row; add one cross-package doc-rot test in packages/iris-mcp-all parsing each README env table against values from @iris-mcp/shared (Rule #45).
- 2026-10-14T10:47:58Z status=wontfix-accepted owner=35-3-pin-request-locale-error-text by=migration note=reopen_if=the documented Accept-Language default drifts from DEFAULT_ACCEPT_LANGUAGE

### DW-469: [35-3-CR-4] Documented IRIS_NAMESPACE default (USER) is wrong in all 7 env-var tables; config.ts defaults to HSCUSTOM
- source: legacy:35.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Pre-existing and outside Story 35.3's ACs; lead decides the direction: correct 7 docs to HSCUSTOM or change the code default to USER (HSCUSTOM is a local dev artifact).
- 2026-10-14T10:47:58Z status=decision-pending owner=burndown by=migration note=call: documented IRIS_NAMESPACE default (USER) vs code default (HSCUSTOM) - fix the docs or the code
- 2026-10-15T11:47:34Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=decided=orchestrator(Lead-away) fix in 38.0 [NSDEFAULT]: config.ts:131 default -> USER (matches all 7 env tables; HSCUSTOM is HealthShare-only); update config.test.ts:34 + JSDoc :82; maintainer sets IRIS_NAMESPACE=HSCUSTOM
- 2026-10-15T14:29:56Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-3: fixed; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-470: [35-4-DEV-1] iris_resource_manage:listPrivileges' system parameter is read server-side but never sent by the tool
- source: legacy:35.4 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: SqlPrivilegeList reads system but resource.ts declares no zod field and never sets qs system (Rule #10 gap); fix: optional system boolean forwarded when true plus a wire-forwarding test.
- 2026-10-14T10:47:58Z status=routed owner=burndown by=migration note=SqlPrivilegeList reads system but resource.ts declares no zod field and never sets qs system (Rule #10 gap)
- 2026-10-15T11:47:34Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=fix in 38.0 [LISTPRIV]: Add optional system boolean to resource.ts listPrivileges and forward system=1 when true (Security.cls:3356 reads it) + wire test
- 2026-10-15T14:29:56Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-9: fixed; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-471: [35-4-CR-2] tRS is not closed when an exception escapes either fetch loop of SqlPrivilegeList (or the Execute()-error exits)
- source: legacy:35.4 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Pre-existing pattern across Security.cls %ResultSet handlers; sweep the file's handlers together closing the cursor on every exit path.
- 2026-10-14T10:47:58Z status=routed owner=burndown by=migration note=Pre-existing pattern across Security.cls %ResultSet handlers; sweep the file's handlers together closing the cursor
- 2026-10-15T11:47:34Z status=wontfix-theoretical by=x0 note=Same as DW-40 (Security.cls SqlPrivilegeList): %ResultSet %OnClose closes the cursor when the method-local tRS is released; real only if tRS outlived the method

### DW-472: [35-4-CR-3] On the raw REST path degenerate maxRows values are silently coerced
- source: legacy:35.4 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Deliberately mirrors the in-file AuditStatus clamp idiom the Dev Notes instructed; reject-with-400 vs clamp-and-echo is a cross-handler policy decision.
- 2026-10-14T10:47:58Z status=decision-pending owner=burndown by=migration note=call: reject degenerate maxRows with a 400, or clamp and echo (cross-handler policy)
- 2026-10-15T11:47:34Z status=by-design by=x0 note=decided=orchestrator(Lead-away) TS rejects non-int/<=0 (resource.ts:179-183) and documents the >1000 clamp; coercion affects only raw-REST callers, matching AuditStatus's clamp. Alt: 400 on degenerate values

### DW-473: [35-4-CR-4] A malformed target reaches UserColumnPrivs unvalidated and surfaces a raw <SUBSCRIPT> 500
- source: legacy:35.4 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: $Piece(tTarget,'.',1)/(2,*) with no shape check: target=NoDotHere gives ERROR #5001 <SUBSCRIPT>SQLUserColumnPrivsExecute (live-captured); validate exactly one dot with non-empty pieces; a QA test currently pins the 500.
- 2026-10-14T10:47:58Z status=routed owner=burndown by=migration note=$Piece(tTarget,'.',1)/(2,*) with no shape check: target=NoDotHere gives ERROR #5001
- 2026-10-15T11:47:34Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=fix in 38.0 [LISTPRIV]: Validate listPrivileges target has exactly one '.' with non-empty pieces before $Piece (Security.cls ~3388) -> clear error; update the QA test pinning the 500
- 2026-10-15T14:29:56Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-9: fixed; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-474: [35-4-CR-5] Whether the underlying stored procedure resolves GRANTEE names case-insensitively is unverified
- source: legacy:35.4 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Handler forwards grantee verbatim to %SQL.Manager.CatalogPriv:UserPrivs; unverified either direction; needs its own live probe with case-varied names.
- 2026-10-14T10:47:58Z status=wontfix-accepted owner=35-4-bound-list-privileges by=migration note=reopen_if=UserPrivs grantee case variants give inconsistent results across tools

### DW-475: [35-4-CR-6] The %All/cap signal fields (superUserPrivilegesOmitted, reason) repeat on every page including an empty past-the-end page
- source: legacy:35.4 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Direct consequence of the signal-preserving spread chosen over audit.ts's field-dropping rebuild; page-scoped vs response-scoped fields is a pagination-contract question across sibling list tools.
- 2026-10-14T10:47:58Z status=decision-pending owner=burndown by=migration note=call: emit %All/cap signal fields on the first page only (or under summary) across list tools
- 2026-10-15T11:47:34Z status=by-design by=x0 note=decided=orchestrator(Lead-away) the signal fields describe the query, not the page; repeating them lets a caller reading any page see the %All omission (35.4 spread choice). Alt: first page only across list tools

### DW-476: [35-4-CR-7] Rule #34 second-namespace smoke neither performed nor recorded as a residual risk for listPrivileges
- source: legacy:35.4 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: All live proof ran in one namespace; risk genuinely low (maxRows cap and %All short-circuit are namespace-independent); on the next touch run the three probes against a second namespace.
- 2026-10-14T10:47:58Z status=decision-pending owner=burndown by=migration note=human=run the three listPrivileges probes against a second namespace with a different SQL object population
- 2026-10-15T11:47:34Z status=resolved-by:38-0-epic-37-deferred-cleanup by=x0 note=decided=orchestrator(Lead-away) done live read-only 2026-10-15: _SYSTEM USER count 4/omitted 3112 vs HSCUSTOM count 5 rowsCapped/omitted 15222; USER column-level ok: namespace differs, guards hold

### DW-477: [35-5-DEV-1] iris_oauth_manage delete with entity client can never succeed (OAuth2.Client.Delete(name) does not exist; only DeleteId)
- source: legacy:35.5 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Branch pre-checks OAuth2.Client.%ExistsId and uses DeleteId; same defect family and handler as 35-SWEEP-6; never spent a cycle open.
- 2026-10-14T10:47:58Z status=resolved-by:35-5-validate-before-delegating-oauth-restname owner=35-5-validate-before-delegating-oauth-restname by=migration note=Branch pre-checks OAuth2.Client.%ExistsId and uses DeleteId; same defect family and handler as 35-SWEEP-6

### DW-478: [35-5-DEV-2] iris_oauth_list cannot list the OAuth2.ServerDefinition rows that serverName references
- source: legacy:35.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Lists OAuth2_Server.Configuration and OAuth2.Client but not discovered-issuer definitions; add an additive serverDefinitions array (IssuerEndpoint, SSLConfiguration, IsDiscovery, endpoints).
- 2026-10-14T10:47:58Z status=wontfix-accepted owner=35-5-validate-before-delegating-oauth-restname by=migration note=reopen_if=a user asks to enumerate OAuth2 server definitions through iris_oauth_list

### DW-479: [35-5-SMOKE-1] iris_interop_rest:delete leaves the generated .impl class behind
- source: legacy:35.5 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: iris_interop_rest description and the interop README example now state the .impl contract (registration removed; impl class preserved by design).
- 2026-10-14T10:47:58Z status=resolved-by:35-8-docs-artifact-rollup-epic-gate owner=35-5-validate-before-delegating-oauth-restname by=migration note=iris_interop_rest description and the interop README example now state the .impl contract

### DW-480: [35-6-CR-1] iris_doc_xml_export:import partial compile/load failure is visible in structuredContent without isError
- source: legacy:35.6 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Partial failure stays in structuredContent without isError; that is the suite convention.
- 2026-10-14T10:47:58Z status=by-design owner=35-6-xml-import-compile-and-legacy-rest-get by=migration note=Partial failure stays in structuredContent without isError; that is the suite convention.

### DW-481: [35-7-QA-1] iris_docdb_manage:list live structuredContent is {content:[...]} not the unit-pinned {items,count}
- source: legacy:35.7 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Live list payload is plain JSON with a content key so toStructured never wraps it; no protocol violation; decide the canonical DocDB list shape and align tests to live captures.
- 2026-10-14T10:47:58Z status=decision-pending owner=burndown by=migration note=call: canonical DocDB list shape - {content} passthrough or {items,count} wrap
- 2026-10-15T11:47:34Z status=wontfix-accepted by=x0 note=decided=orchestrator(Lead-away) reopen_if=a throwaway IRIS with %Service_DocDB enabled exists (Story 42.3 scripts/ci-throwaway.sh) or a user reports an empty typed-property iris_docdb_find; cut from 38.0 by orchestrator; keep passthrough (no client-visible change). Alt: unwrap content arrays to {items,count}. Capture needs %Service_DocDB enabled (lead write) or the 35.7 QA capture

### DW-482: [35-7-QA-2] Older IRIS versions reportedly fail disabled-DocDB with ERROR #800 / HTTP 403 rather than 200+822
- source: legacy:35.7 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Residual-risk note: native #800 text already names the service and its state; no action on 2026.1.
- 2026-10-14T10:47:58Z status=wontfix-theoretical owner=35-7-docdb-prerequisite-error-and-docs by=migration note=real_if=an IRIS version that returns ERROR #800 / HTTP 403 for disabled DocDB becomes a supported target

### DW-483: [35-9-DEV-1] A PUT /doc/{name} name/content mismatch arrives as a string-typed status field the shared HTTP client never throws on
- source: legacy:35.9 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Fixed per-caller in iris_doc_load's upload loop (BOM strip at read plus string-status inspection) with live proof; NOT in the shared HTTP client so iris_doc_put still does not inspect it.
- 2026-10-14T10:47:58Z status=resolved-by:35-9-doc-load-package-prefix-validation owner=35-9-doc-load-package-prefix-validation by=migration note=Fixed per-caller in iris_doc_load's upload loop (BOM strip at read plus string-status inspection) with live proof

### DW-484: [35-9-DEV-2] Prompt text for deployAndTestClass/objectscriptReview still says a bare path 'mis-maps the class name'
- source: legacy:35.9 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Wording replaced with the post-35.9 REFUSAL contract on four prompt surfaces (two prompt sources and two regenerated skills).
- 2026-10-14T10:47:58Z status=resolved-by:35-8-docs-artifact-rollup-epic-gate owner=35-9-doc-load-package-prefix-validation by=migration note=Wording replaced with the post-35.9 REFUSAL contract on four prompt surfaces

### DW-485: [35-9-CR-1] iris_doc_put has no string-typed result.status inspection, no BOM strip, and reports success unconditionally
- source: legacy:35.9 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: A BOM-bearing doc_put is the same live silent-drop class as 35-9-DEV-1 (server stores nothing; status carries ERROR #16021); decide whether doc_put should set isError on a non-empty string status.
- 2026-10-14T10:47:58Z status=routed owner=burndown by=migration note=A BOM-bearing doc_put is the same live silent-drop class as 35-9-DEV-1
- 2026-10-15T11:47:34Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=fix in 38.0 [DOCPUT]: doc.ts:211-229: strip leading U+FEFF (as load.ts:404-410) and set isError when response.result.status is a non-empty string; BOM + status tests
- 2026-10-15T14:29:56Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-1: fixed; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-486: [L34.retro7-5-reevaluate-34-8-cr-1-charset-and-ceiling-against-beta] Epic 34/35 retro: re-evaluate 34-8-CR-1 (%request.CharSet)
- source: legacy:34.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Both were deferred on the reasoning that every client is ours, which beta invalidates; the trigger evidence does not exist until beta runs; 34-8-CR-1/-2 join the Epic 37 forward obligation.
- 2026-10-14T10:47:58Z status=decision-pending owner=burndown by=migration note=human=review beta feedback for non-UTF-8 charset clients and oversized responses, then decide on 34-8-CR-1
- 2026-10-15T11:47:34Z status=dropped by=x0 note=decided=orchestrator(Lead-away) duplicate of DW-421 (charset) and DW-411 (ceiling); both halves are dispositioned terminally; the beta premise fails for charset because every request still comes from IrisHttpClient. Alt: keep open as a beta-review item

### DW-487: [L34.retro7-6-define-epic-35] Epic 34 retro: define Epic 35 (epics.md topped out at 34)
- source: legacy:34.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Epic 35 was defined in epics.md 2026-08-17 with 9 stories, Constraints E-1/E-2 and the branching decision; sprint planning reconciled all keys.
- 2026-10-14T10:47:58Z status=resolved-by:unknown owner=34-0-epic-33-deferred-cleanup by=migration note=Epic 35 was defined in epics.md 2026-08-17 with 9 stories, Constraints E-1/E-2 and the branching decision

### DW-488: [L35.retro-rule-candidate-60-region-scoped-edits] Epic 35 retro rule candidate #60
- source: legacy:35.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Not codified as a rule; carried as a convention into the Epic 36 story files.
- 2026-10-14T10:47:59Z status=wontfix-accepted owner=35-0-epic-34-deferred-cleanup by=migration note=not codified as a rule; kept as a convention; reopen_if=another region-scoped edit tooling incident occurs

### DW-489: [L35.retro-rule-candidate-61-tsbuildinfo-masks-dist-state] Epic 35 retro rule candidate #61 (tsbuildinfo masks dist state) - NOT codified
- source: legacy:35.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Not codified as a rule; carried as a convention into the Epic 36 story files.
- 2026-10-14T10:47:59Z status=wontfix-accepted owner=35-0-epic-34-deferred-cleanup by=migration note=not codified as a rule; kept as a convention; reopen_if=a stale tsbuildinfo again masks missing dist output

### DW-490: [36-0-QA-1] @iris-mcp/dev request-body-utf8-decode.test.ts non-ASCII JSON KEY test omits the fixtureSkipReason guard its three siblings
- source: legacy:36.0 | severity: med | fix-risk: low | footprint: out-of-footprint
- evidence: With the Rule #39 hand-load-only fixture undeployed it surfaces isError:true instead of skipping (695 passed/16 skipped/1 failed); one-line test-file fix at L305: if (skipReason || fixtureSkipReason).
- 2026-10-14T10:47:59Z status=routed owner=burndown by=migration note=With the Rule #39 hand-load-only fixture undeployed it surfaces isError:true instead of skipping
- 2026-10-15T11:47:34Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=fix in 38.0 [SUITE-GREEN]: request-body-utf8-decode.test.ts:305: if (skipReason || fixtureSkipReason)
- 2026-10-15T14:29:56Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-4: fixed; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-491: [36-0-QA-2] OS AdvisorDataTest.TestRunExplainProducesPlanText pins an IDKEY plan on Ens_Config.Item
- source: legacy:36.0 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Does not reproduce in isolation; root cause open; re-run the full package to check order-dependence or relax the assertion to tolerate either plan shape.
- 2026-10-14T10:47:59Z status=wontfix-accepted owner=36-0-epic-35-deferred-cleanup by=migration note=reopen_if=AdvisorDataTest.TestRunExplainProducesPlanText fails again in a full-package run

### DW-492: [36-0-QA-3] OS MessageResendTest real-resend methods have no existence/skip guard for the external SessionAgent.Sample.Production dependency
- source: legacy:36.0 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Deterministic always-reproducing false-FAIL on a standard instance (2 of the OS suite's 3 failures); add a class-existence probe and skip with a stated reason when absent.
- 2026-10-14T10:47:59Z status=routed owner=burndown by=migration note=Deterministic always-reproducing false-FAIL on a standard instance (2 of the OS suite's 3 failures)
- 2026-10-15T11:47:35Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=fix in 38.0 [SUITE-GREEN]: MessageResendTest.cls:420,483: %Dictionary.CompiledClass %ExistsId('SessionAgent.Sample.Production') guard -> $$$LogMessage skip reason, Quit
- 2026-10-15T14:29:56Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-4: fixed; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-493: [36-1-QA-1] The runIndexSource counter fallback can misattribute a completely unrelated concurrent run's index to the caller's
- source: legacy:36.1 | severity: high | fix-risk: med | footprint: out-of-footprint
- evidence: The counter fallback now applies ONLY to a COMPLETED run whose queue-node capture never succeeded (attributeRunIndexByCounter); a still-running unobserved result reports runIndex null with a runIndexNote.
- 2026-10-14T10:47:59Z status=resolved-by:36-1-execute-tests-running-contract-and-handles owner=36-1-execute-tests-running-contract-and-handles by=migration note=The counter fallback now applies ONLY to a COMPLETED run whose queue-node capture never succeeded

### DW-494: [36-1-QA-2] The handles-on-every-path trade-off ('a run resolving within its first ~400ms') is empirically the COMMON case for everyday
- source: legacy:36.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Lead ruling (AC 36.1.5 wins; AC 36.1.7 amended in place): counter snapshot read BEFORE POST /work, queue node read from the FIRST still-running poll, HANDLE_CAPTURE_THRESHOLD_POLLS removed; every null runIndex carries a note.
- 2026-10-14T10:47:59Z status=resolved-by:36-1-execute-tests-running-contract-and-handles owner=36-1-execute-tests-running-contract-and-handles by=migration note=Lead ruling (AC 36.1.5 wins; AC 36.1.7 amended in place): counter snapshot read BEFORE POST /work

### DW-495: [36-1-QA-3] client-config certification-process.test.ts project-scope drift test fails deterministically on macOS
- source: legacy:36.1 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: macOS-only path-assertion mismatch, not a product defect; resolve the expected path through fs.realpathSync(tmpdir()) or assert on a suffix/basename.
- 2026-10-14T10:47:59Z status=routed owner=burndown by=migration note=macOS-only path-assertion mismatch, not a product defect; resolve the expected path through fs.realpathSync(tmpdir())
- 2026-10-15T11:47:35Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=fix in 38.0 [SUITE-GREEN]: certification-process.test.ts:76: mkdtemp under fs.realpathSync(tmpdir()) (macOS /var -> /private/var)
- 2026-10-15T14:29:56Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-4: fixed; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-496: [36-1-QA-4] client-config engine-e2e.test.ts 'restore by NAME across a chain' fails intermittently (2 of 5 standalone runs)
- source: legacy:36.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Test-suite reliability defect masking real regressions with a flake; suspect module-level mutable state in write.ts/the engine; containment: pin vitest pool to forks.
- 2026-10-14T10:47:59Z status=routed owner=burndown by=migration note=Test-suite reliability defect masking real regressions with a flake
- 2026-10-15T11:47:35Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=fix in 38.0 [FLAKE]: Probe-first: loop engine-e2e 'restore by NAME across a chain' x10, root-cause module state in write.ts; containment: vitest pool forks
- 2026-10-15T14:29:56Z status=wontfix-accepted by=adjudication note=reopen_if=engine-e2e 'restore by NAME across a chain' fails again in a standalone run on a clean tree; never reproduced (10-run probe + ~1230 plan-time runs); containment shipped in 05b26d9 (strictly increasing injected clock, checkDistFresh beforeAll) without a proven effect, so not claimed resolved

### DW-497: [36-1-QA-5] gen-skills-stray-file.test.ts may leave a disposable skills/audit-security-posture/NOTES.md behind if interrupted or timed out
- source: legacy:36.1 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Low-likelihood race gated on process interruption/timeout, self-limiting; move rmSync cleanup into afterEach and give execFileSync an explicit timeout.
- 2026-10-14T10:47:59Z status=routed owner=burndown by=migration note=Low-likelihood race gated on process interruption/timeout, self-limiting
- 2026-10-15T11:47:35Z status=wontfix-accepted by=x0 note=reopen_if=skills/audit-security-posture/NOTES.md appears in git status after a test run; Needs interruption or timeout mid-test; self-limiting

### DW-498: [36-1-CR-1] iris_execute_tests still declares idempotentHint:true (and readOnlyHint:true) though its documented contract is do NOT re-submit
- source: legacy:36.1 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: A client trusting annotations may retry freely, the damage vector the running contract removes; set idempotentHint:false, re-evaluate readOnlyHint with the BASELINE_ACTION_CLASSIFICATIONS cross-check (#44) and update the annotation pins.
- 2026-10-14T10:47:59Z status=routed owner=burndown by=migration note=A client trusting annotations may retry freely, the damage vector the running contract removes
- 2026-10-15T11:47:35Z status=routed owner=40-4-test-depth-docs-prompt-and-capstone by=x0 note=owned by named story (orchestrator decision 2): AC 40.4.3 names DW-498 explicitly (readOnlyHint/idempotentHint vs the write classification and the do-not-resubmit contract)
- 2026-10-19T01:32:46Z status=resolved-by:40-4-test-depth-docs-prompt-and-capstone by=adjudication note=iris_execute_tests declares readOnlyHint:false and idempotentHint:false (decision 63); no key, classification or baseline moved; a reverse-direction pin with no allowlist, derived from the built servers, keeps any write-classified tool from declaring readOnlyHint:true; build 27d04e5 + review patches 36d2f90; mutation-verified (spec-40-4 Verification); lead smoke: 9 Epic 40 gates armed 262/262

### DW-499: [36-1-CR-2] The iris_execute_tests wait budget bounds only the poll loop's START condition
- source: legacy:36.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Fix: per-request timeout of max(1, deadline-now) on in-loop GETs, skip the post-loop counter read past the deadline, guarantee at least one poll; pin with the TestClock seam.
- 2026-10-14T10:47:59Z status=wontfix-accepted owner=36-1-execute-tests-running-contract-and-handles by=migration note=reopen_if=iris_execute_tests overruns the client timeout because a poll GET stalls near the deadline

### DW-500: [36-1-CR-3] Every running result leaves its Atelier queue node and detached WQM token in IRISTEMP
- source: legacy:36.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: iris_test_status:poll's jobId path issues GET /work/{jobId} on re-attach, draining the queue node as the item suggested.
- 2026-10-14T10:47:59Z status=resolved-by:36-2-test-status-companion-tool owner=36-1-execute-tests-running-contract-and-handles by=migration note=iris_test_status:poll's jobId path issues GET /work/{jobId} on re-attach

### DW-501: [36-2-QA-1] README preset-rationale bullet still said the full 28-tool server after the Story 36.2 count rollup
- source: legacy:36.2 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: One-word correction in a file the story owns; git grep 28-tool returns zero hits after; iris-mcp-all suite 129/129 unchanged.
- 2026-10-14T10:47:59Z status=resolved-by:36-2-test-status-companion-tool owner=36-2-test-status-companion-tool by=migration note=One-word correction in a file the story owns; git grep 28-tool returns zero hits after

### DW-502: [36-2-CR-1] ExecuteMCPv2.REST.Global:BuildGlobalRef wraps subscripts in quotes without doubling an embedded quote then evaluates
- source: legacy:36.2 | severity: high | fix-risk: med | footprint: out-of-footprint
- evidence: BuildGlobalRef no longer evaluates caller text (escape-in-place chosen over $Name which canonicalizes numeric-looking strings); audit found no other caller-influenced indirection in src/ExecuteMCPv2.
- 2026-10-14T10:47:59Z status=resolved-by:36-4-global-subscript-injection owner=36-2-test-status-companion-tool by=migration note=BuildGlobalRef no longer evaluates caller text

### DW-503: [36-3-DEV-1] client-config certify.mjs final step unconditionally merges results into the REAL scripts/certification-results.json
- source: legacy:36.3 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Reproduced live during 33-5-L10 mutation-testing; make the merge target injectable or gate the real-file merge behind an explicit --commit-results flag.
- 2026-10-14T10:47:59Z status=routed owner=burndown by=migration note=Reproduced live during 33-5-L10 mutation-testing; make the merge target injectable or gate the real-file merge behind
- 2026-10-15T11:47:35Z status=wontfix-accepted by=x0 note=reopen_if=an unintended certification-results.json change is committed, or certify.mjs is run from a test or mutation harness again; scripts/certification-results.json is checked in, so an unintended merge shows in git diff and is revertible

### DW-504: [36-3-QA-1] tsconfig.base.json __tests__ exclude removed test files from every tsc type-check and build gate across 7 packages
- source: legacy:36.3 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: The exclude is reverted; type-check and build proven RED->GREEN with a probe type error; tests kept out of tarballs via the files negation.
- 2026-10-14T10:47:59Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=36-3-rule-37-ledger-burn-down by=migration note=The exclude is reverted; type-check and build proven RED->GREEN with a probe type error

### DW-505: [36-3-QA-2] 34-4-R5/34-3-R6 RESOLVED evidence rests on a harness whose Setup/Teardown resets the same globals
- source: legacy:36.3 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: 34-4-R5 and 34-3-R6 re-dispositioned CLOSED-WITH-EVIDENCE on a mutation-verified pin taken outside the harness scrub.
- 2026-10-14T10:47:59Z status=resolved-by:36-3-rule-37-ledger-burn-down owner=36-3-rule-37-ledger-burn-down by=migration note=34-4-R5 and 34-3-R6 re-dispositioned CLOSED-WITH-EVIDENCE on a mutation-verified pin taken outside the harness scrub.

### DW-506: [36-3-CR-1] @iris-mcp/shared published package.json exports advertise ./test-helpers subpaths that the files list does not ship
- source: legacy:36.3 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Pre-existing since the subpaths were added; found by an exports-vs-tarball check; before the first publish drop the subpaths via publishConfig.exports or move them to a dev-only mechanism
- 2026-10-14T10:47:59Z status=routed owner=burndown by=migration note=Pre-existing since the subpaths were added; found by an exports-vs-tarball check
- 2026-10-15T02:51:51Z status=routed owner=42-1-pre-publish-package-fixes by=correct-course note=pre-publish fix table (decision-record-2026-10-14)
- 2026-10-16T19:38:36Z occurrence=39-0-epic-38-deferred-cleanup
- 2026-10-16T19:38:37Z note=39.0 plan 2026-10-16: dist/test-helpers/integration-config.* also ships in the shared tarball today (the inverse direction); Story 42.1 AC 42.1.3 should cover it
- 2026-10-16T23:53:09Z occurrence=39-0-epic-38-deferred-cleanup
- 2026-10-16T23:53:09Z note=39.0 implement: AC-7 pack-content gate deferred here; npm pack must list no __tests__/env-harness/startup-env path and no dist/test-helpers (Story 42.1 AC 42.1.3)
- 2026-10-17T00:45:43Z occurrence=39-0-epic-38-deferred-cleanup

### DW-507: [36-4-QA-1] BuildGlobalRef strips leading/trailing whitespace (incl. TAB) BEFORE the new control-character rejection runs
- source: legacy:36.4 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Control-character rejection REMOVED (36-4-CR-A): AC 36.4.2 lists control characters as stored and addressed as literal data; the rejection also covered $C(128)-$C(159) and broke pre-fix-addressable nodes; code and docs now agree.
- 2026-10-14T10:47:59Z status=resolved-by:36-4-global-subscript-injection owner=36-4-global-subscript-injection by=migration note=Control-character rejection REMOVED (36-4-CR-A): AC 36.4.2 lists control characters as stored and addressed

### DW-508: [36-4-CR-1] Silent downgrade on version skew - the bootstrap redeploys embedded classes on ANY version mismatch including a DOWNGRADE
- source: legacy:36.4 | severity: high | fix-risk: high | footprint: out-of-footprint
- evidence: probeCustomRest compares deployed hash vs embedded BOOTSTRAP_VERSION for equality only; fix: embed a monotonic seq:hash, add a newer status so bootstrap() does not redeploy; servers already built without it will always downgrade.
- 2026-10-14T10:47:59Z status=routed owner=burndown by=migration note=probeCustomRest compares deployed hash vs embedded BOOTSTRAP_VERSION for equality
- 2026-10-15T02:51:51Z status=routed owner=42-2-bootstrap-downgrade-guard by=correct-course note=pre-publish fix table (decision-record-2026-10-14); must land before 42.6 publishes

### DW-509: [36-4-CR-2] BuildGlobalRef's numeric test tSub = (+tSub) throws <MAXNUMBER> for a string key whose numeric prefix overflows (e.g. 1E999)
- source: legacy:36.4 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Such a string subscript cannot be addressed through iris_global_get/set/kill; not a safety issue; guard the numeric test in Try/Catch and pin 1E999 as a literal string subscript.
- 2026-10-14T10:47:59Z status=routed owner=burndown by=migration note=Such a string subscript cannot be addressed through iris_global_get/set/kill; not a safety issue
- 2026-10-15T11:47:35Z status=wontfix-theoretical by=x0 note=Needs a string subscript whose numeric prefix overflows (e.g. '1E999'); fails with an error and never touches the wrong node; real if such keys appeared in user data

### DW-510: [36-4-CR-3] Empty or whitespace-only subscript pieces leave positional gaps (1,,2 / ,1 / ' ' / ',') and surface an opaque <SYNTAX>
- source: legacy:36.4 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: No data is touched (kill-widening concern disproven); the Story 36.4 Traps forbid changing empty-piece semantics (Rule #19); reject with a clear 'empty subscript piece' error; every such input fails today.
- 2026-10-14T10:47:59Z status=routed owner=burndown by=migration note=No data is touched (kill-widening concern disproven); the Story 36.4 Traps forbid changing empty-piece semantics
- 2026-10-15T11:47:35Z status=wontfix-accepted by=x0 note=reopen_if=an agent loops on or reports an opaque <SYNTAX> from iris_global_get/set/kill caused by an empty subscript piece; Every such input already fails (opaque <SYNTAX>) and touches no data; Story 36.4 Traps freeze empty-piece semantics

### DW-511: [36-4-CR-4] The armed Epic 36 gates flake when run in parallel
- source: legacy:36.4 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Both gates predate 36.4 and run in parallel in prepublish-gate.mjs since 36.2; 4 of 5 prepublish-gate runs pass; run the two %UnitTest-driving gates sequentially and surface the Atelier work response in the error text.
- 2026-10-14T10:47:59Z status=routed owner=burndown by=migration note=Both gates predate 36.4 and run in parallel in prepublish-gate.mjs since 36.2; 4 of 5 prepublish-gate runs pass
- 2026-10-15T11:47:35Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=fix in 38.0 [SUITE-GREEN]: prepublish-gate.mjs:81: add --no-file-parallelism so the two %UnitTest-driving gates run sequentially; include the Atelier work response in the failure text
- 2026-10-15T14:29:56Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-4: fixed; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-512: [37-1-DEV-1] No opt-in strictness knob to restore fail-fast on an unreachable default profile (IRIS_STARTUP_STRICTNESS lenient/strict)
- source: legacy:37.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Speculative - no beta user has asked for fail-fast-on-unreachable; precedent exists (IRIS_SERVER_MANAGER off/auto/required); trigger: a beta user explicitly asks.
- 2026-10-14T10:47:59Z status=decision-pending owner=burndown by=migration note=call: add an IRIS_STARTUP_STRICTNESS lenient/strict knob when a beta user asks (trigger L-3)
- 2026-10-15T11:47:35Z status=wontfix-accepted by=x0 note=decided=orchestrator(Lead-away) reopen_if=a user requests fail-fast startup on an unreachable default profile; speculative, no user asked (trigger L-3); precedent IRIS_SERVER_MANAGER off/auto/required. Alt: add IRIS_STARTUP_STRICTNESS now

### DW-513: [37-1-DEV-2] iris_server_profiles reports no per-profile reachability (cannot answer 'is default currently reachable?')
- source: legacy:37.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: The discovery tool is deliberately connection-agnostic; a reachability field needs its own design (lastKnownReachable boolean|null from establishment attempts already made); trigger: a beta user asks.
- 2026-10-14T10:47:59Z status=decision-pending owner=burndown by=migration note=call: add a lastKnownReachable roster field when a beta user asks (trigger L-4)
- 2026-10-15T11:47:35Z status=wontfix-accepted by=x0 note=decided=orchestrator(Lead-away) reopen_if=a user asks iris_server_profiles to report per-profile reachability; the discovery tool is deliberately connection-agnostic (trigger L-4). Alt: add a lastKnownReachable roster field now

### DW-514: [37-1-DEV-3] health.ts ping() has no caller (comment refers to a nonexistent Story 1.4 monitoring loop)
- source: legacy:37.1 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Exported and used only by epic35-defect-gate.test.ts's availability probe; either wire a real periodic health-refresh (needs a design) or remove the stale comment and reclassify as a general-purpose utility.
- 2026-10-14T10:47:59Z status=routed owner=burndown by=migration note=Exported and used only by epic35-defect-gate.test.ts's availability probe
- 2026-10-15T11:47:35Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=fix in 38.0 [DOCFIX]: health.ts:5,53: remove the nonexistent Story 1.4 monitoring-loop references; describe ping() as a general availability probe
- 2026-10-15T14:29:56Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-13: fixed; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-515: [37-1-CR-1] The startup health-check catch does not distinguish a CONFIGURATION refusal
- source: legacy:37.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Follows Lead decision L-2 (non-fatal everywhere); spec-wording-vs-code seam; decide whether M1 clause (1) says 'unreachable-or-refusing never exits' or HEALTH_CHECK_FAILED should fail fast via error.code.
- 2026-10-14T10:47:59Z status=decision-pending owner=burndown by=migration note=call: amend M1 clause (1) to 'unreachable-or-refusing never exits', or fail fast on HEALTH_CHECK_FAILED
- 2026-10-15T11:47:35Z status=by-design by=x0 note=decided=orchestrator(Lead-away) Lead decision L-2 (non-fatal everywhere); README:541 documents 401/403/404 refusals as non-fatal; amend spine M1 clause (1) wording. Alt: fail fast on HEALTH_CHECK_FAILED

### DW-516: [37-1-CR-2] After a degraded start the first default call runs the full custom-REST bootstrap INSIDE the request
- source: legacy:37.1 | severity: med | fix-risk: high | footprint: out-of-footprint
- evidence: Only checkHealth is bounded (5 s); negotiateVersion uses the 60 s timeout and bootstrap() has no deadline; reintroduces the Epic 36 client-ceiling problem; give establishProfile an overall deadline and clear a timed-out establishing entry.
- 2026-10-14T10:47:59Z status=routed owner=burndown by=migration note=Only checkHealth is bounded (5 s); negotiateVersion uses the 60 s timeout and bootstrap() has no deadline
- 2026-10-15T11:47:35Z status=wontfix-accepted by=x0 note=reopen_if=a first default-profile tool call after a degraded start exceeds the client's request timeout; Same lazy first-touch cost every non-default profile has had since D8; bootstrap short-circuits when deployed hash equals embedded (common case)

### DW-517: [37-1-CR-3] No negative cache or backoff while default is down: every call re-runs the health check
- source: legacy:37.1 | severity: med | fix-risk: high | footprint: out-of-footprint
- evidence: Extends the retry-on-every-touch semantics of AC 14.2.8 to default; a cooldown changes retry semantics for every profile and needs a design; cache {lastFailureAt,error} per profile with a documented window.
- 2026-10-14T10:47:59Z status=decision-pending owner=burndown by=migration note=call: add a per-profile failure cooldown/negative cache (window, scope) to stop ~5 s stalls per call
- 2026-10-15T11:47:35Z status=by-design by=x0 note=decided=orchestrator(Lead-away) AC 14.2.8 retry-on-every-touch (a failed first touch is retryable next call); a cooldown delays recovery for every profile. Alt: per-profile negative cache with a window

### DW-518: [37-1-CR-4] The new default-suite live gate epic37-default-outage-gate MUTATES the target instance on first touch
- source: legacy:37.1 | severity: med | fix-risk: high | footprint: out-of-footprint
- evidence: Unavoidable inside AC 37.1.8; harmless at the embedded BOOTSTRAP_VERSION; interacts with open HIGH 36-4-CR-1 (running from an older branch could reinstall a pre-36.4 Global.cls)
- 2026-10-14T10:47:59Z status=decision-pending owner=burndown by=migration note=call: may a default-suite test deploy? else gate the 'other' leg on IRIS_REQUIRE_LIVE
- 2026-10-15T11:47:35Z status=routed owner=42-2-bootstrap-downgrade-guard by=x0 note=decided=orchestrator(Lead-away) owned by named story (orchestrator decision 2): first-touch deploy = every server's normal bootstrap, idempotent at equal version; the harmful half (older branch reinstalling pre-36.4 Global.cls) is DW-508, closed by AC 42.2.2

### DW-519: [37-1-CR-5] The headline 'recovers automatically, no restart' promise has no LIVE proof
- source: legacy:37.1 | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Proving it live needs default pointed at something initially closed that later serves real IRIS and would run a real bootstrap() write on the shared instance, which the epic forbids; needs a disposable IRIS instance.
- 2026-10-14T10:47:59Z status=decision-pending owner=burndown by=migration note=human=provide a disposable/throwaway IRIS instance (container or CI service) to prove the default-profile recovery
- 2026-10-15T11:47:35Z status=wontfix-accepted by=x0 note=decided=orchestrator(Lead-away) reopen_if=scripts/ci-throwaway.sh (Story 42.3) exists - then add a live default-recovery leg against the throwaway; needs a disposable IRIS and the shared instance forbids the bootstrap write; Story 42.3 adds scripts/ci-throwaway.sh. Alt: provide a container now

### DW-520: [37-1-CR-6] A MID-SESSION outage returns different error text than the docs tell agents to expect
- source: legacy:37.1 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Correct as designed (re-checking health per call would undo the D1/D8 caching contract); only the doc wording overreaches; narrow the docs to 'unreachable at startup' or normalize the two paths.
- 2026-10-14T10:47:59Z status=routed owner=burndown by=migration note=Correct as designed (re-checking health per call would undo the D1/D8 caching contract)
- 2026-10-15T11:47:35Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=fix in 38.0 [DOCFIX]: README.md:541: scope the 'existing connection-error envelope' claim to unreachable-at-startup; mid-session outages surface the raw request error
- 2026-10-15T14:29:57Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-13: fixed; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-521: [37-1-CR-7] A negotiation failure pins default to Atelier v1 for the life of the process with no recovery path
- source: legacy:37.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: If the instance answers the health HEAD but dies before the negotiation GET, defaultEstablished stays true and profileMeta is seeded with atelierVersion 1; treat a negotiation failure like a health failure.
- 2026-10-14T10:47:59Z status=wontfix-accepted owner=37-1-default-profile-outage-degrade-and-retry by=migration note=reopen_if=a transient failure between health check and negotiation leaves default pinned to Atelier v1

### DW-522: [37-1-CR-8] bootstrapAttempted:true is recorded when bootstrap() THREW, so a wobbling instance never re-attempts bootstrap for the life
- source: legacy:37.1 | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: attemptProfileBootstrap swallows failures identically on eager and lazy paths; record the flag only on a bootstrap that did not throw, or add a bootstrapFailed marker.
- 2026-10-14T10:47:59Z status=wontfix-accepted owner=37-1-default-profile-outage-degrade-and-retry by=migration note=reopen_if=bootstrap throws once and the instance never gets the embedded classes until restart

### DW-523: [37-1-CR-9] Double 'IRIS health check failed:' prefix on the refusal path (checkHealth wraps and start() prefixes again)
- source: legacy:37.1 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: health.ts is outside this story's scope; more visible now that the startup log is the only diagnostic on a path that no longer exits; drop the redundant prefix (Rule #8 discipline).
- 2026-10-14T10:47:59Z status=routed owner=burndown by=migration note=health.ts is outside this story's scope; more visible now that the startup log is the only diagnostic on a path
- 2026-10-15T11:47:35Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=fix in 38.0 [DOCFIX]: server-base.ts:2071: log the message as-is (checkHealth already prefixes, health.ts:42); update the 2 test pins
- 2026-10-15T14:29:57Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-12: fixed; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-524: [37-1-CR-10] The Epic 37 live gate checks dist EXISTENCE not dist FRESHNESS (a dist built from pre-fix source passes)
- source: legacy:37.1 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Covered on turbo run test (builds dists first) and the packaging path (checkDistFresh); residual is the bare-runner path; have all process-gates call checkDistFresh in beforeAll.
- 2026-10-14T10:47:59Z status=routed owner=burndown by=migration note=Covered on turbo run test (builds dists first) and the packaging path (checkDistFresh)
- 2026-10-15T11:47:35Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=fix in 38.0 [DISTFRESH]: epic37-default-outage-gate.test.ts:236,288 (and epic35-defect-gate.test.ts:168,179): call checkDistFresh(pkgDir) instead of existsSync(entryPoint)
- 2026-10-15T14:29:57Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-6: fixed; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-525: [37-1-CR-11] A gate child process can outlive a timed-out test (spawned dist terminated only by client.close() in finally)
- source: legacy:37.1 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: Narrow (needs a wedged instance mid-call); identical to sibling process-gates' teardown; kill the child from an afterEach/onTestFinished hook.
- 2026-10-14T10:47:59Z status=routed owner=burndown by=migration note=Narrow (needs a wedged instance mid-call); identical to sibling process-gates' teardown
- 2026-10-15T11:47:35Z status=wontfix-accepted by=x0 note=reopen_if=an orphaned node .../dist/index.js child is observed after a timed-out gate run; Needs a wedged instance mid-call; same teardown as sibling process-gates (client.close in finally, :219)

### DW-526: [37-1-CR-12] M1 clause (2)'s 'ONE path' is not literally met: the default's success path still runs the inline start() warm-up sequence
- source: legacy:37.1 | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: AC 37.1.3 and constraint F-2 require the eager success path byte-for-byte; amend M1 clause (2) to name the mirrored seam or refactor start() to delegate once F-2 no longer binds.
- 2026-10-14T10:47:59Z status=routed owner=burndown by=migration note=AC 37.1.3 and constraint F-2 require the eager success path byte-for-byte
- 2026-10-15T11:47:35Z status=by-design by=x0 note=AC 37.1.3 + constraint F-2 require the eager success path byte-for-byte; amend spine M1 clause (2) to name the mirrored seam (doc-only)

### DW-527: [38-0-x0] iris_doc_export may drop the generated parameter on its modifiedSince branch (export.ts:398-403)
- source: x0-triage-2026-10-15 (side finding while verifying DW-36) | severity: med | fix-risk: low | footprint: in-story
- evidence: DW-36's fix (1b7b874) sent generated on the doc.ts/packages.ts /modified branches; export.ts:398-403 modified branch appears to omit it; unverified
- 2026-10-15T11:47:35Z status=routed owner=38-0-epic-37-deferred-cleanup by=x0 note=probe then fix or close with evidence
- 2026-10-15T14:29:57Z status=resolved-by:38-0-epic-37-deferred-cleanup by=adjudication note=AC-2: generated now forwarded on the modifiedSince branch (pinned against the Atelier request shape); the route itself answers 405 on IRIS 2026.2, tracked as DW-528; commits 05b26d9 (build) + lead story commit; pinning test mutation-verified, recorded in spec-38-0 ## Verification

### DW-528: iris_doc_list, iris_doc_export and iris_package_list build GET /modified/<ts>, which IRIS answers HTTP 405 (Atelier /modified is POST-only with a database-hash body): modifiedSince cannot work
- source: _bmad-output/implementation-artifacts/spec-38-0-epic-37-deferred-cleanup.md | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: DW-527 live probe 2026-10-15 IRIS 2026.2 Atelier v8 HSCUSTOM: GET /modified/<ts> -> 405, OPTIONS ALLOW POST,OPTIONS; %Api.Atelier.v1 route /:namespace/modified/:type is POST (type CLS, body [{dbname,dbhash}]); doc.ts:451
- 2026-10-15T13:36:58Z status=routed owner=burndown by=harvest note=user-reachable broken filter; fix the route shape or remove modifiedSince with a clear error
- 2026-10-15T14:26:42Z occurrence=38-0-epic-37-deferred-cleanup
- 2026-10-16T15:58:09Z status=routed owner=38-7-epic-38-burn-down by=burndown note=chartered into the Epic 38 burn-down story
- 2026-10-16T18:57:28Z status=resolved-by:38-7-epic-38-burn-down by=adjudication note=AC-7: modifiedSince refused with a clear error before any request on iris_doc_list/export/package_list (DW-529 folded in); live wire gate; build 4520fd7; mutation-verified (spec-38-7 Verification)

### DW-529: iris_doc_export modifiedSince branch also drops category and type, yet filtersApplied reports them as applied
- source: _bmad-output/implementation-artifacts/spec-38-0-epic-37-deferred-cleanup.md | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: export.ts:387-403 plan-time read 2026-10-15: /modified path adds no category/type filter; filtersApplied echoes all three
- 2026-10-15T13:36:58Z status=wontfix-accepted owner=38-0-epic-37-deferred-cleanup by=harvest note=reopen_if=the modifiedSince route fix (DW-528) lands -- apply category/type on that branch in the same change
- 2026-10-16T18:57:28Z status=dropped by=adjudication note=obsolete: modifiedSince is now refused before any request (DW-528, Story 38.7), so the category/type misreport cannot occur

### DW-530: iris_env_promote execute writes target documents without inspecting the per-document Atelier result.status (same blind spot as DW-485)
- source: _bmad-output/implementation-artifacts/spec-38-0-epic-37-deferred-cleanup.md | severity: med | fix-risk: low | footprint: out-of-footprint
- evidence: env-promote.ts:869 awaits targetClient.put(putPath,{enc:false,content}) and never reads result.status; 38.0 added shared atelierDocStatusError which can be reused
- 2026-10-15T13:36:58Z status=routed owner=burndown by=harvest note=reuse atelierDocStatusError from @iris-mcp/shared
- 2026-10-16T15:58:09Z status=routed owner=38-7-epic-38-burn-down by=burndown note=chartered into the Epic 38 burn-down story
- 2026-10-16T18:57:28Z status=resolved-by:38-7-epic-38-burn-down by=adjudication note=AC-8: iris_env_promote execute halts on a target PUT soft status; live handler gate; build 4520fd7; mutation-verified (spec-38-7 Verification)

### DW-531: Production-delete state guard (DW-54) pinned only at its predicate/message, not at the ProductionManage handler wiring (no test drives a refusal of a current non-Stopped production through the route)
- source: _bmad-output/implementation-artifacts/spec-38-0-epic-37-deferred-cleanup.md | severity: med | fix-risk: high | footprint: in-epic
- evidence: 38.0 review (blind-hunter, verification-gap, intent-alignment); HSCUSTOM has no current non-Stopped production and starting one on the shared instance leaves Ens.Runtime pointing at a deleted production; Interop.cls:122
- 2026-10-15T13:36:58Z status=escalated owner=burndown by=harvest note=for the decision sheet: an injectable seam (classmethod: status, predicate, message) vs an operator-approved scratch-namespace production
- 2026-10-15T14:26:42Z occurrence=38-0-epic-37-deferred-cleanup
- 2026-10-16T15:58:09Z status=routed owner=38-7-epic-38-burn-down by=merge_gate note=decided=orchestrator(Lead-away) decision 17: fix now in the Epic 38 burn-down story (sanctioned AD-15 change where behavior moves)
- 2026-10-16T18:57:27Z status=resolved-by:38-7-epic-38-burn-down by=adjudication note=AC-3: delete state guard wired through an injectable seam, pinned by TestProductionManageWiring (handler ignoring the seam and swapped arguments both red); residual: no live Running-production refusal (decision 17); build 4520fd7; mutation-verified (spec-38-7 Verification)

### DW-532: VS Code launcher full test suite red on this macOS host at baseline: 5 tests in 3 files + 2 files that cannot load
- source: _bmad-output/implementation-artifacts/spec-38-0-epic-37-deferred-cleanup.md | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: clientsEngine/governanceEngine assert Windows C:\git paths; constants/credentials tests cannot load @intersystems-community/intersystems-servermanager (absent from extension node_modules); clientsActivationFlow 33-3-3 times out at 60s; reproduced with launcher code at HEAD
- 2026-10-15T13:36:58Z status=routed owner=burndown by=harvest note=pre-existing; blocks a green launcher suite before 42.7 publishes the extension
- 2026-10-16T15:58:09Z status=routed owner=42-7-vs-code-extension-publish by=burndown note=overflow: the extension-publish story needs a green launcher suite on every platform; DW bullet in 42.7

### DW-533: iris_production_manage delete removes ANY class given as name: the class-delete path never checks that the class extends Ens.Production
- source: spec-38-0-epic-37-deferred-cleanup.md | severity: med | fix-risk: high | footprint: in-story
- evidence: Interop.cls ProductionManage delete: %Dictionary.ClassDefinition %ExistsId(tName) then %DeleteId(tName), no Ens.Production check; iris_production_manage:delete is a frozen-baseline default-enabled write, so it also bypasses an operator who disabled iris_doc_delete
- 2026-10-15T14:26:53Z status=escalated owner=burndown by=cr note=new refusal on an existing destructive route needs an AD-15/AD-33 Lead decision plus bootstrap regen; pre-existing, re-touched here
- 2026-10-16T15:58:09Z status=routed owner=38-7-epic-38-burn-down by=merge_gate note=decided=orchestrator(Lead-away) decision 17: fix now in the Epic 38 burn-down story (sanctioned AD-15 change where behavior moves)
- 2026-10-16T18:57:27Z status=resolved-by:38-7-epic-38-burn-down by=adjudication note=AC-2: production delete refuses a non-production class; live wire gate deletes a production draft and keeps a non-production class; build 4520fd7; mutation-verified (spec-38-7 Verification)

### DW-534: dev, data and all prepublish-gate.mjs never apply the DW-388 target resolution: an unset IRIS variable still defaults silently in their armed gate runs
- source: spec-38-0-epic-37-deferred-cleanup.md | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: the three gate scripts spawn vitest with process.env and never call resolveIrisTarget; their gate files default IRIS_PASSWORD to SYS and the namespace to HSCUSTOM; only verify-iris-reachable.mjs warns and refuses under CI
- 2026-10-15T14:26:53Z status=wontfix-accepted owner=38-0-epic-37-deferred-cleanup by=cr note=reopen_if=a CI job (Story 42.3) or the release script (42.5) runs a package prepublish-gate.mjs with an IRIS variable unset

### DW-535: iris_doc_put refusal text says nothing was stored for every non-empty result.status, but a post-save source-control hook error is reported there too
- source: spec-38-0-epic-37-deferred-cleanup.md | severity: low | fix-risk: low | footprint: in-story
- evidence: %Api.Atelier.v2 PutDoc saves through SetTextFromArray (line 185), then runs Extension UserActionExecute for actions 1 and 7 (lines 224-225); an error there reaches ServeDoc as the per-document status after the document was stored
- 2026-10-15T14:26:53Z status=by-design owner=38-0-epic-37-deferred-cleanup by=cr note=the spec I/O matrix fixes the refusal wording (was not saved) for any non-empty status; reopens only via spec amendment

### DW-536: The StateName call site in Interop.cls ProductionSummary has no IRIS-side test; only mocked TypeScript tests cover iris_production_summary
- source: spec-38-0-epic-37-deferred-cleanup.md | severity: low | fix-risk: med | footprint: in-story
- evidence: the refactor replaced the inline state map with ..StateName(tState) in the per-namespace loop; ExecuteMCPv2.REST.Interop.1.int shows a same-routine call with the same argument; a route test would read every namespace, which the shared-instance rule forbids
- 2026-10-15T14:26:53Z status=wontfix-accepted owner=38-0-epic-37-deferred-cleanup by=cr note=reopen_if=iris_production_summary reports a state that differs from iris_production_status for the same namespace

### DW-537: The live-gate work/ response recorder (recordWorkResponses, lastWork) is copied verbatim into two iris-dev-mcp gate files
- source: spec-38-0-epic-37-deferred-cleanup.md | severity: low | fix-risk: low | footprint: in-story
- evidence: execute-tests-running-contract-epic-gate.test.ts and test-status-epic-gate.test.ts each define the same 22-line recorder; the only reason is that live gate files are self-contained by pattern (Rule 2: weak reason)
- 2026-10-15T14:26:53Z status=wontfix-accepted owner=38-0-epic-37-deferred-cleanup by=cr note=reopen_if=a third gate file needs the work/ recorder, or the two copies diverge

### DW-538: Streamable HTTP transport is not offered: a real MCP HTTP transport needs an authentication, bind-address and session design first
- source: spec-38-1-reject-the-unimplemented-http-transport.md | severity: med | fix-risk: high | footprint: out-of-footprint
- evidence: G48/S-2: Story 38.1 makes every non-stdio transport a startup configuration error; AD-23 and the spine Deferred list allow an HTTP transport only with an auth, bind-address and session design and a confirmed remote-access use case
- 2026-10-15T15:01:25Z status=decision-pending owner=burndown by=implement note=human=decide the auth, bind-address and session design (and the use case) for Streamable HTTP; AD-23
- 2026-10-16T15:58:09Z status=dropped by=merge_gate note=action_item:epic-38-retro-item-1-decide-whether-to-build-a-streamable-htt (human=Project Lead decides the remote-access use case and auth design)

### DW-539: VS Code launcher passes an ambient MCP_TRANSPORT through to the stdio servers it spawns: after Story 38.1 any non-stdio value makes every launched server exit 1
- source: spec-38-1-reject-the-unimplemented-http-transport.md | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: extensions/iris-mcp-launcher/src/env.ts LAUNCHER_OWNED_VARS (ambient vars nulled because McpStdioServerDefinition.env is additive over the extension host env) omits MCP_TRANSPORT; resolveTransport now rejects every non-stdio value
- 2026-10-15T15:52:02Z status=escalated owner=burndown by=cr note=launcher only spawns stdio, so nulling MCP_TRANSPORT loses nothing; rec: add it to LAUNCHER_OWNED_VARS (suite red here, DW-532)
- 2026-10-16T15:58:09Z status=routed owner=38-7-epic-38-burn-down by=merge_gate note=decided=orchestrator(Lead-away) decision 17: fix now in the Epic 38 burn-down story (sanctioned AD-15 change where behavior moves)
- 2026-10-16T18:57:27Z status=resolved-by:38-7-epic-38-burn-down by=adjudication note=AC-4: launcher LAUNCHER_OWNED_VARS clears MCP_TRANSPORT; build 4520fd7; mutation-verified (spec-38-7 Verification)

### DW-540: iris_doc_put without ignoreConflict gets HTTP 409 for every EXISTING document (it can only create); its ignoreConflict description is wrong
- source: _bmad-output/implementation-artifacts/spec-38-2-line-range-document-read.md | severity: med | fix-risk: med | footprint: in-epic
- evidence: Live probe 2026-10-15 IRIS 2026.2 Atelier v8: second iris_doc_put to an existing doc -> 409; %Api.Atelier.v2 PutDoc saves only when new or HTTP_IF_NONE_MATCH equals TS(); the tool never sends If-None-Match (doc.ts:193; bootstrap.ts:233-241 documents the same 409)
- 2026-10-15T16:44:50Z status=routed owner=38-3-storage-block-drop-guard by=harvest note=38.3 owns the iris_doc_put write path (its guard reads current source first, so it has the ts to send); 38.4 must send the version header too
- 2026-10-15T19:47:01Z status=resolved-by:38-3-storage-block-drop-guard by=adjudication note=AC-7: existing documents saved with If-None-Match from the 409 ts (doc.ts); unit + armed live gate pinned, mutation-verified; lead smoke 2026-10-15 updated an existing class without ignoreConflict

### DW-541: iris_doc_get metadataOnly reads a Last-Modified header Atelier never sends, so timestamp is always absent; the unit test fakes the header (Rule #54)
- source: _bmad-output/implementation-artifacts/spec-38-2-line-range-document-read.md | severity: low | fix-risk: low | footprint: in-epic
- evidence: Atelier v1-v8 and %Atelier.REST set only ETag (=ts); live metadataOnly returns {exists,name,etag}; doc.test.ts:103-127 fakes Last-Modified; 38.2 corrected only the description
- 2026-10-15T16:44:50Z status=routed owner=38-3-storage-block-drop-guard by=harvest note=two-way door (drop the dead read + the impossible fake); 38.3 edits doc.ts anyway
- 2026-10-15T17:11:58Z occurrence=38-2-line-range-document-read by=cr note=the fix also turns the 38.2 AC-4 pin doc-get-range.test.ts:163-178 red (toStrictEqual pins timestamp:undefined); update it
- 2026-10-15T19:47:01Z status=resolved-by:38-3-storage-block-drop-guard by=adjudication note=AC-8: dead Last-Modified read and its fake removed; metadataOnly returns {exists,name,etag}; 38.2 pin updated deliberately

### DW-542: iris_doc_get without a range reports an Atelier GET soft error (HTTP 200, content "", non-empty status) as success with no isError; the ranged read reports the same result as an error
- source: spec-38-2-line-range-document-read.md | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: Live 2026-10-15 default/HSCUSTOM: iris_doc_get name=ExecuteMCPv2.Utils (no extension) -> {content:"",status:"ERROR #16006 ... name is invalid"}, no isError; doc.ts:266-271 never reads result.status
- 2026-10-15T17:11:58Z status=escalated owner=burndown by=cr note=AD-15: isError on a result that is a success today needs a Lead decision; reuse atelierDocStatusError as M6 does
- 2026-10-16T15:58:09Z status=routed owner=38-7-epic-38-burn-down by=merge_gate note=decided=orchestrator(Lead-away) decision 17: fix now in the Epic 38 burn-down story (sanctioned AD-15 change where behavior moves)
- 2026-10-16T18:57:27Z status=resolved-by:38-7-epic-38-burn-down by=adjudication note=AC-5: no-range iris_doc_get soft error is isError via atelierDocStatusError; live wire gate; build 4520fd7; mutation-verified (spec-38-7 Verification)

### DW-543: Test env harness makeEnvHarness is copied verbatim into 43 test files (doc-get-range-framework.test.ts copies loc-e2e.test.ts:140-173), so an env-isolation gap fixed in one copy stays in the others
- source: spec-38-2-line-range-document-read.md | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: grep 'function makeEnvHarness' = 43 files in shared/dev/admin/ops/interop; loc-e2e's copy leaves IRIS_TOOLS_* and IRIS_GOVERNANCE_FILE/PRESET set; 38.2 cr fixed only its own copy
- 2026-10-15T17:11:58Z status=wontfix-accepted owner=38-2-line-range-document-read by=cr note=reopen_if=a second test result is found to depend on an env var that its makeEnvHarness copy leaves set
- 2026-10-16T18:53:44Z occurrence=38-7-epic-38-burn-down
- 2026-10-16T18:57:09Z status=routed owner=burndown by=lead note=reopen_if fired at the 38.7 review (governance-enforcement env harness read ambient IRIS_GOVERNANCE_FILE/PRESET/SERVER_MANAGER); for the Epic 39 X.0 gate: one shared startup-env scrub for test harnesses
- 2026-10-16T19:05:21Z owner=39-0-epic-38-deferred-cleanup by=x0 note=Epic 39 X.0 gate: fix in Story 39.0 (DW bullet in its epics.md block)
- 2026-10-17T00:46:58Z status=resolved-by:39-0-epic-38-deferred-cleanup by=adjudication note=AC-4..7: one shared env harness + startup-env setupFiles scrub; 43 copies migrated with identical test counts; every default suite green under hostile variables; build 628a817, mutation-verified (spec-39-0 Verification)

### DW-544: iris_doc_load uploads each file with ignoreConflict on by default and has no Storage check, so a file whose class text has no Storage block replaces the stored class and drops its Storage definitions
- source: spec-38-3-storage-block-drop-guard.md | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: load.ts:447-456 sends PUT ?ignoreConflict=1 per file (the default) with no Storage guard; Story 38.3 AD-24 write-path verdict: excluded, because loading files from source control is the sanctioned flow and the file is the source of truth for the class text
- 2026-10-15T18:19:47Z status=wontfix-accepted owner=38-3-storage-block-drop-guard by=implement note=reopen_if=a class loses its Storage after iris_doc_load uploads a file without it (user report or ledger occurrence)

### DW-545: iris_env_promote execute copies each source document to the target with ignoreConflict=1 and has no Storage check, so a sync replaces the target class's Storage definitions with the source copy's
- source: spec-38-3-storage-block-drop-guard.md | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: env-promote.ts:868-869 PUTs the source content to ...?ignoreConflict=1; a sync replaces the target's whole class, Storage included, by design. Story 38.3 AD-24 write-path verdict: excluded, because execute is plan-gated (the plan embeds the content hash of its source diff, AD-17) and default-disabled
- 2026-10-15T18:19:52Z status=wontfix-accepted owner=38-3-storage-block-drop-guard by=implement note=reopen_if=promote execute replaces a target class that has Storage with a source copy that has none (report)

### DW-546: iris_doc_xml_export import loads an XML export through action/xml/load with no Storage check, so an import replaces the stored class, including its Storage definitions, with the export's
- source: spec-38-3-storage-block-drop-guard.md | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: format.ts:218 POSTs the XML to action/xml/load; an XML export carries its own <Storage> elements, so an import replaces the stored definitions with the exported ones. Story 38.3 AD-24 write-path verdict: excluded (orchestrator decision 8 at the spec gate, 2026-10-15), because the export is the source of truth for the class it describes
- 2026-10-15T18:19:52Z status=wontfix-accepted owner=38-3-storage-block-drop-guard by=implement note=reopen_if=an XML import replaces a class that has Storage with a definition that has none (report)

### DW-547: Storage-drop scanner loses brace sync without reporting it in embedded &html</&js< blocks, string-bearing [ ] keyword values and ( ) defaults, XData bodies, and some contrived headers, so a drop after such a member is not refused (fails open = pre-38.3 behavior)
- source: _bmad-output/implementation-artifacts/spec-38-3-storage-block-drop-guard.md | severity: low | fix-risk: med | footprint: in-epic
- evidence: 38.3 implement + review probes vs live IRIS 2026.2: XData string braces and InitialExpression = {"}"} -> IRIS sees Default, scanner returns []; read-only sweep matches 2515/2516 %Dictionary.StorageDefinition parents (miss: %SQL.Manager.UI &html<); storage-guard.ts objectScriptBodyEnd/rawBodyEnd/headerBraceEnd
- 2026-10-15T18:54:44Z status=wontfix-accepted owner=38-3-storage-block-drop-guard by=harvest note=reopen_if=a Storage definition is lost through iris_doc_put or iris_doc_edit on a class the scanner reported as storage-free, or the guard's live oracle sweep drops below 2515/2516
- 2026-10-15T19:43:48Z occurrence=38-3-storage-block-drop-guard by=cr note=live 2026-10-15: an ObjectScript JSON literal holding a backslash-escaped quote, and &sql with '{', each hide Storage
- 2026-10-15T19:43:48Z status=wontfix-accepted owner=38-3-storage-block-drop-guard by=cr note=reopen_if=a Storage loss via iris_doc_put/edit on a class the scanner read as storage-free, or a red oracle fixture

### DW-548: Storage-drop scanner ends a non-ObjectScript method body (Language=python/tsql) only at a column-0 brace, so indented members or a column-0 brace inside a Python string desync it; on the proposed side that is a spurious STORAGE_DROPPED refusal
- source: _bmad-output/implementation-artifacts/spec-38-3-storage-block-drop-guard.md | severity: low | fix-risk: med | footprint: in-epic
- evidence: spec rule 5 (foreignBodyEnd); over-refusal only, the documented allowStorageRegeneration override applies; storage-guard.ts:foreignBodyEnd
- 2026-10-15T18:54:44Z status=wontfix-accepted owner=38-3-storage-block-drop-guard by=harvest note=reopen_if=a STORAGE_DROPPED refusal is reported for a put or edit that keeps every Storage definition
- 2026-10-15T19:43:48Z occurrence=38-3-storage-block-drop-guard by=cr note=live 2026-10-15: a one-line python body desyncs too; the 409 current text desyncs alike, so a drop can pass
- 2026-10-15T19:43:48Z status=wontfix-accepted owner=38-3-storage-block-drop-guard by=cr note=reopen_if=a STORAGE_DROPPED refusal for a put that keeps every definition, or a Storage loss after a put

### DW-549: iris_doc_load with ignoreConflict: false sends an unversioned PUT, so every file whose document already exists gets HTTP 409 and lands in failures (the DW-540 defect, unfixed for load); its description reads as if false only protects newer server copies
- source: spec-38-3-storage-block-drop-guard.md | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: load.ts:449-456 sends PUT with no If-None-Match when ignoreConflict is false; %Api.Atelier.v2 PutDoc answers an unversioned PUT to an existing doc with 409 (38.3 probe record, DW-540); load.ts:348 says 'If true (default), overwrite server copies even when newer'; load.test.ts:314-326 fakes a resolving put
- 2026-10-15T19:43:42Z status=escalated owner=burndown by=cr note=38.3 Never list excludes load; fix mirrors DW-540 (save with the 409 ts), a behavior change like decision #7
- 2026-10-16T15:58:09Z status=routed owner=38-7-epic-38-burn-down by=merge_gate note=decided=orchestrator(Lead-away) decision 17: fix now in the Epic 38 burn-down story (sanctioned AD-15 change where behavior moves)
- 2026-10-16T18:57:28Z status=resolved-by:38-7-epic-38-burn-down by=adjudication note=AC-6: iris_doc_load ignoreConflict:false uses the 409-ts If-None-Match save; live conflict case gives a per-file DOCUMENT_CONFLICT; build 4520fd7; mutation-verified (spec-38-7 Verification)

### DW-550: Three iris-mcp-all repo-scan tests carry their own directory walker (story-38-0-qa-doc-claims, and new in 38.3 document-write-paths and story-38-3-qa-doc-claims) with different skip sets and path forms
- source: spec-38-3-storage-block-drop-guard.md | severity: low | fix-risk: low | footprint: in-story
- evidence: document-write-paths.test.ts walk() skips node_modules/dist/__tests__ and sorts; story-38-3-qa-doc-claims sources() skips the same set unsorted; story-38-0-qa-doc-claims walk() skips node_modules/dist only; Rule 2 copy with no stated reason (code review 38.3)
- 2026-10-15T19:43:43Z status=wontfix-accepted owner=38-3-storage-block-drop-guard by=cr note=reopen_if=a repo-scan test misses a source file another scan reads, or a fourth copy of the walker is added

### DW-551: Project Rule #53 still states the core ceiling as <=13 runtime tools/server although the Lead made 13 a guideline (2026-10-14, L-4); dev core is now 14
- source: _bmad-output/implementation-artifacts/spec-38-4-surgical-line-edit-tool.md | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: .claude/rules/project-rules.md #53 text vs presets.test.ts pin (dev core 14 under L-4); agent-context file, rules are edited at retrospectives
- 2026-10-15T21:18:38Z status=decision-pending owner=burndown by=harvest note=human=Project Lead rewords Rule #53 to 'guideline' (or keeps it, citing the clarification)
- 2026-10-15T21:53:24Z occurrence=38-4-surgical-line-edit-tool
- 2026-10-16T11:37:48Z status=resolved-by:38-4-surgical-line-edit-tool by=lead note=Project Lead directed 2026-10-16: Rule #53 reworded in .claude/rules/project-rules.md -- ~13 runtime tools/server is a guideline, not a cap; everyday-loop exception recorded with the dev core 15 example

### DW-552: iris_doc_edit STALE_CONTENT mismatches[].current does not round-trip as expected when the addressed range ends in an empty line
- source: spec-38-4-surgical-line-edit-tool.md | severity: med | fix-risk: low | footprint: in-story
- evidence: doc-edit.ts:336 sets current=joinLines(lines) and textToLines drops one trailing line break, so the lines ["}",""] give "}\n", which parses as ["}"]: a retry with current is STALE_CONTENT again; an expected built by joining a ranged iris_doc_get slice with \n fails the same way (blind-hunter, verified).
- 2026-10-15T21:53:24Z status=decision-pending owner=burndown by=cr note=contract call: recommend current=joinLines(lines)+newline (round-trips every range) + a description line; 38.6 prompt depends on it
- 2026-10-15T22:04:03Z status=routed owner=38-6-editing-and-sql-safety-docs-prompt-and-capstone by=lead note=decided=orchestrator(Lead-away) decision 11: append a trailing line break to mismatches[].current plus one description line; the 38.6 edit prompt depends on the round trip
- 2026-10-16T15:53:37Z status=resolved-by:38-6-editing-and-sql-safety-docs-prompt-and-capstone by=adjudication note=AC-4: mismatches[].current carries a trailing line break; capstone leg 3 passes current back as expected on a range ending in an empty line (live, armed); description sentence added

### DW-553: doc-edit.test.ts several-edits fake re-read S2_LINES is a .cls layout IRIS cannot return (no blank line after the class brace or between members)
- source: spec-38-4-surgical-line-edit-tool.md | severity: low | fix-risk: med | footprint: in-story
- evidence: Plan probe 1 and the CR live probe 2026-10-15 show IRIS restoring member separators on save; S2_LINES is the re-read of Test.Edit.cls in the six shuffled-order rows. Their PUT-body pins (AC-2) are realistic; only the answer fields rest on the fake.
- 2026-10-15T21:53:24Z status=wontfix-accepted owner=38-4-surgical-line-edit-tool by=cr note=reopen_if=a doc-edit change keeps the S2 rows green while doc-edit-live-gate multi-edit row (replace+insert+delete) goes red

### DW-554: IRIS_GOVERNANCE in the intuitive flat shape {"iris_doc_put": false} is accepted silently and does nothing: the key stays enabled (configSource default), no warning, no fail-fast -- governance config fails OPEN
- source: lead smoke Story 38.4 (2026-10-15) | severity: high | fix-risk: low | footprint: in-epic
- evidence: built dev dist 2026-10-15: IRIS_GOVERNANCE={"iris_doc_put":false} -> iris_server_profiles iris_doc_put:true configSource default, stderr no WARN; documented shape is {"global":{...}} or {"<profile>":{...}}; a top-level key that is not a known profile, or a non-object value, should fail fast like other malformed IRIS_GOVERNANCE (M1/F-3)
- 2026-10-15T22:05:32Z status=routed owner=burndown by=lead note=smoke-found (pre-existing, Epic 32 parser); Epic 38 burn-down story must fix: reject a non-object layer value and an unknown top-level profile name at startup, with the documented shape in the message
- 2026-10-16T15:58:09Z status=routed owner=38-7-epic-38-burn-down by=burndown note=chartered into the Epic 38 burn-down story
- 2026-10-16T18:57:27Z status=resolved-by:38-7-epic-38-burn-down by=adjudication note=AC-1: governance-shaped top-level keys fail fast at startup naming the shape; valid documents and metadata start identically; built-process gate story-38-7-qa-governance-process (30 tests, zero IRIS requests on rejection); build 4520fd7; mutation-verified (spec-38-7 Verification)

### DW-555: iris_execute_tests hints, the deploy-and-test-class prompt and its generated skill still point models at iris_sql_execute for read-only queries, which the read-only preset blocks; they should name iris_sql_query
- source: _bmad-output/implementation-artifacts/spec-38-5-sql-write-safety.md | severity: low | fix-risk: low | footprint: in-epic
- evidence: 38.5 implement review (2026-10-15): iris_sql_query (read-classified) now exists; prompt/skill text predates it
- 2026-10-16T00:13:57Z status=routed owner=38-6-editing-and-sql-safety-docs-prompt-and-capstone by=harvest note=38.6 already updates deploy-and-test-class (AC 38.6.2) and regenerates skills
- 2026-10-16T15:53:37Z status=resolved-by:38-6-editing-and-sql-safety-docs-prompt-and-capstone by=adjudication note=AC-5: running hint, iris_execute_tests description, deploy-and-test-class prompt + regenerated skill name iris_sql_query; pinned by the SDK prompt wire test and doc-claims

### DW-556: Three live gates (doc-edit-live-gate, doc-put-storage-guard-live-gate, and before this review the 38.5 gates) end with a cleanup it() that removes the shared fixtures, so they pass only while that test runs last
- source: spec-38-5-sql-write-safety.md | severity: med | fix-risk: low | footprint: in-epic
- evidence: doc-edit-live-gate.test.ts and doc-put-storage-guard-live-gate.test.ts each keep a final describe(cleanup) whose it() calls removeFixtures(); under --sequence.shuffle or a test added after it every later test loses its fixture class. Story 38.5 review moved its own gates' assertions into afterAll.
- 2026-10-16T12:35:29Z status=routed owner=burndown by=cr note=fix: move the nothing-left assertions into afterAll and delete the it(), as Story 38.5 did; re-run each armed gate
- 2026-10-16T15:58:09Z status=routed owner=38-7-epic-38-burn-down by=burndown note=chartered into the Epic 38 burn-down story
- 2026-10-16T18:57:28Z status=resolved-by:38-7-epic-38-burn-down by=adjudication note=AC-10: dev live-gate cleanup moved into afterAll; order-independent; build 4520fd7; mutation-verified (spec-38-7 Verification)

### DW-557: The 38.5 live gates copy the kill-every-ExecuteMCPv-global-containing-the-stem cleanup loop from the 38.3 and 38.4 gates instead of a shared helper in live-doc-helpers.ts
- source: spec-38-5-sql-write-safety.md | severity: low | fix-risk: low | footprint: in-epic
- evidence: sql-safety-live-gate.test.ts:243-257 repeats doc-put-storage-guard-live-gate.test.ts:156-163 and doc-edit-live-gate.test.ts:135; the spec named the sibling to follow (a weak reason, Rule 2); the iris-mcp-all wire gate cannot import dev test helpers.
- 2026-10-16T12:35:29Z status=wontfix-accepted owner=38-5-sql-write-safety by=cr note=reopen_if=a fourth live gate copies the loop, or the loop's behavior must change in more than one file

### DW-558: A capped INSERT, UPDATE or DELETE on a table stored in IRISTEMP is not undone by the cap's rollback, yet the overCap text says 'Its row changes were undone'
- source: spec-38-5-sql-write-safety.md | severity: med | fix-risk: med | footprint: in-story
- evidence: Live 2026-10-16 default/HSCUSTOM: a persistent class with DEFAULTGLOBAL ^CacheTemp.Cr385R2 (dest mgr/iristemp), 3 rows; DELETE with maxRowsAffected 0 gave overCap 'Its row changes were undone', then COUNT(*) was 0. A GTT is unobservable: its data is ^|| and the webapp clears process-private globals between requests (same job, ^|| gone).
- 2026-10-16T13:51:09Z status=routed owner=burndown by=cr note=lead item (c): amend the CAP rolled-back text to hedge IRISTEMP storage (Rule 5) plus a docs line; storage detection is high-risk
- 2026-10-16T15:58:09Z status=routed owner=38-7-epic-38-burn-down by=burndown note=chartered into the Epic 38 burn-down story
- 2026-10-16T18:57:28Z status=resolved-by:38-7-epic-38-burn-down by=adjudication note=AC-9: overCap text hedged to journaled storage plus a docs line; build 4520fd7; mutation-verified (spec-38-7 Verification)

### DW-559: Prepublish live gates never assert that the deployed ExecuteMCPv2 BOOTSTRAP_VERSION equals the shipped embed, so a gate can pass against a stale (older or newer) deployment of the handlers it exercises
- source: _bmad-output/implementation-artifacts/spec-38-5-sql-write-safety.md | severity: med | fix-risk: low | footprint: in-epic
- evidence: 38.5 re-review 2026-10-16: sql-safety-live-gate and the other armed gates read live results without checking the deployed version; today they match (d352a6a32158); Rule #59 path dimension
- 2026-10-16T13:54:17Z status=routed owner=38-6-editing-and-sql-safety-docs-prompt-and-capstone by=cr note=the 38.6 capstone (the epic gate) asserts deployed == shipped BOOTSTRAP_VERSION before its live legs; reuse for the other gates if cheap
- 2026-10-16T15:53:37Z status=resolved-by:38-6-editing-and-sql-safety-docs-prompt-and-capstone by=adjudication note=AC-6: assertDeployedBootstrapVersion in the capstone + 38.4/38.5 wire gates, red-proven (decision 16, deployed restored to d352a6a32158); residual: non-bootstrapping dev gates still test whatever is deployed (accepted at the spec gate)

### DW-560: Existing-tool annotation divergences (spine AD-4 Known divergences): iris_sql_execute, iris_execute_command and iris_doc_put declare destructiveHint:false although each can delete or overwrite existing state
- source: _bmad-output/implementation-artifacts/spec-38-6-editing-and-sql-safety-docs-prompt-and-capstone.md | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: spine AD-4 Known divergences + Deferred (the Epic 38 gate routes them to one ledger entry with an owner); correcting a hint is an AD-15 sanctioned change (iris_execute_tests is already DW-498)
- 2026-10-16T15:13:57Z status=decision-pending owner=burndown by=harvest note=product call for the decision sheet: sanction the hint correction (and in which story) or keep the grandfathered hints
- 2026-10-16T15:58:09Z status=routed owner=42-1-pre-publish-package-fixes by=merge_gate note=decided=orchestrator(Lead-away) decision 18: sanction the destructiveHint correction before 1.0; DW bullet in 42.1

### DW-561: Epic 38 capstone, the 38.4 and the 38.5 wire gates each carry their own fixture helpers (putDoc, compileDoc, lineNumber, fixtureDocuments, fixtureGlobals, removeFixtures) instead of one promoted set in process-gate-helpers.ts
- source: _bmad-output/implementation-artifacts/spec-38-6-editing-and-sql-safety-docs-prompt-and-capstone.md | severity: low | fix-risk: low | footprint: in-epic
- evidence: the 38.6 spec named only the env/session/Atelier helpers for promotion; three copies now
- 2026-10-16T15:13:57Z status=wontfix-accepted owner=38-6-editing-and-sql-safety-docs-prompt-and-capstone by=harvest note=reopen_if=a fourth live gate (e.g. the Epic 39 or 40 capstone) copies the fixture helpers -- then promote them into process-gate-helpers.ts in that story
- 2026-10-16T18:53:44Z occurrence=38-7-epic-38-burn-down
- 2026-10-16T18:57:09Z status=routed owner=39-6-message-forensics-docs-prompt-and-capstone by=lead note=reopen_if fired at the 38.7 review (fourth gate with its own fixture helpers); the Epic 39 capstone would be the fifth copy -- promote one set there; DW bullet in 39.6
- 2026-10-17T01:15:30Z occurrence=39-1-message-header-search
- 2026-10-17T01:15:30Z note=39.1 adds a session-parameterized docFixtures(session) to process-gate-helpers.ts instead of a fifth copy; 39.6 moves the Epic 38 gates onto it
- 2026-10-17T12:06:54Z occurrence=39-4-search-table-lookup
- 2026-10-17T12:06:54Z note=39.4 copies route/succeeded/skip/searchEntries (39.4 gate, 39.4 QA live gate) and startStub/session (39.4 QA process)
- 2026-10-17T18:23:43Z status=resolved-by:39-6-message-forensics-docs-prompt-and-capstone by=adjudication note=one promoted set of gate helpers in process-gate-helpers.ts; 18 gates migrated; gate-helper-copies.test.ts guards re-declaration (incl. denial); every gate armed green; build c158b73

### DW-562: The default @iris-mcp/all suite (vitest run, file-parallel) runs the three bootstrapping live gates (38.4, 38.5, Epic 38 capstone) at once; on a stale instance one gate's version check or legs can overlap a sibling server's redeploy and compile
- source: spec-38-6-editing-and-sql-safety-docs-prompt-and-capstone.md | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: vitest.config.ts sets no fileParallelism (untouched since Epic 25); only prepublish-gate.mjs runs --no-file-parallelism; bootstrap.ts has no lock; QA's serial full run was green (428)
- 2026-10-16T15:51:29Z status=escalated owner=burndown by=cr note=decide: fileParallelism false (or a serial group for the gate files) in iris-mcp-all vitest.config.ts; 1st stale run flakes
- 2026-10-16T15:58:09Z status=routed owner=38-7-epic-38-burn-down by=merge_gate note=decided=orchestrator(Lead-away) decision 17: fix now in the Epic 38 burn-down story (sanctioned AD-15 change where behavior moves)
- 2026-10-16T18:57:28Z status=resolved-by:38-7-epic-38-burn-down by=adjudication note=AC-11: @iris-mcp/all default suite serial (fileParallelism false) with a guard test; build 4520fd7; mutation-verified (spec-38-7 Verification)

### DW-563: iris_doc_edit description says STALE_CONTENT mismatches[].current can be passed back as expected unchanged without the README/prompt condition that the change must still apply to that text
- source: spec-38-6-editing-and-sql-safety-docs-prompt-and-capstone.md | severity: low | fix-risk: low | footprint: in-story
- evidence: doc-edit.ts description sentence is dictated verbatim by the 38.6 intent; the frozen refusal text already said Retry with the current text below as expected
- 2026-10-16T15:51:30Z status=by-design owner=38-6-editing-and-sql-safety-docs-prompt-and-capstone by=cr note=spec-bound: intent fixes the sentence; condition carried by the edit-and-test-class prompt step 3 and the root README

### DW-564: Generated skills/*/SKILL.md frontmatter carries the gen-skills DO-NOT-EDIT banner naming repository paths (scripts/gen-skills.mjs, packages/iris-dev-mcp/src/prompts/*.ts), which AD-28 keeps out of agent content
- source: spec-38-6-editing-and-sql-safety-docs-prompt-and-capstone.md | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: all 12 generated skills, from scripts/gen-skills.mjs (pre-existing); YAML comment in frontmatter; AD-28's mechanical check lands in Epic 41
- 2026-10-16T15:51:30Z status=wontfix-accepted owner=38-6-editing-and-sql-safety-docs-prompt-and-capstone by=cr note=reopen_if=Epic 41's AD-28 internal-reference check scans skills/ frontmatter, or a client shows SKILL.md frontmatter comments to the model
- 2026-10-16T15:51:48Z status=wontfix-accepted owner=38-6-editing-and-sql-safety-docs-prompt-and-capstone by=cr note=reopen_if=Epic 41 AD-28 internal-reference check flags the skills/ frontmatter banner

### DW-565: An unknown governance key inside a layer (a typo such as {"global":{"iris_doc_putt":false}}) is accepted silently and does nothing: the DW-554 fail-open class one level down
- source: _bmad-output/implementation-artifacts/spec-38-7-epic-38-burn-down.md | severity: med | fix-risk: med | footprint: in-epic
- evidence: 38.7 plan probe 2026-10-16; one governance document is shared by all five servers, so each server alone cannot tell another server's key from a typo -- a fix needs the cross-server key universe (iris-mcp-governance universe / deriveKeysForTool)
- 2026-10-16T17:57:29Z status=routed owner=burndown by=harvest note=overflow from the Epic 38 burn-down story: for the Epic 39 X.0 gate (warn on a key matching no tool in the suite universe)
- 2026-10-16T19:05:21Z owner=39-0-epic-38-deferred-cleanup by=x0 note=Epic 39 X.0 gate: fix in Story 39.0 (DW bullet in its epics.md block)
- 2026-10-17T00:46:58Z status=resolved-by:39-0-epic-38-deferred-cleanup by=adjudication note=AC-1..3: startup WARN per provably-dead key (never fails) + iris-mcp-governance check exits 1 on suite-unknown keys; built-process + built-CLI gates; build 628a817, mutation-verified (spec-39-0 Verification)

### DW-566: IRIS_GOVERNANCE / IRIS_GOVERNANCE_FILE JSON-parse errors embed V8's message, which can quote a snippet of the input, although governance.ts:106 and :406 say contents are never echoed
- source: _bmad-output/implementation-artifacts/spec-38-7-epic-38-burn-down.md | severity: low | fix-risk: low | footprint: in-epic
- evidence: 38.7 plan read 2026-10-16
- 2026-10-16T17:57:29Z status=wontfix-accepted owner=38-7-epic-38-burn-down by=harvest note=reopen_if=a governance document carries a secret, or a parse-error message is reported to echo sensitive content -- then drop V8's message and report only the position

### DW-567: iris_doc_list type description offers 'cls' as an example for category CLS, but Atelier answers GET docnames/CLS/cls with HTTP 400 (CLS accepts only *)
- source: _bmad-output/implementation-artifacts/spec-38-7-epic-38-burn-down.md | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: 38.7 plan probe 2026-10-16, IRIS 2026.2 Atelier v8
- 2026-10-16T17:57:29Z status=routed owner=burndown by=harvest note=two-way-door doc fix (<=5 lines + a pin); overflow for the Epic 39 X.0 gate
- 2026-10-16T19:05:21Z owner=39-0-epic-38-deferred-cleanup by=x0 note=Epic 39 X.0 gate: fix in Story 39.0 (DW bullet in its epics.md block)
- 2026-10-17T00:46:58Z status=resolved-by:39-0-epic-38-deferred-cleanup by=adjudication note=AC-8: shared type description, every example live-validated 200 against Atelier; old CLS/cls pair pinned as 400; build 628a817, mutation-verified (spec-39-0 Verification)

### DW-568: iris_production_manage delete passes its production-class check for a library production class (IsProductionClass of Ens.Production answers 1), so only a read-only ENSLIB stops a delete of a built-in base class
- source: spec-38-7-epic-38-burn-down.md | severity: low | fix-risk: med | footprint: in-story
- evidence: 38.7 QA observation; cr probe 2026-10-16: HSCUSTOM %Dictionary.CompiledClass holds Ens.Production and Ens.Enterprise.Production; iris_database_check ENSLIB readOnly true; the same delete was possible before 38.7 (DW-533 narrowed it to production classes)
- 2026-10-16T18:53:39Z status=wontfix-theoretical owner=38-7-epic-38-burn-down by=cr note=real if ENSLIB is mounted read-write and a delete names a library production class; then refuse a class whose source db is not the namespace routine db

### DW-569: The shared IrisHttpClient turns an HTTP 400 whose Atelier error list is empty into an empty SUCCESS (e.g. iris_doc_list type 'cls' on category CLS returned {items:[]} instead of an error) -- an error response reported as success
- source: spec-39-0-epic-38-deferred-cleanup.md (QA 2026-10-16) | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: QA 39.0: http-client.ts ~395 maps a 400 with status.errors=[] to a resolved empty result; live GET docnames/CLS/cls -> 400, tool -> {items:[]}
- 2026-10-17T00:14:32Z status=routed owner=burndown by=qa note=for the Epic 39 burn-down: a non-2xx response is an error even when status.errors is empty; pin with the live 400 pair from doc-type-description-live-gate
- 2026-10-17T18:31:11Z status=routed owner=39-7-epic-39-burn-down by=burndown note=chartered into the Epic 39 burn-down story
- 2026-10-17T21:38:00Z status=resolved-by:39-7-epic-39-burn-down by=adjudication note=every non-2xx Atelier response is an IrisApiError (iris_macro_info no-document fallback kept); built-server process test across five packages; newly erroring inputs named in the CHANGELOG; build 2e307d4 + review patches; mutation-verified (spec-39-7 Verification)

### DW-570: iris_message_resend resendFiltered executing path (the ID fetch after guard f) is exercised by no test: only MessageResendLiveTest reaches it and it starts a production in HSCUSTOM (forbidden on the shared instance)
- source: _bmad-output/implementation-artifacts/spec-39-1-message-header-search.md | severity: med | fix-risk: med | footprint: in-epic
- evidence: 39.1 review 2026-10-16; the statement is built like the dry-run sample statement the replay runs; a break fails safe (resends nothing)
- 2026-10-17T02:34:38Z status=routed owner=burndown by=harvest note=Epic 39 burn-down: drive it inside the disposable mapping-only namespace (its own Ens.Runtime) with a synthetic production, never HSCUSTOM
- 2026-10-17T03:13:38Z status=routed owner=39-2-phi-data-policy by=lead note=39.2 owns MessageResend.cls (resend preview under the PHI policy); drive the executing path in the disposable mapping-only namespace with a synthetic production, never HSCUSTOM; DW bullet in 39.2
- 2026-10-17T06:24:31Z status=resolved-by:39-2-phi-data-policy by=adjudication note=resendFiltered executing path driven live in the disposable mapping-only namespace with a synthetic production (probe showed clean start/stop; never HSCUSTOM), verified against SQL; build 549bbad

### DW-571: flake: doc-type-description-live-gate.test.ts (dev) failed once in a parallel turbo run; it compares two live listings of the shared HSCUSTOM
- source: _bmad-output/implementation-artifacts/spec-39-1-message-header-search.md | severity: low | fix-risk: low | footprint: in-epic
- evidence: 39.1 implement 2026-10-16: passed alone and in the serial run; listings of a shared namespace can change between the two reads
- 2026-10-17T02:34:38Z status=routed owner=burndown by=harvest note=flake class (cf. DW-444): make the comparison tolerant of concurrent changes or compare a fixed filter
- 2026-10-17T05:29:28Z occurrence=39-2-phi-data-policy
- 2026-10-17T08:21:39Z occurrence=39-3-message-body-content-search
- 2026-10-17T11:24:38Z occurrence=39-4-search-table-lookup
- 2026-10-17T14:26:14Z occurrence=39-5-message-body-reader
- 2026-10-17T17:42:27Z occurrence=39-6-message-forensics-docs-prompt-and-capstone
- 2026-10-17T18:31:11Z status=routed owner=39-7-epic-39-burn-down by=burndown note=chartered into the Epic 39 burn-down story
- 2026-10-17T21:38:00Z status=resolved-by:39-7-epic-39-burn-down by=adjudication note=the iris_package_list row compares its own request and envelope; 3/3 green under churn vs old row red in 2/5; build 2e307d4 + review patches; mutation-verified (spec-39-7 Verification)

### DW-572: iris_message_search headers: on an untuned Ens.MessageHeader the 7-day window does not bound the scan when a name or status filter is set (bitmap plan over the whole history)
- source: spec-39-1-message-header-search.md | severity: med | fix-risk: high | footprint: in-story
- evidence: EXPLAIN in HSCUSTOM: item+status -> Status INTERSECT (Source UNION Target) bitmaps, master map read per id, TimeCreated tested per row, cost 19075; window only -> TimeCreated index range, cost 103.84; resendFiltered COUNT shares the WHERE
- 2026-10-17T03:11:26Z status=escalated owner=burndown by=cr note=decide the plan strategy (index hint vs TuneTable guidance) with a large-data probe; revisit the add-filters doc advice
- 2026-10-17T09:11:02Z occurrence=39-3-message-body-content-search
- 2026-10-17T18:31:10Z status=routed owner=39-7-epic-39-burn-down by=merge_gate note=decided=orchestrator(Lead-away) decision 30: bound the search statement plan only (index hint), EXPLAIN before/after; resendFiltered unchanged
- 2026-10-17T21:38:01Z status=resolved-by:39-7-epic-39-burn-down by=adjudication note=index hint on the headers/body/searchTable statements; plan rows from INFORMATION_SCHEMA.STATEMENTS read the TimeCreated range; hint red-proven with ignored index names; resendFiltered untouched (residual DW-588); build 2e307d4 + review patches; mutation-verified (spec-39-7 Verification)

### DW-573: AD-15/AC-7: no test pins that pre-existing tools/list entries (description, schema, annotations) stay unchanged; the README payload sync compares tool counts only
- source: spec-39-1-message-header-search.md | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: no tool-definition snapshot in any package; docs-visibility-roster-sync compares counts; the 39.1 triage log cited gen:governance-baseline:check, which checks keys only
- 2026-10-17T03:11:29Z status=routed owner=39-6-message-forensics-docs-prompt-and-capstone by=cr note=the Epic 39 capstone pins every pre-existing interop tools/list entry (snapshot or per-tool hash) so a change goes red
- 2026-10-17T18:23:43Z status=resolved-by:39-6-message-forensics-docs-prompt-and-capstone by=adjudication note=114-entry tools/list snapshot fixture + shared core + CLI (--check / --force) + default-suite test; drift and vanished tools fail, new tools reported; build c158b73

### DW-574: message-search.ts adds a fifth local toStructured copy (message-resend.ts:162, execute.ts, sqlAnalyze.ts, docdb.ts) instead of one shared helper
- source: spec-39-1-message-header-search.md | severity: low | fix-risk: med | footprint: out-of-footprint
- evidence: Rule 2 (cr 39.1): identical 5-line helper; spec Task 11 froze message-resend.ts beyond the STATUS_LABELS export; the project keeps a local copy per tool module
- 2026-10-17T03:11:31Z status=wontfix-accepted owner=39-1-message-header-search by=cr note=reopen_if=the toStructured contract changes (more than one copy must be edited) or a sixth copy is added

### DW-575: MessageSearch.TypeLabel duplicates the MessageType $Select inside MessageResend PreviewOne (MessageResend.cls:229)
- source: spec-39-1-message-header-search.md | severity: low | fix-risk: low | footprint: in-epic
- evidence: Rule 2 (cr 39.1): spec-forced copy; PreviewOne is frozen in 39.1 (Never list) and the spec change log names 39.2 as the story that moves it onto TypeLabel
- 2026-10-17T03:11:34Z status=routed owner=39-2-phi-data-policy by=cr note=when 39.2 edits PreviewOne, call ##class(ExecuteMCPv2.REST.MessageSearch).TypeLabel(tType) instead of its own $Select
- 2026-10-17T06:24:31Z status=resolved-by:39-2-phi-data-policy by=adjudication note=PreviewOne calls MessageSearch.TypeLabel; the duplicate removed; build 549bbad

### DW-576: PHI data policy does not yet govern iris_production_logs (Text can carry segment text) or iris_message_diagram (sanitized ErrorStatus filled by parser errors with segment text); under the default redact they still show it
- source: _bmad-output/implementation-artifacts/spec-39-2-phi-data-policy.md (decision 26) | severity: med | fix-risk: med | footprint: in-epic
- evidence: 39.2 plan: TCPOutboundAdapter.cls:68,72, Parser.cls:262,287 (logs); Parser.cls:223,280, Correlator.cls:194-198 (diagram); AD-15 sanctioned only the preview change in 39.2
- 2026-10-17T03:55:04Z status=routed owner=burndown by=lead note=Epic 39 burn-down: bring both under dataPolicy (a sanctioned AD-15 change, orchestrator decision 26) or document as residual with an operator switch
- 2026-10-17T18:21:28Z occurrence=39-6-message-forensics-docs-prompt-and-capstone
- 2026-10-17T18:31:10Z status=routed owner=39-7-epic-39-burn-down by=burndown note=decision 31: under block withhold message-derived text of iris_production_logs/iris_message_diagram; redact/allow unchanged and documented residual
- 2026-10-17T21:38:01Z status=resolved-by:39-7-epic-39-burn-down by=adjudication note=under block iris_production_logs and iris_message_diagram withhold message-derived text with fixed reasons; redact/allow byte-identical; built interop process test; build 2e307d4 + review patches; mutation-verified (spec-39-7 Verification)

### DW-577: MessageSearch Hl7Text serializes the whole HL7 message before comparing its size with the cap (a large body is fully materialized first)
- source: _bmad-output/implementation-artifacts/spec-39-2-phi-data-policy.md | severity: med | fix-risk: med | footprint: in-epic
- evidence: 39.2 implement review 2026-10-16 (unverified; no tool reaches Hl7Text yet; Story 39.5 is its first consumer)
- 2026-10-17T05:29:28Z status=routed owner=39-5-message-body-reader by=harvest note=39.5: check the size bound before full serialization, or stream with a cap; pin with a large synthetic body
- 2026-10-17T06:22:00Z occurrence=39-2-phi-data-policy
- 2026-10-17T15:52:37Z status=resolved-by:39-5-message-body-reader by=adjudication note=AC-6: Hl7Size precheck sums stored segment sizes (and batch children) and refuses tooLarge before Hl7Text serializes; timing row on a 2,000,000+ char body + exact-size row, mutation-verified; build 5e02f47

### DW-578: redactHl7 keeps a line split off a free-text field by a raw LF when it starts with a known HL7 or Z-segment name and the field separator (the name, and a reviewed segment's kept positions)
- source: spec-39-2-phi-data-policy.md | severity: low | fix-risk: high | footprint: in-story
- evidence: CR probe on the patched built dist: NTE-3 split before 'ZOE|x' gives ZOE|***; before 'PID|v|...|w' keeps PID-1/PID-8; unknown names (LEE, DOE|) now refuse
- 2026-10-17T06:22:00Z status=wontfix-accepted owner=39-2-phi-data-policy by=cr note=reopen_if=a 39.5 live sample shows a split-off line kept by name; a fix needs DocType structure validation

### DW-579: A tools/call the MCP SDK rejects as schema-invalid never reaches handleToolCall, so it is never audited (AD-3 step 1 Zod validation; AD-19 one entry per call)
- source: spec-39-3-message-body-content-search.md | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: server-base.ts:1178 registerTool passes inputSchema, so the SDK validates before the audited chokepoint; the 39.3 gate audit row (story-39-3-body-search-live-gate.test.ts:1120) sees an entry for the valid call only
- 2026-10-17T09:11:02Z status=escalated owner=burndown by=cr note=decide: validate inside the chokepoint (permissive SDK schema) or amend AD-3/AD-19; recheck after the Epic 43 SDK move
- 2026-10-17T18:31:10Z status=routed owner=43-1-framework-migration-to-sdk-v2 by=merge_gate note=decided=orchestrator(Lead-away) decision 33: the SDK v2 call-path rewrite audits schema-invalid calls (one entry, outcome error, no argument values); DW bullet in 43.1

### DW-580: iris_message_search searchTable matches only headers whose body class is exactly the Search Table's DOCCLASS; indexed bodies of a DOCCLASS subclass are left out unless bodyClass names that subclass
- source: spec-39-4-search-table-lookup.md | severity: med | fix-risk: med | footprint: in-story
- evidence: MessageSearch.cls:996-1004 binds DOCCLASS via HeaderWhere; IRIS IndexDoc accepts %Extends(DOCCLASS), and Ens.SearchTableBase.SearchHeader and EnsPortal/MsgFilter/Assistant.cls:1502-1511 match subclasses
- 2026-10-17T12:07:01Z status=by-design owner=39-4-search-table-lookup by=cr note=spec I7/Boundaries; documented in the description; reopen by spec amendment to match subclasses (Ens.IsASub) as SearchHeader does

### DW-581: No test drives MessageSearch.SearchTablesConfigured to a SQL failure, so a regression that answers notApplicable for a failed configuration read would stay green
- source: spec-39-4-search-table-lookup.md | severity: low | fix-risk: med | footprint: in-story
- evidence: no test references the error path; forcing a failure in an Interoperability namespace needs a privilege-limited user (no security changes on the shared instance) or a test seam
- 2026-10-17T12:07:03Z status=wontfix-accepted owner=39-4-search-table-lookup by=cr note=reopen_if=SearchTablesConfigured changes, or a namespace with SearchTableProp rows answers notApplicable

### DW-582: AD-12's recorded IRIS-side exceptions do not name Search Table value normalization (MessageSearch.SearchTableValue mirrors Ens.VDoc.SearchTableGenerator's stored form)
- source: spec-39-4-search-table-lookup.md | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: spec I4 places it under AD-12 (PropType read in the same handler, one round trip); the spine's AD-12 exception list names identifier and operator validation only
- 2026-10-17T12:07:06Z status=wontfix-accepted owner=39-4-search-table-lookup by=cr note=reopen_if=another handler adds IRIS-side value normalization, or a review files AD-12 against SearchTableValue

### DW-583: iris_message_body under allow cannot show the content of a persistent body held in a character-stream property (HS.Message.XMLMessage ContentStream): the dump rules give its class and size only
- source: spec-39-5-message-body-reader.md | severity: med | fix-risk: med | footprint: in-story
- evidence: irislib/HS/Message/XMLMessage.cls:1,13 (%Persistent + %XML.Adaptor, payload in ContentStream); MessageBody.cls PropertyDump stream branch; Design Notes dump rules (spec-bound)
- 2026-10-17T15:49:37Z status=decision-pending owner=burndown by=cr note=decide: under allow, render a character-stream property's text (to maxChars) for persistent bodies, or a HealthShare renderer
- 2026-10-17T18:31:10Z status=routed owner=39-7-epic-39-burn-down by=merge_gate note=decided=orchestrator(Lead-away) decision 32: render character-stream body content under allow only, bounded by maxChars; redact withholds; block kind-only
- 2026-10-17T21:38:01Z status=resolved-by:39-7-epic-39-burn-down by=adjudication note=PropertyDump renders character-stream text under allow within one shared maxChars budget; redact withholds; block kind-only; live gate with an HS.Message.XMLMessage body; build 2e307d4 + review patches; mutation-verified (spec-39-7 Verification)

### DW-584: iris_metrics_interop 24-hour error count (Monitor.cls:579) counts Event Log Type=3 (Warning; Error is 2) and compares a local $Horolog cutoff with UTC TimeLogged
- source: _bmad-output/implementation-artifacts/spec-39-7-epic-39-burn-down.md | severity: med | fix-risk: low | footprint: out-of-footprint
- evidence: 39.7 plan source read 2026-10-17 (Ens.DataType.LogType values 1-6); unverified live
- 2026-10-17T20:40:17Z status=routed owner=burndown by=harvest note=overflow for the Epic 40 X.0 gate: probe, then fix Type and the UTC cutoff
- 2026-10-17T21:45:49Z status=routed owner=40-0-epic-39-deferred-cleanup by=x0 note=Epic 40 X.0 gate: probe then fix or close with evidence in Story 40.0 (DW bullet in its epics.md block)
- 2026-10-18T00:08:43Z status=resolved-by:40-0-epic-39-deferred-cleanup by=adjudication note=errorCount24h counts Type 2 over a UTC cutoff from Monitor.UtcCutoff ($ZTimeStamp, never $Horolog); messageCount24h shares it (decision 38); live gate 3/2 at process zones 0, 420 and -600 through the route's own collector; build b3d11b1 + review patches 898ae48; mutation-verified (spec-40-0 Verification); lead smoke 82/82 armed

### DW-585: iris_production_logs type filter probably matches nothing: the EventLog handler binds the display name (Error) to Type = ? in logical select mode, but Type is an integer (Ens.DataType.LogType)
- source: _bmad-output/implementation-artifacts/spec-39-7-epic-39-burn-down.md | severity: med | fix-risk: low | footprint: out-of-footprint
- evidence: 39.7 plan source read 2026-10-17; needs a probe before any fix
- 2026-10-17T20:40:17Z status=routed owner=burndown by=harvest note=overflow for the Epic 40 X.0 gate: probe with synthetic Event Log rows in a disposable namespace, then map display name to logical value
- 2026-10-17T21:45:49Z status=routed owner=40-0-epic-39-deferred-cleanup by=x0 note=Epic 40 X.0 gate: probe then fix or close with evidence in Story 40.0 (DW bullet in its epics.md block)
- 2026-10-18T00:08:43Z status=resolved-by:40-0-epic-39-deferred-cleanup by=adjudication note=Interop.LogTypeValue maps the six display names to their stored numbers (equal to the live Ens.DataType.LogType lists); numbers and unknown values pass through (AD-33); every type pinned on the wire against a SQL oracle; build b3d11b1 + review patches 898ae48; mutation-verified (spec-40-0 Verification); lead smoke 82/82 armed

### DW-586: Under block, iris_message_diagram leaves a per-session generation failure text (Generation failed for session N: <text> in warnings[] and the Mermaid %% line) unchanged; only the Correlator Error on message texts are rewritten
- source: _bmad-output/implementation-artifacts/spec-39-7-epic-39-burn-down.md | severity: med | fix-risk: low | footprint: in-epic
- evidence: 39.7 implement review 2026-10-17 (unverified whether <text> can carry message content)
- 2026-10-17T20:40:17Z status=routed owner=burndown by=harvest note=overflow for the Epic 40 X.0 gate: probe what <text> can carry; withhold under block if message-derived
- 2026-10-17T21:35:25Z occurrence=39-7-epic-39-burn-down
- 2026-10-17T21:45:49Z status=routed owner=40-0-epic-39-deferred-cleanup by=x0 note=Epic 40 X.0 gate: probe then fix or close with evidence in Story 40.0 (DW bullet in its epics.md block)
- 2026-10-18T00:08:43Z status=wontfix-theoretical by=adjudication note=closed with evidence (spec-40-0 Design Notes): the generator failure text carries only a SQL schema error or a system error name and location, and no reachable code path puts message content in it; Diagram/*.cls and diagram.ts byte-identical; reopen_if=a Diagram stage's exception data or SQL %Message echoes a header field value

### DW-587: Under block, the trace-message-flow prompt and its generated skill give no rule for withheld Event Log and diagram error text: steps 5-6 ask what the error log says, with no report-the-reason, never-read-it-another-way line like step 3 has for bodies
- source: spec-39-7-epic-39-burn-down.md | severity: med | fix-risk: low | footprint: out-of-footprint
- evidence: traceMessageFlow.ts steps 4-6 unchanged by 39.7 vs step 3 body rule; the 39.7 Docs table omits the prompt (Rule 56); 39.6 CHANGELOG treats a prompt-body change as AD-15 sanctioned
- 2026-10-17T21:35:25Z status=escalated owner=burndown by=cr note=decide at the Epic 40 X.0 gate: add the block rule to steps 4-5 (AD-15 prompt-body change, regenerate skills) or accept
- 2026-10-17T21:41:21Z note=decided=orchestrator(Lead-away) decision 36: fix the trace-message-flow prompt text (sanctioned AD-15 prompt change) in the Epic 40 X.0 story
- 2026-10-17T21:45:49Z status=routed owner=40-0-epic-39-deferred-cleanup by=x0 note=Epic 40 X.0 gate: decision 36 applied; fix the prompt text in Story 40.0 (DW bullet in its epics.md block)
- 2026-10-18T00:08:43Z status=resolved-by:40-0-epic-39-deferred-cleanup by=adjudication note=trace-message-flow steps 4-6 carry the block report-the-reason, never-read-it-another-way rule; SKILL.md regenerated; built interop process over stdio with arguments omitted; build b3d11b1 + review patches 898ae48; mutation-verified (spec-40-0 Verification); lead smoke 82/82 armed

### DW-588: DW-572 residual: iris_message_resend filtered mode (resendFiltered) keeps the history-wide Status/Source/Target bitmap plan on an untuned Ens.MessageHeader, because decision 30 left its statements unchanged
- source: spec-39-7-epic-39-burn-down.md | severity: med | fix-risk: med | footprint: out-of-footprint
- evidence: DW-572 evidence: resendFiltered COUNT shares the WHERE; decision 30: resendFiltered stays unchanged; MessageResend.cls not in the 39.7 diff; nothing carries the residual once DW-572 resolves
- 2026-10-17T21:35:25Z status=escalated owner=burndown by=cr note=decide at the Epic 40 X.0 gate: HEADERHINT in resendFiltered (its pins move) or a tuning note; filtered resend is a default-disabled write
- 2026-10-17T21:41:21Z status=wontfix-accepted by=merge_gate note=decided=orchestrator(Lead-away) decision 37: reopen_if=an operator enables iris_message_resend resendFiltered and a dry run on a large Ens.MessageHeader exceeds the Web Gateway timeout, or a measured EXPLAIN on a tuned table shows the hint changes no results -- then add the same index hint to resendFiltered with its byte-identity pin re-captured

### DW-589: iris_alerts_manage reset builds clearedAt from local $Horolog and appends a literal Z, so on a non-zero time zone it labels local time as UTC (the DW-584 defect class)
- source: _bmad-output/implementation-artifacts/spec-40-0-epic-39-deferred-cleanup.md | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: 40.0 implement review 2026-10-17: Monitor.cls ~960 $Translate($ZDateTime($Horolog,3,1)," ","T")_"Z"; instance runs at $ZTimeZone 0 so invisible live; pre-existing
- 2026-10-17T23:04:40Z status=routed owner=burndown by=harvest note=overflow for the Epic 40 burn-down: use $ZTimeStamp (as UtcCutoff does) and pin under a per-process $ZTimeZone
- 2026-10-19T01:44:17Z status=routed owner=40-5-epic-40-burn-down by=burndown note=Epic 40 burn-down gate: chartered into Story 40.5 (DW bullet in its epics.md block)
- 2026-10-19T04:15:02Z status=resolved-by:40-5-epic-40-burn-down by=adjudication note=AlertsManage clearedAt comes from Monitor.UtcStamp ($ZTimeStamp); OS tests at fixed instants and process zones 420/-600, and a falsifiable source pin on the route (the reset route is never called on the shared instance); build 1fdda9e + review patches 506fd0c; mutation-verified (spec-40-5 Verification, Rule 48); lead smoke 116/116 armed + OS classes

### DW-590: Under block, the recover-stuck-production prompt step 3 calls iris_production_logs with no report-the-reason, never-read-it-another-way rule for withheld Event Log text (the rule DW-587 added to trace-message-flow)
- source: _bmad-output/implementation-artifacts/spec-40-0-epic-39-deferred-cleanup.md | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: 40.0 implement review 2026-10-17: recoverStuckProduction.ts:54 says nothing about textPolicy; decision 36 scoped DW-587 to trace-message-flow; a prompt-text change is a sanctioned AD-15 change
- 2026-10-17T23:04:40Z status=escalated owner=burndown by=harvest note=decide at the Epic 40 burn-down decision sheet (same shape as decision 36)
- 2026-10-19T01:44:17Z status=routed owner=40-5-epic-40-burn-down by=merge_gate note=decided=orchestrator(Lead-away) decision 65: add the block report-the-reason rule to recover-stuck-production step 3 (sanctioned AD-15 prompt change) in Story 40.5
- 2026-10-19T04:15:02Z status=resolved-by:40-5-epic-40-burn-down by=adjudication note=recover-stuck-production step 3 carries the block report-the-reason, never-read-it-another-way rule (decision 65); skill regenerated; built interop server over stdio; build 1fdda9e + review patches 506fd0c; mutation-verified (spec-40-5 Verification, Rule 48); lead smoke 116/116 armed + OS classes

### DW-591: gen:bootstrap rewrites bootstrap-classes.ts even when its content is unchanged, so an idempotence re-run after a build leaves the shared dist older than its source and every armed live gate skips or fails as stale until shared is rebuilt
- source: _bmad-output/implementation-artifacts/spec-40-0-epic-39-deferred-cleanup.md | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: 40.0 implement 2026-10-17; scripts/gen-bootstrap.mjs:180 writeFileSync unconditional; staleDistReason/checkDistFresh compare mtimes
- 2026-10-17T23:04:41Z status=routed owner=burndown by=harvest note=overflow for the Epic 40 burn-down: write only when content differs, and pin it
- 2026-10-19T01:44:17Z status=routed owner=40-5-epic-40-burn-down by=burndown note=Epic 40 burn-down gate: chartered into Story 40.5 (DW bullet in its epics.md block)
- 2026-10-19T04:15:02Z status=resolved-by:40-5-epic-40-burn-down by=adjudication note=gen:bootstrap writes bootstrap-classes.ts only when the whole content differs (prints Unchanged otherwise, mtime untouched); drift and idempotence tests unchanged, hand-edit and round-trip cases pinned in scratch trees; build 1fdda9e + review patches 506fd0c; mutation-verified (spec-40-5 Verification, Rule 48); lead smoke 116/116 armed + OS classes

### DW-592: Monitor.cls CollectInteropMetrics and Interop.cls EventLog bind the UTC cutoff and the type number through %ExecDirect at the process default select mode, not the explicit %SelectMode=0 MessageSearch.cls uses for the same Ens.DataType.UTC comparison
- source: _bmad-output/implementation-artifacts/spec-40-0-epic-39-deferred-cleanup.md | severity: low | fix-risk: med | footprint: in-story
- evidence: 40.0 cr 2026-10-17: %SQL.Statement %SelectMode defaults to $zu(115,5); only a non-logical process default (nothing in src sets it) shifts the cutoff; fix moves BOOTSTRAP_VERSION
- 2026-10-18T00:04:04Z status=wontfix-accepted owner=40-0-epic-39-deferred-cleanup by=cr note=reopen_if=a REST worker runs with $zu(115,5)'=0, or Monitor/Interop.cls next change (fix as MessageSearch.cls:1119)

### DW-593: Mocked iris_production_logs entries in interop monitor.test.ts and logs-diagram-policy.test.ts carry type "Error" where the route returns the stored number (Rule #54 fake shape)
- source: _bmad-output/implementation-artifacts/spec-40-0-epic-39-deferred-cleanup.md | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: 40.0 cr 2026-10-17: monitor.test.ts:26, logs-diagram-policy.test.ts:46,146; Interop.cls EventLog sets type from tRS.Type (2); no assertion reads the field
- 2026-10-18T00:04:04Z status=wontfix-accepted owner=40-0-epic-39-deferred-cleanup by=cr note=reopen_if=a test or tool reads an Event Log entry's type, or these mocks are next edited

### DW-594: The 40.0 QA gate re-implements small helpers instead of extending shared ones: its seed put/compile/check (putCompileSeed is private) and rawLogs/idsOf/LogsContent copied from the burn-down gate
- source: _bmad-output/implementation-artifacts/spec-40-0-epic-39-deferred-cleanup.md | severity: low | fix-risk: low | footprint: in-story
- evidence: 40.0 cr 2026-10-17: story-40-0-qa-live-gate beforeAll vs interop-namespace-fixture.ts putCompileSeed; rawLogs in both 40.0 gates; inline QA seeds follow the 39.3/39.5 QA gates
- 2026-10-18T00:04:04Z status=wontfix-accepted owner=40-0-epic-39-deferred-cleanup by=cr note=reopen_if=a third gate declares rawLogs or idsOf, or another file needs Story40Q.Seed

### DW-595: Coverage Runner.ReadCounts reads the Line-by-Line counts right after RunTest with no readiness check, so a suite that finishes inside the monitor's start-up delay could read zero counts and report 0% as a complete result
- source: _bmad-output/implementation-artifacts/spec-40-1-line-coverage-probe-and-engine.md | severity: med | fix-risk: low | footprint: in-epic
- evidence: 40.1 review 2026-10-17 (Blind), claim from reading only: ResultExecute returns zero rows without an error for an unknown routine, so a premature read would be silent; every gate run read correct counts; settle with a probe that starts a session and reads the same process's counts at once
- 2026-10-18T04:15:06Z status=routed owner=40-2-coverage-reports-and-targets by=harvest note=probe first; 40.2 consumes the counts for its per-class/per-method summary
- 2026-10-18T05:28:57Z occurrence=40-1-line-coverage-probe-and-engine
- 2026-10-18T13:33:41Z status=wontfix-theoretical by=adjudication note=40.2 plan probe 2026-10-17: in the process that calls Start, code run right after Start is counted and its counts read at once with no wait, in 3 rounds; the runner is that process; reopen_if=a completed run reports zero counts for a routine whose tests ran

### DW-596: The coverage Status route builds one nested pair per counted line and per command line of the whole run on every read of a terminal run; the 200,000-line cap and 20-run retention were sized from SyntaxColor/Result timings, not measured on the Status path
- source: _bmad-output/implementation-artifacts/spec-40-1-line-coverage-probe-and-engine.md | severity: med | fix-risk: low | footprint: in-epic
- evidence: 40.1 review 2026-10-17 (Blind), claim from reading only (REST/Coverage.cls BuildRoutines); the gate fixture has 48 lines; settle by measuring Status time, response bytes and process memory for a ~200,000-line routine
- 2026-10-18T04:15:06Z status=routed owner=40-2-coverage-reports-and-targets by=harvest note=measure before 40.2 builds its summary on the Status payload; Rule #38 output caps are not scan caps
- 2026-10-18T13:33:42Z status=wontfix-accepted by=adjudication note=measured at the 200,000-line cap (40.2 implement): one terminal Status read 0.62 s over HTTP, 4.8 MB, 62.8 MB IRIS process memory, inside the 2 s budget; encoding kept; reopen_if=a Status read at the cap exceeds 2 s or runs out of memory

### DW-597: ExecuteMCPv2.REST.UnitTest:BuildTestSpec joins a package's classes as :A;:B, which RunTest reads as class A with a method named B, so POST /tests with level package runs no test
- source: _bmad-output/implementation-artifacts/spec-40-1-line-coverage-probe-and-engine.md | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: 40.1 verification-gap review, captured live 2026-10-17: a package coverage run of Story401 ran 0 tests until REST.Coverage.TestSpec rewrote the spec as :A;B (then 5 ran); no MCP tool calls POST /tests; UnitTestTest pins only the string shape
- 2026-10-18T04:15:06Z status=routed owner=burndown by=harvest note=overflow for the Epic 40 burn-down: fix BuildTestSpec at its source (then TestSpec's rewrite can go) and pin a package run
- 2026-10-19T01:44:17Z status=routed owner=40-5-epic-40-burn-down by=burndown note=Epic 40 burn-down gate: chartered into Story 40.5 (DW bullet in its epics.md block)
- 2026-10-19T04:15:02Z status=resolved-by:40-5-epic-40-burn-down by=adjudication note=BuildTestSpec joins a package's classes as :A;B; the coverage TestSpec rewrite is removed; POST /tests and iris_test_coverage package runs pinned live (3 classes, 6 methods) in disposable namespaces; iris_execute_tests' own path pinned unchanged; build 1fdda9e + review patches 506fd0c; mutation-verified (spec-40-5 Verification, Rule 48); lead smoke 116/116 armed + OS classes

### DW-598: A coverage run whose Line-by-Line session loaded fewer routines than its routine list fails both release proofs, and the next start kills its node as disproved, so the suite's own session is orphaned and every later start is refused foreign
- source: spec-40-1-line-coverage-probe-and-engine.md | severity: med | fix-risk: low | footprint: in-story
- evidence: 40.1 rework re-review 2026-10-18 (Edge, verified by reading): LineByLine.Start loads routines through $$LIST^%R and silently skips a missing .obj (irislib LineByLine.cls:56-70); ProofFailure's ListsEqual then fails for runner and supervisor, Finish keeps the node, and NodeDisproved (count mismatch) kills it
- 2026-10-18T07:26:21Z status=routed owner=40-2-coverage-reports-and-targets by=cr note=probe first: Runner.Run checks GetRoutineCount against the run's list right after Start and stops at once with a startError
- 2026-10-18T13:33:42Z status=resolved-by:40-2-coverage-reports-and-targets by=adjudication note=the runner checks right after Start that the session loaded every listed routine (Job.SessionScopeFailure, LoadedAsListed) and on a mismatch fails the run naming the routine, runs no test and stops its own proven session (Runner.RecordUnstoppedSession on a non-clean stop); zero-routine session case (row 13b) included; gate rows 13/13b live, mutation-verified; 4 armed coverage gates 79/79 at lead smoke

### DW-599: Spine AD-27 and the round-1 HIGH-2 note say an all-processes or paused session still reports the previous scoped session's list; the rework probe on the same build saw the starting process and others instead
- source: spec-40-1-line-coverage-probe-and-engine.md | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: 40.1 rework re-review 2026-10-18 (Blind, Gap, Auditor): ARCHITECTURE-SPINE.md AD-27 'What proves a session is the suite's' vs spec Spec Change Log rework-1 probe and Verification mutation line for MonitorActive; the mode-2-only rule holds under both readings
- 2026-10-18T07:26:21Z status=wontfix-accepted owner=40-1-line-coverage-probe-and-engine by=cr note=lead may reword the AD-27 rationale (Rule 20); reopen_if=a later AD-27 story bases a decision on what $ZU(84,10,2) reads in mode 1 or 0

### DW-600: The coverage live gates declare their own copies of the same helpers (fixtureCall, monitorState, coverageGlobal, runCounter, expectIdle, rawStatus, releaseLeftover, coverage, poll, wireOptions, sourceOf) and the fixture HoldRunnerLock repeats HoldMonitorLock
- source: spec-40-2-coverage-reports-and-targets.md | severity: low | fix-risk: med | footprint: in-story
- evidence: Up to four gate files (story-40-1-coverage, story-40-1-qa, story-40-2-coverage-reports, story-40-2-qa live gates) declare the helpers, mostly verbatim; the spec's stated reason is only that the 40.2 gate follows the 40.1 gate shape (Rule 2, weak reason)
- 2026-10-18T11:35:23Z status=wontfix-accepted owner=40-2-coverage-reports-and-targets by=cr note=reopen_if=a coverage gate's copy of expectIdle or another shared-instance check diverges from another gate's copy
- 2026-10-19T04:12:15Z occurrence=40-5-epic-40-burn-down

### DW-601: A freshly compiled class whose only methods with INT code have bodies of preprocessor lines alone (#; or #dim) reads source.reason not-up-to-date: IsDirective records those lines as 0, so lineMapIsGone cannot tell the class from one whose line map is gone
- source: spec-40-2-coverage-reports-and-targets.md | severity: med | fix-risk: med | footprint: in-story
- evidence: CR re-review 2026-10-18, live: fresh ExecuteMCPv2.Temp.CR402Stub (IsUpToDate 1, $Data(^rMAP)=10) gives OnHook [0]/label 7, Declared [0]/label 5; built dist -> {reason:not-up-to-date}, verdict FAIL; a doc-only edit gives the same shape with ^rMAP 0
- 2026-10-18T13:27:45Z status=routed owner=40-4-test-depth-docs-prompt-and-capstone by=cr note=fix: raw class flag from $Data(^rMAP(class)) in SourceMap; exact label via cMETHrtnlabel also closes the 31-char residual
- 2026-10-19T01:32:46Z status=resolved-by:40-4-test-depth-docs-prompt-and-capstone by=adjudication note=SourceMap records $Data(^rMAP(class)) (10 fresh, 0 stale) and each method's compiled label (cMETHrtnlabel; a %-named method with an empty RtnLabel uses its name cut to 31 characters); the TypeScript stale rule uses lineMap; a directive-only fresh class is no longer not-up-to-date and a stale %-only class no longer exports at line-rate 1; build 27d04e5 + review patches 36d2f90; mutation-verified (spec-40-4 Verification); lead smoke: 9 Epic 40 gates armed 262/262

### DW-602: IsDirective drops a #dim line that carries an initial value (#dim tSC As %Status = $$$OK), which compiles to an executable Set: the statement is never a class line and its INT line counts as generated, against the AC-1 executable rule; the dev README and CHANGELOG state it as never a class line
- source: spec-40-2-coverage-reports-and-targets.md | severity: med | fix-risk: med | footprint: in-story
- evidence: CR re-review 2026-10-18, live: ExecuteMCPv2.Temp.CR402Probe DimInit -> INT 16 'Set tSC=1' (C:set), raw intLines [0,17]/label 15; built dist reports only line 7 and generated 1; the idiom skews percent per method
- 2026-10-18T13:27:45Z status=routed owner=40-4-test-depth-docs-prompt-and-capstone by=cr note=fix: keep INTLine's line for a #dim with '=' outside parens (or a raw per-line kind flag, TS decides); correct the README/CHANGELOG sentence
- 2026-10-19T01:32:46Z status=resolved-by:40-4-test-depth-docs-prompt-and-capstone by=adjudication note=an initializing #dim is an executable class line at its own line; a non-initializing #dim whose trailing comment holds = (// ; or /* */, strings respected) is not; README and CHANGELOG corrected; build 27d04e5 + review patches 36d2f90; mutation-verified (spec-40-4 Verification); lead smoke: 9 Epic 40 gates armed 262/262

### DW-603: The Story 40.1 and 40.2 coverage gates and their QA gates each still declare their own copy of the instance-wide monitor helpers (monitorState, coverageGlobal, expectMonitorIdle, releaseLeftoverSession) that testproduction-gate-helpers.ts now shares for the two Story 40.3 gates
- source: spec-40-3-testproduction-runs.md | severity: med | fix-risk: low | footprint: in-epic
- evidence: story-40-1-coverage-live-gate, story-40-1-qa-live-gate, story-40-2-coverage-reports-live-gate and story-40-2-qa-live-gate each define the four helpers at top level (Rule 2 near-copies); a fix to the StopIfList safety net or the idle check in one copy does not reach the others
- 2026-10-18T17:35:54Z status=routed owner=burndown by=cr note=Rule 2; move the four gates onto the shared helpers (a monitor-only module if the TestProduction helpers do not fit) and re-run them armed
- 2026-10-19T01:00:23Z occurrence=40-4-test-depth-docs-prompt-and-capstone
- 2026-10-19T01:44:17Z status=routed owner=40-5-epic-40-burn-down by=burndown note=Epic 40 burn-down gate: chartered into Story 40.5 (DW bullet in its epics.md block)
- 2026-10-19T04:15:02Z status=resolved-by:40-5-epic-40-burn-down by=adjudication note=the 40.1/40.2 gates, the capstone and 40.4 QA use the shared monitor-gate-helpers.ts; the copy guard learns the moved names; all 11 Epic 40 gates armed green; build 1fdda9e + review patches 506fd0c; mutation-verified (spec-40-5 Verification, Rule 48); lead smoke 116/116 armed + OS classes

### DW-604: Spine AD-15's Story 40.3 bullet (decision #60) names a namespace that cannot see the ExecuteMCPv2 classes as unguarded, but not the rework-1 case of a namespace holding its own copy of an earlier build without ProductionGuard
- source: spec-40-3-testproduction-runs.md | severity: low | fix-risk: low | footprint: in-epic
- evidence: UnitTest.cls ProductionCheck now answers proceed unguarded where a namespace's own pre-40.3 copy lacks ProductionGuard (lead rework item 2); CHANGELOG, tool_support.md and the dev README state it, the spine AD-15 bullet does not
- 2026-10-18T19:52:53Z status=wontfix-accepted owner=40-3-testproduction-runs by=cr note=spine is lead-owned (Rule 20); the CHANGELOG, where AD-15's list is pruned at the Epic 42 retro, names it. reopen_if=the AD-15 bullet is cited to decide an older-copy namespace

### DW-605: POST /tests (ExecuteMCPv2.REST.UnitTest:RunTests) passes its raw target into BuildTestSpec and %UnitTest.Manager:RunTest, which reads ';' as more classes, ',' as more specs and '^' as setup code it runs with do @..., so a REST caller can run arbitrary classmethods and unguarded TestProduction classes
- source: spec-40-3-testproduction-runs.md | severity: med | fix-risk: low | footprint: out-of-footprint
- evidence: irislib/%UnitTest/Manager.cls BeforeRunTest (d:before'="" @before), RunOneTestSuite ';' split and RunTest ',' split; RunTests validates only that target is non-empty. The MCP path (iris_execute_tests method segment) was closed in Story 40.3's re-review
- 2026-10-18T19:52:59Z status=wontfix-theoretical owner=40-3-testproduction-runs by=cr note=no MCP tool calls POST /tests, and a REST caller with webapp access already holds POST /command. Real if a tool starts calling RunTests
- 2026-10-19T04:12:15Z occurrence=40-5-epic-40-burn-down

### DW-606: orchestrator-decisions-wave-6.md pause banner still says the run is paused after run_resumed, and its ~20:40Z time disagrees with the cycle log's 20:31:56Z
- source: spec-40-3-testproduction-runs.md | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: banner: Run paused 2026-10-18 (~20:40Z); cycle-log-epic-40.md: run_paused 20:31:56Z, run_resumed 20:56:25Z (0f996c1 did not touch the banner)
- 2026-10-18T21:41:52Z status=wontfix-accepted owner=40-3-testproduction-runs by=cr note=lead-owned run-state banner, rewritten at each pause/resume; reopen_if=a resume or merge gate reads the banner and treats the run as paused

### DW-607: ProductionGuardTest's guard-and-dictionary agreement loop takes its expected value from %Dictionary.Classname:IsValid, the same function IsClassName now calls, so it cannot fail; the claim that every compilable class name passes the guard's name check is pinned only by one CJK sample, not against the compiler's own validator
- source: _bmad-output/implementation-artifacts/spec-40-3-testproduction-runs.md | severity: low | fix-risk: low | footprint: in-epic
- evidence: lead scoped re-review of 47412c4 (2026-10-18): ProductionGuardTest.cls:125-127; IsClassnameValid^%occName (behind $System.OBJ.IsValidClassname) source is not in the irislib snapshot
- 2026-10-18T21:53:57Z status=routed owner=burndown by=harvest note=overflow for the Epic 40 burn-down: take the expected value from $System.OBJ.IsValidClassname for non-existent names, or drop the loop and keep the CJK assertions
- 2026-10-19T01:44:17Z status=routed owner=40-5-epic-40-burn-down by=burndown note=Epic 40 burn-down gate: chartered into Story 40.5 (DW bullet in its epics.md block)
- 2026-10-19T04:15:02Z status=resolved-by:40-5-epic-40-burn-down by=adjudication note=ProductionGuardTest's agreement loop takes its expected value from $System.OBJ.IsValidClassname (independent of IsClassName); "" asserted separately; mutation to an ASCII-only check goes red; build 1fdda9e + review patches 506fd0c; mutation-verified (spec-40-5 Verification, Rule 48); lead smoke 116/116 armed + OS classes

### DW-608: Once, a freshly compiled class (UDL save plus Compile cuk-d) showed $Data(^rMAP(class)) 0 while IsUpToDate was 1, so SourceMap would record lineMap 0 and coverage would read the class not-up-to-date (a false FAIL)
- source: _bmad-output/implementation-artifacts/spec-40-4-test-depth-docs-prompt-and-capstone.md | severity: low | fix-risk: med | footprint: in-story
- evidence: 40.4 implement probe 2026-10-18 22:43 in HSCUSTOM, two brand-new classes; 12 later probe rounds, about 10 capstone runs and every OS run gave 10; cause not found; errs only toward a false FAIL (CHANGELOG known limits)
- 2026-10-19T00:11:38Z status=wontfix-theoretical owner=40-4-test-depth-docs-prompt-and-capstone by=harvest note=reopen_if=a capstone or OS run shows lineMap 0 straight after a compile
- 2026-10-19T01:24:40Z status=wontfix-accepted by=adjudication note=lead correction (40.4 code review): the event was observed once, so it is an accepted residual, not theoretical; errs only toward a false FAIL; reopen_if=a capstone or OS run shows lineMap 0 straight after a compile

### DW-609: The edit-and-test-class prompt calls iris_execute_tests but has no PRODUCTION_BUSY note, so under the Story 40.3 guard an agent has no instruction to report the refusal rather than stop the other production to get its tests to run
- source: _bmad-output/implementation-artifacts/spec-40-4-test-depth-docs-prompt-and-capstone.md | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: 40.4 implement review 2026-10-18: editAndTestClass.ts; deploy-and-test-class gained the note in 40.4 (decision 62); the AD-15 sanction names only deploy-and-test-class; same shape as DW-590
- 2026-10-19T00:11:38Z status=escalated owner=burndown by=harvest note=decide at the Epic 40 burn-down decision sheet together with DW-590 (prompt-text changes need an AD-15 sanction)
- 2026-10-19T01:24:40Z status=decision-pending owner=burndown by=adjudication note=lead correction (40.4 code review): a low prompt-text item awaiting a decision, not an escalated medium; decide at the Epic 40 decision sheet with DW-590 and DW-610
- 2026-10-19T01:44:17Z status=routed owner=40-5-epic-40-burn-down by=merge_gate note=decided=orchestrator(Lead-away) decision 66: add the PRODUCTION_BUSY note to edit-and-test-class (sanctioned AD-15 prompt change) in Story 40.5
- 2026-10-19T04:15:02Z status=resolved-by:40-5-epic-40-burn-down by=adjudication note=edit-and-test-class carries the shared PRODUCTION_BUSY note (decision 66); skill regenerated; built dev server over stdio; build 1fdda9e + review patches 506fd0c; mutation-verified (spec-40-5 Verification, Rule 48); lead smoke 116/116 armed + OS classes

### DW-610: Step 4 of the deploy-and-test-class prompt says a PRODUCTION_BUSY refusal means a production other than the tests' own is running and the refusal names it, but the Story 40.3 guard also refuses with state Unknown when the production state cannot be read
- source: spec-40-4-test-depth-docs-prompt-and-capstone.md | severity: low | fix-risk: low | footprint: in-story
- evidence: 40.4 code review 2026-10-18: deployAndTestClass.ts step 4 (decision 62 golden text); 40.3 CHANGELOG: busy including when the state cannot be read, refusal carries state Unknown and error; the refusal text names the case
- 2026-10-19T01:00:23Z status=decision-pending owner=burndown by=cr note=prompt-text amendment needs a lead call (AD-15, decision 62); decide at the Epic 40 decision sheet with DW-590 and DW-609
- 2026-10-19T01:44:17Z status=routed owner=40-5-epic-40-burn-down by=merge_gate note=decided=orchestrator(Lead-away) decision 67: step 4 wording covers the unreadable-state refusal too (sanctioned AD-15 prompt change) in Story 40.5
- 2026-10-19T04:15:02Z status=resolved-by:40-5-epic-40-burn-down by=adjudication note=the shared PRODUCTION_BUSY note covers both the running-production and the unreadable-state refusal in deploy-and-test-class and edit-and-test-class (decision 67); pinned against a live Unknown refusal; build 1fdda9e + review patches 506fd0c; mutation-verified (spec-40-5 Verification, Rule 48); lead smoke 116/116 armed + OS classes

### DW-611: The real-tree provenance tests need client-config's built dist, but nothing orders @iris-mcp/all's test after @iris-mcp/client-config's build, and the turbo cache key of @iris-mcp/all's test omits the pack inputs (skills-pack-src/, skills/, scripts/)
- source: _bmad-output/implementation-artifacts/spec-41-1-pack-layout-licensing-and-provenance.md | severity: med | fix-risk: low | footprint: in-epic
- evidence: 41.1 implement review 2026-10-19: packages/iris-mcp-all depends on the five servers, not client-config; turbo.json gives test no inputs; on a fresh clone the gatherer fails loudly (not a false green), and a cached green can replay after pack sources change
- 2026-10-19T06:17:55Z status=routed owner=41-7-skills-pack-docs-and-capstone by=harvest note=the 41.7 capstone runs in the default suite and needs that ordering; add a workspace devDependency or turbo inputs, and pin it
- 2026-10-19T07:08:11Z occurrence=41-1-pack-layout-licensing-and-provenance note=cr: inputs also miss packages/client-config/package.json, client-config/skills-pack/** and client-config dist

### DW-612: Nothing on the publish path runs gen:pack --check or check:provenance; client-config's prepublishOnly runs only verify-iris-reachable, so a publish made without the default suite could ship a drifted pack or a tarball without the notice
- source: _bmad-output/implementation-artifacts/spec-41-1-pack-layout-licensing-and-provenance.md | severity: med | fix-risk: low | footprint: out-of-footprint
- evidence: 41.1 implement review 2026-10-19: packages/client-config/package.json scripts.prepublishOnly; Epic 42 owns the publish gates (AD-29)
- 2026-10-19T06:17:55Z status=routed owner=42-6-tarball-smoke-and-1-0-0-publish by=harvest note=42.6's tarball smoke proves the pack and notice gate red on the real publish path (Rule 59)

### DW-613: No pack check requires a SKILL.md to start with frontmatter, so an adaptation header placed above the frontmatter passes provenance while the skill loses its name and description
- source: spec-41-1-pack-layout-licensing-and-provenance.md | severity: med | fix-risk: low | footprint: in-epic
- evidence: 41.1 CR 2026-10-19: hasValidAdaptationHeader (provenance-core.mjs:165) reads a file whose line 1 is not --- as frontmatter-less, so header-then-frontmatter passes; reproduced by 4 layers and QA; the frontmatter test reads root skills/ only
- 2026-10-19T07:08:11Z status=routed owner=41-3-core-knowledge-skills by=cr note=add a default-suite check that every pack SKILL.md opens with frontmatter holding name and description; prove it red

### DW-614: Provenance cannot yet cover an adapted rule: listAgentContentFiles labels a rule source packRel rules/<f>, a path the pack no longer has (the forms are rules/claude-code/ and rules/agents-md/), and the adaptation header's position inside the agents-md form is undecided
- source: _bmad-output/implementation-artifacts/spec-41-2-always-on-objectscript-pre-write-rule.md | severity: low | fix-risk: med | footprint: in-epic
- evidence: 41.2 implement review 2026-10-19 (recorded as a residual risk); no story plans an adapted rule
- 2026-10-19T09:16:29Z status=wontfix-accepted owner=41-2-always-on-objectscript-pre-write-rule by=harvest note=reopen_if=a story adds a rule adapted from third-party content, or check:provenance reports a rule:<f> path that does not exist in the pack

### DW-615: Live probes in Story 41.2 found the project's own agent rule files wrong in places: object-script-testing.md (typed MultiDimensional properties compile; %OnNew-Private holds only when the parent's %OnNew is public; the macro list omits AssertNotTrue and others), iris-objectscript-basics.md (an empty abstract body compiles; // is a valid comment; % names are a convention; the New $NAMESPACE example is environment-dependent) and project rule #7 (Use dev::("") clears the mnemonic but leaves redirection on)
- source: _bmad-output/implementation-artifacts/spec-41-2-always-on-objectscript-pre-write-rule.md | severity: low | fix-risk: low | footprint: out-of-footprint
- evidence: 41.2 plan probes 2026-10-19 (26 Probe412 classes, IRIS 2026.2 build 221U); the full list is under Flagged for the retro in the spec; retros are skipped this run, so the flag would otherwise be lost
- 2026-10-19T09:16:29Z status=decision-pending owner=burndown by=harvest note=human=the user decides whether to correct .claude/rules/object-script-testing.md, iris-objectscript-basics.md and project rule #7 (agent instruction files are the user's to edit)
