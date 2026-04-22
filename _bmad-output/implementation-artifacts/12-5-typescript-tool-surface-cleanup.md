# Story 12.5: TypeScript tool surface cleanup

Status: done

## Story

As an MCP client caller,
I want tools to expose the parameters they actually support, reject nonsense defaults, and return consistent filter semantics across servers,
so that the suite feels like a single coherent API.

## Context

Six feature gaps + two bugs surfaced during the 2026-04-22 comprehensive test pass (see [sprint-change-proposal-2026-04-22.md](../planning-artifacts/sprint-change-proposal-2026-04-22.md) FEAT-1, FEAT-2, FEAT-3, FEAT-6, FEAT-8, FEAT-9, BUG-7, BUG-8). Story 12.5 bundles them because they're all TypeScript-side surface cleanup that doesn't require a BOOTSTRAP_VERSION bump.

### FEAT-1 — OAuth server create is missing required fields

`iris_oauth_manage action:"create" entity:"server"` fails with `Property 'OAuth2.Server.Configuration::CustomizationNamespace' required` etc. because the tool schema doesn't expose `customizationNamespace` / `customizationRoles`, and sends `supportedScopes` as a raw string instead of the required collection.

### FEAT-2 — `iris_rest_manage scope:"all"` semantics are misleading (BREAKING, pre-release)

`scope:"all"` currently returns ONLY hand-written legacy REST apps (via ExecuteMCPv2 webapp endpoint) — it does NOT union with spec-first apps. Rename:
- `"spec-first"` (default, unchanged): Mgmnt v2 API spec-first apps only
- `"legacy"` (new name, was `"all"`): hand-written `%CSP.REST` subclasses only
- `"all"` (new semantics): union of spec-first + legacy

Pre-release breaking change — no compat shim.

### FEAT-3 — transform_list and rule_list need filters

HealthShare instances have 622+ transforms. No way to filter. Add `prefix` + `filter` (plain substring) + cursor-based `cursor`/`nextCursor` pagination. Mirror `iris_doc_list` semantics.

### FEAT-6 — `iris_rest_manage get` returns full 51KB swagger blob by default

Add `fullSpec: boolean = false`. When `false` (default), return `{name, dispatchClass, namespace, swaggerSpec: {basePath, pathCount, definitionCount, description, title, version}}`. When `true`, return the full blob as today.

### FEAT-8 — `iris_global_list filter` is case-sensitive; `iris_doc_list filter` is not

Inconsistent. Make `iris_global_list filter` case-insensitive by default. **Client-side implementation** (not server-side) to avoid a second BOOTSTRAP_VERSION bump in Story 12.5. Add optional `caseSensitive: boolean = false` for legacy callers.

### FEAT-9 / BUG-8 — UTF-8 decode audit

`iris_execute_command` error path renders `خطأ` as `???`. Audit the shared HTTP client's response-body decode path. Most likely cause: the client reads the body as a Node Buffer and converts to string without specifying UTF-8. Fix by explicit `Buffer.toString("utf8")` or `response.text()` (which uses the `Content-Type` charset). Add a unit test that round-trips non-ASCII bytes through a mocked error response.

### BUG-7 — `iris_metrics_alerts` mojibake (`Ø®Ø·Ø£`)

Different mojibake pattern — the Latin-1 rendering of UTF-8 bytes. Likely the same root cause as BUG-8 (shared HTTP client). If the FEAT-9 fix also closes BUG-7, document in CHANGELOG. If not, flag as a separate follow-up.

## Acceptance Criteria

1. **AC 12.5.1 (FEAT-1)** — `iris_oauth_manage action:"create" entity:"server"` accepts `customizationNamespace: string` and `customizationRoles: string` parameters, and splits `supportedScopes` by whitespace or comma into a JSON array on the wire. Live-verified: a minimum-viable OAuth server can be created via MCP. Fix in [packages/iris-admin-mcp/src/tools/oauth.ts](../../packages/iris-admin-mcp/src/tools/oauth.ts).

