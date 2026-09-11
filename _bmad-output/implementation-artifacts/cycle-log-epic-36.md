# Cycle Log — Epic 36

Append-only. TAB-separated, exactly four fields:
`<UTC-timestamp>` TAB `<Story <id> | Epic 36>` TAB `<stage>` TAB `<metadata>`

Epic 36 is the first beta-feedback epic: `iris_execute_tests` long-run fidelity
(`docs/bugs-2026-09-10.md`, `sprint-change-proposal-2026-09-10-execute-tests-long-run.md`).
Branch `epic36` off `feature/feature-wave-5-beta-feedback` (cut off `main` at
`9cfa7af`, Project Lead decision L-1) per `_bmad/custom/branch-naming.yaml`
(`feature_pattern: feature/feature-{Description}`, `epic_pattern: epic{N}`,
`ticket_required: false`).

Epic-start notes for this run:
- Resume mode FRESH in the single repo (no `.gitmodules`; no prior epic-36 cycle
  log; `epic36` and the wave-5 feature branch absent locally and on remote).
- SC-1 feature-branch creation AUTHORIZED by the Project Lead in the same session
  (correct-course approval, decision L-1: "Cut feature/feature-wave-5-beta-feedback
  off main; epic36 off it"). Description `wave-5-beta-feedback` validated against
  `description_format`; ticketless per config.
- Clean-tree precondition — documented deviation: the tree carried (a) the
  just-approved correct-course output from this same session (planning artifacts +
  Story 36.1 file), which SC-6 forbids committing on `main`, and (b) the Project
  Lead's own unrelated IDE theme edit in `iris-execute-mcp-v2.code-workspace`.
  Both branch operations started from `HEAD == origin/main` (0 ahead / 0 behind),
  so no working-tree rewrite could occur — the hazard the precondition guards
  against was structurally absent. (a) landed as the first `epic36` commit
  (`69526ed`); (b) is left untouched and must NEVER be staged by any story commit.
- IDE file-sync toggle SKIPPED as inapplicable: `.vscode/settings.json` has
  `objectscript.conn.active: false` at HEAD and in the working tree — the repo's
  committed intentional state (commit 47f3161 "Disabled to prevent double
  loading"), not an orphaned crash toggle. No Window A / Window B.
- AC 36.0.2 precondition VERIFIED: `git merge-base --is-ancestor 60be515 epic36`
  exits 0 (Epic 35's SC-4 merge is reachable).
- No ADR registry (`docs/adr/` absent); architecture decisions live in
  `architecture.md` (H1–L1). No skill `model:` pins — Model Strategy map applies
  (dev/QA → sonnet, code review → opus). Spawned-stage rows record `spawn_tier=`
  per the Epic 35 §3.4 convention (the tier→model mapping is not observable from
  the lead; story files keep the agent self-report).

---

2026-09-10T23:12:34Z	Epic 36	feature_branch_created	repos=. ticket= description=wave-5-beta-feedback root=origin/main from=9cfa7af branch=feature/feature-wave-5-beta-feedback authorized_by=project_lead_decision_L-1_2026-09-10 pushed=true
2026-09-10T23:12:34Z	Epic 36	epic_branch_created	repos=. from=9cfa7af base=feature/feature-wave-5-beta-feedback pattern=epic36 config=_bmad/custom/branch-naming.yaml ide_sync_toggle=skipped_inapplicable_committed_false pushed=true
2026-09-10T23:12:34Z	Epic 36	epic_branch_checked_out	repos=. head=9cfa7af submodules=none clean_tree=false_documented_deviation_see_header ac_36.0.2=SATISFIED_60be515_ancestor
2026-09-10T23:12:34Z	Epic 36	course_correction_absorbed	sha=69526ed source=beta_feedback_docs/bugs-2026-09-10.md proposal=sprint-change-proposal-2026-09-10-execute-tests-long-run.md epic36_keys=3_stories+retro story_36.1=ready-for-dev_created_by_correct_course decisions=L-1_wave5+L-2_developer_only_unpaired+L-3_dev_minor_shared_patch unstaged_user_file=iris-execute-mcp-v2.code-workspace_never_stage model=claude-opus-5
2026-09-10T23:13:41Z	Epic 36	sprint_planning_complete	model=claude-opus-5 mode=reconcile_existing_rows scope=epic-36_only keys_created=0 keys_renamed=0 keys_matched_by_story_number=3_plus_epic_plus_retro status_changes=0 yaml_valid=js-yaml_3.14.2_safeLoad illegal_statuses=0 totals=36_epics_189_stories_186_done sync_check=OK_0_drift_0_orphans_0_dup epic-36=backlog_until_first_create-story
2026-09-10T23:52:20Z	Epic 36	retro_review_complete	source_retro=_bmad-output/implementation-artifacts/epic-35-retro-2026-08-19.md rows=140 included=48 deferred=80 dropped=12 ledger_open=121_reconciled_exactly_0H_26M_95L ledger_distinct=201_corrected_from_202 rule37_trigger=FIRED count2_items=48_5M_43L routing=3_to_36.1_AC_36.1.12+45_to_new_36.3 lead_decisions=36.3_runs_LAST+mandatory_45_only count_basis=strict_per_35-0-CR-C epic37_forward_obligation=36_items_to_count2 audit=lead_commissioned_subagent_opus_mechanical_parse model=claude-opus-5
2026-09-10T23:52:20Z	Epic 36	planning_amended_at_gate	files=epics.md+sprint-status.yaml+36-1-story added=Story_36.3_key_36-3-rule-37-ledger-burn-down+AC_36.1.12+AC_36.1.1_sanctioned_edit+preamble_gate_note amended_in_place=AC_36.0.3_wrong_batch_and_omitted_48 sync_check=OK_0_drift_0_orphans yaml=valid_262_keys commit=rides_story_36.0 model=claude-opus-5
2026-09-10T23:52:20Z	Story 36.0	story_created	path=_bmad-output/implementation-artifacts/36-0-epic-35-deferred-cleanup.md key_adopted=36-0-epic-35-deferred-cleanup keys_created=0 integration_ac=not_applicable_gate_triage_story ac_36.0.2=SATISFIED_60be515_ancestor+wave4_ancestor_of_main triage_arithmetic=lead_rederived_73open_21M_52L_defer+45_36.3+3_36.1 retro_row_equality=s4_6eq6+s7_5eq5 checklist=self_review_no_must_fix epic-36=backlog_to_in-progress model=claude-opus-5
2026-09-11T00:18:21Z	Story 36.0	dev_complete	spawn_at=2026-09-11T00:00:00Z spawn_tier=sonnet files=3 ledger_append=single_EOF_hunk tests_added=0_no_executable_surface tasks=6of6 reconciliation=two_orthogonal_scripted_methods_match_0H_26M_95L_121 distinct_slip=independently_rediscovered_L2712 retro_row_equality=s4_6+s6_8+s7_5+s5_2 baselines=shared_data_interop_all_match+admin_486_vs_retro_480_transcription_slip+dev_712_after_fixture_load+OS_3_failures_env_attributed ob_state_change=ExecuteMCPv2.Tests_hand_loaded_into_HSCUSTOM clarifications=0 closing_sections_present=true
2026-09-11T00:18:54Z	Story 36.0	adr_verifications_complete	result=none_required reason=no_adr_registry_in_project acs=none lead_gate_findings_for_qa=3_dev_findings_recorded_as_prose_only_no_ledger_ids+OS_failure_plausibly_fixture_induced_Ens_Config.Item model=claude-opus-5
2026-09-11T00:33:37Z	Story 36.0	qa_complete	spawn_tier=sonnet tests_added=0_no_executable_surface defects_found=2 defect1=dev_task1_debuglog_awk_nonreproducing_off_by_one_35-0-CR-D_class_documented_not_fixed defect2=3_prose_only_findings_normalized_to_ledger_rows_36-0-QA-1..3_M_L_M ledger_after=124_open_204_distinct_80_terminal finding_b=dev_root_cause_disproved_live_test_passes_now_flaky reconciliation=independent_scripts_match_121_0H_26M_95L+distinct_201+defer_73_21M_52L+include_3_45 append_only=single_EOF_hunk clarifications=0 closing_sections_present=true
2026-09-11T01:17:13Z	Story 36.0	cr_complete	spawn_tier=opus cycle_iteration=1 close_kind=DEGRADED review_degraded=true failed_layers=edge_case_hunter_22.2min_vs_20min_bound_late_payload_merged layers_in_time=acceptance_14.9min+blind_16.6min raw=74 deduped=22 resolved=17 deferred=0 dismissed=5 high=0 med=8 low=9 status=in-progress_by_degraded_gate_only notable=retro_s6_8_rows_untriaged_fixed+lead_amendments_36.1.1_36.1.6_36.1.12_patched+task1_task3_transcripts_replaced ledger=0H_28M_96L_124open_204distinct_80terminal clarifications=0 closing_sections_present=true
2026-09-11T01:17:47Z	Story 36.0	lead_decision	event=rework_iteration_1_after_DEGRADED_close decision=review_only_rerun_no_dev_respawn rationale=0_unchecked_review_items+all_22_findings_resolved+in-progress_set_solely_by_step-04_degraded_gate path=step-04_s7_rerun_code_review adaptation=sequential_synchronous_layers_each_own_armed_20min_timer_per_Epic35_35.6-35.9 cycle_iteration=2 model=claude-opus-5
2026-09-11T02:07:38Z	Story 36.0	cr_complete	spawn_tier=opus cycle_iteration=2 close_kind=CLEAN review_degraded=false failed_layers=none layers_mode=sequential_sync layers=blind_661s_13+edge_511s_9+auditor_426s_8_all_within_own_20min_bound raw=30 deduped=16 resolved=14 deferred=0 dismissed=2 high=0 med=2 low=12 med_fixes=36-0-CR-R_AC36.1.1_poll_loop_clause_regression_from_iter1+36-0-CR-S_36.1_context_wording status=done ledger=0H_28M_96L_124open_204distinct_80terminal transcripts=reproduce_verbatim clarifications=0 closing_sections_present=true
2026-09-11T02:09:13Z	Story 36.0	smoke_complete	method=other_documentary_mechanical result=pass iterations=2 defects_caught=1 defect=ledger_row_35-6-CR-1_first_cell_bare_ID_no_terminal_token_reopened_terminal_item_to_last-row_parser_raw_128_vs_127 fix=terminal_token_added_in_that_one_cell_by_lead checks=8 evidence=status_done+sync_OK+yaml_valid+one_EOF_hunk_0_deletions_utf8+raw_parser_127_0H_29M_98L_minus_3_prose_terminal_eq_124_0H_28M_96L+newly_open_vs_HEAD_exactly_36-0-QA-1..3+no_snapshot_leftovers model=claude-opus-5
