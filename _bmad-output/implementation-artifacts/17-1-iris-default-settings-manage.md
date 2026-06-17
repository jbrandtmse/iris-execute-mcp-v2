# Story 17.1: `iris_default_settings_manage` — System Default Settings

**Status:** done

**Epic:** 17 — Interop & Dev Tools (`iris-interop-mcp` + `iris-dev-mcp`)

## Story

**As an** integration engineer, **I want** to manage Interoperability System Default Settings (`Ens.Config.DefaultSettings`), **so that** I can configure the production-portable settings override layer via the agent.

## Acceptance Criteria

- **AC 17.1.1** — New tool `iris_default_settings_manage` in `@iris-mcp/interop`. Actions: `list`, `get`, `set`, `delete`. `list`/`get` read-only (default-enabled); `set`/`delete` mutating (default-disabled via `mutates`).
- **AC 17.1.2** — Backed by `Ens.Config.DefaultSettings` (production/item/host-class/setting tuple → value model). Use the verified shapes/recipe in `17-0-api-probes.md` Area 1 (IdKey 4-tuple `ProductionName||ItemName||HostClassName||SettingName`, SQL table `Ens_Config.DefaultSettings`, `%Save()`/`%DeleteId()` with auto mod-flag hooks — NO manual production recompile).
- **AC 17.1.3** — Input: `action`; settings key tuple `production`/`item`/`hostClass`/`setting` (each defaulting to `"*"` when omitted, per the class `InitialExpression`); `value` (for `set`); optional `description`, `deployable` (for `set`); `server`; `namespace`. Output: `list` → array of settings rows; `get` → the matched row (or not-found); `set` → `{action:"set", ...tuple, value}`; `delete` → `{action:"deleted", ...tuple}`.
- **AC 17.1.4** — Unit tests (mocked HTTP) for all four actions + a governance-defaults proof through the REAL `McpServerBase.handleToolCall` gate (mirrors `process-governance.test.ts`): under empty `IRIS_GOVERNANCE`, `set`/`delete` DENIED with `GOVERNANCE_DISABLED` keyed `iris_default_settings_manage:<action>` and handler never invoked; `list`/`get` ALLOWED. Tests in the DEFAULT suite (`*.test.ts`, discoverable).
- **AC 17.1.5** — **Bootstrap (Rule #24):** the new ObjectScript handler is embedded by regenerating `bootstrap-classes.ts` (`pnpm run gen:bootstrap`) and `BOOTSTRAP_VERSION` is moved IN THIS STORY (record from→to). `bootstrap.test.ts` green (on-disk == embedded == version).
- **AC 17.1.6** — **Governance baseline frozen (Rule #23/#25):** `governance-baseline.ts` stays at `1e62c5ad5bf7` (141 keys); the new `iris_default_settings_manage:*` keys are NOT added to the baseline (they're governed by `mutates`). Verify with `pnpm run gen:governance-baseline:check` (exit 0, frozen git-clean). Do NOT run the bare generator (Rule #25 footgun).
- **AC 17.1.7** — **Additive / Integration:** strictly additive — no existing tool, route, or handler behavior changes. No in-epic consumer (this is a leaf tool exercised by its own unit + governance tests; the first/only consumer is the end user via MCP). Deploy via glob-prefixed `iris_doc_load` (Rule #17).

## Tasks / Subtasks

- [x] **Task 1 (AC 17.1.2/17.1.3)** — Add ObjectScript handler methods to `src/ExecuteMCPv2/REST/Interop.cls`: `DefaultSettingsList()` (GET, list/filter via parameterized SQL) and `DefaultSettingsManage()` (POST, dispatch `get`/`set`/`delete`). Follow the existing `ItemManage`/`ProductionManage` patterns (read body via `ExecuteMCPv2.Utils.ReadRequestBody`; `ValidateRequired`; namespace save/restore via `SwitchNamespace`/`tOrigNS` with catch-first-line restore; single `RenderResponseBody` per request per Rule #7; `SanitizeError` on every error path). Use the copy-paste CRUD recipe from `17-0-api-probes.md` Area 1.
- [x] **Task 2 (AC 17.1.1/17.1.3)** — Add the two routes to `src/ExecuteMCPv2/REST/Dispatch.cls` UrlMap: `<Route Url="/interop/defaultsettings" Method="GET" Call="ExecuteMCPv2.REST.Interop:DefaultSettingsList" />` and `<Route Url="/interop/defaultsettings" Method="POST" Call="ExecuteMCPv2.REST.Interop:DefaultSettingsManage" />`.
- [x] **Task 3 (AC 17.1.1/17.1.3)** — Create `packages/iris-interop-mcp/src/tools/defaultSettings.ts` exporting `defaultSettingsManageTool` (name `iris_default_settings_manage`, scope `"NS"`, `mutates: { list: "read", get: "read", set: "write", delete: "write" }`, namespace forwarding via `ctx.resolveNamespace`, `server` param handled by the central injection layer). Register it in `packages/iris-interop-mcp/src/tools/index.ts`.
- [x] **Task 4 (AC 17.1.4)** — Add `defaultSettings.test.ts` (unit, mocked http: all 4 actions + error path) and `defaultSettings-governance.test.ts` (real-gate proof — copy the `process-governance.test.ts` harness). Bump `index.test.ts` interop tool-count assertion (+1).
- [x] **Task 5 (AC 17.1.5/17.1.6)** — Deploy `Interop.cls` + `Dispatch.cls` to HSCUSTOM via glob-prefixed `iris_doc_load` (Rule #17), compile. Run `pnpm run gen:bootstrap` (records `BOOTSTRAP_VERSION` from→to). Run `pnpm run gen:governance-baseline:check` (exit 0, frozen). Full monorepo `turbo run test`/`lint`/`build` green.

### Review Findings (code review 2026-06-16)

Three parallel review layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor) ran against the change set. The Acceptance Auditor confirmed all four in-scope ACs (17.1.1–17.1.4) satisfied, including the flagged `delete` → `"deleted"` output naming. Two findings were patched; the rest dismissed (intentional/spec-compliant/established-pattern) or deferred.

- [x] [Review][Patch] `||` IdKey-delimiter injection guard — DefaultSettingsManage [src/ExecuteMCPv2/REST/Interop.cls:1951] — A key slot value containing the `||` IdKey delimiter would split `tId` into the wrong subscripts, so get/set/delete silently resolved/modified a DIFFERENT row than the caller named (the response echoes the original slot strings, masking the mismatch). InterSystems' own `%Import` has the same latent gap, but a cheap guard prevents silent wrong-row mutation. FIXED: reject any slot containing `||` with a clear validation error before assembling `tId`. Redeployed + recompiled to HSCUSTOM; `gen:bootstrap` re-rolled `BOOTSTRAP_VERSION` 56f492db456d → 8c748712e247 (Rule #24); bootstrap.test.ts green.
- [x] [Review][Patch] `list` filter `"*"` semantics documented — defaultSettings.ts [packages/iris-interop-mcp/src/tools/defaultSettings.ts:61] — The tool description said omitted slots default to `"*"` = "applies to all", but for `list` a literal `"*"` filter equality-matches only the wildcard-scoped (`*`) rows, NOT all rows (omit the slot to get all). The actual behavior is correct and unit-tested; only the description was misleading. FIXED: clarified the `production` filter description (omit = all; literal `*` = only `*`-rows). The item/hostClass/setting descriptions already cross-reference it.
- [x] [Review][Defer] `||`-guard has no automated test (live-HTTP-only) [src/ExecuteMCPv2/REST/Interop.cls:1951] — deferred. The guard is server-side ObjectScript; the TS unit tests use mocked HTTP, so a TS-layer test would only assert the body is forwarded (not that the guard fires). Genuine coverage requires the lead's live-HTTP smoke (Rule #26) — add a "slot with `||` is rejected, changes nothing" assertion there.
- [x] [Review][Defer] explicit empty-string slot coerced to `"*"` [Interop.cls:1943-1950] — dismissed-as-intentional but recorded: an explicit `""` slot becomes the wildcard `*` row (consistent with omitted = `*`, the InitialExpression). A caller who accidentally sends `""` writes/deletes the broad `*` row. Low risk; the TS schema + the "omit for default" contract make this a deliberate-caller path. No change.
- [x] [Review][Defer] `deployable` coercion at REST layer (`+%Get`) [Interop.cls:2023] — dismissed: a direct REST caller sending the STRING `"true"` gets `Deployable=0`. The TS schema enforces `z.boolean()`, and this matches the established `+` coercion in `ItemManage`/`AutoStart` in the same file. Direct-REST hardening is a cross-handler concern, not this story.
- [x] [Review][Defer] get/delete not-found asymmetry [Interop.cls:1959-2046] — dismissed: `get`-miss returns 200 `{found:false}`; `delete`-miss returns an error envelope. This is INTENTIONAL, spec-compliant (AC 17.1.3), and explicitly asserted by the QA tests. No change.


`_bmad-output/implementation-artifacts/17-0-api-probes.md` **Area 1** is the live-verified, copy-paste-ready CRUD recipe for `Ens.Config.DefaultSettings`. It is authoritative (it supersedes any older evidence). Key points reproduced:
- **IdKey** = `ProductionName||ItemName||HostClassName||SettingName` (delimiter `||`). Each slot defaults to `"*"`.
- **SQL table** = `Ens_Config.DefaultSettings`. List ROWSPEC: `ID, ProductionName, ItemName, HostClassName, SettingName, SettingValue, Deployable` (+ `Description` if SELECTed explicitly — it is NOT in `EnumerateSettings`).
- **set** = `%ExistsId(id)` ? `%OpenId` : `%New()`+set-4-keys → set `SettingValue` (+ optional `Description`/`Deployable`) → `%Save()`. `%OnAfterSave` auto-updates production mod flags. **No manual recompile.**
- **delete** = `%DeleteId(id)`. `%OnAfterDelete` auto-updates mod flags.
- **get** (exact tuple) = `%OpenId(id)` then read `SettingValue`/`Description`/`Deployable`. (`%GetSetting` does wildcard-fallback — NOT what `get` wants; use `%OpenId` for the exact tuple.)

### Established patterns to mirror (this codebase)
- **Handler class:** `src/ExecuteMCPv2/REST/Interop.cls` — see `ItemManage()` (lines 326–475) and `ProductionManage()` for the exact body-read / validate / namespace-switch / single-`RenderResponseBody` / `SanitizeError` skeleton. Honor Rule #7 (I/O + single-dispatch — though no `ReDirectIO` here), Rule #9 (propagate `%Status` via `SanitizeError`, don't swallow), and the namespace save/restore rule (NO `New $NAMESPACE`; restore `tOrigNS` as the first line of `Catch`).
- **Routes:** `src/ExecuteMCPv2/REST/Dispatch.cls` — existing `/interop/production/item` etc. (lines 100–124). Add the two `/interop/defaultsettings` routes adjacent to the other `/interop/*` routes.
- **TS tool:** `packages/iris-interop-mcp/src/tools/item.ts` (`productionItemTool`) is the closest structural analog (scope `"NS"`, `ctx.resolveNamespace(namespace)`, `body` build, `ctx.http.post`, `IrisApiError` catch → `isError`, `structuredContent: result`). For governed actions add the `mutates` map (item.ts predates governance, so copy the `mutates` shape from `packages/iris-ops-mcp/src/tools/process.ts` `processManageTool`).
- **Governance test:** `packages/iris-ops-mcp/src/__tests__/process-governance.test.ts` is the canonical real-gate harness — copy it, swap the tool + keys. It runs in the DEFAULT suite (NOT `*.integration.test.ts`).
- **structuredContent:** must be an object, not an array (per project memory). For `list`, wrap rows: `{ settings: [...] }` — do NOT return a bare array as `structuredContent`.

### Governance classification (Rule #23, frozen-foundation)
`mutates: { list: "read", get: "read", set: "write", delete: "write" }`. New keys absent from the frozen baseline → `set`/`delete` default-disabled, `list`/`get` default-enabled. Do NOT touch `governance-baseline.ts`; verify it stays `1e62c5ad5bf7` via `gen:governance-baseline:check`.

### Bootstrap (Rule #24, per-story)
This story adds a NEW ObjectScript handler → it MUST regenerate `bootstrap-classes.ts` and move `BOOTSTRAP_VERSION` in THIS story (not deferred to 17.4). Editing `Interop.cls` makes `bootstrap.test.ts` fail until `gen:bootstrap` runs — that is expected; run it. Record the from→to hash. (`bootstrap-classes.ts` is output-only — never hand-edit, Rule #18.)

### namespace + server params
- `namespace` forwarded to the handler (consistent with every interop tool). The handler switches namespace for `Ens.*` work and restores.
- `server` is injected/stripped centrally by the shared `withServerParam` layer (Epic 14 D2) — the tool does NOT declare its own `server` field beyond what the shared layer adds. Mirror `item.ts` (it does not hand-handle `server`).

### Deploy (Rule #17)
`iris_doc_load path="c:/git/iris-execute-mcp-v2/src/ExecuteMCPv2/**/*.cls" compile=true namespace=HSCUSTOM` (glob-prefixed). Never a bare file path.

### Testing standards
- Unit: mocked `ctx.http` (no live IRIS) — assert request body shape per action + structuredContent object shape + error path.
- Governance: real `McpServerBase.handleToolCall` gate (mirrors process-governance.test.ts).
- Lead smoke (later gate) drives the LIVE deployed REST route over HTTP — out of scope for the dev's automated tests.

### References
- `17-0-api-probes.md` Area 1 (authoritative recipe) + "Determinations settled for downstream stories"
- `epics.md:3596–3604` (Story 17.1 ACs + impl notes)
- `.claude/rules/project-rules.md` Rules #2, #3, #7, #9, #16, #17, #18, #19, #23, #24, #25; `iris-objectscript-basics.md` (namespace switching in REST handlers)
- Patterns: `src/ExecuteMCPv2/REST/Interop.cls:326–475`, `Dispatch.cls:100–124`, `packages/iris-interop-mcp/src/tools/item.ts`, `packages/iris-ops-mcp/src/tools/process.ts`, `packages/iris-ops-mcp/src/__tests__/process-governance.test.ts`

## Integration ACs

No consumers in this story; the first and only consumer of `iris_default_settings_manage` is the end user via the MCP server. It is a standalone leaf tool (no other Epic-17 story calls it). Exercised by its own unit + governance tests (AC 17.1.4) and the lead's live-endpoint smoke. (Rule 1 escape clause — service with no in-epic consumers.)

## Dev Agent Record

### Agent Model Used
claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References
- `iris_doc_load` glob-prefixed deploy to HSCUSTOM: 20/20 uploaded. The compile-all step reported a benign artifact error (`Class 'REST.Analytics' does not exist`) caused by the bare-stem doc listing; explicit `iris_doc_compile` of the two touched classes (`ExecuteMCPv2.REST.Interop.cls`, `ExecuteMCPv2.REST.Dispatch.cls`) with flags `cuk` finished successfully in 0.152s.
- Live read-only probe: `##class(Ens.Config.DefaultSettings).%ExistsId("*||*||*||__nope__")` → 0 (4-tuple IdKey path confirmed reachable).

### Completion Notes List
- **Task 1** — Added `DefaultSettingsList()` (GET) and `DefaultSettingsManage()` (POST: get/set/delete) to `Interop.cls`, mirroring `EventLog()` (param-count SQL dispatch) and `ItemManage()` (body-read / validate / namespace save-restore / single `RenderResponseBody` / `SanitizeError`). Used the Area-1 recipe verbatim: IdKey `prod||item||hostClass||setting`, `%ExistsId`→`%OpenId` else `%New()`+4-keys, `%Save()`/`%DeleteId()` (auto mod-flag hooks, no manual recompile). `value` requiredness uses `tBody.%IsDefined("value")` (Rule #15 — no `$Get()` on a method call). Each omitted key slot defaults to `"*"` server-side.
- **Task 2** — Added the GET + POST `/interop/defaultsettings` routes adjacent to the other `/interop/*` routes.
- **Task 3** — Created `defaultSettingsManageTool` (`iris_default_settings_manage`, scope `"NS"`, `mutates {list:read,get:read,set:write,delete:write}`). `list` → GET with filters; `get`/`set`/`delete` → POST. `structuredContent` is the result object; for `list` the server wraps rows as `{settings:[...],count}` (object, not bare array). Registered in `tools/index.ts`.
- **Task 4** — `defaultSettings.test.ts` (14 unit tests: all 4 actions, filter forwarding, omitted-field handling, namespace, error paths, metadata/`mutates`); `defaultSettings-governance.test.ts` (4 real-gate tests: set/delete DENIED `GOVERNANCE_DISABLED` keyed `iris_default_settings_manage:<action>` with handler never invoked; list/get ALLOWED; opt-in flips just `set`). Bumped `index.test.ts` count 19→20 and added name/lookup assertions.
- **Task 5** — Deployed + compiled clean. `gen:bootstrap` moved `BOOTSTRAP_VERSION` `fe972c4cb317` → `56f492db456d`. `gen:governance-baseline:check` exit 0 (frozen 141 keys, `iris_default_settings_manage:*` among the allowed post-foundation keys; baseline git-clean). Full `turbo run build` (6/6), `lint` (6/6), `test` (12/12 incl. interop 189, shared 504 with bootstrap.test.ts green) all pass.
- **Strictly additive:** no existing tool/route/handler behavior changed; `iris_production_item` untouched (Story 17.2 scope).

### File List
- `src/ExecuteMCPv2/REST/Interop.cls` (modified — added `DefaultSettingsList` + `DefaultSettingsManage`)
- `src/ExecuteMCPv2/REST/Dispatch.cls` (modified — added two `/interop/defaultsettings` routes)
- `packages/iris-interop-mcp/src/tools/defaultSettings.ts` (new — `defaultSettingsManageTool`)
- `packages/iris-interop-mcp/src/tools/index.ts` (modified — import + register)
- `packages/iris-interop-mcp/src/__tests__/defaultSettings.test.ts` (new — unit tests)
- `packages/iris-interop-mcp/src/__tests__/defaultSettings-governance.test.ts` (new — real-gate governance proof)
- `packages/iris-interop-mcp/src/__tests__/index.test.ts` (modified — tool count 19→20 + name/lookup assertions)
- `packages/shared/src/bootstrap-classes.ts` (regenerated — `BOOTSTRAP_VERSION` fe972c4cb317 → 56f492db456d → 8c748712e247 after the code-review `||`-guard fix)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — story → in-progress → review)

## Change Log

| Date | Change |
|---|---|
| 2026-06-16 | Story 17.1 created (lead). Grounded in `17-0-api-probes.md` Area 1 (live-verified DefaultSettings CRUD). New `iris_default_settings_manage` (interop): list/get/set/delete; set/delete `mutates:write` default-disabled. New `DefaultSettingsList`/`DefaultSettingsManage` handlers on Interop.cls + `/interop/defaultsettings` routes. Per-story bootstrap regen (Rule #24); frozen governance baseline (Rule #23/#25). Status → ready-for-dev. |
| 2026-06-16 | Story 17.1 implemented (dev). Tasks 1–5 complete. Interop.cls `DefaultSettingsList`/`DefaultSettingsManage` + 2 Dispatch routes deployed/compiled clean to HSCUSTOM. `defaultSettingsManageTool` added + registered (interop tools 19→20). 18 new tests (14 unit + 4 real-gate governance) green; full monorepo build/lint/test green. `BOOTSTRAP_VERSION` fe972c4cb317 → 56f492db456d (Rule #24). Governance baseline frozen at 1e62c5ad5bf7 / 141 keys, `gen:governance-baseline:check` exit 0 (Rule #23/#25). Strictly additive. Status → review. |
| 2026-06-16 | Story 17.1 code review (3-layer adversarial). All in-scope ACs (17.1.1–17.1.4) satisfied. 2 patches applied: (1) `||` IdKey-delimiter injection guard in `DefaultSettingsManage` (silent wrong-row get/set/delete prevented); (2) clarified `list` filter `"*"` semantics in the tool description. Interop.cls redeployed/recompiled to HSCUSTOM; `gen:bootstrap` re-rolled `BOOTSTRAP_VERSION` 56f492db456d → 8c748712e247 (Rule #24); bootstrap.test.ts (41) + interop tests (23) + `gen:governance-baseline:check` (exit 0, baseline frozen 1e62c5ad5bf7, git-clean) all green. 4 findings deferred (live-HTTP `||` test) / dismissed (intentional: empty-slot→`*`, `+`-coercion matches existing handlers, get/delete not-found asymmetry is spec-compliant + tested). Status → done. |