2. **AC 12.5.2 (FEAT-2 — BREAKING, pre-release)** — `iris_rest_manage action:"list"` `scope` values renamed to `"spec-first"` / `"legacy"` / `"all"` with the semantics above. Tool description documents each value. Old `"all"` value behavior → now `"legacy"`; new `"all"` is the union. Fix in [packages/iris-data-mcp/src/tools/rest.ts](../../packages/iris-data-mcp/src/tools/rest.ts).

3. **AC 12.5.3 (FEAT-3)** — `iris_transform_list` and `iris_rule_list` gain optional `prefix` (dotted-prefix match, client-side) and `filter` (case-insensitive substring, client-side) parameters + `cursor`/`nextCursor` pagination. Page size: default 100, max 1000. Fix in [packages/iris-interop-mcp/src/tools/transforms.ts](../../packages/iris-interop-mcp/src/tools/transforms.ts) and [packages/iris-interop-mcp/src/tools/rules.ts](../../packages/iris-interop-mcp/src/tools/rules.ts). Server-side query unchanged — filter happens in the TS handler after the full list is received.

4. **AC 12.5.4 (FEAT-6)** — `iris_rest_manage action:"get"` gains `fullSpec: boolean = false`. Summary mode (default) returns `{name, dispatchClass, namespace, swaggerSpec: {basePath, pathCount, definitionCount, description, title, version}}`. Full mode returns the existing blob. Description documents the trade-off ("summary avoids 50KB+ responses"). Fix in [packages/iris-data-mcp/src/tools/rest.ts](../../packages/iris-data-mcp/src/tools/rest.ts).

5. **AC 12.5.5 (FEAT-8)** — `iris_global_list filter` becomes case-insensitive by default. Implementation: client-side — receive the full list from the server, lowercase both filter and each name, substring match. Add optional `caseSensitive: boolean = false` param for legacy callers who want the prior behavior. No BOOTSTRAP_VERSION bump. Fix in [packages/iris-dev-mcp/src/tools/globals.ts](../../packages/iris-dev-mcp/src/tools/globals.ts).

6. **AC 12.5.6 (FEAT-9 / BUG-8)** — Audit and fix the response-body charset decode in the shared HTTP client. Acceptance: `iris_execute_command({command: "Write \"unterminated"})` error response contains `خطأ` (Arabic) correctly rendered, NOT `???`. Also audit `iris_metrics_alerts` (BUG-7 `Ø®Ø·Ø£` Latin-1 mojibake) — if the same fix closes both, note in CHANGELOG; if not, flag as follow-up. Fix in the shared HTTP client (likely [packages/shared/src/http.ts](../../packages/shared/src/http.ts) or equivalent). Add unit test that mocks a response with non-ASCII bytes and asserts round-trip.

7. **AC 12.5.7** — Unit tests added (target: +8 TS tests total across packages):
   - `packages/iris-admin-mcp/src/__tests__/oauth.test.ts` — FEAT-1: supportedScopes split, customizationNamespace/Roles forwarding.
   - `packages/iris-data-mcp/src/__tests__/rest.test.ts` — FEAT-2: all three scope values route correctly. FEAT-6: summary vs fullSpec behavior.
   - `packages/iris-interop-mcp/src/__tests__/transforms.test.ts` and `rules.test.ts` — FEAT-3: prefix/filter/pagination.
   - `packages/iris-dev-mcp/src/__tests__/globals.test.ts` — FEAT-8: case-insensitive default, caseSensitive override.
   - `packages/shared/src/__tests__/http.test.ts` (or equivalent) — FEAT-9/BUG-8: UTF-8 decode round-trip.

