# Story 35.6: MEDIUM - `doc_xml_export:import` Compile Parity + `rest_manage:get` Legacy Routing

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **operator or AI client calling `iris_doc_xml_export:import` or `iris_rest_manage:get`**,
I want **imported XML documents to be compilable in the same call (with an honest signal when they are not compiled), and `get` to resolve every name that `list` returns — or fail with an accurate reason**,
so that **an "imported" document is actually usable, and I never chase a phantom "web server configuration" problem that is really a by-design scope boundary**.

## Context — why this story exists

Two ledger items from the 2026-08-17 post-Epic-34 full-surface sweep:

- **`35-SWEEP-8`** (MEDIUM): `iris_doc_xml_export:import` POSTs Atelier `action/xml/load` (`format.ts:163`), which loads definitions **without compiling**. Response `{"imported":["…XmlProbe.cls"]}` is followed by `<CLASS DOES NOT EXIST>` on invocation; only a separate `iris_doc_compile` makes the class usable. No `compile` option (unlike `iris_doc_load`), no warning.
- **`35-SWEEP-9`** (MEDIUM): `iris_rest_manage:list` with `scope:"all"` returns `/api/executemcp/v2` (a legacy hand-written `%CSP.REST` app), but `get` on that exact name 404s via the Mgmnt API with *"Check the IRIS web server configuration"* — misleading: per Rule #12 the Mgmnt API knows spec-first apps only, by design. Story 12.5 added the dual-scope `list` but never swept `get`.

Ledger: `deferred-work.md` lines 2359-2360. **This story is pure TypeScript — no ObjectScript handler changes, so NO bootstrap regen; `BOOTSTRAP_VERSION` must NOT move (currently `e1168c1ebe56`). Prove that.**

## Acceptance Criteria

Sourced verbatim from `_bmad-output/planning-artifacts/epics.md`, "### Story 35.6".

