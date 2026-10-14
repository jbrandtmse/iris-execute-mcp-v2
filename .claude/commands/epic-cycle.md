---
description: Run the BMAD Method epic development cycle for one or more epics
---

You are executing the BMAD Method development implementation cycle for one or more epics. Stories run sequentially by default; independent stories within the same epic may be processed as a parallel batch — see "Smart Parallelism" below.

**Epic range:** $ARGUMENTS (e.g., `1-3` for Epics 1 through 3, `2` for a single epic). If empty, prompt the user for the range.

## Pre-flight Runtime Check

Uses the standard `Agent` tool to spawn pipeline-stage subagents and the `Skill` tool for lead-side skill invocations. No experimental flag required.

**Lead model gate (first action, before any other gate):** this command's `model: opus` frontmatter pin is officially documented but currently IGNORED at runtime (anthropics/claude-code #45191) — never assume it applied. Read your own model declaration from your system prompt ("You are powered by the model named …"). If the lead is an Opus-tier-or-higher model (Opus, or an above-Opus tier such as Fable/Mythos): proceed and log `lead_model_gate model=<detected> action=proceed`. Otherwise STOP and ask the user: switch the session (`/model opus`, or restart with `claude --model opus`) and re-invoke, or explicitly accept a lower-tier lead for this run — acceptance is logged `lead_model_gate model=<detected> action=user_accepted` so any later quality dip is attributable. Rationale: the lead's judgment artifacts (story specs, merge-conflict resolutions, AD verdicts, DAG analysis) are the pipeline's least-reviewed outputs; the stage→model map assumes they come from the highest tier in the run. Stage subagents are unaffected either way — they receive explicit `model` parameters on their Agent calls, which DO work. Above-Opus note: the gate accepts Fable/Mythos-tier leads, but Opus is the intended price/performance point for the lead (~2x the cost for marginal lead-side gain) — treat an above-Opus lead as a deliberate exception for an exceptionally hard epic, never a standing default.

If `Agent` is a deferred tool, load its schema via `ToolSearch` with `"select:Agent"` before first use. If `Agent` is unavailable, halt and surface to the user.

**BMAD + runtime gate (second action):** read `installation.version` from `_bmad/_config/manifest.yaml` and require ≥ 6.11.0 — this command drives `bmad-build-auto`, which does not exist earlier (6.10 projects: use the pre-6.11 kit). **BMAD v7 gate**, checked before the version comparison (a v7 project may have no manifest, or a stale 6.12 one under v7 skills): `.claude/skills/bmad-build-auto/customize.toml` (or its plugin-namespaced equivalent) must declare `[[workflow.review_layers]]`, and no `bmod-method/bmod.toml` may exist under `.claude/skills/` or `~/.claude/skills/`. Otherwise HALT with: "This kit supports BMAD Method 6.11–6.12.x. This project runs BMAD v7 (<the marker found>), which replaces the review layers, sprint planning and story files the kit drives — its overrides would stop v7's renderer. To keep using these kits, keep the project on 6.12.x (`npx bmad-method@6.12 install --action update --modules bmm --tools claude-code --yes` in the project directory); try the v7 preview in a separate clone." Run `uv --version`; HALT with the install pointer (https://docs.astral.sh/uv/) if it fails — `bmad-build-auto` renders itself through `uv run _bmad/scripts/render_skill.py` and halts on activation without it. Then run `uv run --no-cache _bmad/scripts/resolve_config.py --project-root <abs-root> --key core.project_name`: exit 0 proves uv can run BMAD's scripts (Python ≥ 3.11 available or provisioned); exit 3 means no Python 3.11+ — HALT. Verify these exist: `.claude/skills/bmad-build-auto/SKILL.md`, `.claude/skills/bmad-code-review/SKILL.md`, `.claude/skills/bmad-qa-generate-e2e-tests/SKILL.md`, `.claude/skills/bmad-sprint-planning/scripts/sprint_plan.py` (on a plugin-namespaced install, the equivalent paths). Verify the durable state is tracked: `git check-ignore -q _bmad-output/implementation-artifacts` must FAIL (exit 1) — if the directory is gitignored, HALT: cycle logs, `sprint-status.yaml`, specs and the ledger must live on the epic branch (resume, bookkeeping commits, and the parallel merge queue depend on it); the user removes `_bmad-output/` from `.gitignore` (keeping `_bmad/render/`, `*.user.toml`, `.worktrees/` ignored). Then determine how CI can be read (see "CI Is a Gate"): `ci=gh` when `.github/workflows/*.yml` exist, `gh auth status` succeeds, and `git remote get-url origin` is a GitHub URL; `ci=none` when the repo has no workflows; `ci=unavailable` otherwise — surface `unavailable` once ("CI results cannot be read from this session; the merge gate will ask you to confirm CI by hand") rather than proceeding as if the suite's local result were the shipped one. Log `runtime_gate bmad=<version> uv=<version> ci=<gh|none|unavailable>`. Resolve `<project_name>`, `<impl>` and `<planning>` with BMAD's config resolver (the shorthand paragraph below). Read the launch environment ("Permission Mode": `printenv CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH CLAUDE_CODE_RETRY_WATCHDOG BASH_MAX_TIMEOUT_MS`) and log `launch_env`; an explicit depth below what the run needs (2 sequential, 3 parallel) → HALT and say which setting to raise.

**Telemetry gate (third action):** scan every existing `cycle-log-epic-*.md` for `model_tier_checkpoint` entries whose `result` is `recommend_escalate` or `offer_mixed` with `applied=false`. If any exist, surface them once before starting ("Epic N's checkpoint recommended escalating `implement` to Opus (evidence …); no policy file exists / the user declined — apply now, or continue as is?") and log `telemetry_gate pending=<N>`. Accumulated telemetry that nobody acts on is the failure mode this gate exists for.

**`SPRINT_PLAN` shorthand.** Throughout this command, `SPRINT_PLAN` means `uv run --no-cache <path-to>/bmad-sprint-planning/scripts/sprint_plan.py`, where `<path-to>` is `.claude/skills` (or the plugin-namespaced skills directory). Three more placeholders recur below: `<impl>` and `<planning>` (also written `<implementation_artifacts>` / `<planning_artifacts>`) and `<project_name>`. Resolve all three once, at pre-flight, through BMAD's own resolver — `uv run --no-cache _bmad/scripts/resolve_config.py --project-root <abs-root> --key core.project_name --key modules.bmm.implementation_artifacts --key modules.bmm.planning_artifacts` (JSON out) — and substitute `{project-root}`; by default they are `_bmad-output/implementation-artifacts` and `_bmad-output/planning-artifacts`. Never read them from `_bmad/config.toml` alone: since BMAD 6.12.1 every skill merges the project's config layers (`_bmad/config.toml`, `_bmad/custom/config.toml`, and the user files), so a path read from one file can disagree with the path the skills write to. It is BMAD's deterministic tracker script (JSON in, JSON out; `uv run` may print an `Installed N package(s)` line to stderr — ignore it). Its three subcommands replace the retired `/bmad-sprint-status mode=data|validate`:

- `SPRINT_PLAN status --status-file <impl>/sprint-status.yaml` → per-status counts, `open_action_items`, `recommendation.story_key`, `all_done`.
- `SPRINT_PLAN validate --status-file <impl>/sprint-status.yaml` → `valid`, `problems`.

**`LEDGER` shorthand.** `LEDGER` means `bash _bmad/scripts/ledger.sh <impl>/deferred-work.md` (installed by this kit). `LEDGER load` → counts + `owner:<key>=<n>` lines; `LEDGER slice <owner>|all` → `DW-n TAB status TAB owner TAB summary` for non-terminal entries; `LEDGER show DW-n` → one entry; `LEDGER new "<summary>" "<source>" <severity> <fix-risk> <footprint> "<evidence>" <status> <owner> <by> "<note>"` → creates an entry, prints its id; `LEDGER append DW-n "status=… owner=… by=… note=…"` → one trailer line. Nobody in the pipeline reads or edits `deferred-work.md` any other way.
- `SPRINT_PLAN generate --epic-file <planning>/epics.md --status-file <impl>/sprint-status.yaml --stories-dir <impl> --project <project_name> --date "<MM-DD-YYYY HH:MM>" --set <key>=<status> [--set …]` → the lead's ONLY sanctioned status writer. The merge itself never downgrades, but **`--set` is the script's repair path and is applied unconditionally — it WILL downgrade.** Before every `--set`, read the key's current value (`SPRINT_PLAN status` or the file) and refuse to write a lower rank (`backlog < ready-for-dev < in-progress < review < done`). `--set` on a key that is not in the generated plan fails (`ok: false`, "not in the generated plan") and writes nothing — a story must exist in the epic file first. Preserves comments; reports `explicit_set`. Use `--dry-run` when unsure. (`<epic-file>` may repeat for multi-file epics; `<project_name>`, `<impl>` and `<planning>` are the resolver's values from the shorthand paragraph above.)

## Task Sequence

**Per Epic (setup, executed once per epic before any stories):**

1. **Lead** verifies a clean working tree across the parent repo and every submodule listed in `.gitmodules`; halts on dirty state.
2. **Lead** determines per-repo resume mode (see "Resume Semantics").
3. For repos in FRESH mode: **Lead** verifies (or creates with user authorization) the feature branch per Rule SC-1, then verifies (or creates) the epic branch `{TICKET}-epic{N}` per Rule SC-2.
4. **Lead** checks every affected repo out to `{TICKET}-epic{N}` and logs `epic_branch_checked_out`; then resolves the **architecture spine** (Rule 6: newest `ARCHITECTURE-SPINE.md` with `status: final` under `<planning>/architecture/*/`, else the newest spine, else any `*architecture*.md` under `<planning>`, else none), counts its `### AD-` blocks, and logs `spine_resolved path=<path|none> ads=<N> status=<final|draft|none>`. The path goes into every spawn prompt; Rule 20 writes go to this file.
5. **Lead** measures the ledger (`LEDGER load`; re-owns any `owner=none` entry) and logs `ledger_load`, then executes `/bmad-sprint-planning` directly, **headless**, with the load in its argument, and branches on its readiness `gate` (see "Sprint Planning Per Epic" and "Ledger Drain").
6. If a previous epic's retrospective, the ledger (`LEDGER slice all`), or open `action_items` in `sprint-status.yaml` have unresolved items, **Lead** reviews them, **closes** each (resolve / own / terminal — Rule 17), and creates Story X.0 via a `bmad-build-auto` plan spawn (see "Retrospective Review & Story X.0 Creation").

**Per Story (executed once per story in the epic):**