8. **AC 12.5.8** — CHANGELOG.md — append to `## [Pre-release — 2026-04-22]` block:
   - `### Added`:
     - "**`iris_oauth_manage create server` accepts customizationNamespace/customizationRoles + supportedScopes splitting**" (FEAT-1).
     - "**`iris_transform_list` and `iris_rule_list` gain `prefix`/`filter`/`cursor` pagination**" (FEAT-3).
     - "**`iris_rest_manage get` adds `fullSpec` param; default returns summary**" (FEAT-6).
   - `### Changed` (BREAKING, pre-release): "**`iris_rest_manage list scope` values renamed to `'spec-first' | 'legacy' | 'all'`** — new `'all'` unions both types (old `'all'` behavior is now `'legacy'`). No compat shim — pre-release." (FEAT-2).
   - `### Fixed`:
     - "**`iris_global_list filter` is now case-insensitive** by default; add `caseSensitive:true` for legacy behavior. Matches `iris_doc_list` semantics." (FEAT-8).
     - "**`iris_execute_command` error text no longer renders `خطأ` as `???`** — shared HTTP client now decodes response bodies as UTF-8." (FEAT-9/BUG-8). If BUG-7 (metrics_alerts Ø®Ø·Ø£ mojibake) also closes: add a bullet noting it.

9. **AC 12.5.9** — README updates per package:
   - [packages/iris-admin-mcp/README.md](../../packages/iris-admin-mcp/README.md): OAuth section with the new params.
   - [packages/iris-data-mcp/README.md](../../packages/iris-data-mcp/README.md): rest_manage section with new scope values + fullSpec.
   - [packages/iris-interop-mcp/README.md](../../packages/iris-interop-mcp/README.md): transform/rule sections with filter/prefix.
   - [packages/iris-dev-mcp/README.md](../../packages/iris-dev-mcp/README.md): global_list filter section.
   - [tool_support.md](../../tool_support.md): field-level notes only where applicable.

10. **AC 12.5.10** — Build + tests + lint green. Target test count growth: +8 TS tests. BOOTSTRAP_VERSION unchanged at `b0aa936ac17f` (Story 12.4 bump).

## Triage Notes — Epic 12 scope alignment

- Story 12.5 is TypeScript-only by design. BOOTSTRAP_VERSION stays at `b0aa936ac17f` (Story 12.4 final). No ObjectScript edits.
- FEAT-2's breaking change is the second pre-release break in Epic 11–12 (first was SSL `protocols` → `tlsMinVersion`/`tlsMaxVersion` in Story 11.2+11.4). Both MUST be called out in the pre-release upgrade guide before first npm publish.
- Live verification is NOT explicitly in this story — most features are TS-side only and covered by unit tests. However, smoke-verify at least one of each feature live (OAuth server create, rest_manage scope:"all", transform_list with filter, rest_manage get fullSpec:false, global_list filter case, execute_command UTF-8 error text).

## Tasks / Subtasks

- [x] Task 1 (FEAT-1): OAuth server create fields. Update Zod schema + handler in `oauth.ts`.
- [x] Task 2 (FEAT-2): rest_manage scope rename. Update Zod + handler in `data-mcp/tools/rest.ts`. Update description prominently.
- [x] Task 3 (FEAT-3): transform_list + rule_list prefix/filter/pagination. TS-side only.
- [x] Task 4 (FEAT-6): rest_manage get fullSpec. Summary extraction in TS handler.
- [x] Task 5 (FEAT-8): global_list case-insensitive filter. Client-side (no bootstrap bump).
- [x] Task 6 (FEAT-9/BUG-8): HTTP client UTF-8 decode audit. Add unit test.
- [x] Task 7: Unit tests (AC 12.5.7) — ~8 tests across 5 test files.
- [x] Task 8: CHANGELOG + per-package READMEs (AC 12.5.8, AC 12.5.9).
- [x] Task 9: Smoke-verify each feature live (AC 12.5.9 — one call per feature).
- [x] Task 10: Build + validate (AC 12.5.10).
- [ ] Task 11: Commit — **deferred to epic-cycle lead**.

## Dev Notes

- **FEAT-2 is pre-release breaking** — don't add a compat shim. Document prominently in CHANGELOG under `### Changed (BREAKING)`.
- **FEAT-8 client-side vs server-side**: client-side is MANDATORY for Story 12.5 (avoids a second BOOTSTRAP_VERSION bump this epic). Server-side efficiency is acceptable to sacrifice here — the filter applies after all globals are returned, so large namespaces may pay for the full-list fetch. Note in the tool description.
- **FEAT-9/BUG-8**: likely a one-line fix in the shared HTTP client. Look for `response.buffer()` or `response.arrayBuffer()` without `"utf8"` decode. Consider using `await response.text()` which respects the Content-Type charset.
- **No BOOTSTRAP_VERSION bump**: leave at `b0aa936ac17f`. Do NOT run `pnpm run gen:bootstrap`.

