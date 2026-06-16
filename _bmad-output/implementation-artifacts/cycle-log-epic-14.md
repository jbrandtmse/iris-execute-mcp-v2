# Cycle Log — Epic 14 (Platform Foundation: Multi-Server Profiles & Tool Governance)
# Format: <UTC>	<Epic N | Story id>	<stage>	<metadata>  (TAB-separated, append-only)
# Branch: epic14 (off feature/mgmt-portal-tools, off main). Single repo, no submodules.

2026-06-16T00:43:15Z	Epic 14	feature_branch_created	repos=. ticket= description=mgmt-portal-tools root=origin/main
2026-06-16T00:43:15Z	Epic 14	epic_branch_created	repos=. from=960098c
2026-06-16T00:43:15Z	Epic 14	epic_branch_checked_out	repos=. head=960098c
2026-06-16T00:45:44Z	Epic 14	sprint_planning_complete	model=claude-opus-4-8 epics=4 stories=20 retro_entries_added=4
2026-06-16T01:03:22Z	Epic 14	retro_review_complete	source_retro= included=0 deferred=27 routed=1 dropped=0 model=claude-opus-4-8
2026-06-16T01:03:22Z	Story 14.0	story_created	path=_bmad-output/implementation-artifacts/14-0-epic-13-deferred-cleanup.md triage_only=true model=claude-opus-4-8
2026-06-16T01:03:52Z	Story 14.0	committed	sha=8936cf8 submodules= triage_only=true
2026-06-16T01:09:18Z	Story 14.1	story_created	path=_bmad-output/implementation-artifacts/14-1-multi-server-profiles-config-and-resolution.md model=claude-opus-4-8
2026-06-16T01:27:39Z	Story 14.1	dev_complete	spawn_at=2026-06-16T01:09:18Z model=claude-opus-4-8 files=5 source_modules=profiles.ts,server-base.ts,index.ts tests_added=25 shared_tests=230 clarifications=0 nfr_tripwires=0 adr_violations_surfaced=0 cycle_iteration=1 closing_sections_present=true
2026-06-16T01:27:39Z	Story 14.1	adr_verifications_complete	tool=none acs=none result=none_required evidence= model=claude-opus-4-8
2026-06-16T01:34:57Z	Story 14.1	qa_complete	spawn_at=2026-06-16T01:27:46Z model=claude-opus-4-8 tests_added=30 shared_tests=260 first_run_failures=0 clarifications=0 closing_sections_present=true
2026-06-16T01:48:09Z	Story 14.1	cr_complete	spawn_at=2026-06-16T01:35:15Z model=claude-opus-4-8 resolved=2 deferred=5 dismissed=6 high=1 med=3 low=3 clarifications=0 closing_sections_present=true
2026-06-16T01:49:59Z	Story 14.1	smoke_complete	method=cli result=pass iterations=1 defects_caught=0 evidence=smoke-14-1.mjs(17-assertions,offline-builtmodule,removed-after) model=claude-opus-4-8
2026-06-16T01:50:26Z	Story 14.1	committed	sha=213756b submodules=
2026-06-16T01:53:31Z	Story 14.2	story_created	path=_bmad-output/implementation-artifacts/14-2-server-parameter-across-all-tools.md model=claude-opus-4-8
2026-06-16T02:08:38Z	Story 14.2	dev_complete	spawn_at=2026-06-16T01:53:31Z model=claude-opus-4-8 files=2 source_modules=server-base.ts,profiles.ts tests_added=14 shared_tests=276 full_suite=1243 clarifications=0 nfr_tripwires=0 adr_violations_surfaced=0 cycle_iteration=1 closing_sections_present=true
2026-06-16T02:08:38Z	Story 14.2	adr_verifications_complete	tool=none acs=none result=none_required evidence= model=claude-opus-4-8
2026-06-16T02:15:28Z	Story 14.2	qa_complete	spawn_at=2026-06-16T02:08:39Z model=claude-opus-4-8 tests_added=15 shared_tests=291 first_run_failures=0 clarifications=0 closing_sections_present=true
2026-06-16T02:32:20Z	Story 14.2	smoke_complete	method=cli result=pass iterations=2 defects_caught=0 evidence=smoke-14-2(11-assertions,D2-injection+selection+2-live-IRIS-auth-calls,removed) note=nonzero-exit-is-windows-libuv-teardown-artifact model=claude-opus-4-8
2026-06-16T02:32:44Z	Story 14.2	committed	sha=3ea9d09 submodules=
2026-06-16T02:36:05Z	Story 14.3	story_created	path=_bmad-output/implementation-artifacts/14-3-governance-policy-model-and-cascade.md model=claude-opus-4-8
2026-06-16T02:50:35Z	Story 14.3	dev_complete	spawn_at=2026-06-16T02:36:05Z model=claude-opus-4-8 files=7 new_modules=governance.ts,governance-baseline.ts(generated),gen-governance-baseline.mjs tests_added=41 shared_tests=334 baseline_keys=141 baseline_hash=1e62c5ad5bf7 clarifications=0 nfr_tripwires=0 adr_violations_surfaced=0 cycle_iteration=1 closing_sections_present=true
2026-06-16T02:50:36Z	Story 14.3	adr_verifications_complete	tool=none acs=none result=none_required evidence= model=claude-opus-4-8
2026-06-16T02:57:00Z	Story 14.3	qa_complete	spawn_at=2026-06-16T02:50:36Z model=claude-opus-4-8 tests_added=45 shared_tests=379 first_run_failures=0 clarifications=0 closing_sections_present=true
2026-06-16T03:11:29Z	Story 14.3	smoke_complete	method=cli result=pass iterations=1 defects_caught=0 evidence=generator-deterministic(byte-identical-regen)+engine-smoke-13-assertions(AC14.3.7-proof-141-keys,cascade,proto-safety,parse,getEffectivePolicy-invariant) model=claude-opus-4-8
2026-06-16T03:11:51Z	Story 14.3	committed	sha=4b506ff submodules=
2026-06-16T03:14:24Z	Story 14.4	story_created	path=_bmad-output/implementation-artifacts/14-4-call-time-governance-enforcement.md model=claude-opus-4-8
2026-06-16T03:26:42Z	Story 14.4	dev_complete	spawn_at=2026-06-16T03:14:24Z model=claude-opus-4-8 files=1 source=server-base.ts(gate+startup-wiring,+152-additive) tests_added=14 shared_tests=411 full_suite=1378 clarifications=0 nfr_tripwires=0 adr_violations_surfaced=0 cycle_iteration=1 closing_sections_present=true
2026-06-16T03:26:42Z	Story 14.4	adr_verifications_complete	tool=none acs=none result=none_required evidence= model=claude-opus-4-8
2026-06-16T03:33:03Z	Story 14.4	qa_complete	spawn_at=2026-06-16T03:26:42Z model=claude-opus-4-8 tests_added=14 shared_tests=425 first_run_failures=0 clarifications=0 closing_sections_present=true
2026-06-16T03:46:37Z	Story 14.4	smoke_complete	method=cli result=pass iterations=2 defects_caught=0 evidence=real-McpServerBase-gate-vs-live-IRIS-6-assertions(cascade-enable/disable,denial-envelope-code+action+server,handler-not-called,seed-passthrough) note=nonzero-exit-is-windows-libuv-teardown model=claude-opus-4-8
2026-06-16T03:47:00Z	Story 14.4	committed	sha=71049a7 submodules=
2026-06-16T03:49:09Z	Story 14.5	story_created	path=_bmad-output/implementation-artifacts/14-5-governance-resource-and-capability.md model=claude-opus-4-8
2026-06-16T04:06:12Z	Story 14.5	dev_complete	spawn_at=2026-06-16T03:49:09Z model=claude-opus-4-8 files=1 source=server-base.ts(resources-capability+governance-resource) tests_added=13 shared_tests=438 capstone=governance-cross-server.test.ts(AC14.5.6-in-default-suite) clarifications=0 nfr_tripwires=0 adr_violations_surfaced=0 cycle_iteration=1 closing_sections_present=true
2026-06-16T04:06:12Z	Story 14.5	adr_verifications_complete	tool=none acs=none result=none_required evidence= model=claude-opus-4-8
2026-06-16T04:12:39Z	Story 14.5	qa_complete	spawn_at=2026-06-16T04:06:12Z model=claude-opus-4-8 tests_added=12 shared_tests=450 first_run_failures=0 clarifications=0 closing_sections_present=true
2026-06-16T04:26:32Z	Story 14.5	smoke_complete	method=cli result=pass iterations=1 defects_caught=0 evidence=real-MCP-SDK-resource-handlers-vs-live-IRIS-7-assertions(capability,list,templates,per-profile-read-cascade-143-keys,unknown-profile-McpError) note=nonzero-exit-is-windows-libuv-teardown model=claude-opus-4-8
2026-06-16T04:26:56Z	Story 14.5	committed	sha=0ed5264 submodules=
2026-06-16T04:28:51Z	Story 14.6	story_created	path=_bmad-output/implementation-artifacts/14-6-documentation-rollup.md model=claude-opus-4-8
2026-06-16T04:42:36Z	Story 14.6	dev_complete	spawn_at=2026-06-16T04:28:51Z model=claude-opus-4-8 files=13 docs_only=true tests_added=0 ops_count=17 suite_total=89 clarifications=0 nfr_tripwires=0 adr_violations_surfaced=0 cycle_iteration=1 closing_sections_present=true
2026-06-16T04:42:36Z	Story 14.6	adr_verifications_complete	tool=none acs=none result=none_required evidence= model=claude-opus-4-8
2026-06-16T04:45:55Z	Story 14.6	qa_complete	spawn_at=2026-06-16T04:42:36Z model=claude-opus-4-8 tests_added=0 docs_validation=7/7-pass first_run_failures=0 clarifications=0 closing_sections_present=true
2026-06-16T04:58:16Z	Story 14.6	smoke_complete	method=cli result=pass iterations=1 defects_caught=0 evidence=docs-as-user-16-assertions(3-client-configs-JSON-in-env-double-parse-copy-paste-safe,ops=17,suite=89-columns-sum) model=claude-opus-4-8
2026-06-16T04:58:39Z	Story 14.6	committed	sha=f201a88 submodules=
2026-06-16T05:00:18Z	Epic 14	epic_summary	stories=7 pipeline_stories=6 shared_tests=205->450 total_high_unresolved=0 total_med_unresolved=0 smoke_defects=0 rework_events=0 bootstrap_bump=none additive=byte-for-byte-back-compat opus_stage_count=all model=claude-opus-4-8