1. **AC 35.6.1** - `iris_doc_xml_export` `import` no longer reports bare success for a document that is not usable. Verified today: `{"imported":["...XmlProbe.cls"]}` followed by `<CLASS DOES NOT EXIST>` on invocation; a separate `iris_doc_compile` fixes it.
2. **AC 35.6.2** - Probe-first (#16): determine whether Atelier's `action/xml/load` (`format.ts:163`) accepts a compile qualifier natively, or whether a follow-up compile call is required. Implement whichever is REAL - do not assume the flag exists. Record the probe.
3. **AC 35.6.3** - Expressed as an additive `compile` PARAMETER mirroring `iris_doc_load`'s existing `compile`/`flags` options - NOT a new action (Constraint E-1). Default preserves today's behavior (Rule #19); when compile is not requested, the response states plainly that imported documents are uncompiled.
4. **AC 35.6.4** - `iris_rest_manage:get` handles legacy dispatch apps. Today `list` with `scope:"all"` returns `/api/executemcp/v2` but `get` on that exact name 404s via the Mgmnt API with *"Check the IRIS web server configuration"* - a misleading message for a by-design limitation (Rule #12: the Mgmnt API lists spec-first apps only). Either route legacy names to the legacy path or return a clear, correct explanation. A name that `list` returns must never fail with a message implying server misconfiguration.
5. **AC 35.6.5** - Live proof of the list->get round trip for BOTH scopes: every name returned by `scope:"all"` is resolvable by `get`, or fails with an accurate reason. Spec-first `get` (verified working today) must be unchanged.

## Lead pre-story findings — verified at source, ready to build on

**1. AC 35.6.2's probe is already answered — the native qualifier EXISTS.** `LoadXMLFiles` (`irislib/%Api/Atelier/v7.cls:307`, inherited by `%Api/Atelier/v8` which owns the live route) reads a `flags` query parameter at line 346 (`Set tFlags = $GET(%request.Data("flags",1))`) and passes it straight to `$SYSTEM.OBJ.LoadStream(tStrm, tFlags, …)` (line 375). The `c` qualifier compiles after load — so `POST /action/xml/load?flags=ck` compiles natively. **No follow-up `action/compile` call is needed.** Dev still re-probes live (a real import with `?flags=ck` → class immediately callable), because the source claim and the live behavior must agree (#16/#36).

**2. The load response already carries per-file error text.** Response shape: `{content: [{file, imported: [...], status: ""}]}`; on failure the per-file `status` gets `$SYSTEM.Status.GetErrorText(tSC)` (`v7.cls:388`). With `c` in the flags, **compile errors land in that per-file `status`** — that is your Rule #59 discriminating oracle: import deliberately-broken XML with `compile: true` → `status` carries the compile error (proves `c` reached LoadStream); with `compile: false` → load reports success while the class stays unusable.

**3. `rest.ts` (data package) anatomy for AC 35.6.4.** `get` (lines 201-215) always hits `/api/mgmnt/v2/{ns}/{application}`; the generic `IrisApiError` catch (294-306) renders the Mgmnt API's misleading 404 text. `fetchLegacyApps(ctx, ns)` (lines 40-61) already exists and returns `[{name, dispatchClass, namespace, swaggerSpec: null}]` — **reuse it; do not invent a second legacy lookup (#47)**. Design: on a Mgmnt 404 (match the **HTTP status**, never the message text — Rule #8/#13 localization lesson), consult `fetchLegacyApps`; name found → return the legacy detail `{name, dispatchClass, namespace, swaggerSpec: null}` plus an explanation field (legacy `%CSP.REST` apps have no OpenAPI spec by design); not found in either scope → an accurate not-found naming BOTH scopes checked. Spec-first `get` must stay byte-identical (Rule #19 pin against the current shape).

**4. `delete` has the same legacy gap but is NOT in the ACs.** Do not route `delete` to a legacy path (deleting a legacy app is `iris_webapp_manage:delete`'s job — deleting the webapp, not the spec classes). Instead: state the spec-first-only limitation in the `delete` description and, if the Mgmnt 404 message is surfaced on delete, prefer the accurate explanation there too when it shares the get path's mechanism cheaply. Document whichever you do.

**5. Governance verified (do not re-derive):** `iris_doc_xml_export:import` is `write` but grandfathered default-ENABLED; `iris_rest_manage:get/list` are `read`; all keys pre-existing in the frozen baseline (`baseline-classifications.ts:91-93,184-186`). Additive parameters only — no baseline or classification change (E-1/E-2).

## Tasks / Subtasks

- [x] **Task 1 — Live probe of the native compile path (AC 35.6.2)**
  - [x] Import a small valid class XML via the DEPLOYED Atelier endpoint with `?flags=ck` → the class is immediately callable (invoke a classmethod on it). Same import without flags → loaded but NOT callable (`<CLASS DOES NOT EXIST>` on invoke). Record both in Dev Notes.
  - [x] Probe the flags-folding rule you will implement: user `flags` without `c` + `compile: true` must still compile (fold `c` in); document the rule.
  - [x] Clean up every probe class from IRIS and disk.

- [x] **Task 2 — `iris_doc_xml_export` compile parity (AC 35.6.1, 35.6.3)**
  - [x] `packages/iris-dev-mcp/src/tools/format.ts` import branch (149-174): additive `compile` (boolean, default false) and `flags` (string, optional — "Only used when compile is true", mirroring `load.ts:209-215` naming and semantics).
  - [x] `compile` omitted/false → **send NO `flags` query param at all** (byte-identical request to today) and add an additive response note stating the imported documents are NOT compiled and naming the remedy (`compile: true` or `iris_doc_compile`). The AC mandates this note; keep every existing response field untouched.
  - [x] `compile: true` → `?flags=` with `c` guaranteed present (fold into user flags if absent); document the folding rule in the `.describe()`.
  - [x] Surface the per-file `status` text when non-empty so compile failures are visible in the tool response.

- [x] **Task 3 — `iris_rest_manage:get` legacy routing (AC 35.6.4)**
  - [x] `packages/iris-data-mcp/src/tools/rest.ts` get branch: on Mgmnt 404 → legacy lookup → legacy detail or accurate both-scopes not-found. Intercept BEFORE the generic catch renders the misleading message.
  - [x] `fullSpec: true` with a legacy app: `swaggerSpec` stays `null` (there is no spec) — handle deliberately, not incidentally.
  - [x] `delete` description gains the spec-first-only limitation (no behavior change).
  - [x] Tool `description` updated: `get` resolves legacy names returned by `list scope:"all"/"legacy"` and what the legacy shape means.

- [x] **Task 4 — Tests**
  - [x] Extend `packages/iris-dev-mcp/src/__tests__/format.test.ts`: `compile: true` sends `?flags` containing `c`; omitted `compile` sends NO `flags` param (back-compat pin that fails on drift); uncompiled note present iff compile not requested; flags-folding rule pinned; non-empty per-file `status` surfaced.
  - [x] Extend `packages/iris-data-mcp/src/__tests__/rest.test.ts`: Mgmnt 404 + legacy hit → legacy detail shape; 404 + no legacy hit → accurate both-scopes error, asserting the misleading "web server configuration" text is ABSENT; spec-first get unchanged (`toEqual` pin on the pre-feature shape); `fullSpec` + legacy handled.
  - [x] No ObjectScript test class this story (no handler change) — the live proof below is the wire-level evidence.

- [x] **Task 5 — Live proof (AC 35.6.1, 35.6.5; Rules #26/#36/#59)**
  - [x] XML: import broken-syntax class XML with `compile: true` → per-file `status` carries the compile error; with `compile: false` → success + honest uncompiled note + class not callable; valid XML + `compile: true` → immediately callable classmethod. Delete all imported classes afterward.
  - [x] REST: `list scope:"all"` → confirm `/api/executemcp/v2` present; `get` that name → legacy detail, response contains NO "web server configuration" text; `get` a spec-first app → unchanged (control); `get` `/no/such/app` → accurate not-found naming both scopes.
  - [x] Run the live proof through BOTH the raw endpoints and the built tool layer (fresh-Node dist smoke — carry-forward from 35.4/35.5: curl alone sits below the TS layer where this story's fixes live).

- [x] **Task 6 — Docs at point of use (Rule #30/#43/#56)**
  - [x] Every surface in Dev Notes → *Doc surfaces*, including the explicit `packages/iris-mcp-all/README.md` check (thrice-missed blind spot). **Run every README example you touch against the live instance** — the 35.5 lead smoke caught a corrected example that still didn't work (OpenAPI 3.0 vs 2.0). A documented example that the implementation rejects is this epic's F7 defect class.

- [x] **Task 7 — Constraints and gates**
  - [x] E-1: no new tool, no new action key — additive parameters only. Tool/action counts unmoved (`@iris-mcp/all` suite).
  - [x] E-2: `pnpm gen:governance-baseline:check` ONLY, exit 0 at frozen `1e62c5ad5bf7`/141/201/60.
  - [x] **No ObjectScript change ⇒ NO bootstrap regen; assert `BOOTSTRAP_VERSION` stays `e1168c1ebe56` and `bootstrap-classes.ts` is absent from your diff.**
  - [x] Per-package standalone suites (dev/data/shared/all) — never the full parallel `turbo run` (`35-1-DEV-1`).
  - [x] Ledger: `35-SWEEP-8` and `35-SWEEP-9` to terminal RESOLVED with a mechanical tally (#51). Changeset: patch for `iris-dev-mcp` + `iris-data-mcp`.

## Dev Notes

### Back-compat pins (Rule #19)

- `import` with `compile` omitted: the HTTP request is **byte-identical** (no `flags` param) — the ONLY response change is the additive uncompiled note the AC mandates. Prove with a test that fails on drift in either direction.
- `get` on a spec-first app: byte-identical response shape (`toEqual` pin).
- `get` on legacy names and nonexistent names changes from misleading-error to data/accurate-error — that IS the fix; say so in the completion notes rather than claiming universal back-compat.

### Traps

- **Match the 404 by HTTP status, never by message text** — the Mgmnt message is prose (and in principle localizable). Check how `IrisApiError` exposes status in `packages/shared/src/http-client.ts` before writing the branch.
- **`ctx.paginate` does not apply here** — no pagination on these tools; don't add any.
- **Name matching for the legacy lookup:** `list` returns names like `/api/executemcp/v2`; match the requested `application` string against those names exactly, and probe case-sensitivity (webapp names are case-sensitive in IRIS config) before deciding on normalization. State the rule you ship.
- **`flags` folding:** `compile: true` with user flags that lack `c` must still compile. `compile: false` + user `flags` → flags are ignored AND the describe text says so (mirror `load.ts` semantics).
- The F8 fix lives entirely in the TS layer — the deployed Atelier endpoint is InterSystems code; you are NOT modifying it.
- **Rule #55:** never generate file content through a shell heredoc.

### Testing standards

- Existing suites to extend: `packages/iris-dev-mcp/src/__tests__/format.test.ts`, `packages/iris-data-mcp/src/__tests__/rest.test.ts` (mock-HTTP; fixtures must be shapes the real APIs return — Rule #54; the xml/load response shape is in finding #2 above, pinned from `v7.cls` source).
- Rule #59: the compile path must be proven by the broken-XML oracle (above), not by "the param parses". The legacy-`get` path must be proven against the REAL `/api/executemcp/v2` legacy app, not only a mocked 404.
- Verify per-package standalone: `dev`, `data`, `shared`, `all` (current baselines: dev 665, data 134, shared 1326, all 120 — your new tests add to these).

### Doc surfaces — enumerate exhaustively (#56)

| File | What changes |
|---|---|
| `packages/iris-dev-mcp/src/tools/format.ts` | tool description + `compile`/`flags` `.describe()` (uncompiled-by-default honesty, folding rule) |
| `packages/iris-dev-mcp/README.md` | `iris_doc_xml_export` row (line 178, params gain `compile?`/`flags?`) + the XML import example (check ~line 630 area — export is there; find/verify the import example and RUN it) |
| `packages/iris-data-mcp/src/tools/rest.ts` | `get`/`scope`/`delete` description updates |
| `packages/iris-data-mcp/README.md` | `iris_rest_manage` section (lines 159-171 + examples ~453-522): `get` resolves legacy names; legacy shape meaning; `delete` spec-first-only |
| `tool_support.md` | line 40 (xml_export row), 269 + 282-292 (rest_manage rows) — update if the contract text there is stale |
| `packages/iris-mcp-all/README.md` | CHECK EXPLICITLY (expected: no change — count-granularity; record the check) |
| root `README.md` | CHECK (expected: no change) |

### Project Structure Notes

- `packages/iris-dev-mcp/src/tools/format.ts` — import branch lines 149-174; `requireMinVersion(ctx.atelierVersion, 7, …)` gate at line 119 stays (xml/load is v7+).
- `packages/iris-data-mcp/src/tools/rest.ts` — `fetchLegacyApps` 40-61; `get` branch 201-215; summary-mode shaping 237-285 (the legacy detail path must not fall into the spec-summary shaping blindly).
- `load.ts:297-309` is the compile-on-load idiom for reference (`action/compile` + flags) — you are NOT using it (native `flags` on xml/load is the real path), but parameter naming/semantics mirror `load.ts:209-215`.
- Reference source (read-only): `irislib/%Api/Atelier/v7.cls:307-408` (`LoadXMLFiles`), route at `v8.cls:116`.

### Previous story intelligence — Stories 35.4/35.5

- **Run, don't read, every documented example you ship** (35.5 lead smoke caught the corrected README example still failing on an OpenAPI version axis nobody re-ran).
- **Audit lists must be re-derived, never trusted** (35.5's pre-enumerated `e.g.` list missed 4 files; the mechanical re-run caught them).
- **A back-compat pin must be able to fail** (35.4 HIGH: vacuous pin against a no-op mock). The "no `flags` param when compile omitted" pin must inspect the actual request URL/params.
- **Tool-layer smoke matters** (35.4: curl sits below the TS layer; this story's fixes are ENTIRELY in the TS layer, so the fresh-Node dist smoke is where they live or die).
- **35-1-DEV-1:** full parallel `turbo run` is environmentally flaky; per-package standalone only.
- Correcting the story's own claims when evidence contradicts them is normal and expected (35.5 corrected its governance note at smoke).

### References

- Ledger: `_bmad-output/implementation-artifacts/deferred-work.md` lines 2359-2360 (`35-SWEEP-8`, `35-SWEEP-9`)
- Epic + ACs: `_bmad-output/planning-artifacts/epics.md`, "### Story 35.6" (constraints E-1/E-2 at "## Epic 35")
- Sweep evidence: `sprint-change-proposal-2026-08-17.md` F8/F9 (lines 41-42)
- Prior story: `35-5-validate-before-delegating-oauth-restname.md` (done — commit cef1d4b)
- Rules: `.claude/rules/project-rules.md` — #10, #12, #16, #19, #26, #30/#43, #31, #36, #38, #45, #47, #51, #54, #55, #56, #59

## Dev Agent Record

### Agent Model Used

claude-fable-5 (k3[1m])

### Debug Log References

No debug globals needed (pure-TS story). Probe evidence was captured directly in terminal transcripts:

- **Task 1 XML probes** (raw endpoint, `node load-probe.mjs` against `POST /api/atelier/v8/USER/action/xml/load`, IRIS 2026.1 Build 235U, 2026-08-18):
  - Valid XML, NO flags → HTTP 200, per-file `status: ""`, class imported but **NOT callable**: `<CLASS DOES NOT EXIST>InvokeWithArgs *ExecuteMCPv2.XmlProbe356` (reproduces 35-SWEEP-8 exactly).
  - Valid XML, `?flags=ck` → console shows "Compiling class ExecuteMCPv2.XmlProbe356"; classmethod invoke returns `xml-probe-356-ok` — **AC 35.6.2's source claim confirmed live** (native qualifier exists; no follow-up `action/compile` needed).
  - Valid XML, `?flags=c` (the exact default the fold ships) → compiles, callable.
  - Valid XML, `?flags=k` (no `c`) → loads, NOT callable — grounds the folding rule: `c` is the compiling qualifier, so `compile: true` + user flags lacking `c` must fold `c` in. Shipped rule: fold unless the flags string already contains a lowercase `c` (lowercase-only check keeps the "must still compile" guarantee even if a caller passes a different-cased letter).
  - Broken XML (unterminated string), `?flags=ck` → HTTP 200, `status.errors` EMPTY, compile error ONLY in per-file `status` (`…#5475: Error compiling routine… #1001: Missing closing quotation mark…`) — the Rule #59 discriminating oracle, and the reason the tool surfaces per-file status. (The raw probe rendered the `خطأ` Arabic prefix because a bare `fetch` sends `Accept-Language: *`; the built client pins `en` per Story 35.3 — the tool-layer smoke below rendered English `ERROR #5475`.)
- **Task 1 REST probes** (raw): `GET /api/mgmnt/v2/USER/%2Fapi%2Fexecutemcp%2Fv2` and `/no/such/app` → HTTP 404 with a `text/html` CSP-gateway page (this is what `http-client.ts` renders as "…non-JSON response. Check the IRIS web server configuration."). Legacy webapp list in **HSCUSTOM** (not USER) returns `/api/executemcp/v2` → `ExecuteMCPv2.REST.Dispatch`. Name-matching rule shipped: EXACT, case-sensitive — webapp names are case-sensitive IRIS config names and `list` returns the exact registered name, so normalization would risk resolving to a different webapp.
- **Task 5 fresh-Node dist smoke** (`smoke-35-6.mjs`, built dists, real `IrisHttpClient`, deleted after use): 13/13 PASS — xml no-compile (note present + class NOT callable), xml compile:true (no note + class callable returning `xml-smoke-356-ok`), xml compile:true broken (per-file status surfaced), rest list scope:all (7 items incl. `/api/executemcp/v2`), rest get legacy (detail shape, no "web server configuration"), fullSpec:true legacy (swaggerSpec null), spec-first control `HS.FHIRServer.MFE.V1` (unchanged summary shape, `pathCount:1`), get `/no/such/app` (accurate both-scopes not-found), delete legacy (refused with spec-first-only explanation; app verified still present afterwards).
- **Task 6 README example run**: the exact `iris_doc_xml_export` import JSON added to the dev README was executed against the live instance through the built dist — output matched the documented shape (`status: ""`, no uncompiled note with `compile: true`); `MyApp.Service.cls` deleted afterwards.

### Completion Notes List

- **AC 35.6.1** — `import` no longer reports bare success for an unusable document: default path carries the additive "loaded but NOT compiled … re-run with compile: true, or compile them afterwards with iris_doc_compile" note; `compile: true` compiles in the same call (proven callable live).
- **AC 35.6.2** — probe recorded above: the native `flags` qualifier is REAL (`?flags=ck` compiles; `k` alone does not); no follow-up compile call implemented. Folding rule documented in the `flags` `.describe()` and `foldCompileFlag` banner.
- **AC 35.6.3** — additive `compile`/`flags` parameters on `iris_doc_xml_export` only (E-1: no new tool/action key; `@iris-mcp/all` suite 120/120 unchanged). Back-compat pin: compile omitted ⇒ request URL has NO `flags` param and `structuredContent` is the untouched API result (asserted by exact-URL `toHaveBeenCalledWith` + `toEqual`); the only change is the mandated additive note in `content[]`.
- **AC 35.6.4** — `get` on Mgmnt HTTP 404 (status-matched, never message text — #8/#13) falls back to the existing `fetchLegacyApps` helper (#47, no second legacy lookup invented): legacy hit ⇒ `{name, dispatchClass, namespace, swaggerSpec: null, explanation}` (fullSpec deliberately inert); miss ⇒ accurate not-found naming BOTH scopes. The misleading "web server configuration" text is never surfaced. `delete` documents AND enforces the spec-first-only scope with an explanation pointing at `iris_webapp_manage:delete` (lead finding #4's "cheaply shared mechanism" option taken — same `findLegacyApp` helper; verified live that the refused delete removed nothing).
- **AC 35.6.5** — list→get round trip proven live for both scopes via the fresh-Node dist smoke (above); spec-first `get` unchanged (control + existing `toEqual` summary/full-blob pins green).
- Behavior-change disclosure (per the story's own Dev Notes): `get` on legacy and nonexistent names intentionally changes from misleading-error to data/accurate-error — that IS the fix, not a back-compat break.
- Rule #54 fixture correction: the pre-existing import fixture claimed per-file `status: "OK"` on success; the live capture pins success as `status: ""` — fixture corrected with a citation comment.
- Docs: dev README (row + new run-verified import example), data README (legacy-names section + get details block + delete note), tool_support.md (rows 40, 269 area + new 35.6 entries). `packages/iris-mcp-all/README.md` and root `README.md` CHECKED EXPLICITLY — neither contains per-tool contract text for these tools (grep for `xml_export|rest_manage`: no matches); counts unmoved, so no change — recorded per the doc-surfaces table.
- Cleanup: probe classes `ExecuteMCPv2.XmlProbe356(.Bad)` / `ExecuteMCPv2.XmlSmoke356(.Bad)` / `MyApp.Service` all deleted from USER (verified via `iris_doc_list` — empty); `smoke-35-6.mjs`, `readme-example-35-6.mjs`, and `%TEMP%/probe356/` deleted from disk.

### File List

- `packages/iris-dev-mcp/src/tools/format.ts` — additive `compile`/`flags` params + folding + uncompiled note + per-file status surfacing (import branch only)
- `packages/iris-dev-mcp/src/__tests__/format.test.ts` — 8 dev tests (flags pin, no-flags back-compat pin, note iff uncompiled, folding, status surfacing) + live-pinned import fixture correction; **QA: +2 tests (uppercase-`C` fold pin, multi-entry selective per-file status) + Rule #54 sibling fixture correction in the list action (live-pinned `status: ""`, `ts: -1`)**
- `packages/iris-dev-mcp/README.md` — `iris_doc_xml_export` row + run-verified import example
- `packages/iris-data-mcp/src/tools/rest.ts` — `findLegacyApp` + `notFoundBothScopes` helpers; get/delete Mgmnt-404 legacy routing; description updates (get/legacy shape, delete spec-first-only, fullSpec inert on legacy)
- `packages/iris-data-mcp/src/__tests__/rest.test.ts` — 6 dev tests (legacy hit shape, fullSpec+legacy, both-scopes not-found, failing-fallback tolerance, non-404 passthrough, delete legacy refusal); **QA: +1 test (fallback-route pin: second GET goes to `/api/executemcp/v2/security/webapp?namespace=HSCUSTOM`)**
- `packages/iris-data-mcp/README.md` — legacy-names section, get details block note, delete spec-first-only note
- `tool_support.md` — xml_export row flags note; new Story 35.6 entries for rest_manage get/delete + xml_export import
- `.changeset/xml-import-compile-and-legacy-rest-get.md` — patch changeset (`@iris-mcp/dev` + `@iris-mcp/data`)
- `_bmad-output/implementation-artifacts/deferred-work.md` — `35-SWEEP-8`/`35-SWEEP-9` terminal RESOLVED + Rule #51 tally
- `_bmad-output/implementation-artifacts/35-6-xml-import-compile-and-legacy-rest-get.md` — this story file
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status transitions

## QA Results (2026-08-18, bmad-agent-qa / Quinn)

**Verdict: PASS.** No product-code defects found. Every live claim was independently reproduced through a QA-authored fresh-Node smoke against the built dists (rebuilt from the working tree first) with a real `IrisHttpClient` — nothing taken from the dev transcript on faith.

**Live reproduction (QA-authored smoke, 35/35 PASS, IRIS 2026.1 Build 235U):** the template XML was captured by EXPORTING a live class (self-oracled, Rule #36), not hand-written. (a) Import valid XML, `compile` omitted → additive "NOT compiled" note naming both remedies + class NOT callable (`<CLASS DOES NOT EXIST>` — 35-SWEEP-8 reproduced); `compile: true` → no note + class immediately callable (`Ping()` → `qa-356-ok`). (b) Rule #59 oracle: broken-syntax XML + `compile: true` → per-file `status` carries the compile error (`ERROR #5475`/`#1001`), HTTP stays 200, class not callable. (c) `get` `/api/executemcp/v2` in HSCUSTOM → legacy detail (`dispatchClass: ExecuteMCPv2.REST.Dispatch`, `swaggerSpec: null`, `explanation` present); "web server configuration" text ABSENT. (d) Spec-first control (first app from `list scope:"spec-first"`, picked dynamically) → unchanged summary shape, no `explanation` field. (e) `get` `/no/such/app` → accurate not-found naming BOTH scopes. All 12 imported classes deleted; `docnames` filter confirms none remain.

**Adversarial results (all live):** `flags:"k"` + `compile:true` → folds to `ck`, class callable. `flags:"C"` (uppercase) + `compile:true` → ships `cC`, compiles. **New ground truth:** a raw probe shows `flags=C` ALONE also compiles — IRIS qualifier letters are case-insensitive — so the shipped lowercase-only fold is conservative-but-harmless, not load-bearing; the shipped rule and its comment remain correct (folding `C`→`cC` does keep the guarantee). Empty-string flags → `c`, compiles. `compile:false` + `flags:"cku"` → flags ignored LIVE (note present, class not callable) — matches the unit pin. Multi-doc XML (1 valid + 1 broken class in one `<Export>`) + `compile:true` → per-file status surfaced, good class callable, broken one not. Casing: `get` `/API/EXECUTEMCP/V2` → accurate both-scopes not-found (exact case-sensitive rule as documented). Namespace interaction: `get` `/api/executemcp/v2` in USER → accurate not-found; probed the webapp endpoint directly — it is strictly namespace-filtered (USER returns no foreign-namespace entries), so `findLegacyApp`'s name-only match cannot produce a cross-namespace false positive. `delete` on the legacy name → refused pointing at `iris_webapp_manage`; the app was verified still present afterwards.

**Rule #54 sweep:** verified the dev's import fixture correction (`status:"OK"`→`""`) against the live capture (success IS `""`). **Found and fixed a sibling the story missed:** the `action=list` fixture also claimed `status:"OK"` — live `xml/list` returns `status:""`, and `ts` for a not-imported document is the NUMBER `-1`, not an ISO string. Fixture corrected with a live-capture citation comment. Export fixtures (`{content:[...lines]}` array) verified against the live export shape — correct.

**Rule #19 pins verified non-vacuous:** the no-flags pin inspects the actual request URL (`mock.calls[0][0]` + exact `toHaveBeenCalledWith`); spec-first get has pre-existing `toEqual` pins on summary AND full-blob shapes (lines 242/323), still green.

**Mutation evidence (Rule #59):** `foldCompileFlag` mutated to not fold → exactly the 3 folding tests go RED (`?flags=c` default, `k`→`ck`, and QA's new `C`→`cC`) → restored hash-identical (md5 `ec6666f889659220442611b2519b8932` before/after) → 25/25 green.

**Gates:** dev 675/675 (665 + 8 dev + 2 QA), data 141/141 (134 + 6 dev + 1 QA), shared 1326/1326, all 120/120 (E-1 — no new tool/action keys). `pnpm gen:governance-baseline:check` exit 0 (141 frozen / 201 live / 60 new). `BOOTSTRAP_VERSION` unmoved at `e1168c1ebe56`; `bootstrap-classes.ts` absent from the diff. Suites run per-package standalone only (35-1-DEV-1).

**Docs (Rule #56 re-derived):** dev README row + import example, data README legacy section + get/delete notes, tool_support.md rows 40/269/297/305 all present. `packages/iris-mcp-all/README.md` and root `README.md` re-grepped for `xml_export|rest_manage` — NO matches; no-change verdict confirmed correct.

**Ledger (Rule #51):** `35-SWEEP-8`/`35-SWEEP-9` both RESOLVED; disposition tally (2 RESOLVED / 0 / 0 / 0) matches the 2 table rows; state transition 28→26 MEDIUM, 122→120 open, 73→75 terminal, 196 distinct unchanged — arithmetic chain consistent.

**Instance cleanliness:** USER and HSCUSTOM swept via `iris_doc_list` — no `356`, `Probe`, `Smoke`, or `MyApp.Service` classes remain (dev's probes and QA's 12 classes all confirmed deleted). QA scripts (`qa-smoke-35-6.mjs`, `qa-debug-export.mjs`, `qa-probe-webapps.mjs`) deleted from disk.

**LOW observations (no action required):** (1) the pre-existing `should handle IrisApiError on get`/`on delete` tests (404 fixtures) now exercise the NEW both-scopes path rather than the generic catch — assertions still valid, names mildly stale; cosmetic. (2) `foldCompileFlag`'s comment implies the lowercase-only fold is what preserves the compile guarantee for different-cased input; live evidence shows `C` alone compiles too (qualifiers are case-insensitive), so the fold is belt-and-braces there — comment is not false, just conservative.

## Review Findings (2026-08-18, cr-35-6 — bmad-code-review, Rule #57 machinery)

**Close kind: CLEAN.** All three adversarial layers DELIVERED explicit findings payloads well inside the 20-minute per-layer hard bound (real armed background timer; layers ran as sequential synchronous subagents — an in-process teammate cannot spawn background agents — each ~7-8 min, none anywhere near its own 20-min window; the armed timer fired during layer 3's run and is recorded here for honesty: no layer breached its per-layer bound). `failed_layers` empty, `review_degraded` = false. Frozen diff snapshot `review-diff-snapshot-35-6-...-20260819-000050.diff` (1172 lines) taken at review start, reviewed by all layers, disposed at close. 15 raw findings → **12 after dedupe: 4 patched in-story, 1 deferred (LOW, flagged to lead), 6 dismissed with reasoning, 1 resolved by reviewer live falsification; 0 surviving HIGH/MEDIUM, 0 decision-needed outstanding.**

Reviewer verification beyond the layers (the epic's carry-forward bar): the compile-omitted byte-identical claim verified at the code path (no `flags` param unless `compile === true`) and by the exact-URL pins; the 404 branch verified status-matched against the REAL `IrisApiError.statusCode` (`packages/shared/src/errors.ts:35`); the Edge layer's `-c` negation premise **live-probed before patching** (Rule #54 gate on the finding itself) — ground truth on IRIS 2026.1: `-c` loads WITHOUT compiling, `c-c` does NOT compile (last c-occurrence wins), `-cc` DOES, `C` alone compiles (QA's case-insensitivity ground truth confirmed). Every flag string the new fold emits was live-proven to compile (`-c`→`-cc`, `c-c`→`c-cc`, `-C`→`-Cc`, `k-c`→`k-cc`, `C`→`C`, `cku`→`cku`). Both patches mutation-verified RED→GREEN (fold reverted to naive `includes("c")` → exactly the 5 fold pins RED; `findLegacyApp` failure re-swallowed → the 2 lookup-failure pins + 1 dispatch-class pin RED). Fresh-Node dist smoke of the patched tree: 9/9 PASS, incl. `compile:true flags:"-c"` → wire shows `?flags=-cc` → class callable — the E1 fix proven end-to-end through the built tool layer.

### Patched in-story (4)

- [x] **[Review][Patch] Negated `-c` qualifier silently defeated the fold — `compile:true` shipped an uncompiling import with the uncompiled note suppressed** [`format.ts` `foldCompileFlag`] (Edge E1, the sharpest finding; MEDIUM) — a bare `includes("c")` check treated `-c` as "c present", shipping `?flags=-c` (compiles NOTHING — live-verified) while `shouldCompile` suppressed the honesty note: the exact 35-SWEEP-8 defect class reintroduced through an unprobed flag form. The fold now inspects the LAST c/C occurrence (case-insensitive per live truth): absent → prepend `c`; negated → append an overriding `c`; otherwise pass through (so `C` now passes through as `C`, not `cC` — QA's conservative pin updated with the live evidence it asked for). 4 new negation pins + reworked uppercase pin; live probe table above; mutation-verified. `flags` describe + README + tool_support + changeset wording updated (absent → "absent or explicitly negated").
- [x] **[Review][Patch] Legacy-lookup FAILURE misreported as proven absence in both scopes** [`rest.ts` `findLegacyApp` + both 404 handlers] (Blind B3 + Edge E3; MEDIUM) — a swallowed 401/500/gateway failure on the webapp list produced "was not found … as a legacy %CSP.REST application", asserting a scope was checked when it wasn't — the same misdirection class this story exists to remove, relocated. `findLegacyApp` now returns a tri-state `{ok, match|reason}`; on lookup failure get/delete say "the legacy %CSP.REST scope could not be checked — the ExecuteMCPv2 webapp list query failed (HTTP <code>)". The reason is STATUS-DRIVEN (`HTTP 404`), never the endpoint's prose — the reviewer's own first patch embedded the raw error message and the new test immediately caught it reintroducing the "web server configuration" text via the reason field (dogfooded Rule #8/#13). 2 new pins (get + delete lookup-failure), mutation-verified.
- [x] **[Review][Patch] "Loaded but NOT compiled" note asserted a successful load even when the load failed** [`format.ts` import branch] (Blind B5 + Edge E2; MEDIUM) — the note claimed "imported documents were loaded" unconditionally on the no-compile path; on a load-level failure (HTTP 200 + per-file status) that claim is false. Reworded to "imported documents are NOT compiled (compile was not requested …)" — true on both paths, AC 35.6.3's mandate intact, all existing note pins still green.
- [x] **[Review][Patch] Duplicate `previous_update:` key + stale narrative in sprint-status.yaml** (Blind B1 MEDIUM + B2/Auditor LOW) — the dev's status write produced TWO active `previous_update:` keys (a YAML duplicate-key violation; strict parsers throw, lenient ones silently drop an entry) and a `last_updated` narrative two pipeline stages stale. Fixed by the review's own close update: header comment demoted, exactly one active `previous_update`, status narrative rewritten at close.

### Deferred (1, flagged to lead)

- [x] **[Review][Defer] Compile failure is invisible to `isError`; `structuredContent` stays the untouched API result** (Blind B4) — ledgered as `35-6-CR-1` (LOW, flagged to lead). Reasoning for the downgrade from the layer's MEDIUM: the failure IS machine-visible (`structuredContent.content[].status` carries the error text, plus the dedicated `Per-file status` content block); AC 35.6.3 + Task 2 explicitly pinned "keep every existing response field untouched", and setting `isError` on content-level failure would diverge from the suite-wide convention (load failures never set it either — pre-existing). Whether content-level errors SHOULD set `isError` is a cross-tool envelope-contract decision, not a 35.6 defect — lead call for the epic (35.8 rollup candidate).

### Dismissed (6, with reasoning)

- [x] **[Review][Dismiss] `flags` silently ignored when `compile` false / accepted on export|list** (Blind B6) — deliberate mirror of `iris_doc_load`'s semantics, mandated verbatim by AC 35.6.3; the `flags` describe says "Only used when compile is true".
- [x] **[Review][Dismiss] "resolves EVERY name list returns" overclaim** (Blind B7) — after Patch 2 the failure path says exactly what was and wasn't checkable; the claim is about name-space coverage, which holds (live-proven round trip).
- [x] **[Review][Dismiss] Lowercase-only fold undocumented in `flags` describe** (Blind B9) — superseded by Patch 1: the fold is now case-correct by live evidence, and the negation behavior IS documented in the describe.
- [x] **[Review][Dismiss] QA route-pin brittle to query-string serialization** (Blind B10) — the pin's PURPOSE is the exact fallback wire route; coupling to the wire shape is what makes it non-vacuous (Rule #59). Accepted deliberately.
- [x] **[Review][Dismiss] Mgmnt-down → spec-first name mislabeled "legacy"** (Edge E4) — falsified live by the reviewer: the webapp-list surface and the Mgmnt surface are name-space DISJOINT on this instance (webapp names are `/`-prefixed paths; Mgmnt spec-first names are package-style, e.g. `HS.FHIRServer.MFE.V1` — HSCUSTOM verified: 4 spec-first apps, none present in the webapp list). The mislabel requires a name collision that is structurally near-impossible.
- [x] **[Review][Dismiss] Empty-`dispatchClass` renders "(dispatch class )." in the delete refusal** (Blind B8) — **falsified as an unreachable branch (Rule #54)**: `fetchLegacyApps` filters empty `dispatchClass` OUT, so no match can ever carry one. The reviewer's initial guard patch + test for it FAILED precisely because the scenario is unreachable; guard reverted (dead code), and the pin now asserts the refusal always names the real class (`dispatch class ExecuteMCPv2.REST.Dispatch`).

### QA LOW observations triaged (per the lead's brief)

1. **Stale-named pre-existing 404 tests** (`should handle IrisApiError on get`/`on delete` now exercise the both-scopes path) — **accepted, no rename**: the tests still pin "Error managing REST application" on a generic failure, which the new path preserves; renaming churns history for zero behavioral information. Recorded here as the disposition.
2. **`foldCompileFlag` comment conservatism** — **resolved by Patch 1**: the lowercase-only rationale comment is gone; the banner now documents the live-pinned case-insensitive/negation/last-wins semantics.

### Post-patch gates (all re-run by the reviewer, standalone per 35-1-DEV-1)

- dev **679/679** (675 QA + 4 review negation pins), data **143/143** (141 QA + 2 review lookup-failure/dispatch-class pins), shared **1326/1326**, all **120/120** (E-1 unmoved). `tsc --noEmit` clean on both touched packages.
- `pnpm gen:governance-baseline:check` (:check ONLY) exit 0 — 141 frozen / 201 live / 60 new (E-2).
- `BOOTSTRAP_VERSION` unmoved at `e1168c1ebe56` (grep-verified); `bootstrap-classes.ts` and all `.cls` ABSENT from the diff (git-status-verified) — pure-TS constraint holds.
- Doc surfaces re-verified: `packages/iris-mcp-all/README.md` + root `README.md` re-grepped (`xml_export|rest_manage` → zero matches — Auditor's verdict independently reproduced, Rule #56); dev README row + import example, data README legacy section, tool_support.md rows all updated for the patched fold/lookup-failure behavior.
- Instance cleanliness: the reviewer's probe classes (`ExecuteMCPv2.Temp.CrE1*`×5, `CrE2*`×6, `CrSmoke356`) deleted from USER and verified absent via `iris_doc_list` (NB: Atelier `DELETE /doc/` returned 200 but left the docs present — cleanup required `iris_doc_delete`; noteworthy for future probes). Review scripts (`cr-35-6-probe-negc.mjs`, `cr-35-6-smoke.mjs`) deleted from disk; frozen snapshot disposed.

## Change Log

| Date | Change | Author |
|---|---|---|
| 2026-08-18 | Story created. Lead source verification: Atelier `LoadXMLFiles` (`irislib/%Api/Atelier/v7.cls:307`) DOES accept a `flags` query param (line 346) passed to `$SYSTEM.OBJ.LoadStream` — the native `c` compile qualifier exists (AC 35.6.2 pre-answered; dev re-probes live). Per-file `status` carries load/compile error text (line 388) — the Rule #59 discriminating oracle. `rest.ts` anatomy mapped (`get` = Mgmnt-only at line 213; `fetchLegacyApps` helper exists at 40-61 for reuse). Pure-TS story: no bootstrap regen, version must not move. Governance verified: all keys pre-existing; `import` write-but-grandfathered-enabled. | Lead (claude-opus-5) |
| 2026-08-18 | Dev complete. XML import compile parity via native Atelier `flags` (live-probed: `c` compiles, `k` does not) + honest uncompiled note + per-file status surfacing; `rest_manage:get` legacy routing on Mgmnt 404 (status-matched) with accurate both-scopes not-found, delete spec-first-only enforcement. Gates: dev 673/673, data 140/140, shared 1326/1326, all 120/120; baseline :check exit 0 (141/201/60); BOOTSTRAP_VERSION unmoved `e1168c1ebe56` and bootstrap-classes.ts absent from diff; fresh-Node dist smoke 13/13 PASS against live IRIS 2026.1; README import example run live. Ledger: 35-SWEEP-8/9 RESOLVED (2 RESOLVED, mechanical tally). | Dev (claude-fable-5) |
| 2026-08-18 | Code review complete (bmad-code-review — cr-35-6). Close CLEAN: all 3 adversarial layers DELIVERED within the Rule #57 per-layer 20-min bound (Blind 10 / Edge 4 / Auditor 1; failed_layers empty; frozen-diff snapshot used and disposed). 15 raw → 12 after dedupe: 4 patched in-story / 1 deferred LOW flagged-to-lead (35-6-CR-1: isError untouched on compile failure — suite-wide envelope-convention question) / 6 dismissed / 0 surviving HIGH/MEDIUM. Headline patch (Edge, MEDIUM, live-verified BEFORE and AFTER): negated `-c` flags defeated the fold — `compile:true flags:"-c"` shipped `?flags=-c` (compiles nothing, note suppressed, the 35-SWEEP-8 defect class reintroduced); the fold now inspects the last c/C occurrence with IRIS's live-pinned case-insensitive + `-`-negation + last-wins semantics; every emitted flag string live-proven to compile; fresh-Node dist smoke 9/9 (wire shows `-c`→`-cc`, class callable). Also patched: legacy-lookup failure no longer misreported as proven absence (tri-state findLegacyApp, status-driven reason — the reviewer's first patch reintroduced the misleading text via the reason field and the new test caught it); uncompiled note no longer asserts "were loaded" on a failed load; sprint-status duplicate previous_update YAML violation fixed at close. Dismissed with evidence incl. one Rule #54 falsification (empty-dispatchClass refusal branch is unreachable — fetchLegacyApps filters it; reviewer's own guard test failed on exactly that). Mutation-verified RED→GREEN on both patches. Gates post-patch (standalone): dev 679/679, data 143/143, shared 1326/1326, all 120/120 (E-1); baseline :check exit 0 (141/201/60, E-2); BOOTSTRAP_VERSION unmoved e1168c1ebe56, no .cls in diff; instance clean (11 probe classes + smoke class deleted — note: Atelier DELETE /doc/ 200s but does NOT delete; use iris_doc_delete). Status: review → done. | cr-35-6 |
| 2026-08-18 | QA PASS (bmad-agent-qa / Quinn). Independently reproduced every live claim via QA-authored fresh-Node dist smoke (35/35 PASS): compile omitted → note + `<CLASS DOES NOT EXIST>` (35-SWEEP-8 reproduced); compile:true → immediately callable; broken-XML oracle surfaces `ERROR #5475` in per-file status; legacy get in HSCUSTOM → detail shape, no "web server configuration"; spec-first control unchanged; both-scopes not-found accurate. Adversarial matrix live: flags `k`→`ck` folds, `C`→`cC` (raw probe: `C` alone ALSO compiles — IRIS qualifiers case-insensitive; shipped fold conservative-but-harmless), empty flags, compile:false ignores flags live, multi-doc good-callable/bad-not, casing not-found, USER-namespace not-found (webapp endpoint verified strictly namespace-filtered), delete legacy refused + app intact. Rule #54: verified dev's import fixture correction; found+fixed sibling list fixture (`status:"OK"`→`""`, `ts` ISO-string→`-1`, live-pinned). Added 3 QA tests (uppercase-C fold pin, multi-entry selective status, fallback-route pin). Mutation-verified foldCompileFlag RED (3 tests) → restored hash-identical → green. Suites: dev 675/675, data 141/141, shared 1326/1326, all 120/120; baseline :check exit 0; BOOTSTRAP_VERSION unmoved. Ledger tally verified (2 RESOLVED, 26 MEDIUM/120 open/75 terminal). Instance clean (USER + HSCUSTOM swept); QA scripts deleted. No product defects; 2 LOW cosmetic observations. | qa-35-6 |
| 2026-08-18 | Lead smoke PASS (method: MCP tool layer, fresh-Node against rebuilt dists, 19/19): schema params advertised; compile-omitted import = honest note + class NOT callable (35-SWEEP-8 shape); compile:true = callable; the code-review negated-flag fold leg (flags:"-c" still compiles) verified live; broken-XML compile error surfaced in per-file status; legacy get returns detail + explanation with no misleading text; fullSpec inert on legacy; nonexistent = accurate both-scopes not-found; spec-first control unchanged. Gates: all 120/120 (E-1), governance :check exit 0, bootstrap absent from diff and version unmoved (e1168c1ebe56), no fixture residue. Note: a raw fetch from a smoke script needs an explicit Accept-Language or undici injects the star header (35.3 mechanism - the tool layer itself is unaffected). | Lead (claude-opus-5) |