1. **Lead** asserts the branch, writes the `stage_spawned stage=plan …` write-ahead entry to the cycle log, and makes the bookkeeping commit (Rule 16 — the tree MUST be clean before every `bmad-build-auto` dispatch). Every later stage spawn (implement, qa, code-review) is preceded by its own `stage_spawned` entry the same way.
2. Agent — **PLAN**: `/bmad-build-auto` on the Opus tier, prompt = the explicit sprint-status story key plus `Halt after planning.`, plus the story's **ledger inbox** (`LEDGER slice <key>` pasted in — every entry addressed in Tasks & Acceptance or declined under Design Notes with a reason; Rule 17 (1b)). It writes `spec-{key}.md` and halts with status `ready-for-dev`. **Lead captures the spec path** and logs `story_created`. The plan does not wait on the previous story's CI run — a plan writes a spec, not code, so it cannot build on a red (see step 4).
3. **Lead** gates the spec: Integration-AC validation (Rules 1/2), AD mapping against the spine (Rule 6), sections the template may have deleted, decision dependency (a spec that builds on a `decision-pending` ledger entry is an intent gap for the user NOW, not at the merge gate); logs `spec_validated`; sets the story `ready-for-dev` via `SPRINT_PLAN generate --set`; bookkeeping commit (everything under `implementation-artifacts`: spec, log, tracker).
4. **Lead** resolves the previous story's `ci=pending` (see "CI Is a Gate", resolution point 1) — a red reworks that story first while this story's spec waits at `ready-for-dev`. Then the lead sets the story `in-progress` (+ `epic-{N}` lift) via `SPRINT_PLAN`, bookkeeping commit; then Agent — **IMPLEMENT**: `/bmad-build-auto` on the Sonnet tier, prompt = the spec path. It implements (via its handoff subagent), self-reviews with its review layers, finalizes the spec `status: done`, and makes a local commit. **Lead** reads the spec frontmatter (`baseline_revision`; accept `baseline_commit` if a newer build-auto writes that key instead — the retrospective skill already calls `baseline_revision` deprecated), harvests `deferred:` into the ledger — each item born with an owner via `LEDGER new` (Rule 15) — sets the story `review` via `SPRINT_PLAN`, and logs `dev_complete` with `build_sha=`.
5. **Lead** executes any AD-tooled AC verifications, each with a named, applied, and reverted mutation (Rule 19 — a pass without one is `unverified`; see "AD-Aware Execution").
6. Agent: `/bmad-qa-generate-e2e-tests` (scope pre-answered to this story's deliverable = `git diff --name-only <baseline_revision>..HEAD`; one demonstrated mutation per AC, Rule 19).
7. Agent: `/bmad-code-review` on the Opus tier, with the spec path as the explicit argument (`review_mode = full`). After it returns: `SPRINT_PLAN validate` (the skill's own sprint-status sync is pre-answered to the script, but verify) and `grep -c "^## Deferred from:" <impl>/deferred-work.md` — if that count grew, the reviewer ignored the ledger pre-answer: harvest each stray bullet with `LEDGER new … cr`, strip the stray block (the one sanctioned edit — those bullets are not DW entries), and log `ledger_stray_bullets harvested=N`. Copy the reviewer's `entries:` line into `cr_complete` (root-cause counts, `rows=`, `unresolved_high_med=`). If the review leaves the story `in-progress` (a HIGH, or — first review only — an unpatched in-story MED), run the Rework Loop (max 3 iterations; each re-review scoped to the rework; a re-review with no HIGH closes the story) before proceeding.
   - Project Rule #57: if the reviewer's `## Decisions` report `review_outcome=DEGRADED`, follow "Degraded review" under Rework Loop — a review-only re-run, never a rework by itself.
8. **Lead** adjudicates the ledger slice this story owns (Rule 17): every entry with effective `owner=<this story key>` is closed against DELIVERED scope — `resolved-by` with evidence, re-owned with the residual restated, or terminal — until `LEDGER slice <key>` reads empty. Logs `ledger_adjudicated`.
9. **Lead** performs per-story smoke and then the fresh-environment check — the story's added and changed tests on a fresh environment, forward and reversed (Rule 19; see "Per-Story Smoke"); logs `smoke_complete` and `fresh_check`.
10. **Lead** commits (QA tests, review patches, ledger, bookkeeping) and pushes — **only to the epic branch** in every affected repo, never to main/master/develop (Rule SC-3 + SC-6) — then records the CI run the push started on the `committed` entry (`ci=pending run=<id>`, or `ci=none` / `ci=unavailable` per the pre-flight; see "CI Is a Gate"), and logs `story_cycle` (see "Cycle Log Format"). The result is resolved before the next story's implement spawn, never assumed.

A story therefore produces several commits on the epic branch: bookkeeping commits, the plan commit (spec), `bmad-build-auto`'s finalize commit (`build_sha`), and the lead's post-smoke commit (`committed sha`). That is by design; the epic's `--no-ff` merge preserves the graph.

**End of Epic (executed once per epic after all stories):**

1. **Lead** runs the **burn-down gate** (Rule 17, see "Ledger Drain"): every story-closable (`routed`/`open`) ledger entry owned by `burndown` or by one of this epic's story keys is resolved / made terminal now, chartered into ONE burn-down story `N.<M+1>` (M = the highest existing story number under Epic N in `epics.md` or `sprint-status.yaml`; at most `burndown_story_max` entries, by priority) that runs the full per-story pipeline before the epic closes, or — the explicit overflow — re-owned to a specific next-epic story key. `escalated` / `decision-pending` entries are not work: they are counted and handed to the decision sheet (step 5). Logs `ledger_burndown_complete` (or `ledger_burndown_skipped reason=empty`).
2. **Lead** sets `epic-{N}: done` via `SPRINT_PLAN generate --set epic-{N}=done` — a transition no skill writes (see "Status Ownership") — and logs `epic_status_done`.
3. **Lead** runs the model-tier checkpoint on EVERY project (see "Model Strategy") and logs `model_tier_checkpoint` with its evaluation; a change to tiers is applied only when `_bmad/custom/model-overrides.yaml` exists and the user approves (then also `model_tier_changed`) — on a project without the policy file a met threshold is surfaced as a recommendation, never silently dropped.
4. **Lead** pauses: "Run a retrospective?" If yes, execute `/bmad-retrospective` fully interactive — the human-in-the-middle exception; see "Retrospective Per Epic".
5. **Lead** presents the **epic-close decision sheet** (Rule 17 (5): every `escalated` and `decision-pending` entry with a recommended disposition, decided in one sitting; human-owned items move to `action_items`), records the answers as `by=merge_gate` trailer lines, logs `decision_sheet_recorded`, and then pauses: "Merge `{TICKET}-epic{N}` into the feature branch and delete the epic branch (local + remote)?" — per Rule SC-4. If yes, execute the merge in each affected repo (submodules-first, parent last).

## Execution Guidelines

Each pipeline-stage task is delegated via the `Agent` tool. Lead-side skills (sprint planning, retrospective) are invoked directly via the `Skill` tool. Story planning is a **spawned** stage in v6.11 (`bmad-build-auto` never advances to another story, so the old race-ahead concern that kept story creation lead-side is gone) — what stays lead-side is the *validation* of the plan. For `bmad-build-auto` stages the completion contract is the spec file (frontmatter `status` + `## Auto Run Result`), not prose. For QA/CR stages, if a return is missing closing-summary sections, the lead extracts the file list from `git status --short` plus `git diff --name-only <baseline_revision>..HEAD` — this is normal extraction.

`/bmad-code-review` triages findings into **decision-needed / patch / defer / dismiss** buckets at **low / medium / high** severity. Under `/epic-cycle` the review agent applies every patch-bucket finding and resolves decision-needed items using best judgment plus the BMAD skill rules; only a genuine user-preference or spec-contradiction question comes back as `## Clarification Needed`. The BMAD skills must be invoked via `Skill`; don't skip steps. `/bmad-retrospective` is the one deliberate human-in-the-middle exception to the autonomous loop — it MUST run in interactive mode, and every one of its elicitation stops must reach the user.

## Permission Mode (Critical)

Subagents **inherit the lead session's permission mode** — on current Claude Code builds the `Agent` tool's `mode` parameter is accepted but ignored ("Deprecated; ignored. Subagents inherit the parent session's permission mode"). The effective control is therefore how the lead session was started: for an unattended run launch it with `claude --permission-mode bypassPermissions` (or `--dangerously-skip-permissions`), or `--permission-mode auto` where the harness offers it with a configured environment. Keep passing `mode: "bypassPermissions"` on every `Agent` call anyway — it is harmless on current builds and still honoured on older ones. Without an unattended permission mode the subagent prompts for every file edit and bash command and the pipeline stalls. No permission mode auto-answers `AskUserQuestion` — that tool always elicits the human. Therefore `/bmad-retrospective` is lead-only (spawned subagents cannot reliably surface their elicitation). Run unattended cycles only in a trusted/isolated environment.

Pipeline-stage subagents must be spawned **synchronously** — never backgrounded, and synchronous is a parameter, not an adjective: every `Agent` call passes `run_in_background: false` (Rule 18 (5)). On current Claude Code builds an `Agent` call that omits the flag runs in the background — it returns at once and its work continues unsupervised — so "spawn synchronously" in prose is not enough, at any depth. A backgrounded subagent never hands control back in an unattended run and the pipeline stalls (this is why `bmad-build-auto` mandates synchronous subagent calls). Parallel batches are still synchronous: N `Agent` calls in ONE message resolve together.

`bmad-build-auto` **requires** subagents of its own (it HALTs `blocked` / `no subagents` otherwise): the stage agent that runs it must be `subagent_type: "general-purpose"` (full tool set including `Agent`). Nested spawning to depth 3 (lead → build-auto stage agent → its handoff/review subagents) is verified on Claude Code (2026-08-26 spike).

**Launch environment (unattended runs).** Set these where the lead session is launched (the shell, or the user's `settings.json` `env` — a project's `.claude/settings.json` `env` applies only once the workspace is trusted). They are Claude Code settings as of 2.1.29x; check them against your version. The pre-flight reads them with `printenv` and logs `launch_env depth=<n|default> watchdog=<0|1> bash_max_ms=<n|default>`.

- `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` — nesting is limited to 3 layers below the main session by default. A sequential run needs 2 (stage → its handoff and review layers), a parallel run 3 (runner → stage → handoff and layers); `4` leaves headroom. At the limit an agent silently loses the `Agent` tool and does the work itself: `bmad-build-auto` then halts `no subagents`, and other skills run their review layers inline without saying so.
- `CLAUDE_CODE_RETRY_WATCHDOG=1` — retries rate-limit and overload errors (`429` / `529`) indefinitely with backoff instead of failing the stage. A `429` that reports a spend or usage limit still fails at once (see the API-error handling in "Agent Invocation Pattern").
- `BASH_MAX_TIMEOUT_MS` (with `BASH_DEFAULT_TIMEOUT_MS`) — raises the foreground cap of Rule 18 (5), default 10 minutes, for a project whose test batches need longer.
- `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` — 20 running subagents per session by default, nested ones included; over it an `Agent` call fails with `Concurrent subagent limit reached`. A parallel run's peak is about `max_parallel_epics` × (runner + stage + its review layers).
- Headless launches (`claude -p`) only: `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`, or the process stops waiting for background runners after 10 idle minutes.

**Supervised, not unattended.** "Unattended" describes the permission mode, not the loop. Measured on a greenfield epic (field report 2026-08-29: 8 stories, 9 clarifications, 7 user decisions, zero false halts) the pipeline needs roughly **one human round trip per story**, peaking where planning artifacts meet reality for the first time, plus one decision sheet at each epic's merge gate. Every one of those halts is load-bearing: a run launched by someone who expects to walk away will experience correct behaviour as a malfunction, and the tempting reactions — pre-authorizing everything, widening footprints blindly — are worse than the wait. The levers that reduce the rate without reducing the halts are Rule 5's apply-and-report tier (amendments that preserve intent are applied, then reviewed) and Rule 11's authority/concurrency split (parallel kit); the halts themselves are not tunable.

## Model Strategy (Critical for cost + quality)

The pipeline runs **efficient implementer + expensive reviewer**: a Sonnet-tier model writes code and tests; an Opus-tier model reviews them. This also satisfies BMAD's own guidance that code review should run in "fresh context, ideally different LLM" than the implementer.

Per-skill model pinning ("skill optimization" — writing `model:` into each SKILL.md's frontmatter) is an **optional, per-project** pass: upstream BMAD v6 ships no `model:` frontmatter, the field is not an officially documented SKILL.md field, and some projects deliberately skip the pass. `/epic-cycle` must behave identically either way, so the command carries the default stage→model map itself:

| Stage | Skill | Model | Why |
| --- | --- | --- | --- |
| Plan | `/bmad-build-auto` + `Halt after planning.` | `opus` | The story spec is the highest-leverage context-fusion step; its judgment lets everything downstream run cheaper. Its epic-context compile subagent inherits this tier. |
| Implement | `/bmad-build-auto` on the planned spec | `sonnet` | Near-Opus coding quality. Its implementation-handoff subagent and its self-review layers (`blind-hunter`, `edge-case-hunter`, `verification-gap`, `intent-alignment` by default) inherit this tier ("same model capability as the current session") — a cheap self-review, not the gate. A project may switch a self-review layer off with `instruction = ""` in its `bmad-build-auto` override (File 2's note: deleting the entry does nothing, and switching off `edge-case-hunter` drops the spec-claims check); the code-review stage is the one never to cut. |
| QA | `/bmad-qa-generate-e2e-tests` | `sonnet` | Bounded test implementation |
| Code review | `/bmad-code-review` | `opus` | The independent adversarial gate — BMAD's own template note: "Dev moves story to 'review', then runs code-review (fresh context, different LLM recommended)". Its review layers (`blind-hunter`, `edge-case-hunter`, `verification-gap`, `acceptance-auditor`) run at the model passed on this spawn because nested subagent spawns inherit the parent's model when no `model` parameter is given. Review MUST NOT run on a lighter model than the implementation. A project's `review_tier: mixed` (see the model-policy file below) re-tiers the three hunter layers only. |

On an **unpinned** project the map is the operative source. On a **pinned** project frontmatter resolves first and normally agrees with the map; if a pin disagrees, the pin wins — treat it as a deliberate project re-pin (never "correct" it), and the `model=` telemetry records what actually ran either way. The one skill that runs at two tiers is `bmad-build-auto`: a frontmatter pin on it documents the **plan** tier; the implement tier comes from the map or the policy file's `implement:` key, never from the frontmatter.

**Upstream levers (v6.11):** `bmad-build-auto`'s `implementation_handoff` and every skill's `review_layers[].instruction` are free-prose overrides in `_bmad/custom/<skill>.toml` — the sanctioned way to route one internal subagent to another model or an external tool. `/epic-cycle` does not need them (it passes `model` on the stage spawn), but a project that must run the implement stage inline (e.g. a runner without nested-spawn headroom) can put `model: sonnet` into the handoff prose there.

### Project model-policy file (`_bmad/custom/model-overrides.yaml`, optional — highest priority)

A project-local re-pin surface that survives BMAD upgrades (the installer never touches `_bmad/custom/`). When present, model resolution becomes: **overrides file → frontmatter → stage map → inherit**. Schema:

```yaml
# Project-local model policy. overrides win over SKILL.md frontmatter and the stage map.
stack_risk: uncommon            # uncommon | standard (default). uncommon arms the end-of-epic model-tier checkpoint.
review_tier: full-opus          # full-opus (default) | mixed — controls bmad-code-review's internal review layers
overrides:                      # optional: STAGE -> tier re-pins (plan | implement | qa | code-review)
  implement: opus               # bmad-build-auto implement stage (plan stays at its own key)
history:                        # append-only; every change records its evidence
  - date: 2026-07-19
    action: escalate-implement-to-opus
    evidence: "epic-2: high+med avg 2.5/story with implement=claude-sonnet-5; 2 rework loops (language semantics)"
    approved_by: user
```

Keys are **stages**, not skills, because `bmad-build-auto` serves two stages at two tiers. (Pre-6.11 policy files keyed `bmad-dev-story` / `bmad-quick-dev` / `bmad-qa-generate-e2e-tests`: read them as `implement` / `implement` / `qa` and offer to rewrite the file once.)

### Model-tier checkpoint (end of epic, lead-side)

**Evaluation is unconditional; application is gated.** The checkpoint evaluates on every project, immediately after `epic_status_done`, against this epic's cycle log, and always logs `model_tier_checkpoint` (a default project has no policy file, yet every `cr_complete` writes the telemetry the checkpoint reads — evaluating only on armed projects meant the numbers were written by everyone and read by no one; field report 2026-08-28: mean 4.75 high+med per story, 3 of 4 stories reworked, never evaluated). Applying a change requires `_bmad/custom/model-overrides.yaml` (create it on the user's approval if absent) plus the user's explicit approval; the mandatory mixed-tier rollback needs no approval but does need the file (it only exists if `mixed` was set). On a project without the file, a met threshold is surfaced with the evidence and the offer to create the file — `result=recommend_escalate armed=false`. (In Orchestrator Mode, the orchestrator runs it in the main checkout at the merge gate, after `epic_merged_to_feature`, against the epic's per-worktree cycle log.)

- **Escalation (uncommon stack):** if mean `cr_complete` **`unresolved_high_med`** ≥ 2 per story with the implement stage on a Sonnet-tier model — the high+med root-cause entries the reviewer could not resolve in its own pass, i.e. what escaped both the implementer and the reviewer's patches; NOT the gross `high+med` found, which a four-layer adversarial review scores at 7–10 on stories that need one pass (field report 2026-09-11: 8, 7 and 10 on three one-pass stories against a threshold of 2 — the metric did not discriminate) — OR ≥ 2 stories entered the rework loop for language-semantics defects, OR ≥ 2 stories' `dev_complete` show `review_loop_iteration ≥ 3` (build-auto's own bad-spec/patch loop thrashing) → recommend re-pinning `implement` / `qa` to `opus` for this project. Surface the evidence to the user; on approval, update `overrides:` + `history:`. Rationale: two rework iterations (extra Sonnet dev + extra Opus review) cost more than Opus-dev. Counts are root-cause entries after the reviewer's grouping (`rows=` is raw layer volume and never a threshold input); a `cr_complete` from before Kit-Version 2026-09-11.1 lacks `unresolved_high_med` — fall back to `high+med` for that story and log `metric=gross` on the checkpoint so the reading is known to be inflated.
- **De-escalation offer (review layers):** after ≥ 2 consecutive epics with zero high and ≤ 1 medium finding per epic from Opus-tier review, the lead MAY offer `review_tier: mixed` (`blind-hunter` / `edge-case-hunter` / `verification-gap` → sonnet; `acceptance-auditor` stays at the parent model; never below the implementation tier).
- **Rollback (mandatory, not user-gated):** if `review_tier: mixed` is active and any `smoke_complete` in this epic recorded `defects_caught>0`, revert to `full-opus` immediately and record it.

**Telemetry is mandatory:** every evaluation logs `model_tier_checkpoint`; every change to model-overrides.yaml logs `model_tier_changed` with `direction=`, `stages=`, `from=`, `to=`, `reason=`, and `evidence=` (see Workflow Telemetry). A tier change absent from the cycle log did not happen — never edit the policy file without the paired log entry and matching `history:` record.

Lead-run gate skills (sprint planning, retrospective) and lead-side gates (spec validation, AD verifications, smoke, merge-conflict decisions) execute inline on the lead's model — run the lead on an Opus-tier model so those judgment calls get maximum quality. Story planning is a spawned Opus stage, so it is tier-guaranteed independently of the lead.

## Skill Tool Invocation (Critical)

All BMAD skills must be invoked via the **`Skill` tool**, not interpreted inline. Agent spawn prompts must explicitly state: "use the `Skill` tool to invoke /bmad-build-auto" (or the relevant skill). Without this directive, agents may try to execute skill logic themselves. For `bmad-build-auto` this matters twice over: its SKILL.md is a bootstrap that runs `uv run render_skill.py` and then follows the rendered `workflow.md` — an agent that "reads the skill" instead of invoking it never renders and runs stale or unresolved workflow text.

## Agent Invocation Pattern (Required)

Each pipeline-stage subagent is a single `Agent` tool call. The `Agent` tool returns the agent's final assistant message as its result — that is the completion signal. No separate envelope, no team membership, no shutdown handshake.

For each pipeline stage, the lead:

1. **Resolves the stage's model.** Resolution order: (a) if `_bmad/custom/model-overrides.yaml` exists and its `overrides:` map names the **stage** (`plan` | `implement` | `qa` | `code-review`), that wins unconditionally (project model policy — see Model Strategy); (b) else if the stage skill's YAML frontmatter — `.claude/skills/<skill-name>/SKILL.md`, or the plugin-namespaced install path — declares a `model:` field (e.g. `opus` / `sonnet` / `haiku`), that wins for every stage except `implement` (a `bmad-build-auto` pin documents the plan tier only); (c) otherwise use the Model Strategy map above (plan → `opus`, implement → `sonnet`, qa → `sonnet`, code-review → `opus`); (d) for a stage not in the map, omit the parameter and let the sub-agent inherit the lead's model. Read the actual file and frontmatter — do not assume. On a vanilla BMAD install (c) is the operative source (upstream v6.11 still ships no `model:` frontmatter); projects that ran a model-pinning pass over their skills resolve via (b), and the pins normally agree with the map.
2. **Writes the `stage_spawned` entry** (`stage=<plan|implement|qa|code-review> spawn_at=<UTC> model=<resolved> agent_name=<name passed on the Agent call> cycle_iteration=N`) to the cycle log IMMEDIATELY before the call — never after. Then, if the stage is `bmad-build-auto`, **ensures the tree is clean** (Rule 16): every pending bookkeeping write including this entry is committed first; `git status --short` must be empty in the stage's working directory (and in every mounted submodule). An open `stage_spawned` (no closing success entry, no `<stage>_clarification_requested`) is the only durable evidence that a stage may be in flight — resume reads it before any re-dispatch.
3. **Spawns** the subagent via `Agent` with `name: "<story-key>-<stage>-<iteration>"` (the `agent_name` recorded above) and:
   - `subagent_type: "general-purpose"` (required for `bmad-build-auto` stages — they spawn their own subagents)
   - `model: <the model resolved in step 1>` — pass this so the stage runs on the model the pipeline intends, NOT the lead's inherited model. Omit the parameter only when step 1 resolved nothing (stage not in the map and no frontmatter declaration).
   - `mode: "bypassPermissions"`
   - `run_in_background: false` — always explicit, never omitted (Rule 18 (5)): the harness default may be background, and a backgrounded stage returns at once while its work runs on with no supervisor
   - `description: <3-5 word task description>`
   - `prompt: <full task — see Spawn Prompt Skeleton below>`
4. **Reads the result.** For `bmad-build-auto` stages: re-read the spec file from disk — frontmatter `status` (`ready-for-dev` after a plan spawn; `done` after an implement spawn; `blocked` otherwise) and the `## Auto Run Result` section (`Status:` / `Blocking condition:`); the agent's prose is advisory. For QA/CR stages: the returned message's closing-summary sections (`## Files Modified`, `## Tests Added`, `## Decisions`, `## Issues Encountered`).
   **A harness error is not a stage result.** If the `Agent` result is an error from the harness rather than the stage's report — `Agent terminated early due to an API error: …`, or a rate-limit, overload, or usage-limit message — the stage did not finish. Log `stage_api_error stage=<stage> error=<rate_limit|overload|usage_limit|other>`; wait (rate limit or overload: about 5, then 10, then 20 minutes; a spend or usage limit: STOP and surface it to the user — waiting will not clear it); then re-spawn the stage per the **Re-dispatch protocol** ("Clarification protocol"): its open `stage_spawned` entry stands, a `bmad-build-auto` stage resumes from the spec's `status`, and the tree is checked first — a stage cut off mid-edit can leave changes behind, which Rule 18 (4)'s quiescence samples and the Rule 16 clean-tree gate catch. It is never a failed story and never a rework iteration. (Field report 2026-10-10: at least seven runner kills from rate limits or quota in one month-long run.)
5. **Falls back** to `git diff --name-only <baseline_revision>..HEAD` + `git status --short` if closing sections are missing.
6. **Records** the stage in the cycle log, setting `model=<the model the sub-agent actually ran on>` (the resolved stage model, or the inherited lead model when none was declared) per the telemetry spec.
7. **Proceeds** to the next stage. No shutdown step.

**Lead-run gate skills run on the lead's model.** `/bmad-sprint-planning` and `/bmad-retrospective` are invoked by the lead directly via the `Skill` tool (not spawned as sub-agents), so they execute in the lead's context and their frontmatter `model:` is NOT applied — there is no per-skill model switch for inline lead execution. This is by design (these gates must stay lead-side; see "Sprint Planning Per Epic" and "Retrospective Per Epic"). Honoring `model:` therefore applies to the spawned pipeline stages (plan / implement / qa / code-review) only.

### Spawn Prompt Skeleton

Every Agent spawn prompt must include, in this order:

1. The literal marker `**Epic Cycle Stage: <plan|implement|qa|code-review> for Story <id>**`.
2. The dispatch anchor: for **plan**, the sprint-status story key (e.g. `3-2-digest-delivery`) — never a spec path, never a spec folder; for **implement / qa / code-review**, the spec file path captured at `story_created`.
3. The list of files modified by upstream stages (for QA: `git diff --name-only <baseline_revision>..HEAD`; for code review: that list plus QA's `## Tests Added`).
4. The architecture spine path from `spine_resolved` (`<planning>/architecture/<run-folder>/ARCHITECTURE-SPINE.md`, or "none") as factual context — its `AD-n` blocks are the project's architecture decisions (Rule 6).
5. The directive: `Use the Skill tool to invoke /<bmad-skill-name>.` For `bmad-build-auto` the skill's own argument is the dispatch anchor from item 2 — for the plan stage append the exact sentence `Halt after planning.` to the argument.
6. The stage-specific rule block (see below) — for QA/CR including its **pre-answered checkpoints**: every interactive menu/halt the skill will hit, with the chosen option, so the agent never waits on input that cannot arrive (Rule 9). `bmad-build-auto` has no checkpoints; its block carries rules only.
7. The completion-contract directive — for QA/CR quote the closing-summary section names inline; for `bmad-build-auto` state that the spec file's frontmatter `status` + `## Auto Run Result` is the contract and that the agent must not push.
8. Skill-specific context.

### Stage-specific rule blocks (copy into spawn prompts)

**Plan spawn (`bmad-build-auto`, Opus tier) — append:**

```text
Dispatch: invoke /bmad-build-auto via the Skill tool with the argument `<story-key> Halt after planning.` — the sprint-status story key (e.g. `3-2-digest-delivery`) followed by that exact sentence. This is the skill's epic-story path: it resolves the epic/story numbers from the key, reuses the committed `<impl>/epic-<N>-context.md` (or would compile it via its own subagent — the lead pre-warms it so that never happens), loads the previous `done` story of this epic for continuity, plans the spec, verifies it against its READY-FOR-DEVELOPMENT standard, sets frontmatter `status: ready-for-dev`, and HALTs. Plan ONLY this story. Do NOT supply a spec folder or stories.yaml (folder+id dispatch is for bmad-spec projects, not this pipeline). Do NOT implement anything.

Rules for this stage (from skill-rules.md):

- Rule 1/2 (Integration ACs, Consumed-by/Consumes): if this story introduces a service, module, or shared component, the spec MUST carry at least one Integration AC (an I/O & Edge-Case Matrix row or a Tasks & Acceptance item of the form "consumer X reads from this and produces observable effect Y") — or an explicit "No consumers in this story; the first consumer will be Story X.Y." note under ## Design Notes — plus `Consumed-by:` / `Consumes:` lists under ## Design Notes.
- Rule 5 (NFR tripwire): an NFR that is unmeasurable, contradictory, or impossible as worded is an `intent gap` HALT that names the NFR and your recommended amendment — never plan around it.
- Rule 6 (architecture decisions): consult the spine at the path above and record the `AD-n` ids that govern this story under ## Design Notes (create the section if the template would omit it), so the implement stage and the reviewer can check against each AD's Rule. If an AC contradicts an AD's Rule, that is an `intent gap` HALT naming the AD — never plan around it.
- Rule 13 (working directory): operate from the absolute working directory stated above; verify `git rev-parse --show-toplevel` matches before reading planning artifacts; pass the same path + verification into the epic-context compile subagent. Rule 13 also covers runtime targets (name every one explicitly — never a tool's default target — and tear down only what your session started) and reading (each document once; re-read only what may have changed, by line range) — pass both into every subagent prompt with the path.
- Rule 18 (5) and the verification arrangement (`## Verification`): mark every command `(loop)` — the story's own tests, run on every verification pass — or `(once)` — the full suite, run once before the implement stage finalizes. Follow the project's verification arrangement if its rules record one ("Per-Story Smoke"): a tier left to CI is omitted while CI is available; a lead-owned full run means no `(once)` lines at all. Every command must finish inside one foreground call (10 minutes with `timeout: 600000`, unless the launch environment raises the cap) — the implement stage may not background it — so write a long suite as several commands (one test class per command is always safe; batches sized from the project's recorded timings, if it keeps any, to about 8 minutes), never as one run-everything line.
- Rule 19 (hermeticity): add a `Shared surfaces:` line under `## Verification` naming every list, menu, roster, schema, or count this story changes that other tests assert on (or `none`), and the standing criterion "every test added or changed passes on a fresh environment, in either order".
- Rule 2 (extend, don't copy): if the story adds a class, method, function, or helper that resembles an existing sibling, name the sibling it extends under ## Design Notes, or record why a copy is the better choice.
- Rule 17 (ledger inbox): the entries this story already owns are listed below (`LEDGER slice <key>`; the ones routed early also appear as `DW-n:` bullets in the story's acceptance criteria). For EACH: either address it — a Tasks & Acceptance item or I/O matrix row that cites `DW-n` — or decline it under ## Design Notes as `Declined DW-n: <one-line reason>` (out of scope for this story's intent, superseded, belongs elsewhere). Never ignore one; an entry you neither address nor decline fails the lead's spec gate.

Ledger inbox for <story-key>:
<paste of `LEDGER slice <story-key>`, or "(none)">

Completion contract: the spec file (its path is your final report's first line, as `SPEC: <path>`) with frontmatter `status: ready-for-dev` and a `## Auto Run Result` section that contains the two lines `Status: <final status>` and `Blocking condition: <condition or none>` verbatim (the skill's HALT protocol spells them out only for the skeleton case — emit them for the existing-spec case too). If you HALT with `status: blocked`, report the blocking condition verbatim. A valid, committed `epic-<N>-context.md` already exists — reuse it; do not recompile. 🚫 Do NOT `git commit` or `git push` — the plan stage leaves the spec uncommitted for the lead's validation gate. **Propagate this prohibition verbatim into every subagent you spawn** (investigation subagents, the epic-context compile subagent if it ever runs), in the same breath as the working directory (Rule 13): they may read, and write only the files the skill names; they may NOT run `git commit`, `git push`, `git reset`, `git rebase`, or anything that mutates a remote or triggers CI; they may NOT `SendMessage` any agent, and you may NOT `SendMessage` them once they have returned (Rule 18 — spawn a fresh one instead). Rule 18 (5): every `Agent` call you make — investigation subagents, the compile subagent — passes `run_in_background: false` (several in ONE message still run in parallel); run every command in the foreground of its own tool call; never wait on `Monitor` or end your turn while anything you started is still running. **Return exactly once**, when the spec is written and the skill has HALTed — never an interim message.
```

**Implement spawn (`bmad-build-auto`, Sonnet tier) — append:**

```text
Dispatch: invoke /bmad-build-auto via the Skill tool with the argument = the spec file path above (frontmatter status `ready-for-dev`). The skill resumes at its implement step: it captures `baseline_revision`, runs its implementation-handoff subagent against the spec, runs the spec's `## Verification` commands and the Matrix Test Audit (acceptance criteria are judged at its review step), runs its review layers in parallel, triages (`patch` fixes inline; `defer` goes to the spec frontmatter `deferred:` list; `intent_gap` HALTs), then finalizes: `status: done`, followed by ONE local commit of the reviewed diff plus the spec. The tree is clean on entry (the lead verified it) and the skill verifies it is clean on exit.

Rules for this stage (from skill-rules.md):

- Rule 5 (NFR tripwire): an un-implementable NFR is an `intent gap` HALT with your recommended amendment; do NOT work around with code comments + deferred-work.md.
- Rule 6 (architecture decisions): match the implementation to the `AD-n` Rules recorded under the spec's ## Design Notes and any other AD whose `Binds:` covers this story's area (spine path above). An AD conflict you cannot resolve within the spec is an `intent gap`, not a judgment call.
- Rule 13 (working directory): operate from the absolute working directory stated above; verify `git rev-parse --show-toplevel` matches before editing anything, and pass the same path + verification requirement into the handoff subagent and every review-layer subagent. Rule 13 also covers runtime targets (name every one explicitly — never a tool's default target — and tear down only what your session started) and reading (each document once; re-read only what may have changed, by line range) — pass both into every subagent prompt with the path.
- Rule 14 (source text): author non-ASCII characters in source via escape sequences (`'…'`), never literal bytes; comments state the contract, never review history (that belongs in the spec).
- Rule 2 (extend, don't copy): prefer extending the sibling the spec names; a copy carries its reason in the spec or the commit message, never in a code comment.
- Rule 15 (ledger): record deferred findings ONLY in the spec's frontmatter `deferred:` list exactly as the skill specifies — the lead harvests them into deferred-work.md; do not write the ledger yourself.
- Rule 19 (falsifiability, at the source): when you or your handoff subagent add or materially change an acceptance criterion's pinning test, write or update its `mutation:` line in the spec's `## Verification` in the same pass — name the mutation, apply it, observe red, revert (tree byte-identical). A test that exists with a missing or stale line is a LOW your own `verification-gap` layer will flag: close it in-pass by demonstrating the mutation and writing the line — never `defer` it. An AC with no pinning test, or an assertion that cannot fail, is a MED to patch.
- Rule 16 (clean tree): your finalize commit lands on the current branch (the epic branch); commit exactly what the skill's finalize step specifies and nothing else. 🚫 NEVER `git push`. **Propagate this prohibition verbatim into the handoff subagent and every review-layer subagent you spawn, in the same breath as the working directory (Rule 13): they may edit files, and they may NOT run `git commit`, `git push`, `git reset`, `git rebase`, or any command that mutates a remote or triggers CI or a deploy. Only you — the layer that spawned them — commit, and only at finalize.** A subagent that reports having committed or pushed is a protocol violation: verify against `git log --branches --not --remotes` and `gh run list` rather than trusting the self-report, do not force-push or roll back anything, and HALT with status `blocked` and blocking condition `subagent protocol violation: <what it did, shas>` so the lead decides.

- Rule 18 (containment) — pre-answered override of the skill's step-04 `patch` handling: the step-03 handoff subagent can NEVER be "re-engaged" (`SendMessage` is not synchronous on this harness; a message to a returned agent creates an orphan writer) — apply patch findings yourself, or spawn a FRESH subagent with the findings written into the spec's `## Tasks & Acceptance`. Never `SendMessage` any agent. While a subagent of yours is running you do not edit the tree (two writers in one worktree produce false protocol alarms); your own test authoring (Matrix Test Audit) happens after it returns. **Stateful tests against a shared runtime run one test class or suite per tool call** — wait for each to complete, never several test-runner calls in one message, never a re-submit on a client-side timeout; propagate this into the handoff subagent in the same breath as the git prohibitions (Rule 18 (3)). **Synchronous is a parameter (Rule 18 (5)):** the handoff subagent and every review layer are launched with `run_in_background: false` on the `Agent` call (the layers together in ONE message still run in parallel) — the skill's own "synchronously" does not set it, and an omitted flag backgrounds the call on current harnesses. Where the skill runs the spec's `## Verification` commands, run the `(loop)` lines on every verification pass and the `(once)` lines exactly once, after the last patch and before the finalize commit. Every command, `## Verification` run, and test sweep runs in the foreground of its own tool call with `timeout: 600000` (the 10-minute cap unless the launch environment raises it; the default is 2 minutes, and a call that reaches its timeout is moved to the background, where it dies when the agent that started it returns) — never `run_in_background: true` on a shell call; a sweep that would outlast the cap is split into foreground calls that each finish inside it (one class per call is always safe; batches sized from the project's recorded timings, if any, to about 8 minutes), never detached. Never wait on `Monitor` — a subagent that arms it and stops has returned; never end your turn while anything you started is still running. Propagate all of this into the handoff subagent too. Return exactly once.

Completion contract: the spec file's frontmatter `status` (`done` on success; `blocked` + blocking condition otherwise) and its `## Auto Run Result` section, which must contain the two lines `Status: <final status>` and `Blocking condition: <condition or none>` verbatim. **Return exactly once, when your work is complete** — an interim or progress return while any subagent of yours is still working strands it as an orphan writer with a dead supervisor. On `blocked`, HALT and report — do not improvise a fix by re-running steps outside the skill.
```

**Implement re-spawn on rework (Rework Loop step 2) — additionally append, after the block above:**

```text
Rework re-dispatch: this spec is `in-progress` because the lead re-opened it after code review (rework iteration <k> of 3; the loop's exit is a re-review that finds no HIGH). Pre-answered overrides: (a) step-01 routes `in-progress` → implement: work ONLY the unchecked `[Review]` / `[Smoke]` / `[CI]` items under ## Tasks & Acceptance and the tests they name — do not re-derive, widen, or re-verify the rest of the story; (b) step-04's follow-up review recommendation is evaluated as a FOLLOW-UP pass (`followup_pass` = `true`): `true` only if this pass patched a `high`, otherwise the work has converged and patch volume is never grounds; (c) Rule 19: every pinning test you touch gets its `mutation:` line written or updated in this pass; (d) Rule 14: this pass's `## Auto Run Result` covers only this pass, and if the spec carries the `oversized` warning, add nothing to it beyond what the open items require.
```

**QA spawn — append:**

```text
Pre-answered checkpoint (Rule 9): the skill's first step asks what to test — answer: the deliverable of Story <id>, i.e. the files listed above (the diff since `<baseline_revision>`), whose acceptance criteria are the spec's Tasks & Acceptance and I/O & Edge-Case Matrix at <spec path>. Do not ask; do not broaden scope to unrelated features. If the project has no test framework yet, choose the stack-appropriate default, record the choice in ## Decisions, and proceed.

Rules for this stage (from skill-rules.md):

- Rule 8 (test discoverability): generated tests MUST be discoverable by the project's default test suite — (a) correct naming convention, (b) not excluded by ignore files, (c) not tagged in a way that opts them out of the default run.
- Rule 19 (falsifiability): for each acceptance criterion, name the mutation that would make its pinning test fail, apply it, confirm red, revert, and confirm the tree is byte-identical to before the mutation (`git status --short` / `git diff --stat` unchanged — a leaked mutation is a defect you shipped). Record it next to the test in the spec's `## Verification` as `mutation: <what> → <test that went red>` (create that section if the planner omitted it — the spec template deletes it for trivial stories). One mutation per AC, not per assertion. A test whose red you have not observed is not evidence; an assertion that cannot fail (expected value forced by the type, subject never constructed, two empty runs compared) is a defect to fix, not a test to count. Report `mutations_demonstrated=<N>` in ## Decisions.
- File-list completeness: append every test file you create to the spec's `## Verification` section (marked `(QA)`), so the spec remains the complete record of the story's files — not just your closing summary.
- Rule 19 (hermeticity): every test you write creates and removes the state it asserts on, depends on no other test's leftovers or run order, and waits for the system under test to signal readiness before acting.
- Rule 13 (targets and reading): name every runtime target explicitly — never a tool's default target — and tear down only what your session started; read each document once and work from your copy.

🚫 Do NOT `git commit` or `git push`. Leave ALL changes uncommitted in the working tree — the lead commits after the per-story smoke gate. Propagate this prohibition verbatim into any subagent you spawn (`git commit` / `git push` / `git reset` / `git rebase` / anything that mutates a remote or triggers CI are all forbidden for them too), in the same breath as the working directory (Rule 13); verify a subagent's self-report against `git log --branches --not --remotes` before relying on it. Rule 18: never `SendMessage` any agent; never message a subagent after it has returned (spawn a fresh one); every `Agent` call you make passes `run_in_background: false`, and every test run is in the foreground of its own tool call with `timeout: 600000`, split into calls that each finish inside the 10-minute cap — never `Monitor`, never end your turn with anything you started still running (Rule 18 (5)); **return exactly once**, when your tests are written and run — never an interim message.

End your final message with these sections, in order:

## Files Modified
- <full path from repo root>
(or "(none)")

## Tests Added
- <full path from repo root>
(or "(none)")

## Decisions
- <one-line summary>
(or "(none)")

## Issues Encountered
- <one-line summary>
(or "(none)")

If you cannot make confident progress for ANY reason — ambiguous ACs, missing prerequisite, user-preference choice, environment failure, or anything risking a stated constraint — STOP before the closing summary and end with a "## Clarification Needed" section instead (Rule 4): the question, what was tried, what is blocking. Do not guess; do not soldier on.
```

**Code-review spawn — append:**

```text
Pre-answered checkpoints (Rule 9 — the skill halts at each of these; take the answer below and continue, do not wait for a human):

1. Step-01 target + context: the explicit argument is the spec file at <spec path> (Tier 1 — this sets `{review_mode}` = "full" and arms the acceptance-auditor layer; never declare "no spec"). Its frontmatter carries `baseline_commit: <sha>` (the lead mirrored build-auto's `baseline_revision` there) — use it as the diff baseline exactly as step-01 describes; do NOT fall through to Tier 3/4. Diff source, in the skill's own terms: commit range `<baseline_revision>..HEAD` plus uncommitted working-tree changes plus untracked files — write `{diff_file}` (step-01's uniquely-named temp file) as `git diff <baseline_revision>` and append, for each untracked file, `git diff --no-index /dev/null <path>`. The layers read that file; so do you — once, then by section (Rule 13). Set {story_key} = `<story-key>` explicitly (the skill only discovers it on its own sprint-status scan, which Tier 1 skips) so its step-04 sprint-status sync works. Step-01's summary confirmation ("HALT and wait for user confirmation to proceed") → confirmed.
1b. Large-diff offer (step-01: "if `wc -l {diff_file}` exceeds approximately 3000 lines, warn the user and offer to chunk the review") → decline; review in full.
1c. Spec layout: this is a `bmad-build-auto` spec. Its `## Tasks & Acceptance` section IS the "Tasks/Subtasks section" — append your `### Review Findings` subsection there. There is NO "story file Status section": the spec's frontmatter `status:` is build-auto's machine state and you must not change it — the skill's "update the story file Status" step is satisfied by the sprint-status sync in 1e and by your closing summary.
1d. SKILL.md's "if you need an explicit user instruction to run subagents, ask once now" → you have it: run every review layer as a subagent.
1e. Sprint-status sync (step-04 §6 "load the FULL file … save preserving comments") → do NOT rewrite the YAML by hand. Run `uv run --no-cache <path-to>/bmad-sprint-planning/scripts/sprint_plan.py generate --epic-file <planning>/epics.md --status-file <impl>/sprint-status.yaml --stories-dir <impl> --project <project_name> --date "<MM-DD-YYYY HH:MM>" --set <story-key>=<done|in-progress>` (the lead has filled every placeholder in this prompt) — it is the only writer that preserves the file's shape.
2. Decision-needed findings → resolve each with best judgment against skill-rules.md and the architecture spine's ADs. Only a genuine user-preference or spec-contradiction question becomes ## Clarification Needed. If you resolve one as `defer`, the skill's "quick one-line reason for deferring?" prompt is answered by the Rule 15 disposition and note you file (below) — do not wait.
3. Patch-handling menu → option 1 (apply every patch).
4. Final next-steps menu → option 3 (done). Do NOT start the next story.

Rules for this stage (from skill-rules.md):

- Rule 3 (real-runtime test evidence): user-facing surface approved without a real-runtime test in the QA suite = high finding. (Distinct from the lead's manual per-story smoke, which is a separate later gate.)
- Rule 5 (NFR tripwire): unmeasurable NFR worked around with code comments + deferred-work.md instead of planning-artifact amendment = high finding.
- Rule 6 (AD violations): for each AC constrained by an `AD-n` in the spec's ## Design Notes — and any AD in the spine whose `Binds:` covers this story — verify the implementation matches the AD's Rule. Mismatch = high (not a low deferrable).
- Rule 1 (Integration ACs): service-introducing story missing an Integration AC = high finding.
- Rule 2 (extend, don't copy): new code that is a near-copy of an existing sibling with no stated reason is a MED naming both locations (patch it by extending the sibling when fix-risk allows); a weak reason is a LOW; a copy the spec forces is `routed` to the story that will unify it, never `by-design`. Check this yourself, with the repository in view — the context-free layers cannot.
- Rule 19 (hermeticity): an added or changed test that is not self-contained — it relies on state it did not create, on another test's leftovers or run order, or acts before the system signals readiness — is a MED in-story finding; so is an entry on the spec's `Shared surfaces:` line whose old-shape assertions the implementation left unchanged.
- Rule 15 (finding disposition bar): whatever the skill's own triage buckets are called (decision-needed / patch / defer / dismiss today; a five-way verdict with `intent_gap` / `bad_spec` / `reject` routes on upstream `main`), Rule 15's table governs the disposition of every finding that survives triage. Disposition every finding AT REVIEW TIME per the Rule 15 lookup, emitting fix-risk (low/med/high + one-line justification) on each. "In-footprint" means the EPIC's footprint (in-story or in-epic) — a file this story did not touch but this epic owns is in-footprint — but fix-now applies only in-story; an in-epic MED is routed to the story that owns the file (below). Spec-bound → close `by-design` at emission; theoretical (no realistic user-reachable failure) → close `wontfix-theoretical` + one line naming what would make it real; MED with fix-risk ≤ med, in-story → patch it NOW when you can (you may edit files; the patch menu applies every patch); what you cannot patch leaves the story `in-progress` for ONE rework iteration on the story's FIRST review only — on a re-review (this prompt then carries a "Rework re-review" block) it is `routed owner=<a later story key in this epic that touches the area, else burndown>` and never blocks `done`; MED with fix-risk ≤ med, in-epic (a file a story of this epic owns, not this one) → `routed owner=<that story's key if it has not reached cr_complete, else burndown>`, non-blocking; LOW two-way door (≈≤15 changed lines incl. its test, in-footprint, spec-clear) → patch now if mechanical, else return it in a `## Fix Pack` section for one bounded dev iteration; LOW that is not a two-way door → `wontfix-accepted` with `reopen_if=<observable probe>` at emission — `burndown` never owns a LOW; MED with high fix-risk or out-of-footprint → `escalated` (decided by the user at the merge-gate decision sheet, non-blocking); real MED/HIGH out-of-footprint → `routed` canonical entry — CONSULT deferred-work.md FIRST and append an occurrence instead of re-filing an adjudicated item; genuine product call → `decision-pending`; closable only by a human → `decision-pending` with `note=human=<what>`. The skill's own `defer` bucket ("pre-existing issue not caused by the current change") is subordinate to this table: a pre-existing in-story MED is still patched now or takes the one MED iteration, a pre-existing in-epic MED is still routed to a named owner, and a pre-existing LOW is still fixed or closed with a probe — "pre-existing" is a fact about blame, not a disposition.
- Rule 19 (falsifiability): an acceptance criterion with NO pinning test, or a pinning assertion that cannot fail (see the `verification-gap` layer's brief), is a MED in-story finding with low fix-risk → patch it now, or it takes the story's one MED iteration. A pinning test that EXISTS but has no `mutation:` line in the spec's `## Verification`, or a stale one (a rework changed the test), is a LOW you close inside this pass: name the mutation, apply it, observe red, revert (tree byte-identical), and write or correct the line under `## Verification` — that section is a tracking doc you MAY edit; this is the one exemption from the skill's "reject any finding whose fix is to edit the spec under review" rule, and it never re-opens the story. Name the AC in either case.

Review-layer model policy: read `_bmad/custom/model-overrides.yaml` (relative to the working directory stated in this prompt). If it sets `review_tier: mixed`, launch the defect-discovery layers — `blind-hunter`, `edge-case-hunter`, `verification-gap` (by `id` in the skill's review_layers) — with an explicit `model: sonnet` parameter on their Agent calls, and launch `acceptance-auditor` with no model override so it inherits your model. If the file is absent or says `review_tier: full-opus`, launch every layer with no model override (they inherit your model). Never launch any review layer on a lighter tier than the model that implemented the story. State in ## Decisions which review tier was applied and which layers ran.

Every ledger write follows Rule 15's grammar and goes through the tool — pre-answered override of the skill's step-04 "append to deferred-work.md": do NOT write the skill's default `## Deferred from:` bullets. Instead, for each `defer` finding: first `bash _bmad/scripts/ledger.sh <ledger> slice all` and grep the summaries — an existing root cause gets `append DW-n "occurrence=<story-key>"`, never a new entry; otherwise `new "<summary>" "<spec-basename>" <severity> <fix-risk> <footprint> "<evidence, one line>" <status> <owner> cr "<note>"` where status/owner follow Rule 15's disposition table: `escalated owner=burndown` (MED, high fix-risk or out-of-footprint — "for the user at the decision sheet"), `routed owner=<story key in this epic that will touch it, else burndown>` (real MED/HIGH out-of-footprint; an in-epic MED, owner = the story that owns the file; an unpatched in-story MED on a re-review — never a LOW, and never an unpatched in-story MED on a first review, which re-opens the story instead), `decision-pending owner=burndown` (genuine product call, or `note=human=<what>` for work only a human can do), `wontfix-accepted` with `reopen_if=` (a LOW that is not a two-way door), `by-design` / `wontfix-theoretical` (terminal — owner is still required; use the story key). Entries born from this review carry `by=cr`. Never open or rewrite the ledger file directly; never write `owner=none`.

🚫 Do NOT `git commit` or `git push`. You MAY edit files to apply patches and update tracking docs (the spec's `### Review Findings`, deferred-work.md, sprint-status.yaml), but the lead commits everything (submodules-first) after the per-story smoke gate. **Propagate this prohibition verbatim into every review-layer subagent you launch (`blind-hunter`, `edge-case-hunter`, `verification-gap`, `acceptance-auditor`), in the same breath as the working directory (Rule 13): they read and report; they may NOT edit files, `git commit`, `git push`, `git reset`, `git rebase`, or run anything that mutates a remote or triggers CI.** A layer that reports having changed or committed anything is a protocol violation — verify with `git status --short` / `git log --branches --not --remotes`, discard that layer's findings, and note it in `## Issues Encountered`. Rule 18: never `SendMessage` any agent; a returned layer is finished (re-launch, never resume); launch every review layer with `run_in_background: false` on its `Agent` call — all of them in ONE message, so they still run in parallel — because an omitted flag backgrounds the layer on current harnesses and the skill's "synchronously" does not set it (Rule 18 (5)); run any command in the foreground with `timeout: 600000`, split into calls that fit the 10-minute cap, never wait on `Monitor`; **return exactly once**, after the skill's final menu — never an interim message. Do NOT change the spec's frontmatter `status:` (it is bmad-build-auto's machine state; the lead re-opens the spec when rework is needed) — record your verdict in sprint-status.yaml and in your closing summary only. Do NOT write cycle-log entries — that is the lead's job.

The skill sets the story's final status itself: `done` when all decision-needed + patch findings are resolved and no high/medium remains unresolved (mediums dispositioned `escalated` or `routed` per Rule 15 are ledgered with an owner, not blocking); otherwise back to `in-progress`. Exit condition (Rule 15): on a re-review that finds no HIGH, every remaining MED is `routed` / `escalated` with an owner and the status is `done` — a reworked story is never left `in-progress` on MEDs alone. Do not override that decision.

End your final message with these sections, in order:

## Files Modified
- <full path from repo root>
(or "(none)")

## Tests Added
- <full path from repo root>
(or "(none)")

## Decisions
- final story status (`done` or `in-progress`), resolved/deferred/dismissed counts, any high-severity fix names
- `entries: high=N med=N low=N rows=N unresolved_high_med=N` — `high`/`med`/`low` count root-cause ENTRIES after step-03 grouping, `rows` the raw findings the layers reported before grouping, `unresolved_high_med` the high+med entries you left unresolved after your own patches (routed, escalated, or re-opening the story). The lead copies this line into `cr_complete`; a row count in the severity fields is a telemetry bug (field report 2026-09-11: duplicates across four layers roughly doubled the checkpoint's reading).
- `review_outcome=<CLEAN|NORMAL|DEGRADED> failed_layers=<csv or none>` — project Rule #57 (`_bmad/custom/code-review-rule57.md`): DEGRADED when any launched review layer delivered no findings payload; a DEGRADED review never sets `done`. The lead copies it into `cr_complete`.
(or "(none)")

## Issues Encountered
- <one-line summary>
(or "(none)")

If you cannot make confident progress for ANY reason — a genuine user-preference or spec-contradiction question, a missing prerequisite, an environment failure — STOP before the closing summary and end with a "## Clarification Needed" section instead (Rule 4): the question, what was tried, what is blocking. Do not guess; do not soldier on.
```

**Code-review re-spawn on rework (Rework Loop step 4) — additionally append, after the block above:**

```text
Rework re-review (iteration <k> of 3): the spec's `baseline_commit` is the REWORK's baseline (`<rework baseline sha>`, the commit build-auto captured after the rework commit), so the diff you review is `<rework baseline>..HEAD` plus the working tree — the rework, not the whole story. The whole story was reviewed at round 1 against `<original baseline sha>`; read wider when a finding needs context, but file a finding outside the rework range only when it is HIGH. Checklist — the previous round's unresolved items, each to be confirmed fixed or reported still open: <list>. Exit condition (Rule 15): if this review finds no HIGH, the story closes — patch what you can, file every remaining MED with an owner (`routed` / `escalated`), set `done`; do not leave it `in-progress` on MEDs alone. A HIGH re-enters the loop (the lead enforces the cap).
```

### Clarification protocol

If an agent returns with a `## Clarification Needed` section instead of the closing summary, the lead:

1. Reads the question from the returned message.
2. Surfaces it to the user with Story ID + context.
3. Waits for the user's answer.
4. Re-spawns the same stage's agent with the clarification baked into the prompt or written to the spec's `## Design Notes` (committed first — Rule 16). If the answer has architectural weight (Rule 20 — a seam, a convention, a dependency or licence, a numeric invariant), it is written into the spine in that same commit and the AD id is cited where the answer is recorded.
5. Logs `<stage>_clarification_requested` before the re-spawn; the re-spawn's normal success entry (`story_created` / `dev_complete` / `qa_complete` / `cr_complete`) closes it.

**`bmad-build-auto` results map onto this protocol by blocking condition** (read from the spec's `## Auto Run Result`; the plan/implement stages emit no `## Clarification Needed` section):

| Spec `status` / blocking condition | Lead action |
| --- | --- |
| `ready-for-dev` (plan spawn) | Success — log `story_created`, run the spec gates. |
| `done` (implement spawn) | Success — harvest `deferred:`, set `review`, log `dev_complete`. |
| `blocked`: `intent gap`, `unclear intent`, `missing previous-story continuity decision`, `matrix ambiguity`, `spec failed ready-for-development standard`, or an unresolved-questions list | Clarification path. Surface the condition + `## Auto Run Result` to the user with Story ID. On answer, follow the **re-dispatch protocol** below. Log `<stage>_clarification_requested` / `<stage>_complete`. |
| `blocked`: `version-control metadata not writable`, `finalization left repository dirty`, `no subagents`, `context compilation verification failed` | Pipeline/environment defect (a missed bookkeeping commit — Rule 16; a non-general-purpose spawn; a missing or unparseable `epics.md` / failed epic-context pre-warm). Halt loudly, fix the cause, re-dispatch per the protocol. Never "answer" these as clarifications. |
| `blocked`: **free-text** condition naming a dirty tree, untracked files, or a branch mismatch (step-01 has no canonical string for this — `version-control metadata not writable` fires only when `git add --refresh` itself fails) | The commonest Rule 16 miss: uncommitted cycle-log / tracker / spec writes, or a wrong checkout. Same handling as the row above — reconcile (`git status --short`; bookkeeping commit or `git checkout {TICKET}-epic{N}`), log `protocol_violation` only if an agent left the tree dirty, and re-dispatch per the protocol. |
| `blocked`: `review repair loop exceeded 5 iterations (non-convergence)`, `implementation verification failed`, `patch verification failed`, `matrix test audit failed`, `handoff conflicts with spec` | Treat as a failed rework cap: surface to the user with the spec's `## Review Triage Log`. The spec is wrong more often than the code. |
| `blocked`: `no epic spec found`, `no stories.yaml found`, `story id not found in stories.yaml`, `ambiguous story file match`, `unrecognized status in existing story file`, `missing spec_file before implementation`, `planned spec file disappeared before implementation` | A `/epic-cycle` dispatch bug (folder+id dispatch used in sprint mode; a spec path that does not exist or whose frontmatter was hand-mangled). Fix the anchor and re-dispatch per the protocol. |
| `blocked`: `blocked spec supplied`, `story already blocked` | The lead re-dispatched on a spec still at `status: blocked` — a kit bug, not a new clarification. Apply the re-dispatch protocol (reset the status first). |

**Re-dispatch protocol (any re-spawn after a `blocked` result).** build-auto routes strictly by the spec's frontmatter `status`: `draft` → plan, `ready-for-dev` / `in-progress` → implement, `in-review` → review, `done` → follow-up review pass, `blocked` → HALT `blocked spec supplied`. So a re-spawn on an unchanged `blocked` spec can never proceed, and a re-spawn with the **story key** while a spec already exists resumes it only if it is still `draft` — at any other status the skill creates `spec-<key>-2.md` and ignores the edited file. Therefore, before every re-dispatch:

1. Apply the answer to the spec. For a **plan-stage** halt the answer usually belongs inside the `<intent-contract>` block (build-auto preserves that block verbatim when it resumes a `draft`) and/or `## Design Notes`; for an **implement-stage** halt it belongs in the non-frozen sections (`## Design Notes`, `## Tasks & Acceptance`, `## Spec Change Log`). Note the change in `## Spec Change Log`. If the answer has architectural weight, write it into the spine first (Rule 20) and cite the AD id.
2. Reset the frontmatter `status`: `draft` to re-plan (the next run re-derives the spec around the preserved intent block and honours `Halt after planning.`); `in-progress` (or `ready-for-dev`) to re-implement. **Exception — an `intent gap` raised at build-auto's review step** (the spec's `## Review Triage Log` entry names a saved patch file under `<impl>`): the skill saved the attempted change as that patch and reverted the code, so do not re-implement — after applying the amendment, `git apply <patch>`, verify it applied cleanly, set `status: in-review`, and the re-spawn resumes at review with the work intact (the 2026-08-29 field report's "expensive mid-implement halt" is exactly this case).
3. Bookkeeping commit (Rule 16).
4. Re-spawn the same stage **on the spec path** — never on the story key once a spec exists, and **never by `SendMessage` to the old stage agent**. Its `Agent` return value was its completion signal; an agent "resumed" after returning is alive with no durable record of it (no open `stage_spawned`), invisible to resume detection, and a de-facto background stage. The re-spawn's apparent cost is the price of durability: the answer lives in the spec, not in a chat message, so the story survives a crash between the answer and the re-spawn.

### Pipeline Flow

```
Lead resolves the architecture spine (newest final ARCHITECTURE-SPINE.md, else newest, else *architecture*.md, else none); logs spine_resolved — path included in every spawn prompt.

For each epic in range:
  Lead verifies clean working tree (parent + every submodule); halts on dirty state.

  # IDE file-sync toggle applicability — conditional, IRIS/ObjectScript projects only (see Source Control Branching)
  ideSync = (.vscode/settings.json exists AND objectscript.conn.active == true)
  If ideSync: record original value   # sync STAYS ON except inside the two branch-op windows; never stage settings.json
  If ideSync: set objectscript.conn.active = false   # >>> Window A start — wraps resume-checkout + SC-1/SC-2 + epic-branch checkout

  # Resume-mode detection (see Resume Semantics)
  For each affected repo, lead determines mode by cross-referencing:
    - cycle-log-epic-{N}.md existence + entries
    - sprint-status.yaml story states for this epic
      (SPRINT_PLAN status for the computed snapshot — per-status counts, recommendation.story_key;
       SPRINT_PLAN validate first if the YAML's integrity is in doubt; do not hand-parse)
    - spec-<key>.md frontmatter status per story (draft | ready-for-dev | in-progress | in-review | done | blocked)
    - {TICKET}-epic{N} branch presence locally and on remote
  Modes per repo: FRESH | RESUME | REMOTE_ONLY | LOCAL_ONLY | AMBIGUOUS | INTEGRITY_ERROR
    INTEGRITY_ERROR or AMBIGUOUS → halt and surface to user
    LOCAL_ONLY                   → halt and ask user (remote deletion intentional?)
    REMOTE_ONLY                  → fetch + checkout {TICKET}-epic{N}; then RESUME
    RESUME                       → run Cross-stage integrity checks; on pass, set resume point
    FRESH                        → fall through to SC-1 / SC-2

  # SC-1 / SC-2 — only where FRESH
  For each repo in FRESH:
    Lead verifies the feature branch
      If missing → STOP and ask user (TICKET, Description, root); validate; create; push; log feature_branch_created
    Lead verifies {TICKET}-epic{N}
      If missing → branch off the feature branch (deterministic); push; log epic_branch_created
  Lead checks every affected repo out to {TICKET}-epic{N}; logs epic_branch_checked_out
  If ideSync: restore objectscript.conn.active to original   # <<< Window A end — MANDATORY (try/finally; restore even on halt/failure)

  Lead: LEDGER load → re-own every owner=none entry (append owner=<story key>|burndown) → logs ledger_load   # see Ledger Drain
    (a legacy-grammar ledger — no `### DW-` headings — HALTS here: run the Step-1 migration first)
  Lead executes /bmad-sprint-planning via Skill tool, HEADLESS, with "Ledger load: <the load line>" in its argument; parses the trailing JSON:
    gate=FAIL or status=blocked → STOP; surface findings (and the saved implementation-readiness.md if written)
    gate=CONCERNS → surface once; continue
    gate=PASS → continue
  Lead logs sprint_planning_complete gate=<PASS|CONCERNS>
  If Epic N-1 retrospective exists OR LEDGER slice all is non-empty OR sprint-status.yaml action_items has status=open entries,
     AND no prior retro_review_* entry for this epic:
    Lead reads all sources, CLOSES every ledger item (resolved-by | own | terminal — Rule 17), inserts Story X.0 into epics.md,
      plans it via the normal PLAN spawn, appends the triage table to the spec; logs retro_review_complete
  Else if no prior retro_review_* entry:
    Lead logs retro_review_skipped reason=no_retro_no_open_ledger_no_open_action_items
  Else:
    (resume case — gate already passed; skip)

  # Epic-context pre-warm (see "Epic Context Pre-warm") — after any epics.md edit, before the first plan spawn
  Lead renders bmad-build-auto, spawns an Opus subagent on the rendered compile-epic-context.md for epic N, verifies the header,
    bookkeeping commit; logs epic_context_compiled

  For each story, strictly sequentially, starting from the resume point:
    If any file in planning_artifacts is newer than epic-{N}-context.md → re-run the pre-warm + bookkeeping commit first
    Lead asserts current branch == {TICKET}-epic{N} in every affected repo; halts on mismatch
    Lead writes stage_spawned (stage= spawn_at= model= agent_name= cycle_iteration=) IMMEDIATELY BEFORE each Agent call —
      for build-auto stages inside the bookkeeping commit that precedes the spawn; closed by the stage's success entry or a clarification entry

    # --- PLAN (Opus) ---
    Lead logs stage_spawned stage=plan; bookkeeping commit (Rule 16: tree clean before every build-auto spawn)
    Lead invokes Agent for /bmad-build-auto with "<story-key> Halt after planning." (model=opus unless re-pinned)
      → re-reads spec-<key>.md: status ready-for-dev → captures spec path; logs story_created path=<spec> build_status=ready-for-dev
      → status blocked → Clarification protocol (build-auto table)
    Lead validates the spec: Integration ACs (Rules 1/2), AD mapping (Rule 6), deleted sections re-created, decision dependency   # see "Lead Validates the Story Spec"
    Lead logs spec_validated; SPRINT_PLAN generate --set <key>=ready-for-dev; bookkeeping commit (everything under implementation-artifacts)

    # --- IMPLEMENT (Sonnet) ---
    Lead resolves the PREVIOUS story's ci=pending (gh run view) → logs ci_resolved   # resolution point (1): the plan above did not wait
      failure → classify (logs ci_red_classified): infra → timed retry, never rework | flake → one rerun + flake: ledger entry | story → HIGH: re-open THAT story's spec with a [CI] task, one rework iteration, re-smoke, re-commit — this story's spec waits at ready-for-dev (inherited red → surface to the user)
    Lead: SPRINT_PLAN generate --set <key>=in-progress --set epic-{N}=in-progress; bookkeeping commit
    Lead invokes Agent for /bmad-build-auto with the spec path (model=sonnet unless re-pinned)
      → re-reads spec: status done → build_sha = HEAD (its finalize commit); asserts tree clean
        Lead harvests spec frontmatter deferred: → LEDGER new … <status> <owner> harvest (born owned, Rule 15); SPRINT_PLAN generate --set <key>=review
        Lead mirrors baseline_revision into the spec frontmatter as baseline_commit (bmad-code-review reads that key)
        logs dev_complete build_sha=<sha> baseline_revision=<sha> review_loop_iteration=<n> followup_review_recommended=<bool> deferred=<n>
      → status blocked → Clarification protocol (build-auto table)
    Lead executes AD-tooled AC verifications against the spine (lead-side, sequential per AC, one mutation each — Rule 19); logs adr_verifications_complete
    Lead invokes Agent for /bmad-qa-generate-e2e-tests (model=sonnet unless re-pinned) → reads ## Tests Added → logs qa_complete
    Lead invokes Agent for /bmad-code-review with the spec path (model=opus unless re-pinned) → reads return
      → verifies sprint-status.yaml moved to done|in-progress; if still review, SPRINT_PLAN generate --set <key>=<reviewer's final status>; SPRINT_PLAN validate
      → checks for stray "## Deferred from:" bullets in deferred-work.md (reviewer ignored the ledger pre-answer) → harvest via LEDGER new, strip, log ledger_stray_bullets
      → logs cr_complete
    If review returned a ## Fix Pack (trivial LOW, Rule 15): the reviewer has already applied mechanical patches; behavioral-but-trivial items go through ONE rework iteration below (cycle_iteration+1) — bounded: exactly one fix-pack iteration per story, shared with the first-review MED iteration; the smoke gate still follows
    While review left story in-progress (a HIGH; or, on the story's FIRST review only, an unpatched in-story MED with fix-risk ≤ med — `routed` / `escalated` mediums never block) AND rework iterations < 3:   # see Rework Loop
      Lead re-opens the spec (status in-progress; unresolved findings appended as unchecked Tasks & Acceptance items); logs rework_opened trigger=<high|med_first_review|fix_pack|smoke|ci> items=<csv>; REWORK commit (QA tests + reviewer patches + bookkeeping)
      Lead re-spawns /bmad-build-auto on the spec (model=sonnet; cycle_iteration+1; "Rework re-dispatch" block appended: work only the open items, followup_pass=true) → harvest deferred:, logs dev_complete
      Lead re-runs AD verifications if rework touched AD-constrained ACs; SPRINT_PLAN generate --set <key>=review
      Lead sets spec baseline_commit = this rework's baseline_revision (scoped re-review: <rework baseline>..HEAD, never the whole story again); re-spawns /bmad-code-review with the "Rework re-review" block → logs cr_complete
      A re-review that finds no HIGH closes the story (remaining MEDs routed/escalated with owners) — the loop exits here even if MEDs remain (Rule 15 exit condition)
    If still in-progress after 3 iterations: STOP; logs rework_cap_reached; surface outstanding findings to user — an override is accepted only with a finite item list and closes at the next review without HIGH (rework_cap_override items=… close=…; see Rework Loop)
    Lead adjudicates LEDGER slice <key> against delivered scope (resolved-by | re-own | terminal) until empty; logs ledger_adjudicated   # Rule 17
    Lead performs per-story smoke (lead-side); logs smoke_complete
    Lead runs the fresh-environment check (the story's added + changed tests on a fresh environment, forward then reversed — Rule 19); logs fresh_check; red → failed-smoke path
    Lead asserts current branch == {TICKET}-epic{N}; commits (QA tests, review patches, bookkeeping) + pushes ONLY to {TICKET}-epic{N} (submodules first if applicable)
    Lead verifies the push on origin (git fetch; merge-base --is-ancestor) and the run's headSha; logs committed ci=pending run=<id> (gh run list --branch --commit; ci=none|unavailable per pre-flight); logs story_cycle; next story
    # the pending run is resolved before the NEXT story's implement spawn — its plan proceeds meanwhile (see IMPLEMENT above)

  # Burn-down gate (Rule 17) — before the epic closes
  Lead: LEDGER slice burndown + slice <each story key of epic N>:
    empty → logs ledger_burndown_skipped reason=empty
    else  → set aside every escalated / decision-pending entry for the decision sheet (to_decision_sheet=N; never re-own or decide them here)
            resolve / terminal what can be closed now; if what remains exceeds ledger_cap (default 8) OR any remaining entry has 2+ occurrences:
              charter Story N.<M+1> "Epic N burn-down" (M = highest existing story number under Epic N across epics.md + sprint-status.yaml; reuse an existing burn-down story) — at most burndown_story_max (default 12) entries by priority (severity, occurrences, low fix-risk first)
              (insert into epics.md, SPRINT_PLAN generate, pre-warm, full per-story pipeline incl. its own ledger_adjudicated)
            every entry still non-terminal (the overflow) → append owner=<specific next-epic story key> with the reason (never "burndown", never "none")
            logs ledger_burndown_complete open_before= resolved= terminal= chartered= chartered_size= overflow= reowned= to_decision_sheet= open_after= cap= story_max= filed_this_epic= closed_this_epic= drain_ratio=
  Lead: SPRINT_PLAN generate --set epic-{N}=done (no skill writes this transition); bookkeeping commit; logs epic_status_done
  Lead evaluates this epic's cycle log against the escalation / de-escalation / rollback thresholds — EVERY project; logs model_tier_checkpoint armed=<bool> result=…
    result=recommend_escalate|offer_mixed → surface evidence to the user; on approval (creating model-overrides.yaml if absent): update overrides+history; logs model_tier_changed
    result=revert_required (mixed active, smoke defects) → mandatory: update the file; logs model_tier_changed
  Lead pauses: "Run a retrospective?"   # human-in-the-middle gate — never auto-answered, never times out into a default
    If yes → /bmad-retrospective via Skill tool, fully interactive (all WAITs reach the user), with the burn-down counts in its argument; logs epic_retro_complete
    If no  → logs epic_retro_skipped reason=user_declined
  Lead presents the epic-close decision sheet (Rule 17 (5)): every escalated + decision-pending entry, one sitting, recommended disposition each
    → writes the answers as by=merge_gate trailer lines (human-owned → action_items + dropped note=action_item); bookkeeping commit; logs decision_sheet_recorded
  Lead pauses: "Merge {TICKET}-epic{N} → feature, delete {TICKET}-epic{N}?" → if yes:
    If ideSync: set objectscript.conn.active = false   # >>> Window B start — wraps the merge branch ops
    For each affected repo, submodules-first then parent:
      checkout feature; pull; merge --no-ff {TICKET}-epic{N}; push feature; delete {TICKET}-epic{N} local + remote
    If ideSync: restore objectscript.conn.active to original   # <<< Window B end — MANDATORY (try/finally; restore even on conflict/halt)
    Logs epic_merged_to_feature
  Else:
    Logs epic_merge_skipped
  Logs epic complete; next epic
```

### Smart Parallelism (retired under v6.11 — stories run strictly sequentially in one checkout)

Story-level batching inside a single working tree is no longer possible:

- **Implement** spawns: each `bmad-build-auto` run makes its own finalize commit and then verifies the tree is clean — two concurrent runs in one checkout see each other's uncommitted work and HALT `finalization left repository dirty` (or race on the git index).
- **Plan** spawns: build-auto's step-01 version-control check ("require a clean working tree … HALT on a dirty tree") runs *after* it has loaded/compiled the epic context, so a sibling plan spawn that has already written its untracked `spec-<key>.md` makes the slower sibling halt; siblings also race on `epic-<N>-context.md`.

Concurrency therefore lives one level up — the parallel kit's per-epic worktrees (Orchestrator Mode). Within an epic: one story at a time, one stage at a time. Emitting multiple pipeline-stage `Agent` calls in one message is an anti-pattern under v6.11.

**Write-ahead rule (extended by Rule 16):** write the cycle log entry for a completed stage BEFORE the next dependent action, and COMMIT it before the next `bmad-build-auto` spawn. For `committed`: write immediately after `git push` returns success. If crashed between push success and log write, inspect `git log --oneline` on resume; if the matching commit exists, write the missing log entry — do NOT re-run the commit. The same applies to `dev_complete`: build-auto's finalize commit (`build_sha`) plus spec `status: done` without a `dev_complete` entry means the entry was lost, not the work — write it, harvest `deferred:`, set `review`, continue.

### Rework Loop (implement ↔ code review, bounded, with an exit)

`/bmad-code-review` closes the story itself: when every decision-needed + patch finding is resolved and no high/medium severity remains unresolved (`routed` / `escalated` mediums are ledgered with an owner and do not count), it sets the story (and sprint-status.yaml) to `done`; otherwise it sets `in-progress` and leaves unchecked review-finding items (action items) in the spec file.

**What re-opens a story (Rule 15):** a HIGH at any review; an unpatched in-story MED with fix-risk ≤ med at the story's FIRST review (one bounded iteration, shared with the Fix Pack); a failed smoke; a red CI run. Nothing else — in-epic MEDs are routed to the owning story, and **a re-review that finds no HIGH closes the story** with its remaining MEDs routed or escalated. (Field report 2026-09-11: without this exit, "fix every in-footprint MED" + a whole-story re-review after every rework + stale mutation lines from the rework's own test changes produced 9 implement passes, 3 reviews and 13 stage spawns on one story that had had zero HIGH since its third review; the cap was overridden with "continue until complete", and complete was not a reachable state.)

**Degraded review (project Rule #57).** A review whose `## Decisions` report `review_outcome=DEGRADED` (a layer delivered no findings payload — `_bmad/custom/code-review-rule57.md`) left the story `in-progress` for that reason alone. If the findings it did deliver contain no re-open trigger (no HIGH, no first-review unpatched in-story MED, no Fix Pack), do NOT re-open the spec or dispatch `bmad-build-auto`: log `cr_complete … review_outcome=DEGRADED failed_layers=<csv>`, `SPRINT_PLAN generate --set <key>=review`, and re-spawn `/bmad-code-review` on the same baseline as a review-only re-run, which does not count against the 3-iteration cap. If it does contain a trigger, run the Rework Loop below as usual — its scoped re-review is the re-run. A second consecutive DEGRADED close on the same story → STOP and surface the failed layers to the user.

`bmad-dev-story`'s review-continuation mode has no v6.11 successor, so the lead re-opens the spec for `bmad-build-auto` instead. When the review returns `in-progress`:

1. **Lead re-opens the spec:** set frontmatter `status: in-progress`; append every unresolved finding as an unchecked item under `## Tasks & Acceptance` (`- [ ] [Review] <finding> — <file:line> — <what the fix must do>`); leave the frozen `<intent-contract>` block untouched; note the iteration in `## Spec Change Log` (Rule 14: once the spec carries the `oversized` warning, add nothing but the open items — no restated history); log `rework_opened cycle_iteration=N iteration=<k> trigger=<high|med_first_review|fix_pack|smoke|ci|cap_override> items=<csv>` — the item list is the iteration's whole scope. **Rework commit:** commit QA's tests, the reviewer's applied patches, and the bookkeeping files together (`chore(epic-N): rework <story-id> iteration <k>`) — they are still uncommitted (the QA and CR spawns are forbidden to commit), and a spec-path dispatch skips build-auto's pre-flight tree check, so anything left uncommitted would be silently absorbed into build-auto's next diff and finalize commit.
2. Re-spawn `/bmad-build-auto` on the spec (Sonnet tier, `cycle_iteration` incremented) **with the "Rework re-dispatch" block appended** to the implement spawn prompt. Its resume table routes `in-progress` → implement — a first pass from the skill's point of view (its `followup_pass` is set only for a `done` spec, so without the block every rework ran as a first pass and its convergence clause never engaged): the block pre-answers step-04's follow-up recommendation as a follow-up pass and confines the work to the open items. It captures a new `baseline_revision` (after the rework commit), works the open tasks, self-reviews, finalizes `status: done`, commits. Harvest `deferred:`; log `dev_complete` (its `followup_review_recommended` is now meaningful: `true` only if the pass patched a HIGH).
3. Re-run AD-tooled verifications if the rework touched AD-constrained ACs. Then `SPRINT_PLAN generate --set <key>=review` (the previous code review moved the tracker to `in-progress`; the re-review expects `review`).
4. Re-spawn `/bmad-code-review` **scoped to the rework** — set the spec's `baseline_commit` to THIS rework's `baseline_revision` (the skill's step-01 uses that key as its diff baseline, so the reviewer diffs `<rework baseline>..HEAD` + working tree) and append the "Code-review re-spawn on rework" block: the previous round's unresolved items as its checklist, the original baseline for context, findings outside the rework range only when HIGH, and the exit condition. The whole story was reviewed once, at round 1; re-reading it after every rework re-samples the same finding distribution (and blows through the skill's own ~3,000-line chunking guard — field report 2026-09-11: round 3 re-read 7,247 lines for 0 HIGH). Fresh eyes on old code always find something tolerable.
5. **Cap: 3 rework iterations.** Non-convergence after 3 → STOP, log `rework_cap_reached outstanding=<csv>`, and surface the outstanding findings to the user (mirrors `bmad-build-auto`'s own 5-iteration review-repair cap). Endless implement↔review ping-pong is a signal the spec is wrong, not the code. **Cap override contract:** the lead accepts an override only as `rework_cap_override cap=3 used=3 authorized_by=user items=<finite csv of finding / DW ids> close=next_review_without_high` — an open-ended instruction ("continue until complete") is answered with the item list to confirm, never acted on; the extra iteration works exactly those items, and the story closes at its next review unless that review finds a HIGH.

**Decisions do not re-open a reviewed story.** A check-in answer or a decision-sheet call on one of this story's `escalated` / `decision-pending` entries, taken after a review that found no HIGH, becomes a `DW-n:` acceptance bullet on a named later story or the burn-down story (Rule 17 (1b)) — not a rework of this one. If the story is still inside its loop (a HIGH outstanding), the decision's items ride along in the current iteration's `items=` list.

The Fix Pack path (trivial LOW, Rule 15): mechanical items are patched by the reviewer inline; behavioral-but-trivial items take exactly ONE iteration of the loop above — the same single iteration a first review's unpatched in-story MEDs use.

Only a story at `done` proceeds to smoke + commit.

### Status Ownership (who writes sprint-status.yaml)

`bmad-build-auto` never touches `sprint-status.yaml` (only the interactive `bmad-build` syncs it, and that skill is not a pipeline stage), so under v6.11 the **lead** owns the early story transitions and writes them ONLY through `SPRINT_PLAN generate --set` (deterministic, preserves comments; `--set` is unconditional, so the lead checks the current value first and never writes a lower rank):

| Transition | Written by |
| --- | --- |
| file generation, `backlog` seeding, `epic-N` keys, `epic-N-retrospective: optional` | `/bmad-sprint-planning` (headless) via `sprint_plan.py generate` |
| story `backlog → ready-for-dev` (after the plan spawn is validated) | **the lead** — `SPRINT_PLAN generate --set <key>=ready-for-dev` |
| story `ready-for-dev → in-progress` + epic `backlog → in-progress` lift (immediately before the implement spawn) | **the lead** — `--set <key>=in-progress --set epic-{N}=in-progress` |
| story `in-progress → review` (after the implement spawn's spec reads `status: done`) | **the lead** — `--set <key>=review` |
| story `review → done` (or back to `in-progress`) | `/bmad-code-review` (its step-04 sync). The skill only sets `{story_key}` itself when it found the story via its sprint-status scan; on an explicit spec-path dispatch the spawn prompt must state the key, and the **lead verifies after `cr_complete`** that the file moved — if it still reads `review`, apply the reviewer's reported final status with `SPRINT_PLAN generate --set` (this is the one sanctioned lead write of `done`/`in-progress` for a story). |
| `epic-{N}-retrospective: optional → done`, `action_items` append | `/bmad-retrospective` via its `sprint_status.py update` |
| **epic `in-progress → done`** (after the last story reaches `done`) | **the lead** — `--set epic-{N}=done`; log `epic_status_done` |

Status enum (kebab-case, unchanged in BMAD v6.11): story `backlog → ready-for-dev → in-progress → review → done`; epic `backlog → in-progress → done`; retrospective `optional → done`; action items `open → in-progress → done`; legacy aliases `drafted` ≡ `ready-for-dev`, `contexted` ≡ `in-progress` (normalized by the script). Never downgrade a status — `--set` would happily do it (it is the script's repair path), so read before you write; never hand-edit the YAML.

**Do not confuse the two status vocabularies.** The spec file's frontmatter `status` is `bmad-build-auto`'s machine state: `draft | ready-for-dev | in-progress | in-review | done | blocked`. `in-review` (spec, mid-self-review) is NOT `review` (sprint-status, awaiting code review), and a spec at `done` means "build-auto finished", not "story done" — the story is `done` only when `bmad-code-review` says so. Never copy one vocabulary into the other.

### Per-Story Smoke (Critical Gate)

After code review (HIGH/MED resolved) and before commit, the lead performs a per-story smoke — a direct exercise of the story's deliverable in its target runtime. Mandatory; only the method varies.

**Method by deliverable runtime:**

- UI / browser-deployed: drive the dev server (or a deployed build) via browser-automation MCP. Navigate, exercise, assert on DOM / render / console.
- CLI / library: invoke the new command or library entrypoint against a real runtime. Assert on stdout / stderr / return code / produced files.
- Service / API: real HTTP request against the local server (or staging). Assert on status code + response body + side-effect surface.
- Other: whatever exercise mirrors production use. Minimum: the lead invoked the new code path against a real runtime and observed expected outcomes via an out-of-band channel.

The smoke is not a substitute for automated tiers; it's the final check that the wired-up system end-to-end produces the user-observable outcome the story promises. It is also platform-bound: a suite that passes on the lead's machine is evidence about that machine, not about the CI runner or the deployment target (field case: a test that regex-scraped a nested runner's summary passed on Windows and failed on Ubuntu, where the runner colourised its output — unreproducible locally by construction). CI is the only gate that runs on the platform the project ships from; see "CI Is a Gate".

**Mechanics:**

1. After `cr_complete` (HIGH/MED resolved), determine the smoke method from the story's diff (`git diff --name-only <baseline_revision>..HEAD`) plus the spec's Tasks & Acceptance / I/O matrix.
2. Execute, capture evidence (screenshots, stdout, response body).
3. On failure: do NOT commit as-is. Either (a) surface to user, or (b) treat the failure as an unresolved HIGH finding and run one Rework Loop iteration (re-open the spec with the failure as a `[Smoke]` task, rework commit, implement re-spawn, code-review re-spawn) then re-smoke. Failed smoke is HIGH, never deferrable.
4. On success: log `<UTC> TAB Story <id> TAB smoke_complete TAB method=<browser|cli|api|other> result=pass iterations=<N> defects_caught=<N> evidence=<path-or-summary> model=<lead-model>`. `iterations` is 1 for first-run pass, bump on re-smoke. `defects_caught` = count of bugs the smoke caught that automated tiers passed.
5. Run the fresh-environment check below, then proceed to commit.

**Verification arrangement.** By default the plan marks each `## Verification` command `(loop)` or `(once)`: the implement stage runs the story's own tests (`(loop)`) on every verification pass and the full suite (`(once)`, in batches that fit the foreground cap) exactly once, after its last patch and before it finalizes; CI then runs everything on the platform the project ships from. Two project options, each recorded under Project-specific rules so the plan writes `## Verification` to match. **(a) CI-fresh tiers** — a test tier that CI runs on fresh instances, and that is resolved before the next implement spawn ("CI Is a Gate"), may be left to CI and dropped from `(once)`; the exemption lapses whenever CI is `none` or `unavailable`. **(b) Lead-owned full run** — a project whose implement stage runs on a tier lighter than Sonnet, or whose full suite takes several times the foreground cap, moves the `(once)` run up to the lead (the runner, in a parallel run): the lead runs it after code review and before this smoke, in capped foreground batches like any other agent — moving the run up does not lift the cap, and a runner that ends its turn has returned too (Rule 18 (5)) — and a red takes the failed-smoke path. The trade for (b): a regression outside the story's own tests surfaces one implement-and-review round later than it would in-stage; the gain: the long run is done by the longest-lived, strongest agent instead of the cheapest and shortest-lived one. (Field reports 2026-10-08 and 2026-10-10: inside one epic each story ran the full browser suite 4–9 times, about 12 minutes each; two Haiku handoffs backgrounded their sweeps despite explicit foreground instructions.)

**Fresh-environment check (Rule 19 — after the smoke, before the commit).** Run the story's added and changed tests on a fresh environment — rebuilt by the project's recipe if its rules record one (a throwaway database or instance, a fresh container), else a clean checkout — once in their normal order and once reversed. A red is a HIGH that takes the failed-smoke path. Log `<UTC> TAB Story <id> TAB fresh_check TAB env=<recipe|clean-checkout> tests=<n> result=<pass|fail> order=forward,reverse`. In a parallel run the runner uses its own throwaway, never another runner's (Rule 13).

### CI Is a Gate, Not an Assumption

Every quality gate in this pipeline runs the suite locally; none of them is the platform the project ships from. The CI run a push starts is therefore a first-class result, recorded write-ahead and resolved before the next irreversible step — never awaited per story (wall-clock), never assumed green.

**Pre-flight (once per run, on `runtime_gate`):** `ci=gh` when `.github/workflows/*.yml` exist, `gh auth status` succeeds, and `origin` is a GitHub remote; `ci=none` when the repo has no workflows; `ci=unavailable` when workflows exist but `gh` is missing/unauthenticated or the remote is not GitHub — surface `unavailable` once ("CI results cannot be read from this session; the merge gate will ask you to confirm CI by hand") rather than silently skipping.

**At `committed`:** after the push, `gh run list --branch {TICKET}-epic{N} --commit <sha> --json databaseId,status,conclusion -L 1` (retry a few times over ~30 s — the run registers shortly after the push); record `ci=pending run=<id>` (or `ci=success` if it already finished; `ci=none` / `ci=unavailable` per pre-flight). No waiting. Push the code commit on its own and confirm its run registered for that exact sha (match `headSha`) before any further push to the branch — a workflow with `concurrency: cancel-in-progress` cancels the run being waited on when a later push lands. Never put a CI-skip token in a code commit's message: a quoted `[skip ci]` skips the run all the same.

**Resolution points — each logs `ci_resolved story=<id> run=<id> result=<success|failure|cancelled>`:** (1) before the next story's implement spawn (Task Sequence per-story step 4) — the next story's plan, spec validation and spec gate proceed meanwhile, and a red reworks the previous story first while the new spec waits at `ready-for-dev` (field report 2026-10-10: waiting at the plan spawn idled the lead about 30 minutes per story); (2) at the burn-down gate; (3) at SC-4 / SC-4-P as the merge precondition (`ci_green_verified` on the branch head, or `merge_gate_blocked reason=ci_red`); (4) at resume (cross-stage integrity check 6). `gh run view <id> --json status,conclusion`; still `in_progress` → wait here, with jitter, up to the project's usual run time.

**On `failure` — classify first, then act; log `ci_red_classified run=<id> class=<story|flake|infra> test=<name|none>`.** `infra`: the run failed before any test ran (runner lost, image-pull or registry limit, network, provisioning) — retry it on a timer (about 10, 20, then 40 minutes) and never count it as rework; three infra reds in a row → surface to the user. `flake`: the failing test already has an open `flake:` ledger entry, or it fails and then passes on one unchanged rerun — rerun once, and file a `flake: <test>` ledger entry (or append an `occurrence=`) routed to the burn-down with priority; the same test red twice on the same head is `story`. `story`: anything else — the path that follows. (Field report 2026-10-10: five different flaky tests forced reruns in two days, and one merge needed five attempts — a flake, then three registry pull-limit failures in which no test ran.)

**On a `story` red:** if the failing job's first red commit is the story just committed → a HIGH finding against it, never deferrable, same path as a failed smoke: re-open the spec with `- [ ] [CI] <job>: <failure summary> — <link>` under Tasks & Acceptance, rework commit, implement re-spawn, code-review re-spawn, re-smoke, re-commit, new `ci=pending`. If the red predates the story (inherited) → surface to the user with the run link and the first red sha; do not start new work on a red branch. `cancelled` → re-check the latest run for the branch head before deciding.

**Runner mode (parallel kit):** identical inside the worktree; the completion contract carries `ci: <success|none|unavailable> run=<id>` for `head:`, and the orchestrator verifies it independently before the merge gate.

**Verified on origin, never inferred from an exit status.** `committed`, `ci_green_verified` and `epic_merged_to_feature` are written only after `git fetch` and `git merge-base --is-ancestor <sha> origin/<branch>` succeed for the pushed or merged sha, and — for a green — `gh run view <id> --json headSha,conclusion` names that exact head. (Field report 2026-10-10: a merge was reported but never pushed; an `&&` guard skipped the push silently.)

### Ledger Drain (Critical Gates — Rule 17)

The deferred-work ledger has as many drains as it has inflows, and every drain is a logged stage. The lead never opens `deferred-work.md`; every read is `LEDGER load|slice|show` and every write is `LEDGER new|append` (see the shorthand under Pre-flight; grammar and vocabulary in Rule 15).

**Epic start — `ledger_load` (before sprint planning).** `LEDGER load`. If the file exists but `total=0` while `grep -c "^### DW-"` is 0 and the file is non-empty, it is a legacy-grammar ledger — HALT and run the kit's Step-1 migration. Re-own every `owner:none` entry (`LEDGER slice none`; `append DW-n "owner=<story key in this epic|burndown> by=load note=…"`). **Repair every `UNKNOWN` owner** (`load` marks them; `LEDGER slice unknown` lists them): take the owner's `<epic>-<story>-` prefix and look it up in `SPRINT_PLAN status` / the tracker — exactly one key with that prefix → `append DW-n "owner=<that key> by=load note=retitle_repair"`; zero or several → HALT and surface (`ledger_owner_repaired repaired=N halted=N`). An entry on a key no gate will ever query is the silent failure this check exists for. Log `ledger_load total= open= routed= escalated= decision_pending= terminal= owner_unknown= burndown=<owner:burndown count>`; put the same line into the headless sprint-planning argument (`Ledger load: …`) so the readiness gate can weigh it, and size Story X.0 by it.

**Harvest — at `dev_complete`, born owned.** For each item in the spec's frontmatter `deferred:` list: `LEDGER slice all` + grep the summaries for the same root cause → `append DW-n "occurrence=<key>"`; otherwise `LEDGER new "<summary>" "<spec path>" <severity from the item, else med> <fix-risk assessed by the lead> <footprint> "<evidence, one line>" <status> <owner> harvest "<note>"` — in-story → `open owner=<this key>`; in-epic → `routed owner=<the story key that will touch it>`; out-of-footprint → `routed owner=burndown`. `dev_complete` records `deferred=<count harvested>`. **Every `routed owner=<story key>` written here, at `cr_complete`, or at adjudication also becomes a `- DW-n: <summary> (ledger; routed by <gate> <date>)` bullet under that story's acceptance criteria in `epics.md`** — the lead/runner owns its own epic's blocks (Rule 11), so this is immediate, in the same bookkeeping commit; a key in another epic is written by the sequential lead now or by the orchestrator post-merge. At most `routed_story_max` bullets per story (default 6; `routed_max:` in `_bmad/custom/ledger.yaml`) — the excess stays ledger-only and is counted. Log `ledger_routed_planned story=<key> entries=N excess=N by=<gate>`; the `epics.md` edit makes the planning artifacts newer than the epic context, so the pre-warm re-runs before the next plan spawn (Rule 17 (1b)).

**Per-story adjudication — `ledger_adjudicated` (after the last `cr_complete`, before smoke).** `LEDGER slice <this story key>`. For each entry, judge it against DELIVERED scope — `git diff --name-only <baseline_revision>..HEAD`, the tests, the spec's Verification — never against the story title:

| Finding | Trailer line |
| --- | --- |
| Covered by the delivered change | `status=resolved-by:<key> by=adjudication note=<commit/test evidence>` |
| Real, not covered, belongs to another story in this epic | `status=routed owner=<that key> by=adjudication note=<residual, restated>` |
| Real, not covered, belongs to no story yet | `status=routed owner=burndown by=adjudication note=<residual, restated>` |
| Real but decided not worth pursuing | `status=wontfix-accepted by=adjudication note=reopen_if=<observable probe>` |
| Spec-bound / no realistic failure / invalid or duplicate | `status=by-design` / `status=wontfix-theoretical` / `status=dropped` (+ note) |

`LEDGER slice <key>` must read empty before `smoke_complete`. Log `ledger_adjudicated owned=N resolved=N reowned=N terminal=N`. An entry the story was supposed to close but did not is a real defect: if it is LOW and a two-way door, fix it in the Fix Pack iteration; otherwise re-own it honestly — re-owning is not failure, silent carry-forward is.

**Burn-down gate — `ledger_burndown_complete|skipped` (after the last story's `committed`, before `epic_status_done`).** First resolve the last story's `ci=pending` (`ci_resolved resolved_at=burndown`; a red branch is handled per "CI Is a Gate" before the epic closes). Then enumerate `LEDGER slice burndown` plus `LEDGER slice <key>` for each of this epic's story keys (the latter should be empty after adjudication; anything there is a missed gate — adjudicate it now). If the union is empty → `ledger_burndown_skipped reason=empty`. Otherwise:

1. **Set aside what is not work.** Every `escalated` and `decision-pending` entry in the union goes to the decision sheet below (`to_decision_sheet=N`). The gate never re-owns, closes, or "decides" one of these — a burn-down story cannot ratify a tick rate or run a playtest, and a runner has no standing to make a product call.
2. Resolve or make terminal everything story-closable that can be closed on evidence now (same table as adjudication, `by=burndown`). A `burndown`-owned LOW is a Rule 15 miss: fix-pack-sized → into the chartered story; otherwise `wontfix-accepted reopen_if=`.
3. If the remainder exceeds `ledger_cap` (default 8; a project may set `cap:` in `_bmad/custom/ledger.yaml`) OR any remaining entry has two or more `occurrence=` lines, charter **Story `N.<M+1>` — "Epic N burn-down"** (M = the highest existing story number under Epic N, read from BOTH the `### Story N.M` headings in `epics.md` and the `N-M-*` keys in `sprint-status.yaml` — gaps are irrelevant and `N.0` counts, so the number always sorts last and never collides. There is no conventional number, and "the next unused number" is wrong because it can fill a gap below an existing story. If `epics.md` already holds an "Epic N burn-down" story — a resumed gate — reuse it and its key. Derive the sprint key from the number actually used): insert it under Epic N in `epics.md` with one acceptance bullet per entry (`DW-n: <summary>`), **at most `burndown_story_max` entries** (default 12; `story_max:` in `_bmad/custom/ledger.yaml`) chosen by priority — HIGH/MED severity, then `occurrence=` count, then lowest fix-risk — `SPRINT_PLAN generate`, re-run the pre-warm, bookkeeping commit, then run the full per-story pipeline on it (plan → validate → implement → AD gate → QA → CR → **its own `ledger_adjudicated`** → smoke → commit). Exactly one burn-down story per epic, of bounded size — the gate is bounded in both dimensions; a story that takes everything is either enormous or a relabelling in disguise.
4. Every entry still non-terminal after that — the **overflow**, counted `overflow=N` — gets `append DW-n "owner=<specific story key in the next epic> by=burndown note=<why it waits>"` **and a `DW-n:` acceptance bullet in that story's block** (Rule 17 (1b): the sequential lead writes it now; a runner leaves it to the orchestrator's post-merge step, which reads the ledger — no contract line needed). `burndown` is not a legal owner after this gate and `owner=none` never is. If no next-epic story can own it, it is `wontfix-accepted` with a probe or `decision-pending owner=<next X.0 key>` for the decision sheet — the only case where an X.0 key appears as owner, and only because it is a real, named story. The next epic's X.0 is a mandatory fix-or-close pass over the overflow (see "Retrospective Review & Story X.0").
5. Log `ledger_burndown_complete open_before=N resolved=N terminal=N chartered=N chartered_size=N overflow=N reowned=N to_decision_sheet=N open_after=N cap=N story_max=N filed_this_epic=N closed_this_epic=N drain_ratio=X.XX`, where `filed_this_epic` = `total` now − `total` at this epic's `ledger_load`, `closed_this_epic` = `terminal` now − `terminal` then, and `drain_ratio` = closed / filed (1.00 = the epic closed as much as it filed). Resume refuses `epic_status_done` without a `ledger_burndown_*` entry for the epic.

**Epic-close decision sheet — `decision_sheet_recorded` (at SC-4, before the merge question; Rule 17 (5)).** The one place a human sees the ledger, at a gate the human already attends. Build it from `LEDGER slice all` filtered to `escalated` and `decision-pending` (any owner), plus — orchestrator mode — the runner's `decisions_for_user:` contract lines. Present every entry in one sitting with its evidence digest (`LEDGER show DW-n`, never the file) and a **recommended disposition**, then write the human's answer as exactly one trailer line `by=merge_gate`:

| The user says | Trailer line |
| --- | --- |
| Fix it — in a named story | `status=routed owner=<story key> by=merge_gate note=<decision>` + a `DW-n:` acceptance bullet in that story's `epics.md` block (Rule 17 (1b); bounded by `routed_story_max`) |
| Not worth it | `status=wontfix-accepted by=merge_gate note=reopen_if=<probe>` |
| It is the design | `status=by-design by=merge_gate note=<why>` |
| A human will do this (`note=human=`) | Append it to `sprint-status.yaml` `action_items` with BMAD's own writer — `uv run --no-cache .claude/skills/bmad-retrospective/scripts/sprint_status.py update --file <impl>/sprint-status.yaml --epic <N> --add-action '[{"action":"<text> (DW-n)","owner":"user"}]'` (it appends `status: open` and a stable `id`; never hand-edit the YAML) — then `status=dropped by=merge_gate note=action_item:<id>`. The item now surfaces at every retrospective and X.0 gate until the user closes it. |
| Decide later | Not an option at this sheet for a product call — it becomes `decision-pending owner=<next X.0 key>` and is asked again at X.0, decided once there. |

A decision with architectural weight (Rule 20) is also written into the spine in the same commit — the trailer line cites the AD id; a `to_x0` deferral with architectural weight is mirrored into the spine's `## Deferred`. Sequential lead: write the lines in the epic-branch checkout and bookkeeping-commit before asking the merge question. Orchestrator: present the sheet before the merge question, write the lines in the MAIN checkout on the feature branch immediately after the merge (post-merge bookkeeping commit; `deferred-work.md` is union-merge so order is irrelevant). Log `decision_sheet_recorded decided=N to_action_items=N to_x0=N` (or `decision_sheet_skipped reason=empty`). The retrospective that follows receives the same counts.

**Retrospective input.** Pass `Ledger: open_before=… open_after=… chartered=… overflow=… drain_ratio=… decisions=…` in the `/bmad-retrospective` argument so the human-in-the-middle sees the drain, not just the inflow.

**Final epic of the range.** After its burn-down gate, `LEDGER slice all` is the range's residue: every entry must be terminal or owned by a named story key outside the range — surface the list at the SC-4 merge gate as the ledger sweep (it is the decision sheet plus the overflow).

### Epic Context Pre-warm (per epic, lead-driven)

`bmad-build-auto`'s epic-story path compiles `<implementation_artifacts>/epic-<N>-context.md` on first use — by spawning a subagent *before* its own clean-tree check, so the freshly written, untracked cache file would trip that check on the very first plan spawn of every epic (and again after any planning-artifact edit, which invalidates the cache). The lead therefore owns the compile:

1. Render the skill once: `uv run --no-cache _bmad/scripts/render_skill.py --project-root <abs-root> --skill <abs-root>/.claude/skills/bmad-build-auto`. It prints `read and follow <snapshot-dir>/workflow.md`; take `<snapshot-dir>`.
2. Spawn a synchronous Opus subagent (`general-purpose`, `model: opus`, `run_in_background: false` — Rule 18 (5)) whose prompt is: "Read fully and follow `<snapshot-dir>/compile-epic-context.md` for epic `<N>`. Working directory `<abs-root>` (Rule 13). Write only `<implementation_artifacts>/epic-<N>-context.md`."
3. Verify the file exists, is non-empty, and starts with `# Epic <N> Context:`; otherwise halt (`context compilation verification failed` — usually a missing or unparseable `epics.md`).
4. Bookkeeping commit; log `epic_context_compiled`.

Run it after sprint planning and the Story X.0 gate (both may edit planning artifacts) and again before any plan spawn whenever a file under `planning_artifacts` is newer than the cache (Rule 5 amendments, X.0 insertion, user edits). With a valid, committed cache the plan spawn reuses it and never recompiles.

### Retrospective Review & Story X.0 Creation (Critical Gate)

After sprint planning, before building the story list, review the previous epic's retrospective and create a cleanup story. Mandatory — closes the feedback loop between retrospectives and sprint planning.

1. Calculate previous epic number (N-1 if processing N).
2. Search for `_bmad-output/implementation-artifacts/epic-{N-1}-retro-*.md`. If multiple, latest by mtime; tie-break by lexicographic filename. Log which file was selected.
3. If a retrospective exists, extract: action items (status: completed / in-progress / not addressed), deferred review findings, preparation tasks for current epic.
4. Also take the ledger's non-terminal slice (`LEDGER slice all`, plus `LEDGER show DW-n` for any entry whose summary is not enough — never the whole file), and the `action_items:` block of `sprint-status.yaml` (`SPRINT_PLAN status` → `open_action_items`; v6.11 retrospectives append their action items there with `status: open`).
5. **Close every ledger item — this is a CLOSE, not a relabelling (Rule 17).** Each non-terminal entry gets exactly one trailer line, `by=x0`: **resolve** (`status=resolved-by:<story> note=<evidence>` — it was fixed since it was filed); **own** (`owner=<N>-0-… ` for items Story X.0 will do, or `owner=<a specific story key of THIS epic whose gate genuinely fails while the item stands>`); or **terminal** (`by-design` / `wontfix-theoretical` / `wontfix-accepted note=reopen_if=…` / `dropped`). Undecided `decision-pending` items (normally only those the previous epic's decision sheet deferred here as `owner=<this X.0 key>`) are batched to the user in one sitting and leave this step decided; human-owned items live in `action_items`, not the ledger. There is no "defer with rationale" and nothing may stay `owner=burndown` or `owner=none`. Default-INCLUDE in X.0 every entry that is (a) trivial + low fix-risk by now, or (b) has two or more `occurrence=` lines — excluding one requires written justification in its note (the burden flips to exclusion). Open action items are included unless the user explicitly defers them. If the previous epic's burn-down gate left more than `ledger_cap` entries owned by this epic's keys, X.0 is a mandatory fix-or-close pass over all of them.
6. Create Story X.0 in four steps (the tracker script rejects `--set` for any key not derived from the epic files, so the story must exist in `epics.md` first):
   - **6a:** Insert `### Story {N}.0: Epic {N-1} Deferred Cleanup` as the first story under Epic {N} in `epics.md`, in the same heading/format as the sibling stories, with a one-paragraph description and the included items as acceptance bullets (one per triaged item, naming its source). Re-run `SPRINT_PLAN generate` (no `--set`) so the key `{N}-0-epic-{N-1}-deferred-cleanup` appears as `backlog`; confirm it in `new_entries`.
   - **6b:** Re-run the epic-context pre-warm (the `epics.md` edit made the planning artifacts newer than `epic-{N}-context.md`); bookkeeping commit (epics.md + tracker + context + log).
   - **6c:** Spawn the normal **plan** stage with the story key + `Halt after planning.` — Story X.0 is now an ordinary epic story. Validate the spec as usual; append the full triage table under its `## Design Notes` (rows of `Item (DW-n where applicable) | Source (retro | ledger | action_items) | Disposition (resolved-by | own:<key> | terminal:<status>)`; header notes which Epic N-1 the triage covers + the date). Story X.0 closes its own owned entries at its `ledger_adjudicated` gate like any other story.
   - **6d:** `SPRINT_PLAN generate --set {N}-0-epic-{N-1}-deferred-cleanup=ready-for-dev`; bookkeeping commit. Under the parallel kit, the orchestrator treats an `epics.md` change whose only diff is an appended Story X.0 as hash-exempt (re-record `epics_md_hash` without a re-approval).
7. Skip Story X.0 ONLY if all three sources are empty. If the retro is missing but the ledger or action items have entries, do NOT skip — execute steps 5-6 from those sources. If nothing is skipped, the pre-warm in 6b doubles as the epic's initial pre-warm; if X.0 is skipped, run the pre-warm now.
8. Log `retro_review_complete source_retro=<path-or-empty> resolved=N owned=N terminal=N dropped=N load_before=N load_after=N cap=N` or `retro_review_skipped`. Closing a previous epic's action item (`sprint_status.py update --set-action-status`) happens only with the user's confirmation, at the next retrospective — never silently here.

### Source Control Branching (Critical Gates)

These fire at the very start of each epic, before sprint planning or story work. Apply uniformly to the parent repo and every submodule in `.gitmodules`. For multi-repo projects (separate child repos rather than git submodules), the user enumerates affected repos up-front; the rules apply to each.

**Precondition — clean working tree.** Before any branching rule, the lead runs `git status --short` against the parent repo and every submodule and halts on dirty state. Non-negotiable. (If the IDE file-sync toggle below applies, run this clean-tree check FIRST; the toggle is then applied only transiently around each branch-changing operation and restored immediately after, so between operations `.vscode/settings.json` is back at its original value and the tree is clean. Never stage the transiently-toggled file into any commit.)

#### IDE file-sync toggle (conditional — IRIS/ObjectScript projects only)

Some IRIS/ObjectScript projects run an IDE extension that bidirectionally syncs the workspace with a live IRIS server (the VSCode-ObjectScript extension with `objectscript.conn.active: true` in `.vscode/settings.json`). When a git operation that **changes branches** rapidly rewrites the working tree, that sync fights the operation — it pushes the new tree to the server, the server recompiles and re-formats, then pushes the formatted files back to disk — producing phantom drift (e.g. spurious whitespace-only diffs), compile cascades, or partially-applied state that has to be reverted before the next commit.

This subsection is self-contained — it does not depend on any project's CLAUDE.md or rules files.

**Applicability — detect once, up front (after the initial clean-tree check):**

1. If `.vscode/settings.json` does NOT exist, or has no `objectscript.conn` block, or `objectscript.conn.active` is not `true` → the extension isn't actively syncing (or this isn't an ObjectScript/IRIS project). **SKIP this toggle entirely; it never applies.** Non-ObjectScript projects are never affected.
2. Otherwise the toggle is in effect for this run: record the original value (almost always `true`) so each window can restore it. The sync stays ENABLED except inside the branch-operation windows defined below.

**Scope — wrap ONLY branch-changing operations; do NOT disable the sync for the whole epic.** Disable the sync immediately before, and restore it immediately after, each git operation (or contiguous group of operations) that moves HEAD and rewrites the working tree: `checkout`, `checkout -b`, `merge`, `pull` (when it advances HEAD), `rebase`, `reset --hard`, `cherry-pick`, `stash apply`/`pop`, `revert`, `submodule update`. Within `/epic-cycle` there are two such windows (plus any resume-time checkout):

- **Window A — epic-start branching (SC-1 + SC-2 + checkout):** wrap the feature-branch checkout/creation, the epic-branch creation, and the `git checkout {TICKET}-epic{N}`. Restore the moment the epic branch is checked out.
- **Window B — SC-4 end-of-epic merge:** wrap the `checkout <feature>` / `pull` / `merge --no-ff` / branch deletes (per affected repo, submodules-first). Restore the moment the merge + deletes complete.

Read-only git ops (`status`/`diff`/`log`) and `add`/`commit`/`push`/`fetch` do NOT change branches and are NOT wrapped. The per-story pipeline stays on `{TICKET}-epic{N}` and only commits/pushes, so it runs with the sync **enabled**, as normal. Between windows the sync is on and `.vscode/settings.json` sits at its original value — clean — so the clean-tree check and the per-story commits never see a toggle-induced modification.

To wrap a window: set `objectscript.conn.active: false` → perform the branch operation(s) → set it back to the recorded original value.

**Restoration is MANDATORY and is the #1 failure mode of this rule.** Each window's restore must run — on success, on halt, on failure, on merge conflict, or on user cancellation. Treat each window like a `try/finally`: the restore belongs on the always-runs path, never only after the success path. The transiently-toggled `.vscode/settings.json` must never be `git add`-ed into any commit; if a window overlaps a commit (the SC-4 merge commit), verify settings.json is not staged. If you discover a window's restore was missed, restore immediately and tell the user the workspace was left disconnected from IRIS and for roughly how long.

**Crash recovery.** If a prior run crashed mid-window, `.vscode/settings.json` may be left at `active: false`. On a fresh run, if detection finds `active: false` where a live connection is expected, surface it to the user before proceeding — it may be an orphaned toggle from a crash, or an intentional manual disconnect; only the user knows.

This toggle is purely an IRIS/ObjectScript convenience; it has no effect on, and must not be applied to, non-ObjectScript projects.

#### Rule SC-1 — Feature branch verification (epic-start)

The lead checks for a feature branch in every affected repo. Branch name follows the project's configured pattern (see "Tracker format flexibility" below); default is `feature/{TICKET}_{Description}`.

- **If the feature branch exists** (locally or fetch-discoverable on remote): check it out, verify it's up to date with its remote, continue.
- **If the feature branch does NOT exist:** STOP and ask the user:
  1. Should the feature branch be created?
  2. The exact `{TICKET}` (validated against the project's `ticket_format` regex).
  3. The exact `{Description}` (validated against `description_format`).
  4. Which root does it branch from? Default precedence: `origin/develop` → `origin/main` → `origin/master`. The lead surfaces candidates the repo actually has and asks the user to confirm.

  **Root freshness check (mandatory, per affected repo, BEFORE creating anything):** `git fetch origin`, then compare the chosen remote root against its local counterpart: `git rev-list --left-right --count origin/{root}...{root}`.
  - **Local ahead (0 behind / N ahead):** STOP. The local branch carries N commit(s) origin does not have — basing on `origin/{root}` will REMOVE from the working tree every tracked file those commits added (this has deleted a project's entire `.claude/` + `_bmad/` tooling mid-session). Show the commits (`git log --oneline origin/{root}..{root}`) and ask the user: (a) push local `{root}` to origin first, then base on `origin/{root}` (recommended); (b) base on local `{root}` instead; (c) base on `origin/{root}` anyway, explicitly acknowledging the listed content disappears from the working tree. Log `root_freshness_resolved` with the choice.
  - **Diverged (both counts nonzero):** HALT and surface both commit lists — the user reconciles the trunk before any branching (same doctrine as a resume INTEGRITY_ERROR; never pick a side silently).
  - **Equal, or local behind:** proceed with `origin/{root}` (the normal case).

  On user authorization: validate the resulting branch name, then `git fetch origin && git checkout -b <validated-name> <confirmed-root> && git push -u origin <validated-name>` per affected repo. Log `feature_branch_created`.

Merging the feature branch into `develop` / `main` is OUT of scope for `/epic-cycle` — that's a PR-review / code-owner workflow. `/epic-cycle` creates and merges INTO the feature branch only.

##### Tracker format flexibility (per-project configuration)

The default assumes a JIRA-style tracker. Real projects use JIRA, Linear, GitHub Issues, Azure DevOps, or no tracker at all. The lead reads the project's branch-naming config from the first of these locations to exist:

1. `_bmad/custom/branch-naming.yaml` (preferred)
2. A `## Branch naming` section in CLAUDE.md
3. The defaults below

**Config schema:**

```yaml
# _bmad/custom/branch-naming.yaml
feature_pattern: "feature/{TICKET}_{Description}"  # template with {TICKET} and {Description}
epic_pattern: "{TICKET}-epic{N}"  # template for epic branch; {TICKET} reused from SC-1, {N} is epic number
ticket_format: "^([A-Z]+-\\d+|SPIKE|EXPLORE|REFACTOR)$"  # regex; tracker IDs OR named exceptions
ticket_required: true   # if false, {TICKET} may be empty
description_format: "^[a-z][a-z0-9-]{2,60}$"  # kebab-case, 3-60 chars, starts with letter
separator: "_"          # between TICKET and Description in the feature template
```

**Defaults if no config:**

| Field | Default |
| --- | --- |
| `feature_pattern` | `feature/{TICKET}_{Description}` |
| `epic_pattern` | `{TICKET}-epic{N}` |
| `ticket_format` | `^[A-Z]+-\d+$` (JIRA/Linear-style) |
| `ticket_required` | `true` |
| `description_format` | `^[a-z][a-z0-9-]{2,60}$` |
| `separator` | `_` |

**Validation at the SC-1 user prompt:**

1. Ask user for `{TICKET}` and `{Description}`, showing an example derived from the configured pattern.
2. Validate each against the configured regex.
3. If invalid: surface the mismatch with the offending regex shown. Offer: (a) re-enter, (b) override and use as-is (logs a warning), (c) update the project config.
4. If valid: render the branch name and confirm before creating.

**Ticketless work.** The default `ticket_format` allows `SPIKE`, `EXPLORE`, `REFACTOR` as named exceptions (e.g., `feature/SPIKE_audio-latency-probe`). Projects can broaden or narrow this list.

**Branch-name safety (non-negotiable).** Refuse any branch name with spaces, shell metacharacters (`*`, `?`, `[`, `]`, `;`, `&`, `|`, `<`, `>`, `$`, `` ` ``, newline), or git-reserved sequences (`..`, `@{`, leading `-`, trailing `.`). These guards are independent of the project config.

#### Rule SC-2 — Epic branch verification (epic-start)

After the feature branch is in place, the lead checks for an epic branch in every affected repo. The branch name follows the project's configured `epic_pattern` (see "Tracker format flexibility" below); default is `{TICKET}-epic{N}` (e.g., `PROJ-1234-epic1`). The ticket prefix is required so that multiple projects committing to the same repository under different tickets do not collide on a shared `epic1` / `epic2` namespace.

`{TICKET}` is the same value validated and recorded by SC-1 for the feature branch — the lead reuses it; do not re-prompt.

- **If the epic branch exists** (local or remote): check it out, continue.
- **If the epic branch does NOT exist:** create deterministically off the feature branch — no user prompt; the name is derived from the epic number and the SC-1 ticket. `git checkout <feature> && git pull && git checkout -b {TICKET}-epic{N} && git push -u origin {TICKET}-epic{N}`. Log `epic_branch_created`.

**Resume semantics:** mid-epic resume should find `{TICKET}-epic{N}` already in place. If the lead is resuming with prior `committed` entries in the cycle log but `{TICKET}-epic{N}` is missing locally AND on remote, that is a workspace-integrity error — halt and surface. Do NOT silently re-create.

**Ticketless projects.** If the project's `ticket_required` is `false` and no ticket was supplied at SC-1, the default `epic_pattern` resolves to a leading-hyphen name (`-epic1`), which is git-invalid. Projects in this mode MUST override `epic_pattern` (e.g., to `epic{N}` for single-project repos, or to `{DESCRIPTION}-epic{N}` to derive the prefix from the feature branch description). The lead validates the resolved epic branch name against the same branch-name safety rules as SC-1 and halts on failure.

#### Rule SC-3 — Commits go ONLY to the epic branch

Every commit during the epic cycle lands on `{TICKET}-epic{N}` in the affected repo. The lead asserts `git branch --show-current == "{TICKET}-epic{N}"` immediately before every `git commit` and halts on mismatch. Applies to submodules (each submodule's HEAD must be on its own `{TICKET}-epic{N}` before the parent's `git add <submodule-path>`).

Push frequency: per story, to the epic branch's remote.

#### Rule SC-4 — End-of-epic merge gate (user decision point)

After the retrospective gate (whether opted in or not), the lead pauses:

> "Epic {N} is complete. Merge `{TICKET}-epic{N}` into the feature branch and delete the epic branch (local + remote) in every affected repo?"

**Precondition — the branch head's CI is green.** `gh run list --branch {TICKET}-epic{N} --commit $(git rev-parse HEAD) --json databaseId,status,conclusion -L 1` (or the equivalent for the project's CI): `success` (or `ci=none` for a project without CI) is required; `failure` → log `merge_gate_blocked reason=ci_red run=<id> job=<name>` and surface the failing job instead of the merge question — the branch is not mergeable while it is red, whatever the local suite says (field report 2026-08-30: a branch red for ~16 h passed two full story pipelines); `pending` → wait; `unavailable` → say so and ask the user to confirm CI by hand. Log `ci_green_verified run=<id> head=<sha>` on success.

Before asking, (1) surface the burn-down gate's result for this epic (`ledger_burndown_*` entry: what was resolved, made terminal, chartered into the burn-down story, the overflow re-owned to which next-epic keys, and the drain ratio), and (2) run the **epic-close decision sheet** (see "Ledger Drain"): every `escalated` and `decision-pending` entry, presented once with a recommended disposition, the user's answers written as `by=merge_gate` trailer lines and logged `decision_sheet_recorded` — the burn-down gate set these aside precisely because only the user can decide them. If this is the range's FINAL epic, follow the merge with the ledger sweep: `LEDGER slice all` — every remaining non-terminal entry must already be owned by a named story key outside the range; present the list with a recommended disposition for each — the end-of-project triage, sized for one sitting.

If **yes**, execute the merge — submodules-first, then the parent (mirrors per-story Submodule Commit Order to avoid broken pointers on the feature branch's remote). This is "Window B" for the IDE file-sync toggle: if that toggle applies, set `objectscript.conn.active: false` before the first `checkout` below and restore it immediately after the deletes complete (mandatory, `try/finally`; restore even if the merge conflicts and halts):

For each affected repo, ordered submodules-first:

1. `git checkout <feature>`
2. `git pull origin <feature>` (in case it moved while the epic was in flight)
3. `git merge --no-ff {TICKET}-epic{N} -m "Merge {TICKET}-epic{N}: <one-line summary>"` (preserves the epic branch's commit graph)
4. `git push origin <feature>`
5. `git branch -d {TICKET}-epic{N}` (refuses if not fully merged — the safety we want)
6. `git push origin --delete {TICKET}-epic{N}`

If submodules are involved, the parent's merge step (3) brings in submodule pointer updates that already exist on `{TICKET}-epic{N}` from per-story commits. Because the submodules' own feature branches were merged in the preceding pass, those pointers now resolve cleanly on the submodules' remotes. Verify with `git submodule status` before the final parent push.

If **no**, log `epic_merge_skipped reason=<short>` and leave `{TICKET}-epic{N}` intact.

#### Rule SC-5 — Epic re-open recreates the epic branch

If an epic is re-opened (e.g., the next epic's retrospective surfaces work that belongs on the prior epic, or the user explicitly reopens), the `{TICKET}-epic{N}` branch must be recreated.

- If the prior `{TICKET}-epic{N}` was merged and deleted: branch a new `{TICKET}-epic{N}` off the current feature-branch HEAD (picks up any interim feature-branch progress).
- If the prior `{TICKET}-epic{N}` was never merged and still exists: check it out as-is; do not branch a parallel `{TICKET}-epic{N}`.

Log `epic_branch_reopened reason=<short>`.

#### Rule SC-6 — NEVER commit directly to `main`, `master`, or `develop`

The lead refuses any commit (story, retrospective, hotfix, anything) when the current branch is `main`, `master`, or `develop` in any affected repo. Absolute defensive default. If the user explicitly directs a direct-to-trunk commit (emergency hotfix outside the epic cycle), that's OUT of scope — the user performs it manually.

Pairs naturally with remote branch protection on trunks.

#### Rule SC-7 — If unsure where to commit, STOP and ask

Branching state can drift across sessions. If the lead cannot confidently identify the right branch to commit to — multiple feature branches with similar names, missing epic branch mid-resume, ambiguous parent between `develop` and `main`, etc. — STOP and ask the user. Do not guess.

#### Rule SC-8 — Parallel epics on the same feature branch

Multiple `/epic-cycle` runs may execute concurrently against the same feature branch — typically when different agents drive Epic A and Epic B simultaneously.

**Per-agent isolation: one working tree per agent.** Git only allows one HEAD per working directory. Concurrent agents on different epic branches require either:

- `git worktree add <path> {TICKET}-epic{N}` (recommended) — separate worktrees share the same `.git` object store. Cleanup: `git worktree remove <path>` after the epic merges.
- Separate full clones (simpler but heavier).

A single working directory running two agents on different epic branches is not supported — it requires constant branch-switching that corrupts file state.

**Branch creation under parallelism.** Each agent runs Rule SC-2 independently. `{TICKET}-epic{N}` is created off the feature branch's current HEAD at the moment that agent starts. If Epic A started earlier and a hotfix or sibling-epic merge landed on feature in between, Epic B's `{TICKET}-epic{N}` branches off a newer feature HEAD. That's fine — the `--no-ff` merge at SC-4 handles three-way reconciliation.

**Per-story commits.** Independent branches, independent remotes — no race. Each agent's pre-commit branch assertion is per-agent and per-worktree.

**Merge serialization.** The `git push` to feature is a single-writer point on the remote, so SC-4 must serialize across agents:

- **Coordinated:** each SC-4 sequence starts with `git pull origin <feature>`. If Epic A already merged, Epic B's pull picks that up before its own merge runs. Standard three-way merge from there.
- **Near-simultaneous:** the user picks the order. The second agent re-pulls feature after the first lands.

**Conflict handling at merge time.** If `git merge --no-ff {TICKET}-epic{N}` produces conflicts (against another epic's already-merged work, a hotfix on feature, or any other drift since branching), the lead STOPs and surfaces to the user. Auto-resolution is forbidden — git's conflict heuristics can silently drop intentional changes. The user resolves in the working tree, then signals the lead to continue.

Submodules are independent under this rule too — each submodule's `{TICKET}-epic{N}` merges into its own feature branch sequentially; submodule conflicts require user resolution before the parent's submodule pointer is bumped.

**Out-of-scope coordination:** if two parallel epics' planning artifacts overlap (both stories' ACs touch the same files), that's a sprint-planning conflict the user resolves before parallel execution. Rule of thumb: if two epics' Files-to-Modify tables overlap by more than ~20%, run sequentially.

#### Sub-repository vs submodule terminology

"Submodule" = git submodule (registered in `.gitmodules`; `git -C <path>` operates on it as a child repo). "Sub-repository" = a non-submodule child repo under one umbrella (separate clones the umbrella project orchestrates). Rules SC-1 through SC-8 apply to both. If ambiguous, that's a SC-7 STOP-and-ask trigger.

### Resume Semantics (Critical)

`/epic-cycle` is designed to be resumable across interrupts, context exhaustion, explicit pauses, and clarification gates spanning days. A later session must pick up exactly where the prior one left off — no re-doing work, no skipping work.

#### Resume-mode detection (epic-start)

The lead determines mode before running SC-1 / SC-2:

1. Read `_bmad-output/implementation-artifacts/cycle-log-epic-{N}.md`.
2. Get this epic's story states from `sprint-status.yaml` via `SPRINT_PLAN status` (per-status counts, `recommendation.story_key`, `open_action_items`); run `SPRINT_PLAN validate` first if the file's integrity is in doubt. Also read each `spec-{N}-*.md` frontmatter `status` — it is `bmad-build-auto`'s own durable state and the tie-breaker when the log and the tracker disagree.
3. For each affected repo, check whether `{TICKET}-epic{N}` exists locally and on the remote.

| Cycle log | `{TICKET}-epic{N}` local | `{TICKET}-epic{N}` remote | Mode | Action |
| --- | --- | --- | --- | --- |
| Missing / empty | Missing | Missing | **FRESH** | Run SC-1, SC-2. Create branches. |
| Missing / empty | Exists | Exists | **AMBIGUOUS** | Halt; ask user whether to (a) adopt existing branch and start logging against it (existing commits accepted as-is), (b) start a new epic under different `N`, or (c) inspect manually. |
| Has entries | Exists | Exists | **RESUME** | Compute resume point from the log. |
| Has entries | Missing | Exists | **REMOTE_ONLY** | `git fetch && git checkout {TICKET}-epic{N}`; then RESUME. |
| Has entries | Exists | Missing | **LOCAL_ONLY** | Halt; ask user (remote deletion intentional?). |
| Has entries | Missing | Missing | **INTEGRITY_ERROR** | Halt loudly. Log claims work that branches no longer carry. |

Detection runs per affected repo. Different repos may legitimately be in different modes (parent RESUME, submodule FRESH).

#### Resume-point computation (within-epic)

For a repo in RESUME mode:

1. Bucket cycle-log entries by story ID; highest-stage entry per story is its resume anchor.
2. Earliest story whose anchor is not `committed` = resume point. Work resumes at the next pipeline stage after the anchor.
3. If a story has a `<stage>_clarification_requested` without that stage's subsequent success entry (`story_created` / `dev_complete` / `qa_complete` / `cr_complete`), the resume point is "answer the clarification + re-spawn" (re-dispatch protocol for build-auto stages). The lead surfaces the question before spawning.
4. **Reconcile with the spec's own state** (`bmad-build-auto` writes it durably; the log can lag by one crash): spec `ready-for-dev` + no `story_created` → the plan finished, the log entry was lost — write it, continue at validation. Spec `done` + `build_sha` (the commit touching the spec) reachable on the epic branch + no `dev_complete` → write the entry, harvest `deferred:`, continue at AD verifications; never re-spawn the implement stage over finished work. Spec `in-progress`/`in-review` + dirty tree is **ambiguous on its face**: it is what a dead build-auto leaves behind AND what a healthy, still-running one looks like (`in-review` is its mid-self-review state; a working agent's tree is dirty because it is working). Liveness is a property of sessions, not of files — a stage agent lives exactly as long as the session that spawned it — so branch on ownership: (i) **this lead is a fresh session with no orchestrator above it** → no stage of this pipeline can be alive; it died mid-run: surface the uncommitted diff to the user (keep and re-spawn per the re-dispatch protocol — its resume table continues from `in-progress` — or discard); never auto-clean. (ii) **Orchestrator mode** → the worktree belongs to a runner; the orchestrator NEVER diagnoses a worktree's in-flight state from artifacts. Check the open `stage_spawned` entry, then the runner's liveness (`ListAgents` — which reports process liveness only: sufficient for runner alive/dead, NOT for whether a stage agent has returned, since a resumed agent shows `running` after returning; Rule 18); if the runner is alive, ASK it whether that stage's `Agent` call has returned — it is the only party that knows — and let it act; only a runner that is confirmed dead (whose stage agents are therefore dead too) makes the artifact reading valid, and then the re-spawned runner performs this step, not the orchestrator. If liveness cannot be established either way, HALT and surface — an ambiguous liveness state is a workspace-integrity error, not a judgment call. A re-spawn onto a live stage puts two agents in one worktree (incident 2026-08-28: ~30 minutes of concurrent patching). Spec `blocked` → the clarification is still open.
5. `epic_context_compiled` present but `epic-{N}-context.md` missing or older than a planning artifact → re-run the pre-warm before the next plan spawn.

#### Cross-stage integrity checks (before resuming any stage)

1. **`committed sha=X` and `build_sha=Y` reachable on `{TICKET}-epic{N}`.** For every `committed` / `dev_complete` entry, verify `git merge-base --is-ancestor <sha> {TICKET}-epic{N}`. Failure = branch drift; halt.
2. **Local and remote `{TICKET}-epic{N}` HEADs match.** `git rev-parse {TICKET}-epic{N}` vs `git rev-parse origin/{TICKET}-epic{N}` (post-fetch). Diverged non-fast-forward = halt. Strictly ahead = log `resume_local_ahead`, push. Strictly behind = fetch + fast-forward.
3. **`sprint-status.yaml` agrees with cycle log and specs.** Story marked `done` in YAML with no `committed` entry (or vice versa), or `review` in YAML with a spec not at `done` = divergence; surface to user. Exemption: a story whose highest anchor is `cr_complete` with a Fix Pack or rework in flight legitimately reads `done` (code review wrote it) or `in-progress` before its `committed` entry exists — resume at the rework/smoke step, not as divergence. `SPRINT_PLAN validate` must report `valid: true`.
4. **Submodule pointer consistency.** If `{TICKET}-epic{N}` on the parent recorded a submodule pointer at commit S, the submodule's `{TICKET}-epic{N}` must contain S. Mismatch = INTEGRITY_ERROR.
5. **Clean tree before the first build-auto spawn** (Rule 16) — a dirty tree at resume is evidence (check 4 in resume-point computation), never something to silently commit or discard.
6. **No `committed` entry is left at `ci=pending`.** Resolve each one (`gh run view <id> --json status,conclusion`) and log `ci_resolved` before resuming any stage; a `failure` is handled per "CI Is a Gate" before new work starts.

#### Resume interactions with parallel epics (SC-8)

If Epic A is being resumed and Epic B merged to feature in the interim, Epic A's `{TICKET}-epic{N}` is unaffected — reconciliation happens at Epic A's eventual SC-4 merge. If Epic A's own `{TICKET}-epic{N}` was force-pushed by another contributor during the pause, Check 1 fails and the lead halts.

#### Resume across the Story X.0 / retro-review gate

- `retro_review_complete` or `retro_review_skipped` entry → already done, skip.
- No such entry → run the gate.
- Entry present but Story X.0 has no `story_created` → treat Story X.0 as the first incomplete story and resume there.

#### Resume across the end-of-epic gates

- Last story `committed` but no `ledger_burndown_*` entry → resume at the burn-down gate (Rule 17); never write `epic_status_done` without it. A story with `cr_complete` but no `ledger_adjudicated` resumes at adjudication, never at smoke.
- Log shows `epic_status_done` but no `epic_retro_*` entry → run the model-tier checkpoint first if no `model_tier_checkpoint` entry exists for this epic (every project; the evaluation is idempotent — re-running it is harmless); then resume at the retrospective question.
- `epic_retro_*` present but no `epic_merged_to_feature` / `epic_merge_skipped` → resume at SC-4: the decision sheet first if no `decision_sheet_*` entry exists for this epic (Rule 17 (5) — its trailer lines are idempotent to re-present; entries already `by=merge_gate` are shown as decided), then the merge question.
- Both gates are user decision points; re-asking after a long pause is correct behavior. A run interrupted mid-retrospective resumes by re-asking the retrospective question (the skill's own output artifacts show how far it got); never auto-complete a half-finished retro.

#### Resume across Sprint Planning

Sprint planning is idempotent — `sprint-status.yaml` is regenerated each run. Always re-run on resume; the skill is a no-op when the YAML is current. The cycle log is append-only, so the new `sprint_planning_complete` entry coexists with the prior one (highest-timestamp wins).

#### Workspace-integrity errors are NOT auto-recoverable

INTEGRITY_ERROR or any cross-stage-check failure must halt. Auto-recovery paths ("the branches must have been pruned; recreate them") lose work. Only the user knows whether missing state was intentional (cleanup) or accidental (mistake).

When halting on an integrity error, surface:

1. What the log says happened (story IDs, stages, recorded shas).
2. What the workspace shows (branches present/missing, HEAD shas).
3. The specific check that failed.
4. Options for the user (re-create from log, abandon log, inspect manually).

Never guess.

#### Resume vs starting a new epic

If the cycle log for epic N is missing but cycle log for epic N-1 exists and shows N-1 completed, that's a normal FRESH start for epic N. SC-1 / SC-2 create the new branch. The retro-review gate triages N-1's deferred items into Story N.0.

If cycle logs for both epic N and epic N+1 are present with entries, two epics are in flight (parallel per SC-8). Resume each independently in its own worktree.

### Sprint Planning Per Epic (Critical Gate)

Before processing any stories for an epic:

1. Execute `/bmad-sprint-planning` directly via the `Skill` tool, **headless** — the skill defines no flag for this; pass the words `headless, intent sprint-planning` as its argument (its `## Headless Mode` section keys off being "invoked headless"). In v6.11 the skill opens with the implementation-readiness gate (it absorbed `bmad-check-implementation-readiness`), then hands the mechanical work to `sprint_plan.py generate`.
2. Parse the JSON block it ends with: `{status, intent, gate, status_file, findings, warnings}`.
   - `gate: FAIL` or `status: blocked` (duplicate epic versions, unreconciled orphans, an unconfirmed fix) → STOP; surface `findings` and the saved `implementation-readiness.md` if written. The user resolves interactively.
   - `gate: CONCERNS` → surface the findings once, log them, continue.
   - `gate: PASS` → continue.
3. `sprint-status.yaml` is now current, all stories tracked, status mismatches caught; run `SPRINT_PLAN validate` as a belt-and-braces check.
4. Log `sprint_planning_complete gate=<PASS|CONCERNS>`. Bookkeeping commit if the tracker changed.

Re-runs are idempotent — the script's merge is preserve-never-downgrade.

### Retrospective Per Epic (User Decision Point — the human-in-the-middle exception)

The retrospective is the ONE deliberate human-in-the-middle exception to the autonomous loop. Its value is the human's judgment about what just happened — automating it defeats its purpose. Concretely: never spawn it as a subagent, never pre-answer its party-mode elicitation or WAIT points (Rule 9's pre-answer protocol explicitly exempts it), and never pass its `-H` / `--headless` flag.

After all stories in an epic complete:

1. Announce: "Epic X is complete. Run a retrospective before moving to the next epic? (yes/no)"
2. **Wait for the user's response.** If the user is away, the run simply pauses at this gate — resume semantics pick it back up later; do not time out into a default answer.
3. **Yes:** execute `/bmad-retrospective` directly via the `Skill` tool, fully interactive, passing the explicit epic number (its `sprint_status.py detect-epic --epic {N}` gate then lists unfinished stories; if the range ended early, the machine verdict `rejected` is expected and the human overrides). Never pass `-H`. Log `epic_retro_complete verdict=<accepted|accepted-with-open-items|rejected>` when it finishes (the skill itself marks `epic-{N}-retrospective: done` and appends its action items to `sprint-status.yaml`). Bookkeeping commit.
4. **No:** log `epic_retro_skipped reason=user_declined`; continue.

`AskUserQuestion` always elicits the human regardless of `bypassPermissions`. The lead executes the skill — do NOT spawn an agent for it (spawned subagents cannot reliably surface elicitation).

### Lead Validates the Story Spec (Critical Gate)

Story creation is the Opus **plan** spawn of `bmad-build-auto` (`<story-key> Halt after planning.`). The gate is what happens between that spawn and the implement spawn: the lead reads the spec it produced (`spec-<key>.md` — capture the path from the agent's `SPEC:` line and confirm by globbing `spec-<epic>-<story>-*.md`) and validates it before any code exists. This replaces the pre-6.11 "lead creates the story file" gate; the race-ahead concern is gone (build-auto never advances to another story), the validation is not.

**Integration AC validation.** Read the spec's Tasks & Acceptance, I/O & Edge-Case Matrix, and Design Notes: does this story introduce a service, module, or component that later stories will consume? Indicators: a new file under `services/` or `lib/`; a new exported class/factory/module; a `Consumed-by:` list; an AC describing a public surface other stories will call.

If yes — the story is service-introducing — it MUST EITHER (a) contain at least one Integration AC of the form "consumer X reads from this service and produces observable effect Y," OR (b) carry an explicit note under `## Design Notes` stating "No consumers in this story; the first consumer will be Story X.Y." (the Rule 1 escape clause for services with no consumers yet in the epic). If neither is present, pause for the user:

> "Story <id> introduces <service-name>. No Integration AC and no 'no consumers yet' declaration found. Choose: (a) re-plan — the lead adds the Integration-AC requirement inside the spec's `<intent-contract>` block, sets frontmatter `status: draft`, commits, and re-spawns the plan stage on the spec path with `Halt after planning.` (re-dispatch protocol — re-spawn on the spec path: a story-key re-spawn resumes a `draft` spec in place but creates `spec-<key>-2.md` at any other status); (b) name the future consumer story and add the 'No consumers in this story; the first consumer will be Story X.Y.' note to Design Notes (lead edit; commit); (c) proceed without (producer-consumer wire-up defects can ship green)."

**AD mapping.** Note which ACs are AD-constrained (Rule 6 — an `AD-n` in the spine binds this story's area) and which are AD-tooled (an AD commits to a tool stack for the verification — lead-executed later); confirm the spec's Design Notes name the governing `AD-n` ids — add them if the plan missed any (lead edit, non-frozen section). **Sections the template may have deleted:** the spec template tells the planner to remove `## Design Notes` and `## Verification` when trivial; if either is absent, the lead creates it now (empty heading + one line) so Rules 1/2/6/19 and QA's file-list rule have somewhere to write — log `sections_created=<csv|none>` on `spec_validated`.

**Spec sanity.** Frontmatter `status: ready-for-dev`; `## Auto Run Result` present; no `blocked`. A spec the READY-FOR-DEVELOPMENT standard rejected arrives as `blocked` / `spec failed ready-for-development standard` — clarification path, not a gate pass.

**Decision dependency.** `LEDGER slice all | grep decision-pending`: if the spec's Design Notes, Tasks, or I/O matrix cite one of those entries, or build on a value the ledger records as undecided (a rate, a threshold, a ratification), the story is about to be built on a question nobody has answered — an `intent gap` for the user NOW, not at the merge gate (field case 2026-08-29: a tick-rate ratification sat `decision-pending` for seven stories). Surface it with `LEDGER show DW-n`, record the answer as a trailer line (`by=spec_gate`) and in the spec's `## Spec Change Log`, and log `decision_dependency=<DW-n csv>` on `spec_validated`.

**Shared-runtime mutation.** Does any AC, I/O row, or `## Verification` command mutate system-level state on a runtime other stories or the lead also use — databases, namespaces, security objects, scheduled tasks, web applications, OS services, a shared dev server? If yes, the spec's `## Verification` must name a **throwaway environment** (a fresh container, a scratch namespace or database, a disposable instance) for its destructive checks, and every test-running party for this story (build-auto's handoff, QA, the review layers, the lead's smoke) runs stateful classes one at a time (Rule 18 (3)). A spec that names none: the lead adds the environment (lead edit, non-frozen section) or raises an `intent gap` if the project has nowhere disposable to run it. Log `mutates_shared_runtime=true|false` on `spec_validated`. (Field report 2026-09-11: an installer story verified against the one long-lived instance; a rework's concurrent test runs left it with a database mounted over a deleted directory and the story blocked on a human restart.)

**Ledger inbox (Rule 17 (1b)).** `LEDGER slice <key>` again: every entry the story owns must be either cited in Tasks & Acceptance / the I/O matrix or listed as `Declined DW-n: <reason>` under Design Notes. An entry the plan ignored → the lead adds it as a Tasks & Acceptance item (lead edit, non-frozen section) or, if the plan's intent genuinely excludes it, re-owns or closes it now (`by=spec_gate` — the lead has the authority and the vocabulary here; adjudication after `done` does not). A declined entry is dispositioned the same way in the same commit. Log `owned_ledger=<DW-n csv|none> addressed=N declined=N` on `spec_validated`.

If NOT service-introducing (refactor, doc-only, internal cleanup, defect-fix), proceed. Then: log `spec_validated service_introducing=<bool> integration_ac=<present|declared-none|user-waived> adr_constrained_acs=<csv-or-empty> decision_dependency=<csv-or-none> mutates_shared_runtime=<bool>`; `SPRINT_PLAN generate --set <key>=ready-for-dev`; bookkeeping commit (everything under `implementation-artifacts`). This workflow gate is the binding enforcement.

### Context Handoff Between Stages (Critical)

The **spec file path** is the canonical context anchor, passed forward to every downstream agent. File lists flow from git (build-auto commits its work) and from the closing-summary sections of the QA/CR returns.

1. Plan → lead: the spec path (from the `SPEC:` line; verified by glob).
2. Lead → Implement: the spec path only (build-auto loads the spec's `context:` docs itself).
3. Implement → QA: lead reads `baseline_revision` from the spec frontmatter (or `baseline_commit` if that is the key a newer build-auto writes — accept either), computes `git diff --name-only <baseline_revision>..HEAD`, passes spec path + that list to QA.
4. QA → Code reviewer: lead reads `## Tests Added` from QA, passes spec path + `baseline_revision` + the diff list + QA's tests.
5. Code reviewer → Commit: lead stages the union of QA's tests, the reviewer's patches, and bookkeeping files (build-auto's own work is already committed).

If a QA/CR return is missing closing sections, fall back to `git status --short` plus the diff list above.

### Lead Context Management (long-run hygiene)

The lead's context window is the scarcest resource in a multi-epic run. Fresh context per stage is the point of the subagent design — both Anthropic's long-horizon-agent guidance and BMAD's own docs ("run each skill in a fresh context window") converge on it. Lead-side rules:

- The cycle log + `sprint-status.yaml` + spec files are the durable state — treat them as external memory (write-ahead, then act). Never rely on conversation memory for a resume or gating decision.
- Do NOT pull stage diffs, full test output, or whole spec files into the lead's context; the completion contracts exist precisely so stage detail stays in the stage. The lead reads a spec only at gates that require it (spec validation, AD mapping, rework re-open, smoke planning) and otherwise reads only its frontmatter and `## Auto Run Result`.
- After a context compaction/summarization event, re-anchor before the next action: re-read the cycle-log tail, the sprint-status snapshot (`SPRINT_PLAN status`), the current spec path and its frontmatter `status`. The write-ahead rule guarantees that is sufficient to continue exactly where the run left off.
- Never load the rendered `bmad-build-auto` workflow into the lead's context — it runs inside the stage agent. The lead only ever reads spec frontmatter and the `## Auto Run Result` section.
- Never open `deferred-work.md`. A healthy ledger is small; an unhealthy one is megabytes, and either way `LEDGER load|slice|show` returns exactly the lines a gate needs.
- Budget: one story's pipeline should cost the lead only its gate-skill invocations, spawn prompts, returned closing summaries, and log writes.

### AD-Aware Execution (Required — the architecture spine)

The project's architecture decisions live in its spine — the `AD-n` blocks of `ARCHITECTURE-SPINE.md` (Rule 6), resolved once per epic and logged `spine_resolved`. ADs commit the project to specific tooling, methodology, and architectural patterns; an AC satisfied by the wrong tool stack is equivalent to a HIGH-severity defect. BMAD itself enforces none of this at build time (no Phase-4 skill reads the spine directly — it reaches `bmad-build-auto` only through the compiled epic context), so this gate and Rule 6 are the enforcement. The spine is also **written** by the pipeline: Rule 20 puts every decision with architectural weight into it at the moment it is made, so the next epic's plan stage sees it. A project with no spine (`spine_resolved path=none`) runs this section as `none_required` — and should get one from `bmad-architecture` before its next epic.

**Layer 1 — Lead-executed AD-tooling gate (between `dev_complete` and the QA spawn).**

After dev returns and before QA is spawned, the lead inspects the story's ACs for any that map to AD-committed agent-time tooling (visual verification, performance profiling, audits, etc.). For each matched AC, the lead drives the verification using its own tool inventory.

This gate exists because MCP tool inventories may not propagate reliably to spawned subagents. The lead always has the MCP servers at session level.

**Mechanics:**

1. Read the spec (path captured at `story_created`).
2. For each AC, consult the spine's ADs (Design Notes ids first, then any AD whose `Binds:` covers the area). If an AD's Rule commits to a specific tool stack for that AC, it's "AD-tooled."
3. Drive each AD-tooled AC verification using the relevant MCP / tool; record pass/fail + evidence paths. **Rule 19 applies to this gate most of all** — it is lead-executed and therefore trusted: for each AD-tooled AC name the mutation that would flip the result, apply it, observe the failure, revert, and confirm the tree is byte-identical (`git status --short` / `git diff --stat`). A `pass` with no named mutation is recorded `result=unverified`, not `pass` (field case: `pass_commands_empty` recorded against a value typed `readonly never[]`).
4. Append one cycle-log entry per story: `<UTC> TAB Story <id> TAB adr_verifications_complete TAB <metadata>` — including `mutations=<ac:what,…|none>`.
5. On failure, surface to user before spawning QA.
6. Pass results to code reviewer's spawn-prompt context.
7. If no AD-tooled ACs, emit `adr_verifications_complete result=none_required` and proceed. (The stage name keeps its historical `adr_` spelling — see Rule 6.)

**Layer 2 — the spine path in every spawn prompt.**

The lead resolves the spine once per epic (`spine_resolved`) and includes its path in every agent spawn prompt as factual context. Agents must consult the ADs for architectural and methodology decisions referenced in their ACs — the plan stage records the governing ids under `## Design Notes`; the code reviewer verifies implementations match each AD's Rule — violations are HIGH (Rule 6).

**Layer 3 — decisions flow back (Rule 20).** Clarification answers, Rule 5 amendments, and decision-sheet calls with architectural weight are written into the spine by the lead (light path: new/amended AD, Conventions or Stack row, `memlog.py append`, `lint_spine.py`, commit; a conflict with an existing AD → `bmad-architecture` Update intent, interactive). The pre-warm then recompiles the epic context, so the decision reaches the next plan spawn. Logged `spine_updated`.

## When to Pause

Within each agent, halt and surface a clarification via `## Clarification Needed` if ANY hold:

- Ambiguous ACs or requirements.
- Missing prerequisite — story references data/code/context not present.
- Multiple reasonable design options where user preference matters.
- Environment or dependency failure blocking the work.
- Proceeding would risk breaking a stated constraint (security, compliance, performance, correctness, an AD's Rule).

Do not guess; do not soldier on. A short pause beats a wrong implementation unwound later.

## Handling Clarifications

When an agent returns with `## Clarification Needed`:

1. Read the question from the returned message.
2. Surface it to the user with Story ID + context.
3. Wait for the user's answer.
4. Re-spawn the same stage's agent with the clarification baked in (prompt, or the spec's `## Design Notes` — committed first, Rule 16; an answer with architectural weight also goes into the spine, Rule 20). Never `SendMessage` the old agent (see Anti-Patterns).
5. Log `<stage>_clarification_requested` before re-spawn; the stage's normal success entry (`story_created` / `dev_complete` / `qa_complete` / `cr_complete`) closes it.

**Key distinction:** clarification-needed is not a completion — closing sections won't be present. Detect via the `## Clarification Needed` heading (QA/CR stages) or the spec's `status: blocked` (build-auto stages — see the blocking-condition table and re-dispatch protocol under "Clarification protocol").

## Submodule / Sub-Repository Commit Order (Critical, if Applicable)

Applies to projects with git submodules OR sub-repositories. Skip if neither applies.

When stories modify files in child-repo directories:

1. **Commit and push inside each affected child first.** For git submodules, this produces an updated submodule pointer the parent will reference.
2. **Then commit and push in the parent.** For submodules, stage both parent files AND the updated pointer (`git add <submodule-path>`). For sub-repositories, the parent references children only at workflow level; children should still be pushed first.

If the parent is pushed with a submodule pointer that doesn't exist on the submodule's remote, other developers get checkout failures. Always submodules-first.

After each story, run `git -C <child-path> status --short` for every affected child to detect changes.

## Completion Logging

At each story completion, write a brief log entry: story ID/name, files touched, key design decisions, issues auto-resolved vs requiring user input.

### Cycle Log Format (enables resume)

Per-stage log entries, append-only. File: `_bmad-output/implementation-artifacts/cycle-log-epic-{N}.md`.

**Format (TAB-separated, exactly four fields):**

```
<UTC-timestamp> TAB <Story <id> | Epic <N>> TAB <stage> TAB <metadata>
```

- Fields separated by a literal TAB (`\t`), not spaces.
- The **metadata** field is whitespace-separated `key=value` pairs. Multi-values comma-separated; no spaces or tabs inside values (percent-encode if needed). Keys are lowercase snake_case.
- **Every sha is read, never recalled.** A `sha=` / `head=` / `build_sha=` / `baseline_revision=` value — in a log entry, a `## Clarification Needed`, or a completion contract — is produced by `git rev-parse --short <ref>` at the moment of writing, never from earlier context (field case 2026-08-29: a clarification quoted a HEAD that did not exist in the repository). The party reading a quoted sha verifies it resolves (`git cat-file -e <sha>`) before acting on it and logs a mismatch as `report_error fault=<lead|stage|runner> field=<name> reported=<sha> actual=<sha>`.
- **Durable facts are verified on origin.** `committed`, `ci_green_verified` and `epic_merged_to_feature` are written only after `git fetch` and `git merge-base --is-ancestor <sha> origin/<branch>` succeed, and a green only when `gh run view <id> --json headSha,conclusion` names that exact head ("CI Is a Gate").
- **A CI-fix commit is logged under the story it fixes** (`committed … fix_for=<story-key>`), never under the story in flight — otherwise one story's cycle time absorbs another's fix (field report 2026-10-10: one story read 16.4 hours when it took 5.6).
- Two entry kinds (distinguished by field 2):
  - **Story-level:** `Story <id>` (most entries).
  - **Epic-level:** `Epic <N>` (branch lifecycle + the optional epic summary).

**Valid story-level stages, in order:** `stage_spawned` (write-ahead marker IMMEDIATELY before every stage `Agent` call — see below), `story_created` (plan spawn returned `ready-for-dev`), `spec_validated` (lead gate passed; `ready-for-dev` written), `dev_complete` (implement spawn returned `done`; `review` written), `adr_verifications_complete` (mandatory, between dev and qa; emits `result=none_required` if no AD-tooled ACs), `qa_complete`, `cr_complete`, `ledger_adjudicated` (mandatory, after the last cr and before smoke — Rule 17), `smoke_complete` (mandatory, between adjudication and commit), `fresh_check` (mandatory, after smoke — Rule 19; metadata `env=<recipe|clean-checkout> tests=<n> result=<pass|fail> order=forward,reverse`), `committed`, `story_cycle` (mandatory, right after `committed` — one line the telemetry reads instead of re-deriving it: `plan_to_commit_min=<n> implement_passes=<n> reviews=<n> rework=<n> first_ci=<success|story|flake|infra|pending|none> models=plan:<m>,implement:<m>,qa:<m>,cr:<m>`; `first_ci` is back-filled by a later `ci_resolved story=<id>` entry, never by editing this line). Also story-level, whenever they occur: `stage_api_error` (a stage `Agent` call ended on a harness error — metadata `stage= error=<rate_limit|overload|usage_limit|other> wait_min=<n>`; closed by the re-spawn's normal entry) and `ci_red_classified` (metadata `run=<id> class=<story|flake|infra> test=<name|none>`). Clarification events use `<stage>_clarification_requested` (`<stage>` ∈ `plan | dev | qa | cr`), closed by that stage's normal success entry on the re-spawn — `story_created` for `plan`, `dev_complete`, `qa_complete`, `cr_complete` — never by a literal `<stage>_complete` (there is no `plan_complete`). Optional: `bookkeeping_committed sha=<short>` after each Rule 16 commit (aids resume forensics; not required). Rework-loop entries (story-level, between `cr_complete` and the next `stage_spawned`): `rework_opened` — the lead re-opened the spec; metadata `cycle_iteration=N iteration=<k> trigger=<high|med_first_review|fix_pack|smoke|ci|cap_override> items=<csv of finding / DW ids> scope_baseline=<sha>`. `rework_cap_reached` — the third iteration did not converge; metadata `cycle_iteration=N rework_iterations_used=3 cap=3 outstanding=<csv> result=stop_and_surface`. `rework_cap_override` — the user authorized one more iteration; metadata `cap=3 used=3 authorized_by=user items=<finite csv> close=next_review_without_high` — an override without `items=` is not writable: ask for the list first (Rework Loop step 5).

**`stage_spawned` — the in-flight marker.** Written IMMEDIATELY BEFORE the `Agent` call for any pipeline stage, never after. Metadata: `stage=<plan|implement|qa|code-review> spawn_at=<UTC> model=<id> agent_name=<name passed on the Agent call> cycle_iteration=N`. Closed by that stage's success entry (`story_created` / `dev_complete` / `qa_complete` / `cr_complete`) or by a `<stage>_clarification_requested`; the success entry's `spawn_at=` repeats the marker's value. A `stage_spawned` with no closing entry is the ONLY durable evidence that a stage may still be in flight — resume MUST check for it before any re-dispatch, and (orchestrator mode) it names the runner-owned agent to ask about. The durable record is otherwise empty for exactly the window in which liveness matters; this entry fills it.

**Valid epic-level stages:**

- `feature_branch_created` — SC-1 created the feature branch. Metadata: `repos=<paths>` `ticket=<id>` `description=<desc>` `root=<origin/branch>`.
- `epic_branch_created` — SC-2 created `{TICKET}-epic{N}`. Metadata: `repos=<paths>` `from=<feature-sha>`.
- `epic_branch_checked_out` — Lead checked out `{TICKET}-epic{N}` (resume or after creation). Metadata: `repos=<paths>` `head=<sha>`.
- `epic_branch_reopened` — SC-5 recreated after a prior merge. Metadata: `reason=<short>` `from=<feature-sha>`.
- `lead_model_gate` — Pre-flight lead-tier check. Metadata: `model=<detected>` `action=proceed|user_accepted`.
- `runtime_gate` — Pre-flight BMAD/uv/CI check. Metadata: `bmad=<version>` `uv=<version>` `ci=<gh|none|unavailable>`. (All pre-flight entries are written to the cycle log of the FIRST epic in the requested range, as `Epic <N>`, before any other entry.)
- `launch_env` — Pre-flight read of the launch environment ("Permission Mode"). Metadata: `depth=<n|default>` `watchdog=<0|1>` `bash_max_ms=<n|default>`.
- `telemetry_gate` — Pre-flight scan for unapplied model-tier recommendations. Metadata: `pending=<N>` `action=applied|declined|none`.
- `protocol_violation` — Any layer observed a containment breach (Rule 18: subagent commit/push, orphan writer, interim return, `SendMessage` to a returned agent). Metadata: `stage=<name>` `depth=<N>` `agent=<name>` `violation=<short>` `consequence=<short>` `detected_by=<short>` `outcome=<short>`. Never omitted "because it was handled" — the record is the point.
- `root_freshness_resolved` — SC-1 root freshness check needed a user decision. Metadata: `repo=<path>` `root=<origin/branch>` `choice=push_local_first|base_on_local|base_on_origin_anyway`.
- `epic_context_compiled` — Lead-driven epic-context pre-warm wrote `epic-{N}-context.md`. Metadata: `sha=<bookkeeping-commit>` `reason=<initial|planning_artifact_newer|x0_inserted|nfr_amendment>` `model=<id>`.
- `spine_resolved` — The architecture spine the epic will read and write (Rule 6/20). Metadata: `path=<path|none> ads=<N> status=<final|draft|none>`.
- `spine_updated` — A decision with architectural weight was written into the spine (Rule 20). Metadata: `ad=<AD-n|conv|stack|deferred> reason=<clarification|rule5|decision_sheet> by=<lead|runner> story=<key|none> lint=ok`.
- `ledger_stray_bullets` — A reviewer wrote `## Deferred from:` bullets instead of ledger entries; the lead harvested them. Metadata: `harvested=N story=<key>`.
- `ledger_owner_repaired` — `ledger_load` found `UNKNOWN` owners and re-owned them by unique `<epic>-<story>-` prefix (Rule 17 (1)). Metadata: `repaired=N halted=N` (`halted` > 0 means an ambiguous key stopped the run).
- `ledger_routed_planned` — `DW-n:` acceptance bullets written into receiving stories' `epics.md` blocks (Rule 17 (1b)). Metadata: `story=<key> entries=N excess=N by=<harvest|cr|adjudication|burndown|merge_gate>`.
- `merge_gate_blocked` — SC-4 precondition failed. Metadata: `reason=<ci_red|…> run=<id> job=<name> head=<sha>`.
- `ci_green_verified` — The branch head's CI run is `success`, read independently by the lead/orchestrator. Metadata: `run=<id> head=<sha>`.
- `ledger_load` — Epic-start ledger measurement, before sprint planning (Rule 17). Metadata: `total=N open=N routed=N escalated=N decision_pending=N terminal=N burndown=N reowned_none=N`.
- `sprint_planning_complete` — Sprint planning done. Metadata: `gate=<PASS|CONCERNS>`.
- `ledger_burndown_complete` / `ledger_burndown_skipped` — End-of-epic burn-down gate (Rule 17), after the last `committed` and before `epic_status_done`. Metadata: `open_before=N resolved=N terminal=N chartered=N chartered_size=N overflow=N reowned=N to_decision_sheet=N open_after=N cap=N story_max=N filed_this_epic=N closed_this_epic=N drain_ratio=X.XX` for complete; `reason=empty` for skipped.
- `decision_sheet_recorded` / `decision_sheet_skipped` — Epic-close decision sheet at SC-4 (Rule 17 (5)): every `escalated` / `decision-pending` entry decided by the user in one sitting. Metadata: `decided=N to_action_items=N to_x0=N`; `reason=empty` for skipped.
- `report_error` — A quoted fact (sha, count, path) in a contract, clarification, or log entry did not match the repository. Metadata: `fault=<lead|stage|runner> field=<name> reported=<value> actual=<value> impact=<short>`.
- `retro_review_complete` / `retro_review_skipped` — Retro + Story X.0 gate done (start-of-epic CLOSE of the previous epic's retro artifacts, the ledger slice, and open action items). Metadata: `source_retro=<path-or-empty>` `resolved=<N>` `owned=<N>` `terminal=<N>` `dropped=<N>` `load_before=<N>` `load_after=<N>` `cap=<N>` for complete; `reason=<short>` for skipped.
- `epic_retro_complete` / `epic_retro_skipped` — End-of-epic retrospective gate (the fully interactive, human-in-the-middle run of `/bmad-retrospective` — distinct from `retro_review_*` above). Metadata: `reason=<short>` for skipped.
- `epic_status_done` — Lead set `epic-{N}: done` in sprint-status.yaml after the last story reached `done`. Metadata: `stories=<N>`.
- `model_tier_checkpoint` — End-of-epic tier evaluation, EVERY epic on every project. Metadata: `armed=true|false` (policy file present) `stack_risk=<uncommon|standard|none>` `review_tier=<full-opus|mixed>` `implement_model=<id>` `high_med_avg=<per-story>` `unresolved_high_med_avg=<per-story>` `metric=<unresolved|gross>` (`gross` only when some `cr_complete` in the epic predates 2026-09-11.1 and lacks the field) `rework_stories=<N>` `review_loop_thrash=<N>` `rework_lang_defects=<N>` `review_high=<N>` `review_med=<N>` `result=hold|recommend_escalate|offer_mixed|revert_required` `applied=true|false|user_declined`.
- `model_tier_changed` — model-overrides.yaml was updated (paired with a `history:` entry in the file). Metadata: `direction=escalate|de_escalate|revert` `scope=implement_qa|review` `stages=<csv>` `from=<tier>` `to=<tier>` `reason=<short>` `evidence=<percent-encoded summary of the triggering telemetry>` `approved_by=user|mandatory_rollback`. The *why* is non-optional: an entry without `reason=` and `evidence=` is a telemetry bug.
- `resume_local_ahead` — Resume check 2 found local ahead of remote; lead pushed. Metadata: `repo=<path>` `pushed_shas=<N>`.
- `epic_merge_skipped` — User declined SC-4 merge. Metadata: `reason=<short>`.
- `epic_merged_to_feature` — SC-4 merge completed. Metadata: `repos=<paths>` `feature_sha=<sha>` `merge_sha=<sha>` `submodules=<paths-or-empty>`.
- `epic_summary` (optional, once per epic after the last `committed`) — see Workflow Telemetry.

**Standardized telemetry (on every `*_complete` entry):**

- `spawn_at=<UTC>` — when the lead invoked `Agent` (omit on lead-driven stages).
- `model=<id>` — which model the agent ran (e.g., `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`). For spawned pipeline stages this is the model resolved per Agent Invocation Pattern step 1 (model-overrides.yaml, else frontmatter override, else the Model Strategy map) and passed on the `Agent` call. For lead-run gate stages, the lead's model. A run where every stage shows the lead's model is a signal that the `model` parameter was not passed on the spawns — `story_created` and `cr_complete` should show the Opus-tier id, `dev_complete` and `qa_complete` the Sonnet-tier id, unless a project re-pinned them.
- `cycle_iteration=N` — defaults to 1; increment on re-spawn after downstream rejection or clarification.

**Stage-specific telemetry (when available):**

- `story_created`: `path=<spec> build_status=ready-for-dev spec_tokens=N epic_context=<compiled|reused>`.
- `spec_validated`: `service_introducing=true|false integration_ac=<present|declared-none|user-waived> adr_constrained_acs=<AD-n csv-or-empty> decision_dependency=<DW-n csv|none> sections_created=<csv|none> owned_ledger=<DW-n csv|none> addressed=N declined=N mutates_shared_runtime=true|false`.
- `dev_complete`: `build_sha=<short> baseline_revision=<short> review_loop_iteration=N followup_review_recommended=true|false deferred=N loc_added=N loc_removed=N files=N nfr_tripwires=N adr_violations_surfaced=N` (`review_loop_iteration` and `followup_review_recommended` are read from the spec frontmatter; `deferred` is the count harvested into the ledger).
- `adr_verifications_complete`: `tool=<id> acs=<comma-separated-list> result=pass|fail|unverified|none_required evidence=<path-or-empty> mutations=<ac:what,…|none>` (`pass` requires a mutation per AC — Rule 19).
- `qa_complete`: `tests_added=N mutations_demonstrated=N first_run_failures=N clarifications=N closing_sections_present=true|false` (a persistent gap between `tests_added` and `mutations_demonstrated` is the visible signal of vacuous coverage).
- `committed`: also `amendments=<file:line csv|none>` — every Rule 5 apply-and-report amendment this story made to a planning artifact or root file, for post-hoc review.
- `cr_complete`: `resolved=N fixed_at_source=N by_design=N wontfix_theoretical=N routed=N escalated=N decision_pending=N deferred=N dismissed=N high=N med=N low=N rows=N unresolved_high_med=N clarifications=N closing_sections_present=true|false` — `high`/`med`/`low` are root-cause ENTRIES after the reviewer's step-03 grouping, copied from its `entries:` closing line; `rows` is the raw finding count the layers reported before grouping (volume, never a threshold input); `unresolved_high_med` is the high+med entries the reviewer left unresolved after its own patches — the model-tier checkpoint's escalation input (field report 2026-09-11: four layers filing one root cause as four rows roughly doubled the gross count the checkpoint read).
- `ledger_adjudicated`: `owned=N resolved=N reowned=N terminal=N` (`owned` = slice size before; `resolved+reowned+terminal` must equal it).
- `smoke_complete`: `method=<browser|cli|api|other> result=pass|fail iterations=N defects_caught=N evidence=<path>`.
- `committed`: `sha=<short-hash> submodules=<paths-or-empty> ci=<pending|success|failure|none|unavailable> run=<id|none>` (`pending` is resolved by a later `ci_resolved`; a `committed` without `ci=` is a pre-2026-08-30.2 entry).
- `ci_resolved`: `story=<id> run=<id> result=<success|failure|cancelled> resolved_at=<next_plan|burndown|merge_gate|resume>`.

**Cost telemetry (when available):** `input_tokens=N output_tokens=N cost_usd=X.XX` on any `*_complete` entry. Omit if not extractable.

**Example** (TABs shown as `→`; actual file uses literal tabs):

```
2026-05-18T13:55:02Z→Epic 1→feature_branch_created→repos=. ticket=PROJ-1234 description=initial-foundation root=origin/main
2026-05-18T13:55:10Z→Epic 1→epic_branch_created→repos=. from=a1b2c3d
2026-05-18T13:55:11Z→Epic 1→epic_branch_checked_out→repos=. head=a1b2c3d
2026-05-18T13:55:40Z→Epic 1→ledger_load→total=0 open=0 routed=0 escalated=0 decision_pending=0 terminal=0 burndown=0 reowned_none=0
2026-05-18T13:56:00Z→Epic 1→sprint_planning_complete→gate=PASS model=claude-opus-4-8
2026-05-18T13:56:30Z→Epic 1→retro_review_skipped→reason=no_retro_no_open_ledger_no_open_action_items
2026-05-18T13:57:10Z→Epic 1→epic_context_compiled→sha=b2c3d4e reason=initial model=claude-opus-4-8
2026-05-18T14:20:00Z→Story 1.5→stage_spawned→stage=plan spawn_at=2026-05-18T14:20:05Z model=claude-opus-4-8 agent_name=1-5-render-engine-plan-1 cycle_iteration=1
2026-05-18T14:23:11Z→Story 1.5→story_created→spawn_at=2026-05-18T14:20:05Z model=claude-opus-4-8 path=_bmad-output/implementation-artifacts/spec-1-5-render-engine.md build_status=ready-for-dev spec_tokens=1420 epic_context=compiled
2026-05-18T14:23:40Z→Story 1.5→spec_validated→service_introducing=true integration_ac=present adr_constrained_acs=ac5 model=claude-opus-4-8
2026-05-18T14:23:48Z→Story 1.5→stage_spawned→stage=implement spawn_at=2026-05-18T14:23:50Z model=claude-sonnet-5 agent_name=1-5-render-engine-implement-1 cycle_iteration=1
2026-05-18T14:24:02Z→Story 1.5→dev_complete→spawn_at=2026-05-18T14:23:50Z model=claude-sonnet-5 build_sha=9f8e7d6 baseline_revision=a1b2c3d review_loop_iteration=1 followup_review_recommended=false deferred=1 files=3 loc_added=412 cycle_iteration=1
2026-05-18T14:25:00Z→Story 1.5→adr_verifications_complete→tool=chrome_devtools_mcp acs=ac5 result=pass evidence=path/to/evidence/ model=claude-opus-4-8
2026-05-18T14:29:47Z→Story 1.5→qa_complete→spawn_at=2026-05-18T14:25:30Z model=claude-sonnet-5 tests=tests/render-engine.test.ts tests_added=14 closing_sections_present=true
2026-05-18T14:33:18Z→Story 1.5→cr_complete→spawn_at=2026-05-18T14:30:15Z model=claude-opus-4-8 resolved=2 deferred=0 high=1 med=1 low=0 closing_sections_present=true
2026-05-18T14:33:50Z→Story 1.5→ledger_adjudicated→owned=1 resolved=1 reowned=0 terminal=0 model=claude-opus-4-8
2026-05-18T14:34:00Z→Story 1.5→smoke_complete→method=browser result=pass iterations=1 defects_caught=0 evidence=path/to/screens/ model=claude-opus-4-8
2026-05-18T14:34:30Z→Story 1.5→committed→sha=abc1234 submodules=
2026-05-18T17:58:10Z→Epic 1→ledger_burndown_complete→open_before=3 resolved=1 terminal=1 chartered=0 reowned=1 open_after=1 cap=8
2026-05-18T17:58:40Z→Epic 1→epic_status_done→stories=6
2026-05-18T18:02:11Z→Epic 1→epic_merged_to_feature→repos=. feature_sha=def5678 merge_sha=fed8765 submodules=
```

**Parsing rule:** split each line on TAB into exactly 4 fields; split metadata on whitespace into `key=value` tokens; split each value on `,` for lists.

On restart, scan the cycle log for the highest-stage entry per story / epic to compute the resume point.

## Workflow Telemetry

The cycle log is the primary telemetry surface. Standardized metadata + stage-specific keys make per-stage cost, quality, and model attribution computable without extra instrumentation.

**What the metadata enables:**

- Per-stage duration by model — `entry.timestamp − entry.spawn_at` grouped by `entry.model`.
- Bug rate by upstream model — `cr_complete.high + cr_complete.med` (root-cause entries) per story, grouped by `dev_complete.model`; `cr_complete.unresolved_high_med` for what escaped both the implementer and the reviewer's own patch pass (the escalation signal); `cr_complete.rows` for raw review volume.
- Rework rate by model — count of `cycle_iteration > 1` entries grouped by model.
- Rework convergence — `rework_opened` per story (its `trigger=`), `rework_cap_reached` / `rework_cap_override` events, and `followup_review_recommended=true` on a rework's `dev_complete` (post-2026-09-11.1: a HIGH was patched in that pass).
- Test-pyramid leak rate — `smoke_complete.defects_caught > 0` events.
- NFR-tripwire surfacing rate — `dev_complete.nfr_tripwires` grouped by model.
- Closing-section reliability — `closing_sections_present=false` rate grouped by model.

**`epic_summary` entry (optional, once per epic after the last `committed`):**

```
<UTC> TAB Epic <N> TAB epic_summary TAB stories=N wall_clock_hours=X.X total_high=N total_med=N total_low=N total_smoke_defects=N rework_events=N opus_stage_count=N sonnet_stage_count=N haiku_stage_count=N input_tokens_total=N output_tokens_total=N cost_usd=X.XX
```

Derivable from per-stage entries; a convenience, not a source of truth.

## Anti-Patterns (Do NOT Use)

- **TeamCreate / SendMessage / TeamDelete / team_name / shutdown handshakes** — Inter-agent messaging is unreliable. Use plain `Agent` tool calls; the return value IS the completion signal.
- **`SendMessage`-resuming a pipeline stage agent** — a stage agent's `Agent` return value IS its completion signal. Resuming one afterwards leaves an agent that has "returned" yet is still running: unrepresentable in the cycle log (its `stage_spawned` was already closed), invisible to resume detection, and a de-facto background stage in violation of the synchronous-stage rule — the exact setup for two agents editing one worktree. When a stage HALTs for clarification, the ONLY sanctioned continuation is a fresh re-spawn per the re-dispatch protocol, with the answer written into the durable artifact (the spec), which is also what makes it resumable after a crash. The rule is universal (Rule 18): `SendMessage` to ANY agent whose `Agent` call has returned is forbidden at every depth and in every direction — lead→stage, runner→stage, orchestrator→stage, runner→runner, and a stage agent→its own internal subagent are examples, not the list. A returned agent is finished; spawn a fresh one. Orchestrator→runner is the sole sanctioned use (parallel kit). Beware upstream text that says "re-engage the subagent with a synchronous message" (`bmad-build-auto` step-04): on this harness that is exactly this anti-pattern — the implement block pre-answers it.
- **Propagating the working directory but not the prohibitions** — an internal subagent (build-auto's handoff, a review layer) that receives Rule 13's path and not the `🚫` git/CI prohibitions does what any capable agent does when it finishes work in a repo with no instruction to the contrary (incident 2026-08-28: commit + push + live deploy from depth 3). Every stage block propagates its prohibitions "in the same breath" as Rule 13, and the layer above verifies self-reports against `git`/`gh` rather than trusting them.
- **Diagnosing liveness from artifacts** — spec `in-progress`/`in-review` + dirty tree describes a live agent as well as a dead one. Liveness belongs to sessions: a fresh sequential lead owns no live stages; an orchestrator asks the runner. Re-spawning on the artifact reading alone puts two agents in one worktree (see Resume Semantics).
- **Returning early** — an interim or progress return while your own subagents are still working strands them as orphan writers that no party can stop (`TaskStop` is owner-scoped and the owner has returned). The same holds for a background test sweep and an armed `Monitor`: "the monitor is armed, I'm holding off" ends a subagent's turn, which IS its return, and the sweep dies or runs on unsupervised. A sweep too long for one foreground call (the cap is 10 minutes) is split into calls that each fit — never backgrounded to get around the cap. Every agent at every depth returns exactly once, when its work is complete; a HALT is a completion, an update is not (Rule 18 (2), (5)).
- **Trusting `ListAgents` for stage discipline** — it reports process liveness, not protocol state; a resumed agent shows `running` after it returned. Use it to tell whether a runner is alive or dead, never to conclude "one active stage agent, which is fine" (Rule 18).
- **TaskCreate / TaskList / TaskUpdate** — Subagents poll TaskList and grab tasks regardless of `blockedBy` or ownership. The task system isn't needed; ignore it.
- **Dispatching `bmad-build-auto` without an explicit anchor** — Without a story key (plan) or spec path (implement) the skill scans for intent, picks the wrong story, or halts `unclear intent`. Under batches or resume that silently plans the wrong story. Always pass the anchor; never let it "find the next story".
- **Using the interactive `bmad-build` as a pipeline stage** — Its checkpoints (`[A]/[E]`, `[S]/[K]`, resume list, push/PR offer) and its `open_spec` editor launch have no place in an unattended run. `bmad-build-auto` is the same workflow with those removed and a machine HALT contract.
- **Folder+id dispatch in sprint mode** — Passing a spec folder / `stories.yaml` to build-auto on an `epics.md` + `sprint-status.yaml` project halts `no epic spec found`. That dispatch mode is for `bmad-spec` projects.
- **Spawning `bmad-build-auto` on a dirty tree** — It halts before planning and again at finalize (Rule 16). Uncommitted cycle-log or tracker writes are the usual culprit: write-ahead → bookkeeping commit → spawn.
- **Disabling every build-auto review layer to save cost** — The skill halts `no active review layers`. Trim by `id` in `_bmad/custom/bmad-build-auto.toml` if telemetry justifies it; keep at least one.
- **Inline skill execution** — Agents interpreting skill logic instead of invoking via the `Skill` tool. Always specify `Skill` explicitly in prompts. For `bmad-build-auto` this also skips the `uv run render_skill.py` bootstrap — the agent then follows unrendered, placeholder-ridden workflow text.
- **Missing context handoff** — Not passing the spec path, `baseline_revision`, and the diff file list between stages; code reviewers can't review effectively.
- **Parent-before-submodule push** — Broken submodule pointers on the remote. Always submodules-first.
- **Normalizing known test failures** — Carrying forward "N pre-existing failures, unrelated" erodes baseline reliability. Fix or formally defer in `deferred-work.md` immediately.
- **Treating a local green as a CI green** — every gate runs the suite on the lead's machine; the run that matters runs on the platform the project ships from, and nobody reads it unless a gate does. Record the run at `committed`, resolve it before the next plan spawn, and never present the merge question on a red head (see "CI Is a Gate").
- **Routing to a key nobody validated** — `owner=<story key>` is a promise that a gate will enumerate the entry; a stale or mistyped key breaks the promise with no error and no count anomaly. `ledger.sh` refuses unknown owners; `ledger_load` repairs or halts on the ones that slipped through (Rule 17 (1)).
- **Routing without planning** — an entry that exists only as `owner=<key>` in the ledger reaches that story's pipeline at `ledger_adjudicated`, after the design is fixed and code review has passed, where the only honest moves are re-own or a Fix Pack. Routed means planned: an acceptance bullet in `epics.md` and the plan spawn's ledger inbox (Rule 17 (1b)).
- **Deferred findings only in spec files** — Without centralized tracking in `deferred-work.md`, deferred items are invisible to the drain (adjudication, burn-down, X.0).
- **Filing without draining** — Every gate writes to `deferred-work.md` and no stage closes an entry, so the pool is monotonic and its open count stops meaning anything (field report: 0 → 1,588 entries in 114 days, never shrinking). A rule that says "periodic burn-down" with no stage that executes it never runs. The drain is a stage with a log entry: `ledger_adjudicated` per story, `ledger_burndown_*` per epic, X.0 as a close (Rule 17).
- **Relabelling instead of closing** — "Defer with rationale", re-owning to "the next X.0", or leaving `owner=burndown` past the burn-down gate moves an entry without deciding it. Every disposition is `resolved-by`, a specific story key, or terminal.
- **`burndown` owning a LOW** — a LOW is fixed at emission (two-way door → patch / Fix Pack) or closed `wontfix-accepted` with a probe; routing it "to the story that will touch it" turns a 15-line fix into a story bullet nobody wants (field report 2026-08-29: 17 of 30 burn-down entries). "In-footprint" is the epic's footprint, not the story's.
- **Deciding a product call at the burn-down gate** — `escalated` and `decision-pending` entries are the user's; a lead or runner that re-owns, closes, or answers one there has decided for the user and hidden the decision in a trailer line. They go to the decision sheet at SC-4 (Rule 17 (5)); a runner lists them under `decisions_for_user:`.
- **Numbering the burn-down story `N.9`** — 9 was shorthand for "last" and is last only on an epic with eight or fewer stories; "the next unused number" can fill a gap below an existing story. The burn-down story is `N.<M+1>`, M the highest existing story number under Epic N across `epics.md` and `sprint-status.yaml`, reused if it already exists (Rule 17 (3)).
- **A burn-down story that takes everything** — one story with 30 bullets is either enormous or a relabelling in disguise. The charter is bounded by `burndown_story_max`; the overflow is re-owned explicitly and counted, and the drain ratio is logged so an under-sized drain is a number.
- **Recording a pass nobody could have failed** — a test or gate whose red has never been observed is not evidence (Rule 19): expected values forced by the type, subjects never constructed, two empty runs compared. Every AC's pinning test has a named, applied, reverted mutation; the lead's AD gate is the layer that most needs it because it is the layer everyone trusts.
- **Quoting a sha from memory** — every sha in a contract, clarification, or log entry is `git rev-parse`d at the moment of writing, and verified (`git cat-file -e`) by whoever acts on it.
- **Reading or hand-editing the ledger file** — Prose accretes (a field-reported 24 kB entry), owner clauses land on the wrong line, and a closed-family word in a body fools every count. `LEDGER` is the only reader and writer; effective state is the last trailer line.
- **Re-filing an adjudicated finding** — a `by-design`/`wontfix`/`routed` ledger entry re-reported as new work re-purchases triage every epic (pilot: one root cause written up four times). Rule 15: `LEDGER slice all` first; `append occurrence=` on the canonical entry.
- **Reading only from `epics.md`** — `sprint-status.yaml` may contain additional stories (cleanup, hotfixes). Build the story list from both sources.
- **Skipping retrospective review before epic start** — Without explicitly reading the previous retro and triaging deferred items, accumulation goes silent.
- **Parallelizing without verifying disjoint files** — Two agents writing the same file produce non-deterministic state and corrupt the commit.
- **Deferring AD-mandated agent-time verification without surfacing it** — "I can't do X from this environment" for work an AD's Rule commits to specific tooling. The lead executes AD-tooled verifications directly.
- **Treating AD violations as LOW deferrable findings** — AD violations are HIGH (Rule 6).
- **Keeping a decision registry BMAD does not read** — a `docs/adr/` folder, a rules file, a trailer line: none of them reach `bmad-build-auto`'s epic context. The spine's `AD-n` blocks are the registry; a decision with architectural weight goes there, at the moment it is made (Rule 20).
- **Hard-coding upstream prompt text in an override** — an id-keyed `[[workflow.review_layers]]` entry replaces the whole layer, so a pasted copy of last release's instruction silently pins a stale placeholder (`{diff_output}` → `{diff_file}` on BMAD `main`) or a rewritten brief. Derive from the installed `customize.toml` and apply the kit's transformations; Step 4 checks the placeholders.
- **Skipping the per-story smoke** — Test pyramid passing while the deployed product is broken is recurring. Failed smoke is HIGH, never deferrable.
- **Smoke executed by a spawned subagent** — Subagents may lack runtime tooling. Smoke is lead-side.
- **Service-introducing story without an Integration AC** — Producer + consumer ship green with wiring never built. Lead validates integration-AC presence at the spec-validation gate.
- **`on_complete` hooks in BMAD `.toml` customizations** — Verification gates belong in the workflow's spawn-prompt skeleton, not the `.toml`. Keeping both creates two sources of truth.
- **Blocking the pipeline waiting for a "completion message"** — The `Agent` tool returns once when the subagent's run ends. Read the returned message directly.
- **Committing directly to `main`, `master`, or `develop`** — Rule SC-6 forbids this absolutely. Every workflow commit lands on `{TICKET}-epic{N}`; trunks are reached only via the SC-4 merge gate + an out-of-band PR.
- **Creating the feature branch silently** — Rule SC-1 mandates STOPping and asking. Silent defaults produce `feature/undefined_undefined` on remotes.
- **Skipping Source Control gates on a "resume" assumption** — Mid-resume should find the branches in place. If missing, that's a workspace-integrity error per SC-2 — halt; don't silently re-create. Silent recreation orphans prior commits.
- **Forgetting submodules need their own `{TICKET}-epic{N}`** — SC-2 applies per repo. Each submodule has its own.
- **Running parallel epics in a single working directory** — Git allows one HEAD per working tree. Parallel agents use `git worktree add` or separate clones (SC-8).
- **Auto-resolving merge conflicts at SC-4** — Three-way-merge conflicts at end-of-epic must be surfaced to the user. Git's auto-resolution can silently drop intentional changes.
- **Spawning pipeline sub-agents without passing the resolved model** — Omitting the `model` parameter on the `Agent` call makes every stage inherit the lead's model instead of the pipeline's intent (dev/qa → `sonnet`, code-review → `opus` per the Model Strategy map, unless `_bmad/custom/model-overrides.yaml` or a skill's frontmatter re-pins it). Resolve per Agent Invocation Pattern step 1 and pass it on the spawn. Lead-run gate skills are the exception — they run inline on the lead's model by design.
- **Letting a skill's interactive checkpoint block the run** — `bmad-code-review` has four happy-path halts (context confirm, decision-needed resolution, patch menu, next-steps menu) plus a large-diff chunking offer; `bmad-qa-generate-e2e-tests` opens by asking what to test. Pre-answer every checkpoint in the spawn prompt (Rule 9); an un-pre-answered checkpoint is a Clarification, never a silent wait. (`bmad-build-auto` has none — its only exits are HALT statuses.)
- **Expecting `bmad-build-auto` to sync sprint-status.yaml** — It never does (only the interactive `bmad-build` syncs). The lead writes `ready-for-dev` / `in-progress` / `review` through `SPRINT_PLAN generate --set`; `bmad-code-review` writes `done`/`in-progress`; the lead writes `epic-{N}: done`. Any other status write path (hand edits, prose instructions to the stage agent) desyncs tracking (see Status Ownership).
- **Hand-parsing or hand-editing sprint-status.yaml** — `SPRINT_PLAN status` returns per-status counts and the next story machine-readably; `SPRINT_PLAN validate` checks integrity; `SPRINT_PLAN generate --set` is the only writer. `/bmad-sprint-status` is a deprecated shim whose `mode=data`/`mode=validate` no longer exist.
- **Reading build-auto's prose instead of the spec** — The spec frontmatter `status` and `## Auto Run Result` are the contract; an agent's summary can claim `done` while the spec says `blocked`. Re-read the spec from disk after every build-auto spawn.
- **Confusing spec status with story status** — Spec `done` = build-auto finished; story `done` = code review passed. Spec `in-review` ≠ sprint-status `review`. Never copy one vocabulary into the other.
- **Backgrounding pipeline subagents** — including by omission: on current Claude Code builds an `Agent` call without `run_in_background: false` IS a background call, whatever its prompt says about synchrony. A backgrounded subagent never hands control back in an unattended run and the pipeline stalls (the reason `bmad-build-auto` mandates synchronous subagent calls); one level down it returns an interim message while its handoff or test sweep runs on with no supervisor (Rule 18 (5)). Pass `run_in_background: false` on every stage spawn, require it in every spawn prompt, and keep tests and commands in the foreground; a parallel batch is N `Agent` calls in ONE message, which still resolve together.
- **Batching any pipeline stage in one working tree** — Two concurrent build-auto runs in one checkout see each other's uncommitted spec/context files or finalize commits and halt (dirty tree / `finalization left repository dirty`) or race on the index. Stories are strictly sequential within a checkout; concurrency is per-epic worktrees (parallel kit).
- **Letting the first plan spawn compile `epic-<N>-context.md`** — build-auto compiles it *before* its own clean-tree check and then halts on its own untracked output. The lead pre-warms and commits the cache (see Epic Context Pre-warm) after every planning-artifact change.
- **Re-dispatching on a `blocked` spec without resetting `status`** — build-auto routes by frontmatter status; a `blocked` spec always halts `blocked spec supplied`. Apply the answer, set `draft` (re-plan), `in-progress` (re-implement), or `in-review` after `git apply`-ing the saved patch of a review-stage intent gap, commit, re-spawn on the spec path — never on the story key (that resumes only a `draft` spec and creates `spec-<key>-2.md` for every other status).
- **Trusting `--set` never to downgrade** — `sprint_plan.py generate --set` is the script's repair path and writes unconditionally. Read the current value first.
- **Unbounded implement↔review rework** — Endless re-spawn ping-pong on unresolved findings is a signal the spec is wrong, not the code. Cap at 3 rework iterations, then surface to the user; a cap override needs a finite `items=` list and closes at the next review without HIGH (see Rework Loop). A re-review that finds no HIGH closes the story — MEDs alone never re-open a reworked story (Rule 15 exit condition).
- **Re-reviewing the whole story after every rework** — resetting `baseline_commit` to the original baseline makes each re-review re-read the entire story diff; fresh eyes on old code always find something tolerable, and under fix-now rules a tolerable finding is a rework spawn (field report 2026-09-11: round 3 re-read 7,247 lines, found 0 HIGH, and the story was re-opened anyway). After a rework the review is scoped to `<rework baseline>..HEAD`; the whole story was reviewed at round 1.
- **Batching test-runner calls in one message against a shared runtime** — tool calls in one message run concurrently; stateful test classes race on shared fixtures (an uninstall racing an install left a database mounted with no file behind it). One class or suite per call, wait, never re-submit on a client timeout — propagated to every depth (Rule 18 (3)); destructive verification belongs on a throwaway environment named at spec validation.
- **Manufacturing next round's findings from this round's fixes** — a rework that changes pinning tests without updating their `mutation:` lines hands the next review a fresh set of Rule 19 findings. Whoever changes a pinning test writes the line in the same pass; a stale line on a test that exists is a LOW the reviewer closes in-pass, never a rework trigger.
- **Skipping the `deferred:` harvest, or harvesting without an owner** — build-auto's deferred findings live only in spec frontmatter until the lead files them with `LEDGER new … <status> <owner> harvest`; unharvested items are invisible to the drain, and ownerless ones have no gate that will ever close them (Rules 15/17).
- **Automating the retrospective** — Spawning `/bmad-retrospective` as a subagent, pre-answering its elicitation or WAIT points, or passing its `-H` / `--headless` flag. The retrospective is the one deliberate human-in-the-middle gate in the loop; its output is only as good as the human answers it collects. (Distinct from the start-of-epic retro-REVIEW gate, which is lead-automated triage of the previous retro's written artifacts and needs no human.)
- **Mis-scoping or forgetting to restore the IDE file-sync toggle** — On IRIS/ObjectScript projects, disable `objectscript.conn.active` ONLY transiently around each branch-changing git operation (Window A: epic-start branching; Window B: SC-4 merge), and restore it immediately after each window. Do NOT leave the sync disabled for the whole epic — the per-story pipeline (commits/pushes, which don't change branches) must run with the sync ON. Each window's restore is mandatory `try/finally`-style: restore on success, halt, failure, merge conflict, or cancellation; an un-restored toggle leaves the workspace silently disconnected from IRIS (no error — just no sync). Never `git add` the transiently-toggled `.vscode/settings.json` into any commit.
- **Relying on a tool's default target** — a call that names no runtime target can be answered by a healthy, unrelated instance with the same namespace and credentials: plausible results, no error. Name the target on every call, make a tool that would fall back to a default fail instead, verify the target's identity rather than its health, and tear down only what your own session started (Rule 13).
- **Logging a merge or a green from an exit status** — an `&&` chain skips silently, and a run can belong to another head. Verify on origin (`git merge-base --is-ancestor`) and by `headSha` before writing `committed`, `ci_green_verified` or `epic_merged_to_feature` ("CI Is a Gate").
- **Treating every red CI run as the story's fault** — an infrastructure red (no test ran) gets a timed retry and never counts as rework; a known flake gets one rerun and a `flake:` ledger entry; only a `story` red re-opens the story ("CI Is a Gate").
- **Shell traps in snippets** — in zsh, `$SHA:refs/…` reads `:r` as a history modifier: write `"${SHA}:refs/…"`. A code commit whose message quotes a CI-skip token gets no CI run. `jobs -p` inside `$( … )` returns nothing: capture `$!` per job. macOS deletes `/tmp` files left untouched for three days: keep throwaway state elsewhere.
- **Basing a new branch on a stale remote root** — when the local trunk is ahead of `origin/<trunk>` (unpushed commits), `checkout -b ... origin/<trunk>` silently removes those commits' files from the working tree — up to and including the project's own `.claude/` + `_bmad/` tooling (pilot incident, 2026-07-10). SC-1's root freshness check is mandatory before creating any branch from a root ref.
