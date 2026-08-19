# Story 35.8: Docs + Artifact Rollup, `epics.md` Backfill, Epic Gate

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the **Epic 35 release gate**,
I want **the docs rollup completed, the `epics.md` drift closed, and a single LIVE epic gate in the default test suite that exercises all nine corrected contracts**,
so that **the beta hand-off ships with every sweep finding verifiably fixed on the real surface — and a permanent gate that would catch any regression**.

## Context — why this story exists

Capstone for Epic 35, running LAST (after 35.9, so the gate covers it). The nine findings F1-F9 were each fixed and proven per-story; this story adds the cross-cutting close-out: docs enrichment, the `epics.md` 34.5 backfill + mechanical drift check, and the epic-level live gate. Per-story docs already shipped (#43) — this story ENRICHES, never first-documents.

## Acceptance Criteria

Sourced verbatim from `_bmad-output/planning-artifacts/epics.md`, "### Story 35.8".

1. **AC 35.8.1** - Docs rollup ENRICHES what stories 35.1-35.7 already shipped; it must not be the first place any capability is documented (#43). Per-server READMEs and `tool_support.md` updated for every changed contract, each with its governance default state stated mechanically from `mutates` (#30).
2. **AC 35.8.2** - **`epics.md` backfill.** Add the missing **Story 34.5** section (`34-5-tool-layer-truncated-and-test-runner-guard`, `done` in `sprint-status.yaml` but absent from `epics.md`) and reorder 34.6-34.8 into ascending sequence (they currently appear 34.8 first, then 34.7, then 34.6). Content is reconstructed from the story file in `implementation-artifacts/`, not invented. Scope correction (mechanical recount 2026-08-17, Rule #51): 16 status keys have no `epics.md` section, of which 15 are runtime-created gate/cleanup stories (expected-absent BY DESIGN) — Story 34.5 is the only genuine drift.
3. **AC 35.8.3** - Mechanical cross-check (#51/#56): every story key in `sprint-status.yaml` for epics 1-35 has a corresponding `epics.md` section, and vice versa. Derive the comparison with a script and report BOTH directions; do not hand-audit. The check must CLASSIFY rather than flat-flag: gate/cleanup story keys matching `*-epic-N-deferred-cleanup` or `*-cleanup` are EXPECTED-ABSENT (runtime-created), and the convention is documented so the check is repeatable and does not re-raise 15 false positives next epic. Any absence outside the expected class is fixed or explicitly logged.
4. **AC 35.8.4** - **Epic gate** - a LIVE full-surface exercise, in the DEFAULT test suite (#21), covering all nine findings: F1 `production_item:set` mutates and reads back; F2 `analytics_cubes:build` returns parseable JSON verified from the RAW wire body; F3 an error renders `ERROR #`; F4 `listPrivileges` respects `maxRows`; F5-F9 each assert the corrected contract. Rule #59: the gate is proven RED by breaking each fix on the path it actually guards, and the story STATES which path that was for each leg.
5. **AC 35.8.5** - Gates green: `pnpm turbo run build test lint type-check`; `gen:governance-baseline:check` (`:check` ONLY) exit 0 at frozen `1e62c5ad5bf7`/141/201/60; tool counts unmoved (#31); no new action keys (Constraint E-1); `BOOTSTRAP_VERSION` from->to recorded with Constraint C-2 re-verified (#24 - `Interop`, `Analytics`, `Security` are bootstrapped); bootstrap rosters unchanged (#39 - no new `.cls`); changeset added.
6. **AC 35.8.6** - `iris_execute_tests` count check (#35): `ExecuteMCPv2.Tests` total compared against the mechanically-counted `Test*` method count; rerun per-class if short.

## Lead pre-story findings — verified at source 2026-08-19

**1. AC 35.8.3 baseline, computed mechanically just now** (script, not hand-count): **186 story keys** in sprint-status.yaml, **170** `### Story N.M:` sections in `epics.md`, **16 absent**, **0 orphan sections**. The 16 absent: `2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 12.0, 14.0, 15.0, 16.0, 17.0, 33.5, 34.0, 34.5` — fifteen expected-absent (14 `N-0-epic-*-deferred-cleanup` + `33-5-late-findings-cleanup`) + the ONE genuine drift (`34.5`). **Expected post-story state: 171 sections, 15 absent (all expected class), 0 orphans.** (Note: keys/sections moved 185→186 / 169→170 vs the AC's baseline because the correct-course added 35.9 to both — consistent.)

**2. The gate pattern to copy — Epic 34's own capstone:** `packages/iris-dev-mcp/src/__tests__/execute-classmethod-epic-gate.test.ts` is a DEFAULT-SUITE file (NOT `*.integration.test.ts`) with a `beforeAll` availability probe + per-test `ctx.skip()` when IRIS is unreachable, driven hard on the packaging path by `packages/*/scripts/prepublish-gate.mjs` (exists in `iris-dev-mcp` and `iris-data-mcp`; sets `IRIS_REQUIRE_LIVE=1` in Node — NOT POSIX env-prefix syntax, which silently fails on Windows — runs a dist-freshness check FIRST, and spawns vitest via `cmd.exe /d /s /c`). It imports the tool definitions and calls `tool.handler(args, ctx)` against a REAL `ToolContext` (`buildToolContext` + `IrisHttpClient` from `@iris-mcp/shared`) — the pattern that sees the TS tool layer, which raw curl cannot (35.4 lesson).

**3. Placement decision (lead):** the Epic 35 gate is ONE consolidated file, **`packages/iris-mcp-all/src/__tests__/epic35-defect-gate.test.ts`**. Rationale: the nine legs span four packages; `iris-mcp-all` is the only package depending on all five servers (Rule #45 — cross-package checks live there); its `__tests__` already hosts the process-gate pattern (`host-guard-process-gate.test.ts` et al.). Arming: `iris-mcp-all`'s `prepublishOnly` currently runs only `verify-iris-reachable.mjs` — add `packages/iris-mcp-all/scripts/prepublish-gate.mjs` modeled on the dev/data scripts and repoint `prepublishOnly` at it (35.2's CR established exactly this fix shape for data). **Prove the arming fail-closed: run the gate script with `IRIS_PORT=59999` and show exit≠0** (Rule #59 — an arming nothing sets was Epic 34 retro incident #6; do not re-create it).

**4. Reaching the tools from `iris-mcp-all`:** verify the import path for tool definitions from the leaf packages (e.g. whether `@iris-mcp/data` exports its tools or you import the constructed servers from `SERVER_PACKAGES` and fish the tool out). Probe first; record what you used. A leg that can't reach a tool handler in-process may drive the deployed REST route via raw `fetch`/`IrisHttpClient` instead (F2's raw-body leg needs the raw wire regardless).

**5. Carried doc items that land in THIS story (already ledgered, part of AC 35.8.1's enrichment):**
   - `35-5-SMOKE-1` (LOW): `iris_interop_rest:delete` leaves the generated `.impl` class by design (`%REST.API` doc: "The implementation class is not deleted") — add the one-line note to the tool description + interop README, then close the ledger row.
   - `35-9-DEV-2` (LOW): prompt text for `deployAndTestClass`/`objectscriptReview` says a bare path "mis-maps the class name" — post-35.9 the behavior is REFUSAL; update the wording, then close the ledger row.

**6. `BOOTSTRAP_VERSION` expectation:** this story changes NO `.cls` — the version stays `e1168c1ebe56`. AC 35.8.5's "from→to" records `e1168c1ebe56 → e1168c1ebe56` with the idempotence proof (`pnpm run gen:bootstrap` produces zero diff — that IS the C-2 re-verification).

## Tasks / Subtasks

- [x] **Task 1 — Docs rollup (AC 35.8.1)**
  - [x] Sweep every Epic-35-changed contract against its surfaces (tool description, owning package README, `tool_support.md`, `packages/iris-mcp-all/README.md` check — record verdicts): 35.1 (`production_item` production param + set durability), 35.2 (analytics build output isolation), 35.3 (`IRIS_ACCEPT_LANGUAGE`), 35.4 (`listPrivileges` maxRows/cursor + %All short-circuit), 35.5 (oauth `sslConfiguration`/preconditions/client contract + interop_rest name contract), 35.6 (xml import `compile`/`flags` + rest_manage legacy get), 35.7 (DocDB prerequisite + actionable error), 35.9 (`baseDir` + refusal contract).
  - [x] Each surface states the governance default state mechanically from `mutates` (#30): verify what's written matches the baseline classifications (e.g. these are grandfathered default-ENABLED writes: `iris_oauth_manage:*`, `iris_interop_rest:*`, `iris_doc_load`, `iris_doc_xml_export:import`, `iris_production_item:set`; reads: `listPrivileges`, `rest_manage:get`, `docdb_find`).
  - [x] Land the two carried items (finding #5) and close their ledger rows.

- [x] **Task 2 — `epics.md` backfill (AC 35.8.2)**
  - [x] Read `_bmad-output/implementation-artifacts/34-5-tool-layer-truncated-and-test-runner-guard.md` and reconstruct the `### Story 34.5` section in `epics.md` from it (reconstructed, not invented — mark its provenance with a one-line note).
  - [x] Reorder the 34.6-34.8 sections into ascending sequence (34.6, 34.7, 34.8). Verify no content changes in the reorder (diff shows moves only).

- [x] **Task 3 — Mechanical cross-check (AC 35.8.3)**
  - [x] Write the comparison as a REPEATABLE script (e.g. `scripts/check-epics-sync.mjs` — Node, no heredoc-generated content per #55) that classifies expected-absent (`/^\d+-0-epic-\d+-deferred-cleanup$/` or `/-cleanup$/`) vs genuine drift, checks BOTH directions (keys→sections and sections→keys), and exits non-zero on genuine drift.
  - [x] Run it: post-backfill state must be 171 sections / 15 expected-absent / 0 orphans / 0 genuine drift.
  - [x] Document the convention where the next epic will find it (the script's own header comment + a line in the story).

- [x] **Task 4 — The epic gate (AC 35.8.4)** — `packages/iris-mcp-all/src/__tests__/epic35-defect-gate.test.ts`, default-suite, `ctx.skip()`-on-unavailable, `IRIS_REQUIRE_LIVE`-armed on the packaging path. One `describe` leg per finding; EVERY leg names the path it guards in a comment:

  | Leg | Assertion (real surface) | Guards the path |
  |---|---|---|
  | F1 | `iris_production_item` `get`→`set`→`get` readback on the deployed `ExecuteMCPv2.Tests` fixture production (restore the original value after) | Tool layer → Interop.cls composite-key path |
  | F2 | `iris_analytics_cubes:build` on a nonexistent cube: raw wire body parses as JSON (no prepended device text) | RAW wire body of Analytics.cls build branch |
  | F3 | an erroring tool call renders `ERROR #` (not a localized prefix) through the tool layer | http-client Accept-Language pin |
  | F4 | `iris_resource_manage:listPrivileges` `grantee=_SYSTEM, maxRows=5` → 5 rows + `rowsCapped: true` + `superUserPrivilegesOmitted` present | Server cap + %All short-circuit |
  | F5 | `iris_docdb_manage:list` → actionable error naming `%Service_DocDB` + portal + governance override (assert service disabled FIRST; skip with a recorded reason if an operator has enabled it — do NOT toggle it) | docdb.ts translation |
  | F6 | `iris_oauth_manage` create-client with a nonexistent serverName → clean precondition error, no `<PARAMETER>` | Security.cls validation |
  | F7 | `iris_interop_rest` `name` description states the package-name contract; `/trap-shape` form yields the clear rejection | rest.ts contract |
  | F8 | `iris_doc_xml_export` import of a fixture class with `compile:true` → callable via the classmethod route; compile omitted → the uncompiled note (clean up the fixture class) | format.ts compile parity |
  | F9 | `iris_rest_manage:get` on `/api/executemcp/v2` → legacy detail, `swaggerSpec: null`, NO "web server configuration" text | rest.ts legacy routing |

  - [x] Rule #59 RED proof per leg at dev time (mutation or pre-fix revert on the GUARDED path), recorded leg-by-leg in the story. For handler-side fixes (F1/F2/F4/F6) the mutation is the deployed class revert; for TS-side fixes (F3/F5/F7/F8/F9) it's the source revert. State each path explicitly.
  - [x] The gate file is NOT `*.integration.test.ts`; it must be collected by the default vitest include.
  - [x] Arming: new `packages/iris-mcp-all/scripts/prepublish-gate.mjs` + repoint `prepublishOnly`; proven fail-closed with `IRIS_PORT=59999` (exit≠0) AND proven it runs the gate legs when IRIS is up (legs execute, not skip).

- [x] **Task 5 — Gates + counts (AC 35.8.5, 35.8.6)**
  - [x] `pnpm turbo run build test lint type-check` — if the known environmental parallel flake (`35-1-DEV-1`) trips, record the substitution (per-package standalone + root `vitest run` aggregate) explicitly as prior stories did.
  - [x] `pnpm gen:governance-baseline:check` exit 0; `@iris-mcp/all` suite 120+ (the gate file ADDS tests to `all` — record the new count; tool/action counts unmoved).
  - [x] `pnpm run gen:bootstrap` → zero diff (idempotence = the C-2 re-verification); `BOOTSTRAP_VERSION` `e1168c1ebe56 → e1168c1ebe56`.
  - [x] AC 35.8.6: `iris_execute_tests` on `ExecuteMCPv2.Tests` — total must equal the mechanical `Test*` count (412 at story creation; recompute).
  - [x] Changeset: patch for `iris-mcp-all` (+ any package whose README changes materially).
  - [x] Ledger: close `35-5-SMOKE-1` and `35-9-DEV-2`; mechanical tally update (#51).

## Dev Notes

### Rule #59 is THIS story's recurring failure mode

Every gate leg must state the path it guards and how RED was proven. The Epic 34 retro's incident list is the warning: a test excluded from the suite, an oracle that can't vary with the property, an arming env var nothing sets, an internal round-trip standing in for the wire. For EACH leg, ask: "would this leg fail if the fix were reverted, on the path the fix actually guards?"

### Traps

- **F5's leg must not toggle `%Service_DocDB`** — the gate asserts the disabled-state contract; if the instance's operator has enabled the service, the leg records an explicit skip reason (Rule #41's not-configured contract is the POINT here).
- **F1's leg mutates a shared fixture** — restore the original value in a `finally`; if the fixture is absent, skip with reason (don't recreate production fixtures from the gate).
- **F8's fixture XML** — capture the shape from a REAL export during dev (Rule #36/54), then embed a minimal version; clean up the imported class in `afterAll`.
- **The gate degrades gracefully** on a pristine checkout (no IRIS → skip, never fail) — but on the ARMED path (prepublish) a skip is a FAILURE (`IRIS_REQUIRE_LIVE=1` flips `ctx.skip()` to a hard error — follow the Epic 34 gate's exact mechanism).
- **Reordering 34.6-34.8:** moves only — `git diff` must show pure relocation.
- **Rule #55:** the cross-check script is written with the Write tool, never heredoc'd.

### Testing standards

- The gate file's own tests ARE the deliverable; they live in `iris-mcp-all`'s default suite.
- The arming proof (fail-closed + legs-execute) is live evidence, recorded with command lines.
- Per-package standalone suites after every change (35-1-DEV-1).

### Doc surfaces — enumerate exhaustively (#56)

| File | What changes |
|---|---|
| `packages/iris-mcp-all/src/__tests__/epic35-defect-gate.test.ts` | NEW — the gate |
| `packages/iris-mcp-all/scripts/prepublish-gate.mjs` | NEW — arming (modeled on dev/data) |
| `packages/iris-mcp-all/package.json` | `prepublishOnly` repoint |
| `packages/iris-interop-mcp/README.md` + `packages/iris-interop-mcp/src/tools/rest.ts` | `35-5-SMOKE-1` `.impl` note |
| prompt text for `deployAndTestClass`/`objectscriptReview` (find them — likely `packages/iris-dev-mcp/src/prompts*`) | `35-9-DEV-2` wording |
| Per-server READMEs + `tool_support.md` | enrichment sweep per Task 1 (only where a contract is under-documented) |
| `_bmad-output/planning-artifacts/epics.md` | 34.5 backfill + 34.6-34.8 reorder |
| `scripts/check-epics-sync.mjs` | NEW — the repeatable cross-check |
| root `README.md` | CHECK (record verdict) |

### References

- Epic + ACs: `_bmad-output/planning-artifacts/epics.md`, "### Story 35.8"
- Epic 34 gate precedent: `packages/iris-dev-mcp/src/__tests__/execute-classmethod-epic-gate.test.ts` + `packages/iris-dev-mcp/scripts/prepublish-gate.mjs`
- 34.5 source for the backfill: `_bmad-output/implementation-artifacts/34-5-tool-layer-truncated-and-test-runner-guard.md`
- Rules: #19, #21, #24, #30, #31, #35, #36, #39, #43, #45, #51, #54, #55, #56, #59
- All nine story files `35-0` … `35-9` in `implementation-artifacts/`

### Previous story intelligence — the whole epic

- The lead smoke drives the MCP TOOL LAYER, not only raw curl (35.4) — the gate does the same by construction (handler-level calls + explicit raw-wire legs only where the fix is wire-level).
- README examples must be EXECUTED (35.5 smoke catch).
- Audit lists are re-derived, never trusted (35.5/35.6).
- `35-1-DEV-1`: per-package standalone; the substitution is recorded, not normalized.
- Cycle-log model-attribution recurrence (35.7/35.9 review flags): the cycle log records the SPAWN tier; story files record agent self-reports — the retro reconciles the convention; no action in this story.

## Dev Agent Record

### Agent Model Used

Claude Fable 5 (k3[1m]), via bmad-dev-story workflow (teammate `dev-35-8`).

### Debug Log References

**Live behavior pins (Rule #36), all captured before writing assertions** — disposable probe scripts (`.tmp-358/`, deleted before staging) driving the BUILT dists through a real `ToolContext`, HSCUSTOM, IRIS 2026.1 (Build 235U), Atelier v8:

- F1: `get FixtureOp` → `{action:"get", itemName, className:"EnsLib.File.PassthroughOperation", enabled:false, poolSize:1}` (comment key absent when empty); `set {comment:"epic35-gate-marker"}` → `{action:"set", production:"…FixtureProd", updatedSettings:["comment"]}`; readback carries `comment:"epic35-gate-marker"`; restore returns the comment key to absent. Verified end-to-end live.
- F4: `_SYSTEM, maxRows=5` → `privileges.length=5`, `count:5`, `rowsCapped:true`, `superUserPrivilegesOmitted:15333` (number), `reason` names `%All`, `nextCursor` absent.
- F5: `%Service_DocDB` live state `enabled:false` (via `/security/service` route); `docdb_manage:list` → isError with the full actionable text (822 + service + portal + `iris_service_manage` + `IRIS_GOVERNANCE` + "currently DISABLED").
- F6: create-client with bogus serverName → `ERROR #5001: No OAuth2 server definition exists for issuer '…'` — no `<PARAMETER>`.
- F7: dist description carries the package-name contract; `/trap-shape-358` → `ERROR #5001: Application name is not a valid package name: /trap-shape-358.`
- F8: minimal XML fixture shape captured from a REAL export of `ClassMethodArgsFixture.cls` (the `<ClassMethod>1</ClassMethod>` child-element form — a first attempt with a `ClassMethod="1"` ATTRIBUTE failed live with `ERROR #6301`, which is how the correct shape was pinned). No-compile import → NOT callable (`<CLASS DOES NOT EXIST>`) + "NOT compiled" note in `content[1]`; `compile:true` import → callable, `returnValue:"epic35-gate-xml-ok"`. Probe classes deleted live.
- F9: `get /api/executemcp/v2` → `{name, dispatchClass:"ExecuteMCPv2.REST.Dispatch", namespace, swaggerSpec:null, explanation}` live.
- F3: `execute_command "Set x = 1/0"` → `Details: ERROR #5001: ObjectScript error: <DIVIDE>Execute` through the tool layer.
- Tool import path (lead pre-story finding #4 probe answer): `@iris-mcp/<pkg>` index.ts is a server ENTRY POINT (side effects on import) and pnpm strict resolution hides `@iris-mcp/shared` from `iris-mcp-all` — so the gate dynamically imports each leaf's BUILT `dist/tools/index.js` via `pathToFileURL` and fishes tools by name (the established `tool-visibility-non-drift.test.ts` pattern), and imports `@iris-mcp/shared`'s `dist/index.js` the same way.

**Rule #59 RED proof per leg (mutation → leg RED → restore → leg GREEN), each on the path the fix actually guards:**

| Leg | Guarded path | Mutation | RED evidence | Restore |
|---|---|---|---|---|
| F1 | Interop.cls composite-key `set` | Deployed-class revert: `Interop.cls` @ `3c7adec^` (pre-35.1) via `iris_doc_load` from a temp dir | leg RED — `set.isError === true` (pre-fix handler cannot target a non-active production) | HEAD redeployed → GREEN; fixture comment untouched by the failed set (finally-restore ran) |
| F2 | Analytics.cls build-branch wire body | Deployed-class revert: `Analytics.cls` @ `796c454^` (pre-35.2) | leg RED — `expected '\r' to be '{'` (the prepended `\r\nERROR #20013:` device text, the exact defect shape) | HEAD redeployed → GREEN |
| F3 | shared `http-client.ts` Accept-Language pin | Source revert: `"Accept-Language": acceptLanguage,` line removed from the headers object; `pnpm build` of `@iris-mcp/shared` | leg RED — received text carried `Details: خطأ #5001: ObjectScript error: <DIVIDE>Execute` (the Arabic prefix = undici's injected `Accept-Language: *` resolving to `araw`, the documented pre-35.3 shape on this `enuw` instance) | file restored from backup, rebuilt → GREEN; `git diff` empty |
| F4 | Security.cls `SqlPrivilegeList` cap + %All omission | Deployed-class revert: `Security.cls` @ `d8320ef^` (pre-35.4) | leg RED — server ignored `maxRows` → 50 rows (the tool's opt-in page size over the unbounded result) vs expected 5 | stepped forward (see F6) → GREEN |
| F5 | data `docdb.ts` catch-path translation | Source revert: the manage-tool call site mutated to `await Promise.resolve(null)` (translation never consulted); rebuilt `@iris-mcp/data` | leg RED — raw `Error managing DocDB database: IRIS reported errors…` without `%Service_DocDB` | restored from backup, rebuilt → GREEN; `git status` clean |
| F6 | Security.cls OAuth precondition chain | Deployed-class revert: `Security.cls` @ `d8320ef` (35.4's version — F4 fixed, F6 absent) | leg RED — error lacked `No OAuth2 server definition exists for issuer` (pre-35.5 delegates blindly) | HEAD redeployed → GREEN (F4 re-verified GREEN on the same intermediate version first, isolating the two fixes' versions) |
| F7 | interop `rest.ts` `name` description contract | Source revert to the pre-35.5 description (`"REST application name (e.g., '/myapi')"`); rebuilt `@iris-mcp/interop` | leg RED — `expected 'REST application name (e.g., '/myapi…' to contain 'package name'` | restored from backup (backup INCLUDED this story's `.impl` note — verified in the post-restore diff), rebuilt → GREEN |
| F8 | dev `format.ts` compile parity (flags forwarding) | Source revert: `if (shouldCompile)` → `if (false as boolean)` (no `flags` param ever sent); rebuilt `@iris-mcp/dev` | leg RED — `compile:true` import's class NOT callable (`callCompiled.isError === true`), i.e. the `c` qualifier never reached Atelier | restored from backup, rebuilt → GREEN |
| F9 | data `rest.ts` legacy `get` routing | Source revert: the Mgmnt-404 legacy fallback branch disabled (`if (false as boolean && …)`); rebuilt `@iris-mcp/data` | leg RED — `result.isError === true` (raw Mgmnt 404 surfaced instead of the legacy detail) | restored from backup, rebuilt → GREEN; `git status` clean |

Arming proofs (Rule #59's "an arming nothing sets" counter-proof):
- **Fail-closed:** `cd packages/iris-mcp-all && IRIS_PORT=59999 node scripts/prepublish-gate.mjs` → **exit 1**; the gate file's `beforeAll` threw `IRIS_REQUIRE_LIVE is set, so the Epic 35 defect gate may not be skipped: IRIS is not reachable at http://localhost:59999 …` (all five dist-freshness checks passed first; the failure is the armed live gate, not an incidental error).
- **Arms-and-executes:** `node scripts/prepublish-gate.mjs` (IRIS up) → **exit 0**, all five dist checks fresh, vitest reports **9 passed (9)** — legs EXECUTE under `IRIS_REQUIRE_LIVE=1`, not skip.
- **Graceful degradation:** `IRIS_PORT=59999 npx vitest run src/__tests__/epic35-defect-gate.test.ts` (no arming) → **exit 0**, 9 skipped, each with its logged `[SKIP] epic35-defect-gate (F…) :` reason — a pristine/offline checkout never fails.
- **Default-suite collection:** the file is `src/__tests__/epic35-defect-gate.test.ts` (NOT `*.integration.test.ts`); a bare `npx vitest run` in `iris-mcp-all` collected it (suite 120 → **129**, +9 legs).

**AC 35.8.6 measurement correction (worth recording):** a first mechanical count used `grep -c "Method Test"` and reported 419 vs the live run's 412 — the unanchored pattern matched 7 occurrences inside `LocClassifierTest.cls`'s string FIXTURES (the classifier tests embed `Method Test…` source text as data). The correct line-anchored count (`grep -h "^Method Test\|^ClassMethod Test" src/ExecuteMCPv2/Tests/*.cls | wc -l`) is **412**, matching the live `iris_execute_tests` total **412/412 passed** exactly. (During that investigation the stale-deployed `LocClassifierTest` was re-uploaded from disk — `up-to-date`, no change; and a trap-glob probe upload through the OLD configured MCP server reproduced 35.9's exact mis-map live on the pre-35.9 tool build, storing nothing.)

### Completion Notes List

- **AC 35.8.1 (docs rollup, enrich-only):** every Epic-35 contract verified present on its surfaces from the per-story passes (interop README 35.1 composite-key note; data README 35.2/35.6/35.7; 6×README+extension 35.3 env row; admin README+tool_support 35.4; admin README+interop README 35.5; dev README+tool_support 35.6/35.9). Enrichment added ONLY where a surface was missing the contract: `tool_support.md` gained three notes — Story 35.1 + 35.5-interop_rest in the interop section, Story 35.5-oauth in the admin section, Story 35.2 in the data "Fields returned" section (wording verified against `Analytics.cls`: `sync` was probed clean and untouched, only `build` got the redirect). Governance default states were verified MECHANICALLY, not by prose: a disposable probe (`buildMutatesLookup`/`buildDefaultEnabledWrites`/`effective` over the five built dists, empty config) confirmed `iris_oauth_manage:*`, `iris_interop_rest:*`, `iris_doc_load`, `iris_doc_xml_export:import`, `iris_production_item:set` are grandfathered default-ENABLED, `iris_production_item:add`/`:remove` default-DISABLED writes, `listPrivileges` default-enabled read — matching what the docs now say. `iris-mcp-all` README verdict: NO change needed (no tool rows for the touched tools — re-grepped); root README verdict: NO change needed (governance table rows 494/499 accurate; prompt-flow row still accurate; the 35.3 env row already shipped there). No README anywhere documents prepublish gates (dev/data's existing ones included), so the new arming's doc surface is the script's own header, matching precedent.
- **Carried items landed and closed:** `35-5-SMOKE-1` (the `.impl`-preserved-by-design note in `iris_interop_rest`'s description + interop README) and `35-9-DEV-2` (the "mis-maps" → REFUSAL wording on all FOUR prompt surfaces: both `prompts/*.ts` sources + both generated `skills/` — regenerated via `pnpm gen:skills` from the rebuilt dist per Rule #18, never hand-edited; the `prompt-safety-invariants.test.ts` doc-rot guard now pins "refused" present / "mis-maps the class name" absent). Ledger terminal-disposition section + mechanical tally added: **0 HIGH / 25 MEDIUM / 97 LOW = 122 open / 202 distinct / 79 terminal**.
- **AC 35.8.2 (epics.md backfill):** the `### Story 34.5` section was reconstructed from `34-5-tool-layer-truncated-and-test-runner-guard.md` (story statement + ACs verbatim, plus a one-line provenance note naming the reconstruction source) and inserted between 34.4 and 34.6; the 34.6-34.8 sections were reordered to ascending by a byte-exact splice (a disposable Node script, deleted after) — each moved section's SHA-256 verified IDENTICAL before/after (`34.6: d49a8725…`, `34.7: f1935a6a…`, `34.8: e95b521f…`), so the reorder is provably moves-only.
- **AC 35.8.3 (mechanical cross-check):** `scripts/check-epics-sync.mjs` (written with the Write tool, Rule #55; header documents the expected-absent convention for the next epic). Post-backfill run: **186 keys / 171 sections / 15 expected-absent / 0 genuine drift / 0 orphans**, exit 0 — exactly the lead's expected post-state. Both failure directions proven RED at dev time: with the 34.5 backfill stashed away it flags `34-5-tool-layer-truncated-and-test-runner-guard` as GENUINE DRIFT, exit 1 (restored after); with a synthetic `### Story 99.1` section appended it flags ORPHAN 99.1, exit 1 (restored after; diff intact).
- **AC 35.8.4 (the gate):** `packages/iris-mcp-all/src/__tests__/epic35-defect-gate.test.ts` — nine legs, each carrying a comment naming the path it guards; RED-proven per the table above. Arming: `packages/iris-mcp-all/scripts/prepublish-gate.mjs` (modeled on dev/data's, with the dist-freshness check deliberately WIDER — it checks the five dists the gate actually drives: shared + dev + admin + data + interop; ops carries no Epic 35 fix) and `prepublishOnly` repointed from `verify-iris-reachable.mjs` (its checks are subsumed, documented in the script header). F5 never toggles `%Service_DocDB` — it pre-reads the live state and skips with a recorded reason if an operator enabled it (documented as intentional even under `IRIS_REQUIRE_LIVE`: the contract under test is the disabled-state translation); F1 restores the fixture value in a `finally` and treats a missing fixture as a publish-blocking failure under arming; F8 cleans up both imported classes in `afterAll` (plus a pre-clean for crash residue).
- **AC 35.8.5 (gates):** `pnpm turbo run build test lint type-check` → **29/29 successful** (no 35-1-DEV-1 flake this run — no substitution needed); the `all` suite ran inside it at **129/129**. `gen:governance-baseline:check` (`:check` ONLY) → exit 0, frozen `1e62c5ad5bf7` / 141 / 201 / 60 (E-2). `gen:bootstrap` → **zero diff**, `BOOTSTRAP_VERSION` `e1168c1ebe56 → e1168c1ebe56` (idempotence = the C-2 re-verification; no `.cls` in this story's diff — Rule #39 rosters untouched). Tool/action counts unmoved (E-1 — the gate is a test; no new keys; the governance checker's 201/60 confirms). Changeset: `.changeset/epic35-defect-gate.md` (patch: `@iris-mcp/all`, `@iris-mcp/dev`, `@iris-mcp/interop` — the packages with user-visible content changes; data/admin got no source or README change this story, only tool_support.md which is repo-root doc, not package content).
- **AC 35.8.6 (count check):** live `iris_execute_tests` `ExecuteMCPv2.Tests` package run → **total 412, passed 412, failed 0**; mechanical line-anchored `Test*` declaration count = **412** — match (see the measurement-correction note in Debug Log for why the naive grep reads 419).
- **Standalone suite counts after all changes (per 35-1-DEV-1 convention):** shared **1326/1326**, dev **712/712**, interop **337/337**, data **161/161**, all **129/129** (120 + 9 gate legs).

### File List

- `packages/iris-mcp-all/src/__tests__/epic35-defect-gate.test.ts` — NEW, the Epic 35 defect gate (9 legs, default suite)
- `packages/iris-mcp-all/scripts/prepublish-gate.mjs` — NEW, packaging-path arming (IRIS_REQUIRE_LIVE=1 + 5 dist-freshness checks)
- `packages/iris-mcp-all/package.json` — `prepublishOnly` repointed to the new gate script
- `packages/iris-mcp-all/src/__tests__/prompt-safety-invariants.test.ts` — glob-guidance test repinned to the post-35.9 refusal wording (35-9-DEV-2)
- `packages/iris-dev-mcp/src/prompts/deployAndTestClass.ts` — prompt wording: bare path is REFUSED (35-9-DEV-2)
- `packages/iris-dev-mcp/src/prompts/objectscriptReview.ts` — same (35-9-DEV-2)
- `skills/deploy-and-test-class/SKILL.md` — regenerated via `pnpm gen:skills` (Rule #18)
- `skills/objectscript-review/SKILL.md` — regenerated via `pnpm gen:skills` (Rule #18)
- `packages/iris-interop-mcp/src/tools/rest.ts` — `iris_interop_rest` description gains the `.impl`-preserved-by-design note (35-5-SMOKE-1)
- `packages/iris-interop-mcp/README.md` — `iris_interop_rest` example block gains the `.impl` note + `iris_doc_delete` remedy pointer (35-5-SMOKE-1)
- `tool_support.md` — three Epic 35 enrichment notes (35.1 + 35.5-interop_rest in the interop section; 35.5-oauth in the admin section; 35.2 build-output isolation in the data fields section)
- `_bmad-output/planning-artifacts/epics.md` — Story 34.5 section reconstructed (provenance-noted) + 34.6-34.8 reordered ascending (byte-identical moves, hash-verified)
- `scripts/check-epics-sync.mjs` — NEW, the repeatable both-directions epics↔sprint-status sync check with expected-absent classification
- `_bmad-output/implementation-artifacts/deferred-work.md` — terminal disposition for `35-5-SMOKE-1` + `35-9-DEV-2`, mechanical tally (0/25/97 = 122 open, 202 distinct, 79 terminal)
- `.changeset/epic35-defect-gate.md` — NEW, patch changeset (`@iris-mcp/all`, `@iris-mcp/dev`, `@iris-mcp/interop`)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `35-8` in-progress → review; `last_updated`
- `_bmad-output/implementation-artifacts/35-8-docs-artifact-rollup-epic-gate.md` — this file

## QA Results

QA agent: qa-35-8 (Claude Fable 5, k3[1m]), 2026-08-19. Diff reviewed UNCOMMITTED as delivered by dev-35-8. All evidence below was re-derived independently — nothing taken from the Dev Agent Record on trust.

### Gate re-run (AC 35.8.4) — all four proofs independently reproduced

- **Default-suite collection:** `pnpm test` in `packages/iris-mcp-all` → **19 files, 129/129 passed** (120 pre-story + 9 gate legs). The gate file is `src/__tests__/epic35-defect-gate.test.ts` (not `*.integration.test.ts`); collected and executed, not skipped.
- **Gate legs execute unarmed with IRIS up:** `npx vitest run src/__tests__/epic35-defect-gate.test.ts` → **9 passed (9)**, zero skips.
- **Armed, IRIS up:** `node scripts/prepublish-gate.mjs` → **exit 0**, all five dist-freshness checks (shared/dev/admin/data/interop) green, vitest reports **9 passed (9)** under `IRIS_REQUIRE_LIVE=1`.
- **Fail-closed:** `IRIS_PORT=59999 node scripts/prepublish-gate.mjs` → **exit 1**; the five dist checks passed FIRST and the failure is the armed gate itself (`IRIS_REQUIRE_LIVE is set, so the Epic 35 defect gate may not be skipped: IRIS is not reachable at http://localhost:59999 …`).
- **Graceful degradation:** `IRIS_PORT=59999 npx vitest run src/__tests__/epic35-defect-gate.test.ts` (unarmed) → **exit 0, 9 skipped (9)**, each leg logging its `[SKIP] epic35-defect-gate (F…)` reason.

### Rule #59 spot-mutations re-run by QA (three highest-value legs)

| Leg | Mutation performed by QA | RED evidence (QA-run) | Restore → GREEN |
|---|---|---|---|
| F2 (raw wire) | Deployed-class revert: `Analytics.cls` @ `796c454^` via `iris_doc_load` from a temp dir (compile ok) | leg RED — `expected '\r' to be '{'` (the exact pre-fix device-text shape on the raw wire) | HEAD redeployed via `iris_doc_load src/**/Analytics.cls` → leg GREEN |
| F4 (cap) | Deployed-class revert: `Security.cls` @ `d8320ef^` | leg RED — `to have a length of 5 but got 50` (server ignored maxRows; the tool's opt-in page size over the unbounded result) | HEAD redeployed → leg GREEN |
| F8 (compile) | Source revert: `format.ts` `if (shouldCompile)` → `if (false as boolean)`, `pnpm --filter @iris-mcp/dev build`, mutation confirmed live in dist (`if (false)` present) | leg RED — `expected true to be undefined` at `callCompiled.isError` (the compile:true import's class NOT callable — the `c` qualifier never reached Atelier) | restored from backup (git diff clean), rebuilt (`if (false)` absent from dist) → leg GREEN |

Post-mutation full gate re-run: **9/9 GREEN** — the deployed classes and dists are verified healthy after all restores. Temp mutation dir (`.tmp-qa358/`) and backup removed; `git status` shows exactly the story's 18-entry diff, nothing QA-added.

### epics.md backfill (AC 35.8.2)

- **34.5 section content:** spot-checked 4 claims against `34-5-tool-layer-truncated-and-test-runner-guard.md` — the story statement and ACs 34.5.1/34.5.3/34.5.7 are verbatim from the story file; the provenance note names the reconstruction source. Reconstructed, not invented: confirmed.
- **34.6–34.8 reorder:** re-derived independently (extraction + SHA-256 via a disposable Node script, deleted after). Section bodies 34.6/34.7/34.8 are **content-identical** HEAD↔work; the only delta my extraction surfaced is the epic-trailing `---` separator, which correctly stayed at the END of the epic's story list (attached to 34.6 in HEAD's wrong order, to 34.8 after the reorder) — a boundary artifact, not a content change. Order is now ascending: `34.1,34.2,34.3,34.4,34.5,34.6,34.7,34.8` (HEAD was `…34.4,34.8,34.7,34.6`).

### check-epics-sync.mjs (AC 35.8.3)

- Run: **186 keys / 171 sections / 15 expected-absent / 0 genuine drift / 0 orphans, exit 0** — the exact expected post-state; all 15 expected-absent rows are the documented classes (14 `N-0-epic-*-deferred-cleanup` + `33-5-late-findings-cleanup`).
- Classifier sanity, both hypothetical branches tested live (synthetic keys appended to a backed-up sprint-status.yaml, restored after): `36-0-epic-35-deferred-cleanup` → classified **expected-absent** (16), exit 0; `36-2-real-story` → **GENUINE DRIFT**, exit 1. Post-restore re-run exit 0.

### Docs rollup (AC 35.8.1) + carried items

- `35-5-SMOKE-1`: `.impl`-preserved-by-design note present in BOTH `iris_interop_rest`'s description (`packages/iris-interop-mcp/src/tools/rest.ts`) and the interop README example block (with the `iris_doc_delete` remedy pointer). Ledger row RESOLVED.
- `35-9-DEV-2`: "mis-maps the class name" → REFUSAL wording on all four surfaces (both `prompts/*.ts` sources + both generated `skills/`); the doc-rot guard repinned. `pnpm gen:skills` re-run by QA → **exit 0, diff unchanged** (idempotent). Ledger row RESOLVED.
- Ledger tally chain audited line-by-line (Rule #51): 35.9 dev (124 open / 201 distinct / 76 terminal) → 35.9 rework closes `35-9-DEV-1` (123/201/77) → 35.9 rework review adds `35-9-CR-1` (124/202/77) → this story closes two (122/202/79). Each step's check arithmetic is correct; the chain is consistent end-to-end.
- Governance default states verified against the LIVE effective policy (`iris_server_profiles`, every key `configSource: "default"` — so this is the default policy, not an override): `iris_oauth_manage:*`, `iris_interop_rest:*`, `iris_doc_load`, `iris_doc_xml_export:import`, `iris_production_item:set` all enabled (grandfathered); `iris_resource_manage:listPrivileges` enabled (read); `iris_resource_manage:grant/revoke` default-disabled. Matches what the docs say.

### Rule #56 doc-surface enumeration (re-derived)

All nine stories' changed contracts present: 35.1 interop README (composite-key, 3 hits) + tool_support; 35.2 tool_support explicit note (the `sync`-untouched/`pVerbose=0` claim verified against `Analytics.cls:300`) + data README example output showing the clean envelope; 35.3 `IRIS_ACCEPT_LANGUAGE` in root + all 6 package READMEs; 35.4 admin README (maxRows/superUserPrivilegesOmitted); 35.5 admin README (sslConfiguration) + interop README + tool_support; 35.6 data README (legacy, 13 hits) + dev README (NOT-compiled note); 35.7 data README (%Service_DocDB); 35.9 dev README (baseDir/REFUSED) + prompts + generated skills. Changeset covers exactly the three packages with user-visible content changes (all/dev/interop); data/admin correctly excluded (their only changes are the repo-root tool_support.md). Marginal observation (not a defect, no action): `iris_doc_load`'s own tool description does not itself state the 35.9 refusal — 35.9 shipped its docs and closed review clean; out of scope here.

### Suites, gates, counts

- Standalone (post-restore, per 35-1-DEV-1 convention): **shared 1326/1326, dev 712/712, data 161/161, interop 337/337, all 129/129** — every dev-claimed count reproduced exactly.
- `pnpm gen:governance-baseline:check` (`:check` ONLY) → **exit 0**, 201 live / 60 post-foundation, frozen baseline intact (E-1/E-2 hold).
- `pnpm run gen:bootstrap` → **exit 0, zero diff**; `BOOTSTRAP_VERSION` stays `e1168c1ebe56` (idempotence = C-2 re-verified). No `.cls` in the diff (#39 rosters untouched).
- AC 35.8.6: live `iris_execute_tests` `ExecuteMCPv2.Tests` package run → **total 412, passed 412, failed 0**; mechanical line-anchored count (`grep -h "^Method Test\|^ClassMethod Test" src/ExecuteMCPv2/Tests/*.cls | wc -l`) = **412**. Match.
- Fixture hygiene: F1 `FixtureOp` comment key absent (baseline restored — verified via `iris_production_item:get` on the fixture production); F8's `Epic35GateXmlCompiled`/`Epic35GateXmlNoCompile` absent from the namespace (`iris_doc_list` filter `Epic35GateXml` → empty); `%Service_DocDB` still `enabled: false` (untouched, per the leg's never-toggle rule).

### Observation (not a defect — recorded for the retro)

The first QA run of the armed gate failed closed on a genuinely STALE-BY-MTIME dist: dev's RED-proof restores (`http-client.ts` from backup) and the idempotent `gen:bootstrap` re-write bumped src mtimes without content changes, and `pnpm turbo run build` (**FULL TURBO** cache restore) plus tsc `composite` incremental both skip re-emit, leaving dist mtimes older than src. The dist-freshness leg did exactly its job (fail closed), and the remedy (`rm packages/*/tsconfig.tsbuildinfo` + `turbo build --force`) is cheap — but a publisher touching src without content change can hit a false-positive freshness block. Fail-closed direction is the safe side; noting for the retro as a possible workflow/doc note. This also gave QA an unplanned live proof of the dist-freshness leg (Rule #59 bonus): it fired, named the package, and refused the publish path.

### Verdict

**PASS — all six ACs verified with independently re-derived evidence.** No defects found. Constraints E-1 (no new keys — governance :check 141/201/60) and E-2 (`:check` only) hold. The gate is collected in the default suite, executes live when armed, fails closed when IRIS is unreachable, degrades gracefully unarmed, and three of its nine legs were re-proven RED by QA's own mutations on the paths they guard.

## Review Findings

Code review 2026-08-19 (reviewer: cr-35-8, Claude Fable 5 k3[1m]). Frozen-diff snapshot `review-diff-snapshot-35-8-docs-artifact-rollup-epic-gate-20260819-094350.diff` captured at review start, disposed at close (Rule #57 FROZEN-DIFF). **Close kind CLEAN, `review_degraded=false`**: all three layers DELIVERED explicit payloads as sequential synchronous in-process layers (the 35.6/35.7/35.9 adaptation — an in-process teammate cannot spawn background agents), each against its own real armed 20-minute background timer (Blind ~12m, Edge ~9m, Auditor ~22m incl. live gate runs and policy spot-checks); `failed_layers` empty. 11 raw findings → 7 after dedupe: **5 patched, 2 dismissed, 0 deferred, 0 decision-needed, no surviving HIGH/MEDIUM.**

- [x] [Review][Patch] **F1 fixture restore discarded its result** [`packages/iris-mcp-all/src/__tests__/epic35-defect-gate.test.ts` finally block] (LOW, Blind B1) — a failed restore would leave the shared fixture marker-polluted under a GREEN leg (and the next run would read the marker as the "original"). The restore's result is now inspected and the leg THROWS loudly naming the fixture and the pollution risk. **Mutation-proven RED**: finally-block restore pointed at a bogus production → leg RED with the exact new message; gate file restored byte-exact (md5); the deliberately-stranded marker cleaned manually via `iris_production_item:set` and the fixture verified comment-absent; full gate 9/9 GREEN after.
- [x] [Review][Patch] **F5 precondition collapsed shape-rot into the operator-skip** [same file, F5 leg] (LOW, Blind B2) — `enabled !== false` treated `undefined` (a broken/renamed `/security/service` response shape) as "operator-enabled" and skipped even under `IRIS_REQUIRE_LIVE`, with a misleading reason. Now tri-state: `true` → documented operator skip, `false` → proceed, anything else → THROW (fail-closed). **Fail-closed proven live**: a bogus service name in the probe makes the leg RED via the route's `IrisApiError` (the realistic failure mode — the route errors on unknown services, so it cannot silently return a shapeless 200); the shape-rot branch itself verified by inspection (three lines, no external dependency).
- [x] [Review][Patch] **`check-epics-sync.mjs` blind to DUPLICATE sections** [`scripts/check-epics-sync.mjs`] (LOW, Blind B3) — the Set-based correspondence check could not see a `### Story N.M:` header appearing twice. The script now flags duplicates and exits 1. **Mutation-proven**: synthetic duplicate `### Story 34.5` appended → `DUPLICATE: 34.5`, exit 1; `epics.md` restored byte-exact (md5 `c9fdd9bf…` both sides), exit 0 after.
- [x] [Review][Patch] **Driven-package `skipped` freshness only logged** [`packages/iris-mcp-all/scripts/prepublish-gate.mjs`] (LOW, Blind B4 + Edge E2 — all five driven packages verified to declare `files: ["dist"]` today, so this needed a second regression to fire) — a `files:["dist"]` manifest regression in a gate-driven package would log-and-proceed over an unverifiable dist. Now fails CLOSED with a remedy message. **Mutation-proven**: `dist` dropped from `packages/shared/package.json` `files` → exit 1 with the exact new message; restored byte-exact (md5), `git diff` empty.
- [x] [Review][Patch] **prepublish header membership rule imprecise** [same script] (LOW, Edge E1) — "every live-IRIS gate file belongs in this list" is wrong for this package: the five `*-process-gate.test.ts` files are live but do NOT implement the `IRIS_REQUIRE_LIVE` arming contract, so listing them would be a no-op. Comment corrected: the membership rule is ARMED live gates (currently exactly one); arming another means adding the contract to the file AND listing it.
- Dismissed (2): **gate hardcodes `IRIS_HTTPS: "false"`** while other connection params are env-driven (Blind B5 + Edge E5) — consistent with every live gate in this repo (local-dev convention; the publish path runs on the maintainer's instance; host/port/user/pass/namespace are env-overridable). **F3's Arabic-prefix pin is instance-specific** (Blind B6) — the positive `toContain("ERROR #5001")` assertion fails on ANY wrong locale, so coverage is not instance-fragile.

**Reviewer-run Rule #59 spot-mutations (lead-directed, F1 + F6):** F1 RED via deployed-class revert of `Interop.cls` @ `3c7adec^` (pre-35.1) — `set.isError === true`, the exact pre-fix shape — then HEAD redeploy → GREEN, fixture verified unpolluted. F6 RED via deployed-class revert of `Security.cls` @ `d8320ef` (F4 fixed, F6 absent) — error lacked `No OAuth2 server definition exists for issuer` — then HEAD redeploy → full gate **9/9 GREEN**. Both mutations hash-verified at staging and restore (Interop `f84b622f…`, Security `c2fac948…`).

**Reviewer re-ran live (nothing taken on trust):** gate 9/9 unarmed; armed `prepublish-gate.mjs` exit 0 with all five dist checks fresh and legs executing; `IRIS_PORT=59999` fail-closed exit 1 with the exact `IRIS_REQUIRE_LIVE` beforeAll message after all five freshness checks passed first; `check-epics-sync.mjs` 186/171/15/0/0 exit 0; `gen:governance-baseline:check` (`:check` only) exit 0 at frozen 141/201/60; `gen:bootstrap` zero diff (`BOOTSTRAP_VERSION` `e1168c1ebe56`); `gen:skills` idempotent; `iris_execute_tests` 412/412 = line-anchored mechanical 412; 34.5 reconstruction spot-verified verbatim against its story file; 34.6-34.8 reorder hash-verified moves-only (170→171 sections, ascending); governance default states match the LIVE effective policy (dev + admin profiles, every key `configSource: "default"`); all 11 gate-driven tool names resolve in the built leaf dists; `iris-mcp-all` vitest include confirmed to collect the gate (only `*.integration.test.ts` excluded) and turbo `test` dependsOn `build` (the standard path rebuilds first — the stale-dist-green-over-broken-source hole needs both turbo AND the prepublish freshness leg bypassed); post-patch full `all` suite **129/129** (19 files), armed gate exit 0, sync exit 0. Instance hygiene: `Epic35GateXml*` absent, F1 fixture comment absent, `%Service_DocDB` untouched (`enabled:false` — never toggled, only read).

**Independently reproduced QA's retro observation LIVE:** this review's own `gen:bootstrap` idempotence run bumped `packages/shared` src mtime; tsc composite skipped re-emit; the armed gate's freshness leg FAILED CLOSED naming `@iris-mcp/shared` — the exact QA-documented false-positive shape, remedied per QA's note (`rm tsconfig.tsbuildinfo` + rebuild). Fail-closed direction confirmed the safe side; the record already exists in QA Results above.

**Retro note (not re-flagged):** cycle-log model attribution recurred a 4th time (35.8 dev/QA rows say `spawn_tier=sonnet`; the stories record fable-5) — the story's standing note leaves reconciliation to the retro.

## Change Log

| Date | Change | Author |
|---|---|---|
| 2026-08-19 | Story created (capstone, runs last). Lead verified at source: the mechanical 35.8.3 baseline recomputed (186 keys / 170 sections / 16 absent = 15 expected + 34.5; expected post-state 171/15/0 orphans); the Epic 34 gate + prepublish-gate pattern re-read as the model; placement decided as ONE consolidated gate in `iris-mcp-all` (the only all-five-servers package, Rule #45) with new prepublish arming proven fail-closed; carried items `35-5-SMOKE-1` and `35-9-DEV-2` assigned here; BOOTSTRAP_VERSION expectation is unchanged (`e1168c1ebe56`, idempotence as the C-2 proof). | Lead (claude-opus-5) |
| 2026-08-19 | Story implemented (dev-35-8): docs rollup (three tool_support.md enrichments + two carried ledger items landed/closed); epics.md 34.5 reconstructed (provenance-noted) + 34.6-34.8 reordered (byte-identical moves, hash-verified); `scripts/check-epics-sync.mjs` (both-directions, classifying, fail-closed — RED-proven in both directions); the Epic 35 defect gate (9 legs, each RED-proven on the path it guards — 4 deployed-class reverts, 5 source reverts) armed fail-closed on the packaging path via `packages/iris-mcp-all/scripts/prepublish-gate.mjs`. Gates: turbo 29/29; governance :check exit 0 (141/201/60); bootstrap idempotent (`e1168c1ebe56`); OS tests 412/412 = mechanical 412; suites shared 1326 / dev 712 / interop 337 / data 161 / all 129 (120+9). | dev-35-8 (claude-fable-5) |
| 2026-08-19 | QA complete (qa-35-8): all four arming proofs re-run (default-suite 129/129 collection; armed 9/9 exit 0; IRIS_PORT=59999 fail-closed exit 1; unarmed-down graceful 9-skip exit 0); Rule #59 spot-mutations re-run on F2/F4/F8 (each RED on its guarded path, restored GREEN, full gate 9/9 after); 34.5 backfill spot-verified verbatim + 34.6-34.8 reorder content-identical (trailing `---` is the epic boundary artifact); sync check 186/171/15/0/0 exit 0 with both classifier branches tested live; docs rollup verified (carried items, gen:skills idempotent, governance defaults match the live policy); Rule #56 enumeration complete; suites 1326/712/161/337/129; governance :check exit 0; bootstrap idempotent; OS tests 412/412 = mechanical 412; instance hygiene verified. One retro-note observation (turbo-cache/tsc-incremental stale-mtime false-positive on the freshness leg — fail-closed, safe side). **PASS.** | qa-35-8 (claude-fable-5) |
| 2026-08-19 | Code review complete (cr-35-8) — review → done. Close CLEAN, review_degraded=false (3/3 layers delivered as sequential synchronous in-process layers under armed 20-min timers; frozen diff disposed at close). 11 raw → 7 after dedupe: 5 patched (all LOW, each mutation- or live-proven: F1 loud restore failure, F5 tri-state fail-closed precondition, sync-check duplicate-section detection, prepublish driven-package skipped-freshness fail-closed, prepublish header membership precision), 2 dismissed (IRIS_HTTPS hardcode = repo convention; F3 Arabic pin covered by the positive ERROR # assertion), no surviving HIGH/MEDIUM. Reviewer spot-mutations: F1 and F6 each proven RED via deployed-class reverts (Interop.cls @ 3c7adec^, Security.cls @ d8320ef) and restored GREEN with the full gate 9/9 after. All gates re-run live post-patch: gate 9/9, all suite 129/129, armed prepublish exit 0, sync exit 0, governance :check exit 0 (141/201/60), bootstrap idempotent e1168c1ebe56, OS tests 412/412 = mechanical 412. Instance clean (fixtures absent/restored, DocDB untouched). | cr-35-8 (claude-fable-5) |
| 2026-08-19 | Lead smoke PASS: sync check exit 0 (186 keys / 171 sections / 15 expected-absent / 0 drift / 0 orphans / 0 duplicates - the exact predicted post-state); default suite 129/129 with the gate collected; armed prepublish-gate exit 0 with 9/9 legs EXECUTED; fail-closed proven (IRIS_PORT=59999 exit 1 with the clear FAILED CLOSED message); governance :check exit 0. Review patches (F1 loud-restore, F5 tri-state precondition, sync-check duplicate detection, freshness fail-closed, arming header correction) all verified in place. | Lead (claude-opus-5) |
