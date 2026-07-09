# Story 26.4: Deferred-Work Ledger Burn-Down (Rule #37)

Status: ready-for-dev

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

- [ ] Task 1: Rule #16 probe/source-read pass for the verify-then-dispose subset (AC 26.4.2) — before touching code, confirm each asserted claim against `irislib`/`irissys` source or a disposable `ExecuteMCPv2.Temp.*` probe (deleted after):
  - [ ] CR 23.2-2 — confirm `Health.cls` only sets canonical `errors[<area>]` keys (source read of `HealthCheck*` methods) → underpins the closed-with-evidence.
  - [ ] CR 22.1-1 — confirm the sole `pairloop` producer (`Compressor.cls:Compress`) always sets a real `.Req` with non-empty `Src` (source read) → confirms UNREACHABLE, guard is defense-only.
  - [ ] CR 22.0-D2 — re-confirm the native `%RoutineMgr:StudioOpenDialog` order-sensitivity is IRIS behavior, not a port defect (source `irislib/%Library/RoutineMgr.cls`) → underpins closed-by-decision.
  - [ ] Record ALL probe/source findings in the Dev Agent Record; delete any probe class (IRIS + disk).
- [ ] Task 2: TS/tooling code-fix subset (AC 26.4.1/26.4.4), each strictly additive + tested:
  - [ ] CR 22.1-2 (governance generator dist-coupling), CR 23.2-3 (health.ts result guard), CR 25.0-4 (registerPrompt try/catch), CR 25.0-5 (dup arg-name guard), CR 25.1-3 (gen-skills stray-file check), CR 25.1-4 (arg() empty-string alignment), CR 25.2-1 (docs prose-count assertions), CR 25.1-6 (per chosen disposition).
  - [ ] CR 23.2-1 & CR 23.2-2 per chosen disposition (closed-by-decision → doc/spec text + test note; resolve → code + test).
- [ ] Task 3: ObjectScript code-fix subset (AC 26.4.4) — bundle ALL into ONE bootstrap re-roll:
  - [ ] CR 22.1-1 (Compressor.cls guard), CR 23.1-3 (Health.cls result-set closes), CR 23.1-4 (Health.cls parse-status), CR 23.1-5 (Health.cls repeated-param, if resolve), CR 22.0-D1 (Generate.cls, if resolve).
  - [ ] Deploy loop (`iris_doc_load` glob path, Rule #17) → compile → `%UnitTest` per-class with total-count check (Rule #35).
  - [ ] `gen:bootstrap` → record `BOOTSTRAP_VERSION` from→to (Rule #24) → `bootstrap.test.ts` green (idempotent).
- [ ] Task 4: Ledger closure (AC 26.4.3) — record the final 16-row disposition table in the Dev Agent Record; mirror each disposition into `deferred-work.md` with a new "Story 26.4 — burn-down closure table" section; confirm the ledger reads ZERO carried-open (only Epic-26-own findings remain).
- [ ] Task 5: Verify (AC 26.4.4) — `gen:governance-baseline:check` exit 0 + `governance-baseline.ts` git-clean; full monorepo suite green; lint + type-check clean.

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

### Debug Log References

### Completion Notes List

### File List