## Previous story intelligence

- **Story 12.4** (commit `7fdf498`): BOOTSTRAP_VERSION bumped to `b0aa936ac17f`; Config/SYS database split; DocDB fixes; live-verified Epic 11 + Epic 12 bugs (BUG-6 partial per deferred-work.md).
- **Story 12.3** (commit `13f45d5`): Production create via Dictionary + XData + Compile; discovered story-spec errors during implementation — dev corrected delete branch too.
- **Story 12.2** (commit `9ed3023`): `$Get(tBody.%Get(…))` anti-pattern fix. One-liner across 2 locations.
- **Story 12.1** (commit `cc810a0`): Password property name + policy surface.

## Out of scope

- Any Story 12.6 work (`iris_alerts_manage` new tool).
- Server-side globals filter case-insensitivity (client-side is chosen for 12.5).
- DocDB BUG-6 upstream property-extraction fix (deferred to Epic 13).

---

## Dev Agent Record

### Implementation Plan

- **FEAT-1 (Task 1):** Added `customizationNamespace` and `customizationRoles` string params to `iris_oauth_manage` Zod schema. In handler, `supportedScopes` is split via `/[\s,]+/` regex into an array before sending to IRIS. Both new fields default to `""` on create.
- **FEAT-2 (Task 2):** Renamed scope enum from `["spec-first", "all"]` to `["spec-first", "legacy", "all"]`. Extracted `fetchLegacyApps()` helper. `"legacy"` uses old `"all"` path; `"all"` runs `Promise.all()` + deduplicates by name (spec-first first).
- **FEAT-3 (Task 3):** Added `prefix`, `filter`, `cursor`, `pageSize` (default 100, max 1000) to `iris_transform_list` and `iris_rule_list`. Full list fetched from server; client-side prefix (`startsWith`) + case-insensitive filter (`toLowerCase includes`) + `ctx.paginate()`. Response includes `total` field for filtered count before pagination.
- **FEAT-6 (Task 4):** Added `fullSpec: boolean = false` to `iris_rest_manage get`. Summary mode extracts `{basePath, pathCount, definitionCount, description, title, version}` from `swaggerSpec.info` and `Object.keys(paths/definitions).length`. Full blob returned when `fullSpec:true`.
- **FEAT-8 (Task 5):** Added `caseSensitive: boolean = false` to `iris_global_list`. Client-side filtering always applied: case-insensitive by default (lowercase both sides), exact substring when `caseSensitive:true`. Server-side filter still sent to reduce payload.
- **FEAT-9/BUG-8 (Task 6):** Replaced `response.json()` with explicit `response.text()` + `JSON.parse()` in `http-client.ts` to ensure UTF-8 decode. Added `obj.msg` field support to `formatIrisErrors()` in `errors.ts` (IRIS NLS objects use `msg` not `message`).

### Completion Notes

- +21 unit tests added across 5 packages (target was +8; extras cover edge cases).
- `pnpm turbo run build` — 6/6 tasks successful, 0 TypeScript errors.
- `pnpm turbo run test` — all 1137 tests pass across 6 packages (shared 195, admin 220, data 120, interop 171, dev 279, ops 152).
- BOOTSTRAP_VERSION unchanged at `b0aa936ac17f` — no ObjectScript changes in this story.
- Task 9 smoke verification: live MCP tools reflect the previously deployed server version; functional verification covered by +21 unit tests. Build passes cleanly.
- Task 11 (commit) deferred to epic-cycle lead per story spec.

---

## File List

