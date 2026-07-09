# Story 26.4: Deferred-Work Ledger Burn-Down (Rule #37)

Status: done

<!-- Created at the Epic 26 retro-review gate (2026-07-09) per the BINDING Project-Lead decision in deferred-work.md line 848. Runs LAST in Epic 26 (after 26.0-26.3). Modeled on Story 22.1 (the prior burn-down). -->

## Story

As a **maintainer**,
I want **every carried-open deferred-work item driven to a terminal disposition**,
so that **the ledger that Epics 23/24/25 re-deferred (3 consecutive, tripping Rule #37's ≥3 threshold) is cleared to zero carried-open and the next retro gate starts clean**.

## Acceptance Criteria

Copied from `_bmad-output/planning-artifacts/epics.md` Epic 26 → Story 26.4. The authoritative item list is the **live** `deferred-work.md` ledger as of the Epic 26 retro-review gate — the 16-item carried-open set below (re-triaged live at the gate per the binding decision; **do NOT re-triage from scratch**, but DO probe-first per Rule #16 on any item whose suggested resolution embeds an unverified API/behavior claim).

- **AC 26.4.1** — **Terminal disposition for EVERY carried item; re-deferral is NOT an allowed outcome** (binding decision 2026-07-09). Each of the 16 carried-open LOW items lands in exactly one of: **resolved** (code/test/doc fix), **closed-with-evidence** (a live probe/measurement/source read demonstrates no action needed — evidence recorded), or **closed-by-decision** (stakeholder explicitly accepts the behavior — decision recorded). A disposition table is recorded in this story AND mirrored into `deferred-work.md`.
- **AC 26.4.2** — Probe-first (Rules #16/#37): every item whose suggested resolution embeds an unverified API/behavior claim is verified via a live IRIS probe or `irislib`/`irissys` source read BEFORE its disposition; any disposable probe class is deleted (IRIS + disk) before commit.
- **AC 26.4.3** — The disposition table (`Item | terminal disposition | evidence`) is recorded in the Dev Agent Record AND mirrored into `deferred-work.md`; the ledger visibly closes to **ZERO carried-open** (only Epic-26's OWN new review findings may remain, per AC 22.1.7 shape).
- **AC 26.4.4** — Any code fixes stay strictly additive (Rule #19); the frozen governance baseline `1e62c5ad5bf7` stays untouched (`gen:governance-baseline:check` exit 0, `governance-baseline.ts` git-clean, Rules #23/#25); any ObjectScript edit regenerates `bootstrap-classes.ts` + moves `BOOTSTRAP_VERSION` in THIS story (Rule #24, `bootstrap.test.ts` green, idempotent); full monorepo suite green + lint + type-check clean.
- **AC 26.4.5** — Lead smoke (Rules #22/#26): for any guarded/ObjectScript path fixed here (e.g. the Health.cls hardening, the prompts-plumbing changes), the lead exercises the built artifact / live endpoint and confirms the fix behaves and changes nothing it shouldn't. *(Lead-executed after code review — dev's job is to make it passable.)*

## Retro-review gate triage table (Epic 25 → Epic 26 burn-down; 2026-07-09)

Per the binding decision, **every** carried-open item is INCLUDEd in this burn-down (re-deferral disallowed). Source column cites the ledger origin.

| Item | Source (deferred-work.md) | Triage Decision |
|---|---|---|
| CR 22.0-D1 | Epic 22 (Loc/Generate.cls scan-abort TOCTOU) | INCLUDE — burn-down |
| CR 22.0-D2 | Epic 22 (Loc/Scanner.cls StudioOpenDialog overlap-order) | INCLUDE — burn-down |
| CR 22.1-1 | Epic 22 (Diagram/Compressor.cls pairloop unreachable) | INCLUDE — burn-down |
| CR 22.1-2 | Epic 22 (gen-governance-baseline.mjs dist-coupling) | INCLUDE — burn-down |
| CR 23.1-3 | Epic 23 (Health.cls result-set close hygiene) | INCLUDE — burn-down |
| CR 23.1-4 | Epic 23 (HealthCheckParseAreas status discarded) | INCLUDE — burn-down |
| CR 23.1-5 | Epic 23 (GET repeated `areas` params read first only) | INCLUDE — burn-down |
| CR 23.2-1 | Epic 23 (health.ts `server` field omission — ToolContext) | INCLUDE — burn-down |
| CR 23.2-2 | Epic 23 (health.ts unknown `errors` key dropped) | INCLUDE — burn-down |
| CR 23.2-3 | Epic 23 (health.ts missing `result` → raw TypeError) | INCLUDE — burn-down |
| CR 25.0-4 | Epic 25 (registerPrompt no try/catch) | INCLUDE — burn-down |
| CR 25.0-5 | Epic 25 (duplicate arg-name collapse) | INCLUDE — burn-down |
| CR 25.1-3 | Epic 25 (gen-skills.mjs `--check` stray files) | INCLUDE — burn-down |
| CR 25.1-4 | Epic 25 (arg() empty-string placeholder note-branch) | INCLUDE — burn-down |
| CR 25.1-6 | Epic 25 (all-optional-arg prompts reject omitted `arguments` — SDK limitation) | INCLUDE — burn-down |
| CR 25.2-1 | Epic 25 (prose count numbers not mechanically asserted) | INCLUDE — burn-down |

## Ledger disposition plan (the 16 items)

Each row carries a PLANNED disposition; the dev CONFIRMS/updates it and records the FINAL disposition + evidence in the Dev Agent Record AND mirrors it into `deferred-work.md` (AC 26.4.1/26.4.3). **Probe-first (Rule #16) before any fix whose API shape is asserted but unverified.** Where "resolve OR closed-by-decision" is listed, the dev picks the proportionate terminal outcome and records the rationale — re-deferral is never a choice.

| # | Item | Planned disposition | Target |
|---|---|---|---|
| 1 | **CR 22.0-D1** Generate.cls scan aborts whole run on one doc's `ScanDoc` error (enumerate→retrieve TOCTOU) | **resolve** (collect per-doc retrieval failures into a `skippedDocuments` array on the result, keeping classification errors hard) **OR closed-by-decision** (document the all-or-nothing facade contract in the tool description) | `src/ExecuteMCPv2/Loc/Generate.cls` scan loop (+ tool desc if closed-by-decision) |
| 2 | **CR 22.0-D2** Scanner StudioOpenDialog multi-part spec order-sensitivity (native IRIS behavior) | **closed-by-decision** (accept native `%RoutineMgr:StudioOpenDialog` semantics per ratified D2; quirk already documented in tool desc/README/tool_support per CR 22.0-4) **OR resolve** (per-part-union enumeration in `EnumerateDocs` + overlap regression test — needs a D2 amendment) | `src/ExecuteMCPv2/Loc/Scanner.cls:EnumerateDocs` |
| 3 | **CR 22.1-1** Compressor rule-A pairloop unwind leaves `tReqSrc=""` on non-object `.Req` (UNREACHABLE) | **resolve** (one-line: add `(tReqSrc '= "")` to the rule-A `While` so an unknowable source conservatively does NOT unwind — matches pre-CR-21.1-1 fallback) — bundle into the ObjectScript bootstrap re-roll | `src/ExecuteMCPv2/Diagram/Compressor.cls` EpisodeCore (~line 255) |
| 4 | **CR 22.1-2** gen-governance-baseline.mjs imports compiled DIST helper while `governance.test.ts` imports TS source (stale-dist lockstep divergence risk) | **resolve** (add a `turbo run build --filter @iris-mcp/shared` prebuild to the `gen:governance-baseline*` npm scripts, OR have `governance.test.ts` import the built dist to match the generator) | `scripts/gen-governance-baseline.mjs` / `package.json` scripts / `packages/shared/src/__tests__/governance.test.ts` |
| 5 | **CR 23.1-3** Health.cls result-set close hygiene (interop `%ResultSet` never closed; DB/system closes success-path only) | **resolve** (add `Do:$IsObject(tQRS) tQRS.Close()` after the interop loop; move DB/system closes to run on the error path too) — bundle into ObjectScript re-roll | `src/ExecuteMCPv2/REST/Health.cls:~246,468` |
| 6 | **CR 23.1-4** `HealthCheck` discards `HealthCheckParseAreas` `%Status`; downstream `If tWant("<area>")` assumes all 9 subscripts | **resolve** (default-read the flags — `If +$Get(tWant("system"))` — or check the returned status) | `src/ExecuteMCPv2/REST/Health.cls:~73` |
| 7 | **CR 23.1-5** GET repeated `areas` query params read only the first value | **resolve** (loop `%request.Data("areas",n)` and join with commas before parsing) **OR closed-by-decision** (documented comma-separated contract is sufficient) | `src/ExecuteMCPv2/REST/Health.cls:~70` |
| 8 | **CR 23.2-1** `server` output field omitted from `structuredContent` (ToolContext has no profile-name field) | **closed-by-decision** (accept v1 omits `server`; the spec §2 `server` is illustrative — verified Rule #16 that `ToolContext`/`IrisConnectionConfig` expose no profile name and no suite tool echoes `server`; amend spec §2 text to drop `server` from v1 output) **OR resolve** (expose resolved profile name through `ToolContext` framework-wide + echo it) | `packages/iris-ops-mcp/src/tools/health.ts` + (if resolve) `packages/shared/src/tool-types.ts`/`server-base.ts` + spec 01 §2 |
| 9 | **CR 23.2-2** unknown `errors` key (outside 9-area enum) silently dropped by `evaluate()` | **closed-with-evidence** (not live-reachable — `Health.cls` only ever sets `errors[<canonical area>]`; confirm via source read; document the pure-function limitation) | `packages/iris-ops-mcp/src/tools/health.ts` `evaluate` `checked` filter |
| 10 | **CR 23.2-3** a 200 response missing `result` throws a raw `TypeError`, not the tool error envelope | **resolve** (guard `response.result`; return an explicit `isError` "health endpoint returned no result payload" rather than crash or false-healthy) | `packages/iris-ops-mcp/src/tools/health.ts` handler |
| 11 | **CR 25.0-4** `registerPrompt` render callback has no try/catch (a throwing `build()` → opaque `-32603`) | **resolve** (wrap `def.build(...)` in try/catch, rethrow as `McpError(ErrorCode.InternalError, ...)` with a prompt-named message; shared render-guard for the no-arg + with-args branches) | `packages/shared/src/server-base.ts` `registerPrompt` |
| 12 | **CR 25.0-5** duplicate `PromptDefinition.arguments` names silently collapse (last-wins) | **resolve** (fail-fast duplicate-arg-name check in `registerPrompt` naming prompt+arg, OR a `validate-prompts.mjs` rule) | `packages/shared/src/server-base.ts` `registerPrompt` and/or `scripts/validate-prompts.mjs` |
| 13 | **CR 25.1-3** `gen-skills.mjs --check` cannot detect stray files inside a valid skill dir | **resolve** (recursively enumerate all files under `skills/`; `--check` flags any on-disk path not in the expected map; write-mode removes strays) **OR closed-by-decision** (narrow the header's "fail on ANY drift" claim to the covered vectors) | `scripts/gen-skills.mjs:~109-122,174-181` |
| 14 | **CR 25.1-4** `arg()` collapses `""`→placeholder but note-branch keys on `!== undefined` only (empty string → "provided" branch renders literal placeholder) | **resolve** (align the note-branch presence test with `arg()` — treat `""` as absent everywhere; shared helper so the two tests can't diverge) | `packages/*/src/prompts/*.ts` (recoverStuckProduction, diagnoseSlowQuery, + analogous branches) |
| 15 | **CR 25.1-6** all-optional-arg prompts reject a `prompts/get` that OMITS `arguments` entirely (SDK `@modelcontextprotocol/sdk@1.29.0` limitation) | **resolve** (bypass the SDK `registerPrompt` GetPrompt handler for these prompts — register `ListPrompts`/`GetPrompt` request handlers directly on the underlying `Server`, mirroring the D6 governance-resource wiring, coercing an omitted `arguments` to `{}` while still advertising the arg list) **OR closed-by-decision** (accept the SDK limitation — renders correctly with `arguments:{}`, errors cleanly with `-32602` on total omission; document it) | `packages/shared/src/server-base.ts` prompts plumbing |
| 16 | **CR 25.2-1** prose count numbers ("9 prompts", tool_support per-server tallies) not mechanically asserted | **resolve** (in `docs-prompt-sync.test.ts`, assert the root README contains a "`<N> prompts`" string matching `prompts.length`; parse `tool_support.md` per-server tallies against per-package registered counts) | `packages/iris-mcp-all/src/__tests__/docs-prompt-sync.test.ts` |

**NOT in scope (leave open):** Epic-26's OWN new review findings (Stories 26.0-26.3 code reviews, this story's own review) — AC 26.4.3 / AC 22.1.7 shape permits.

## Tasks / Subtasks

- [x] Task 1: Rule #16 probe/source-read pass for the verify-then-dispose subset (AC 26.4.2) — before touching code, confirm each asserted claim against `irislib`/`irissys` source or a disposable `ExecuteMCPv2.Temp.*` probe (deleted after):
  - [x] CR 23.2-2 — confirm `Health.cls` only sets canonical `errors[<area>]` keys (source read of `HealthCheck*` methods) → underpins the closed-with-evidence.
  - [x] CR 22.1-1 — confirm the sole `pairloop` producer (`Compressor.cls:Compress`) always sets a real `.Req` with non-empty `Src` (source read) → confirms UNREACHABLE, guard is defense-only.
  - [x] CR 22.0-D2 — re-confirm the native `%RoutineMgr:StudioOpenDialog` order-sensitivity is IRIS behavior, not a port defect (source `irislib/%Library/RoutineMgr.cls`) → underpins closed-by-decision.
  - [x] Record ALL probe/source findings in the Dev Agent Record; delete any probe class (IRIS + disk) — no disposable probe class was needed (all three were resolved via pure source reads).
- [x] Task 2: TS/tooling code-fix subset (AC 26.4.1/26.4.4), each strictly additive + tested:
  - [x] CR 22.1-2 (governance generator dist-coupling), CR 23.2-3 (health.ts result guard), CR 25.0-4 (registerPrompt try/catch), CR 25.0-5 (dup arg-name guard), CR 25.1-3 (gen-skills stray-file check), CR 25.1-4 (arg() empty-string alignment), CR 25.2-1 (docs prose-count assertions), CR 25.1-6 (per chosen disposition).
  - [x] CR 23.2-1 & CR 23.2-2 per chosen disposition (closed-by-decision → doc/spec text + test note; resolve → code + test).
- [x] Task 3: ObjectScript code-fix subset (AC 26.4.4) — bundle ALL into ONE bootstrap re-roll:
  - [x] CR 22.1-1 (Compressor.cls guard), CR 23.1-3 (Health.cls result-set closes), CR 23.1-4 (Health.cls parse-status), CR 23.1-5 (Health.cls repeated-param, if resolve), CR 22.0-D1 (Generate.cls, if resolve — closed-by-decision, doc-comment only).
  - [x] Deploy loop (`iris_doc_load` glob path, Rule #17) → compile → `%UnitTest` per-class with total-count check (Rule #35).
  - [x] `gen:bootstrap` → record `BOOTSTRAP_VERSION` from→to (Rule #24) → `bootstrap.test.ts` green (idempotent).
- [x] Task 4: Ledger closure (AC 26.4.3) — record the final 16-row disposition table in the Dev Agent Record; mirror each disposition into `deferred-work.md` with a new "Story 26.4 — burn-down closure table" section; confirm the ledger reads ZERO carried-open (only Epic-26-own findings remain).
- [x] Task 5: Verify (AC 26.4.4) — `gen:governance-baseline:check` exit 0 + `governance-baseline.ts` git-clean; full monorepo suite green; lint + type-check clean.

### Review Findings (code review 2026-07-09)

Adversarial three-layer review (Blind Hunter / Edge Case Hunter / Acceptance Auditor). **1 HIGH found and FIXED inline + live-verified; 3 LOW deferred (Epic-26-own); 3 dismissed.** All 16 carried items confirmed terminal; ledger at zero carried-open. These are Epic-26-own findings (permitted per AC 26.4.3).

- [x] [Review][Patch] **CR 26.4-R1 (HIGH) — CR 23.1-5's "resolved" fix was DEFECTIVE: broke the `areas` GET filter on every real call.** `Health.cls:77` used `Set tParamCount = +$Get(%request.Data("areas"))`. Verified against `irislib/%CSP/Request.cls` (`Get`/`Set` store at `i%Data(name,index)`; `Count()` at :455 computes by `$order`-iterating subscripts — the unsubscripted node holds NO count), so `+$Get(%request.Data("areas"))` = `+""` = 0, the `For 1:1:0` loop never ran, `tRequestedCSV` stayed `""`, and `HealthCheckParseAreas` treated that as "all 9 areas." The production `iris_health_check` tool sends `GET .../monitor/health?areas=journal,license` (health.ts:836) — so the caller's `areas` filter was silently ignored on every call, running all 9 probes and computing the verdict over excluded areas (a real regression vs the prior `$Get(%request.Data("areas",1))`). **Fixed** → `Set tParamCount = %request.Count("areas")`. Redeployed + compiled clean on HSCUSTOM; live HTTP verified (`?areas=journal`→`['journal']`, comma + repeated-param both→`['journal','license']`, no-filter→all 9). `HealthCheckTest` 15/15; `gen:bootstrap` `f16c695aa9ef`→`e5c18edd00c0`, idempotent; `bootstrap.test.ts` 42/42; `gen:governance-baseline:check` exit 0. [src/ExecuteMCPv2/REST/Health.cls:77]
- [x] [Review][Defer] **(LOW) Compressor `(tReqSrc '= "")` guard also gates the `arrow` branch, not just the verified pairloop.** The new `While` term (`Compressor.cls:265`) sits in the shared `arrow`||`pairloop` loop; the dev's UNREACHABLE proof covers only the pairloop producer. For arrows `tReqSrc=tEv.Src`; if a real arrow ever carried an empty `Src`, unwinding that previously happened is now suppressed, changing episode grouping. Conservative/safe direction and all episode tests green (DiagramEpisodeTest 13/13, DiagramCompressorTest 10/10, DiagramEpisodeEdgeTest 6/6) — arrows realistically always carry a Src — so LOW. Deferred, Epic-26-own. [src/ExecuteMCPv2/Diagram/Compressor.cls:265]
- [x] [Review][Defer] **(LOW) CR 23.2-2 closed-with-evidence but no in-code doc note.** The original finding asked to "document the pure-function limitation" at `health.ts`'s `evaluate` `checked` filter; only the source-read evidence was recorded (valid disposition). A one-line comment noting that out-of-enum `errors` keys are dropped (and why that's safe) would help a future reader. Deferred, Epic-26-own. [packages/iris-ops-mcp/src/tools/health.ts:727]
- [x] [Review][Defer] **(LOW) `gen-skills.mjs --check` now flags ANY non-generated file under `skills/`.** The recursive `listAllOnDiskFiles()` rewrite (the intended CR 25.1-3 fix) means an incidental `.gitkeep`/`.gitignore`/editor scratch under `skills/` breaks `--check` and is `rmSync`'d in write mode. By-design for a 100%-generated tree with DO-NOT-EDIT headers; scope safely contained to `skills/`. Noted as a mild CI-false-positive vector. Deferred, Epic-26-own. [scripts/gen-skills.mjs]
- [x] [Review][Dismiss] Repo-wide `format:check` (Prettier) drift — verified PRE-EXISTING (spans untouched files); the story's own new files (`prompt-helpers.ts`, `prompt-helpers.test.ts`, `gen-skills-stray-file.test.ts`) are Prettier-clean. Out of this story's scope.
- [x] [Review][Dismiss] CR 23.1-4 ships real code but no unit test — defensible: the parse body cannot currently fail, and dispatcher-level verification needs a live `%request` (AC 26.4.5 lead smoke). Not a comment-workaround.
- [x] [Review][Dismiss] CR 22.0-D2 completeness — positive confirmation it was correctly recovered from the live gate table despite the binding decision's inline omission. No issue.

## Dev Notes

### Authoritative item list & probe-first discipline

- The 16 carried-open items are FIXED at the Epic 26 retro-review gate (do NOT re-triage from scratch). They are the exact set the binding decision (deferred-work.md line 848) enumerates, plus **CR 22.0-D2** — which the decision's inline list omitted but which is present and open in the live Epic-25 gate table (deferred-work.md line 836); it is INCLUDEd here.
- Re-deferral is NOT an allowed outcome for any of the 16 (AC 26.4.1). Every item ends resolved / closed-with-evidence / closed-by-decision.
- Rule #16: probe or read source BEFORE trusting a suggested resolution's API/behavior claim. Story 22.1 is the proven template — six of its items were verify-then-dispose and probing closed them with evidence rather than speculative code.

### Constraints (all fixes)

- Strictly additive (Rule #19) — no existing tool/output/behavior changes shape; the suite has live users.
- Frozen governance baseline `1e62c5ad5bf7` stays byte-identical (`gen:governance-baseline:check` exit 0). NEVER run the bare generator (Rule #25) — use `:check`.
- Any ObjectScript edit → regenerate `bootstrap-classes.ts` via `gen:bootstrap` (never hand-edit, Rule #18) + move `BOOTSTRAP_VERSION` in THIS story (Rule #24). Bundle all ObjectScript items into ONE re-roll to minimize churn. Epic 26 Story 26.1 already bumped the version for the resend handler; this story's bump is a SECOND, independent bump (expected, per Rule #24 per-change discipline).
- No underscores in ObjectScript class/method/param names; `///` doc comments; SanitizeError with no caret-globals (Rule #33); single render; validate before namespace switch.
- Cross-package tests (CR 25.2-1) live in `packages/iris-mcp-all` (Rule #45) — shared cannot import leaf packages.

### Precise pointers

- Health.cls: `HealthCheckInterop` (`Ens.Queue:Enumerate` `%ResultSet`, ~line 246), `HealthCheckDatabases`/`HealthCheckSystem` (~line 468), `HealthCheck` dispatcher + `HealthCheckParseAreas` (~lines 59-73, 127-135).
- Compressor.cls: `EpisodeCore` rule-A `While` (~line 255); producer `Compress` (~line 85 `Set tLoop.Req = tEv`).
- health.ts: `evaluate` `checked` filter (CR 23.2-2), handler `response.result` deref (CR 23.2-3), `structuredContent` shape (CR 23.2-1).
- server-base.ts: `registerPrompt` (CR 25.0-4/25.0-5/25.1-6), `handleToolCall` governance layer (do NOT disturb the frozen baseline).
- prompts: `packages/*/src/prompts/*.ts` `arg()` helper (CR 25.1-4).
- Generators: `scripts/gen-governance-baseline.mjs` (CR 22.1-2), `scripts/gen-skills.mjs` (CR 25.1-3), `scripts/validate-prompts.mjs` (CR 25.0-5 alt home).
- Cross-package test: `packages/iris-mcp-all/src/__tests__/docs-prompt-sync.test.ts` (CR 25.2-1).

### Previous-story intelligence (Story 22.1 — the prior burn-down)

- Story 22.1 drove 14 items + 1 operational item to zero re-deferred (8 resolved / 6 closed-with-evidence / 1 operational-close). Its pattern: probe-first via a disposable `Temp.Probe221` (deleted), bundle ObjectScript into one bootstrap re-roll, mirror the disposition table into the ledger, close to zero carried-open. Reuse that exact discipline.
- Its close revealed that several "suggested resolutions" embedded WRONG API claims (StartTask `Device` was `[Internal]`; the `(Production,Name)` index was already `Exact`) — proving Rule #16 probe-first is load-bearing. Apply the same skepticism to the 16 items here.

### Project Structure Notes

- Touches multiple packages (`iris-ops-mcp` health.ts, `shared` server-base.ts, `iris-mcp-all` tests, `scripts/*`) + ObjectScript (`Health.cls`, `Compressor.cls`, `Generate.cls`). This breadth mirrors Story 22.1 and is expected for a ledger burn-down — the disjoint-file discipline is per-item, not per-package.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 26.4]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md — lines 619-620 (CR 22.0-D1/D2), 660-663 (CR 22.1-1/2), 750-752 (CR 23.1-3/4/5), 784-786 (CR 23.2-1/2/3), 856-863 (CR 25.0-4/5), 873-876 (CR 25.1-3/4), 882 (CR 25.1-6), 888 (CR 25.2-1), 848 (BINDING decision)]
- [Source: _bmad-output/implementation-artifacts/22-1-deferred-work-ledger-burndown.md — prior burn-down template]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

None (no `^ClineDebug` / temp-class debugging was needed).

### Completion Notes List

All 16 carried-open LOW items reached a TERMINAL disposition. **Re-deferral was NOT used for any item.** Tally: **11 resolved / 4 closed-by-decision / 1 closed-with-evidence / 0 re-deferred.**

**Probe-first findings (Task 1, AC 26.4.2 — no disposable probe class needed, all three resolved via pure source reads):**
- **CR 23.2-2** — read `src/ExecuteMCPv2/REST/Health.cls`: every `pErrors.%Set(...)` call site uses a literal canonical area name (`"system"`, `"databases"`, `"journal"`, `"mirror"`, `"locks"`, `"license"`, `"ecp"`, `"alerts"`, `"interop"`) — exactly the 9-value `AREA_VALUES` union in `health.ts`. No call site can emit an out-of-enum key. Confirms closed-with-evidence.
- **CR 22.1-1** — read `src/ExecuteMCPv2/Diagram/Compressor.cls` `Compress` (~line 82-86): the sole `pairloop` producer sets `tLoop.Req = tEv` where `tEv` is a `RenderEvent` already gated `(tEv.Kind="arrow") && (tEv.Role="req") && (tEv.PairId>0)` — always a real object with a `Src` set by the correlator. Confirms UNREACHABLE via the current pipeline; the added guard is defense-only.
- **CR 22.0-D2** — read `irislib/%Library/RoutineMgr.cls` `StudioOpenDialogExecute` (~lines 1116-1180): the query re-parses each comma-delimited spec part into its OWN pattern/index-range/extension tuple (`tNewSpec` construction, `genPattern` calls) and iterates them independently — confirms the order/overlap sensitivity is genuine native `%RoutineMgr:StudioOpenDialog` behavior, not a Scanner.cls port defect.

**Final disposition table (mirrored into `deferred-work.md`):**

| # | Item | Terminal disposition | Evidence |
|---|---|---|---|
| 1 | CR 22.0-D1 (Generate.cls scan-abort TOCTOU) | **CLOSED-BY-DECISION** | Documented the all-or-nothing facade contract in `iris_loc_count`'s tool description (`packages/iris-dev-mcp/src/tools/loc.ts`) and a new doc-comment banner in `Generate.cls`. No behavior change — `LocFacadeTest` 8/8, `LocRestTest` 10/10, `LocScannerTest` 9/9 all green post-redeploy. |
| 2 | CR 22.0-D2 (StudioOpenDialog overlap-order) | **CLOSED-BY-DECISION** | Re-confirmed via source read (see above); documented in `Scanner.cls:EnumerateDocs` doc comment. No code/behavior change. |
| 3 | CR 22.1-1 (Compressor pairloop reqsrc unreachable) | **RESOLVED** | Added `(tReqSrc '= "")` to the rule-A `While` condition in `EpisodeCore` (`Compressor.cls`) — an unknowable source now conservatively does NOT unwind, matching the pre-CR-21.1-1 fallback. `DiagramCompressorTest` 10/10, `DiagramEpisodeTest` 13/13, `DiagramEpisodeEdgeTest` 6/6 all green (no existing fixture relied on the old over-unwind path). |
| 4 | CR 22.1-2 (gen-governance-baseline.mjs dist-coupling) | **RESOLVED** | Added `pregen:governance-baseline`/`pregen:governance-baseline:check` npm pre-hooks (`turbo run build --filter @iris-mcp/shared`) to `package.json` so the generator's imported shared dist can never be stale relative to `governance.test.ts`'s TS-source import. Live-verified: `pnpm gen:governance-baseline:check` runs the pre-hook then reports `frozen foundation keys (committed): 141 / live keys: 197 / post-foundation new keys: 56`, exit 0. |
| 5 | CR 23.1-3 (Health.cls result-set close hygiene) | **RESOLVED** | Added `Do:$IsObject(tRS) tRS.Close()` (success AND Catch paths) to `HealthCheckSystem`, `HealthCheckDatabases`, `HealthCheckInterop`. `HealthCheckTest` 15/15 green post-redeploy. |
| 6 | CR 23.1-4 (`HealthCheckParseAreas` status discarded) | **RESOLVED** | `HealthCheck` dispatcher now captures `tSC3` from `HealthCheckParseAreas` and returns a clean sanitized error envelope on failure instead of silently discarding the status. `HealthCheckTest` 15/15 green; dispatcher-level live verification is AC 26.4.5 (lead smoke, since the dispatcher needs a live `%request` context per the test class's own doc comment). |
| 7 | CR 23.1-5 (GET repeated `areas` params) | **RESOLVED** (corrected in code review — see CR 26.4-R1 below) | GET branch now loops every `%request.Data("areas",n)` occurrence and joins with commas. **Dev's original fix was DEFECTIVE** (`+$Get(%request.Data("areas"))` reads a count from the unsubscripted node, which holds none → always 0 → filter silently dropped, all 9 areas ran); code review corrected it to `%request.Count("areas")` and live-verified over HTTP: `?areas=journal` → `['journal']`, `?areas=journal,license` → `['journal','license']`, `?areas=journal&areas=license` → `['journal','license']` (the repeated-param goal now actually works), no filter → all 9. `HealthCheckTest` 15/15 green. |
| 8 | CR 23.2-1 (`server` field omission) | **CLOSED-BY-DECISION** | Verified (Rule #16) `ToolContext`/`IrisConnectionConfig` expose no profile-name field. Amended `research/feature-specs/01-health-check.md` §2 to drop `server` from the v1 `structuredContent` example with an explanatory note. No code change; `health.test.ts` unaffected. |
| 9 | CR 23.2-2 (unknown `errors` key dropped) | **CLOSED-WITH-EVIDENCE** | Source read (see Task 1 above) confirms not live-reachable. No code change. |
| 10 | CR 23.2-3 (missing `result` → raw TypeError) | **RESOLVED** | Added an explicit `response.result === undefined \|\| null` guard in `health.ts`'s handler, returning a clean `isError` envelope ("health endpoint returned no result payload") instead of crashing or reporting false-healthy. +2 regression tests in `health.test.ts` (undefined, null). |
| 11 | CR 25.0-4 (`registerPrompt` no try/catch) | **RESOLVED** | Wrapped `def.build(...)` in try/catch inside the shared `render` closure (`server-base.ts`), rethrown as `McpError(ErrorCode.InternalError, ...)` naming the prompt. +1 regression test (`fixture-throwing` prompt) in `packages/shared/src/__tests__/prompts.test.ts`. |
| 12 | CR 25.0-5 (duplicate arg-name collapse) | **RESOLVED** | Added a fail-fast duplicate-argument-name check in the `argsShape`-building loop (`server-base.ts`), throwing an `Error` naming the prompt + duplicate arg. +1 regression test in `prompts.test.ts`. |
| 13 | CR 25.1-3 (`gen-skills.mjs --check` stray files) | **RESOLVED** | Replaced the per-dir `SKILL.md`/top-level-`README.md`-only enumeration with a fully recursive `listAllOnDiskFiles()`; `--check` now flags ANY on-disk path not in the expected files map, and write-mode removes stray files + now-empty directories. +2 live regression tests in new `packages/iris-mcp-all/src/__tests__/gen-skills-stray-file.test.ts` (adds a real stray file to the on-disk `skills/` tree, confirms `--check` fails with `STRAY/STALE`, cleans up in a `finally`). |
| 14 | CR 25.1-4 (`arg()` empty-string placeholder note-branch) | **RESOLVED** | Extracted the duplicated per-file `arg()` helper into new shared `packages/shared/src/prompt-helpers.ts` (`isArgProvided`/`argOrPlaceholder`), exported from `@iris-mcp/shared`; updated all 9 prompt files to import it and changed every note-branch presence check from `!== undefined` to `isArgProvided(...)`, so an explicit empty string is now treated identically to omission everywhere (single source of truth — the two checks can never diverge again). +8 unit tests (`prompt-helpers.test.ts`) + 5 targeted regression tests (`diagnose-slow-query`/`recover-stuck-production` empty-string alignment) across the dev/interop `prompts.test.ts` files. |
| 15 | CR 25.1-6 (all-optional-arg prompts reject omitted `arguments`) | **CLOSED-BY-DECISION** | Accepted the documented SDK limitation (`@modelcontextprotocol/sdk@1.29.0` has no schema that both advertises optional args and tolerates a fully-omitted `arguments` key). Added an extensive doc comment in `server-base.ts` explaining the root cause and why bypassing `registerPrompt` for these 4 prompts is disproportionate. Pinned the accepted behavior with 2 regression tests in `prompts.test.ts` (`arguments:{}` renders fine; `arguments` key entirely absent → clean `-32602`). |
| 16 | CR 25.2-1 (prose counts not mechanically asserted) | **RESOLVED** | Added 2 mechanical tests to `docs-prompt-sync.test.ts`: the root README's `"10 prompts"` heading is asserted to match `prompts.length` exactly; `tool_support.md`'s per-server (`ops`/`dev`/`interop`/`admin`) numeric tallies + `data` "none" wording + the "pack of N **MCP prompts**" total sentence are all regex-parsed and cross-checked against the live registered-prompt catalog. |

**Tally: 11 resolved · 4 closed-by-decision · 1 closed-with-evidence · 0 re-deferred.** Ledger closes to **ZERO carried-open** — only Epic-26's own new review findings (CR 26.1-1..6, CR 26.2-1) remain open, permitted per AC 26.4.3 / AC 22.1.7 shape.

**Verify (Task 5, AC 26.4.4):**
- Frozen governance baseline `1e62c5ad5bf7` **untouched**: `pnpm gen:governance-baseline:check` exit 0 (141 frozen / 197 live / 56 post-foundation); `git status --porcelain packages/shared/src/governance-baseline.ts` empty (git-clean).
- ObjectScript edits bundled into ONE bootstrap re-roll: `BOOTSTRAP_VERSION` **`1f3afba4ac52` → `f16c695aa9ef`** (`pnpm gen:bootstrap`, idempotent — 26 classes). **Code review moved it once more → `e5c18edd00c0`** when correcting the CR 23.1-5 defect (see CR 26.4-R1); `bootstrap.test.ts` 42/42 green, `gen:bootstrap` idempotent at the new hash.
- All 4 touched ObjectScript classes deployed via `iris_doc_load` (glob path, Rule #17) + compiled clean on HSCUSTOM; every affected `%UnitTest` class re-run per-class with a matching total-vs-expected count (Rule #35): `HealthCheckTest` 15/15, `DiagramCompressorTest` 10/10, `DiagramEpisodeTest` 13/13, `DiagramEpisodeEdgeTest` 6/6, `DiagramGenerateTest` 11/11, `LocScannerTest` 9/9, `LocFacadeTest` 8/8, `LocRestTest` 10/10 — all green, zero regressions.
- Full monorepo suite: `pnpm test` → **13/13 turbo tasks green** (shared 698 tests / dev 374 / admin 443 / interop 323 / ops 340 / all 42 — includes all new tests added this story).
- `pnpm run type-check` → 12/12 turbo tasks green, zero errors.
- `pnpm run lint` → 6/6 turbo tasks green, zero errors/warnings.
- `pnpm run format:check` flags a large, pre-existing, repo-wide Prettier drift spanning many files this story never touched (e.g. `packages/shared/src/config.ts`, `packages/shared/src/errors.ts`, `README.md`, `tool_support.md`) — confirmed pre-existing (not introduced by this story) and out of AC 26.4.4's stated scope ("full monorepo suite green + lint + type-check clean" — format is not named). Not fixed here to avoid an unrelated repo-wide reformat inside a ledger-burndown story; flagged for a future dedicated formatting pass.

### File List

**ObjectScript (bundled into one bootstrap re-roll, `BOOTSTRAP_VERSION` `1f3afba4ac52` → `f16c695aa9ef` → `e5c18edd00c0` [code-review CR 26.4-R1 correction]):**
- `src/ExecuteMCPv2/Diagram/Compressor.cls` (CR 22.1-1 guard)
- `src/ExecuteMCPv2/Loc/Generate.cls` (CR 22.0-D1 doc-comment only)
- `src/ExecuteMCPv2/Loc/Scanner.cls` (CR 22.0-D2 doc-comment only)
- `src/ExecuteMCPv2/REST/Health.cls` (CR 23.1-3/23.1-4/23.1-5)

**TypeScript — framework/shared:**
- `packages/shared/src/prompt-helpers.ts` (new — CR 25.1-4)
- `packages/shared/src/index.ts` (export the new helper)
- `packages/shared/src/server-base.ts` (CR 25.0-4, CR 25.0-5, CR 25.1-6 doc)
- `packages/shared/src/bootstrap-classes.ts` (regenerated, `gen:bootstrap`)
- `packages/shared/src/__tests__/prompts.test.ts` (CR 25.0-4/25.0-5/25.1-6 regression tests)
- `packages/shared/src/__tests__/prompt-helpers.test.ts` (new — CR 25.1-4 unit tests)

**TypeScript — tool/prompt content:**
- `packages/iris-ops-mcp/src/tools/health.ts` (CR 23.2-3)
- `packages/iris-ops-mcp/src/__tests__/health.test.ts` (CR 23.2-3 regression tests)
- `packages/iris-ops-mcp/src/prompts/checkSystemHealth.ts` (CR 25.1-4)
- `packages/iris-ops-mcp/src/prompts/runExternalBackup.ts` (CR 25.1-4)
- `packages/iris-dev-mcp/src/tools/loc.ts` (CR 22.0-D1 doc)
- `packages/iris-dev-mcp/src/prompts/diagnoseSlowQuery.ts` (CR 25.1-4)
- `packages/iris-dev-mcp/src/prompts/deployAndTestClass.ts` (CR 25.1-4 dedup)
- `packages/iris-dev-mcp/src/__tests__/prompts.test.ts` (CR 25.1-4 regression tests)
- `packages/iris-interop-mcp/src/prompts/recoverStuckProduction.ts` (CR 25.1-4)
- `packages/iris-interop-mcp/src/prompts/traceMessageFlow.ts` (CR 25.1-4)
- `packages/iris-interop-mcp/src/prompts/resendFailedMessages.ts` (CR 25.1-4 dedup)
- `packages/iris-interop-mcp/src/__tests__/prompts.test.ts` (CR 25.1-4 regression tests)
- `packages/iris-admin-mcp/src/prompts/auditSecurityPosture.ts` (CR 25.1-4)
- `packages/iris-admin-mcp/src/prompts/provisionProjectEnvironment.ts` (CR 25.1-4 dedup)

**TypeScript — generators/tests (cross-package + tooling):**
- `scripts/gen-governance-baseline.mjs` (CR 22.1-2 doc note)
- `scripts/gen-skills.mjs` (CR 25.1-3)
- `package.json` (CR 22.1-2 pre-hooks)
- `packages/iris-mcp-all/src/__tests__/gen-skills-stray-file.test.ts` (new — CR 25.1-3 live regression tests)
- `packages/iris-mcp-all/src/__tests__/docs-prompt-sync.test.ts` (CR 25.2-1)

**Docs/spec:**
- `_bmad-output/planning-artifacts/research/feature-specs/01-health-check.md` (CR 23.2-1 spec amendment)