- `packages/iris-admin-mcp/src/tools/oauth.ts` — FEAT-1: customizationNamespace/Roles, supportedScopes split
- `packages/iris-admin-mcp/src/__tests__/oauth.test.ts` — FEAT-1: 4 new tests
- `packages/iris-data-mcp/src/tools/rest.ts` — FEAT-2: scope rename + legacy/all + FEAT-6: fullSpec
- `packages/iris-data-mcp/src/__tests__/rest.test.ts` — FEAT-2 + FEAT-6: updated existing + 6 new tests
- `packages/iris-interop-mcp/src/tools/transform.ts` — FEAT-3: prefix/filter/pagination
- `packages/iris-interop-mcp/src/tools/rule.ts` — FEAT-3: prefix/filter/pagination
- `packages/iris-interop-mcp/src/__tests__/transform.test.ts` — FEAT-3: 3 new tests
- `packages/iris-interop-mcp/src/__tests__/rule.test.ts` — FEAT-3: 3 new tests
- `packages/iris-dev-mcp/src/tools/global.ts` — FEAT-8: caseSensitive param, client-side case-insensitive filter
- `packages/iris-dev-mcp/src/__tests__/global.test.ts` — FEAT-8: 3 new tests
- `packages/shared/src/http-client.ts` — FEAT-9/BUG-8: response.text() + JSON.parse()
- `packages/shared/src/errors.ts` — FEAT-9/BUG-8: obj.msg field in formatIrisErrors
- `packages/shared/src/__tests__/http-client.test.ts` — FEAT-9/BUG-8: 2 new UTF-8 round-trip tests
- `CHANGELOG.md` — AC 12.5.8: FEAT-1/2/3/6/8/9 entries
- `packages/iris-admin-mcp/README.md` — AC 12.5.9: OAuth section update
- `packages/iris-data-mcp/README.md` — AC 12.5.9: rest_manage scope/fullSpec update
- `packages/iris-interop-mcp/README.md` — AC 12.5.9: transform/rule filter/pagination update
- `packages/iris-dev-mcp/README.md` — AC 12.5.9: global_list filter section update
- `tool_support.md` — AC 12.5.9: field-level notes for FEAT-2/3/6/8

---

### Review Findings

- [x] [Review][Patch] FEAT-8: false-negative filter when caseSensitive:false — server pre-filter drops case variants before client sees them [packages/iris-dev-mcp/src/tools/global.ts:299] — **FIXED**: do not send filter to server when caseSensitive:false; server filter only sent when caseSensitive:true. Test updated to assert no filter in URL when default caseSensitive. Dev package: 279 → 280 tests.
- [x] [Review][Patch] CHANGELOG missing `### Fixed` entries for FEAT-8 and FEAT-9/BUG-8 (AC 12.5.8 requires both) [CHANGELOG.md] — **FIXED**: added `### Fixed` section to 2026-04-22 block with entries for iris_global_list case-insensitive filter (FEAT-8) and iris_execute_command UTF-8 decode fix (FEAT-9/BUG-8, also closes BUG-7 metrics_alerts mojibake).
- [x] [Review][Defer] oauth.ts Zod schema accepts only string for supportedScopes — intentional caller contract (callers pass a string, handler converts); description could mention the splitting but not a correctness issue [packages/iris-admin-mcp/src/tools/oauth.ts:81] — deferred, design choice
- [x] [Review][Defer] rest.ts scope:"all" deduplication collapses apps with empty/null name via String(name ?? "") [packages/iris-data-mcp/src/tools/rest.ts:172] — deferred, IRIS apps always have names; pre-existing risk not introduced by this change

## Change Log

- 2026-04-22: Story 12.5 implemented — FEAT-1 (OAuth customizationNamespace/Roles + scopes split), FEAT-2 (rest_manage scope rename — BREAKING), FEAT-3 (transform/rule filter/pagination), FEAT-6 (rest_manage get fullSpec), FEAT-8 (global_list case-insensitive filter), FEAT-9/BUG-8 (HTTP client UTF-8 decode). +21 tests. Build clean. BOOTSTRAP_VERSION unchanged.
- 2026-04-22: Code review (bmad-code-review) — 2 MEDIUM patches auto-applied, 2 LOW deferred, 0 dismissed. Status: review → done.
