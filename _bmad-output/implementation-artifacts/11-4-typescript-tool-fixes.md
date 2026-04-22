# Story 11.4: TypeScript tool fixes (non-bootstrap)

Status: done

## Story

**As an** MCP client or developer using `iris_doc_search`, `iris_rest_manage`, `iris_analytics_cubes`, `iris_ssl_*`, or `iris_doc_put`,
**I want** the tool schemas and response handling to be correct and honest,
**so that** search returns matches with its documented defaults, REST listing includes hand-written dispatch classes when I ask for them, analytics timestamps are human-readable, SSL schemas match the server shape, and `iris_doc_put` is clearly labeled as a debug/scratch tool.

## Trigger

Epic 11 Bug Batch — 5 TypeScript-side fixes from the 2026-04-21 comprehensive MCP test pass. See [sprint-change-proposal-2026-04-21.md](../planning-artifacts/sprint-change-proposal-2026-04-21.md):

- **Bug #7** — `iris_doc_search` default `files` pattern does not take effect. Root cause at [intelligence.ts:158](../../packages/iris-dev-mcp/src/tools/intelligence.ts): `if (files !== undefined) params.set("files", files);` — when caller omits `files`, NO `files` query param is sent to Atelier, and the server-side default (whatever it is) doesn't match `.cls` files. Tool's own description advertises default `'*.cls,*.mac,*.int,*.inc'` but never sends it.

- **Bug #13** — `iris_rest_manage` `action:"list"` omits hand-written `%CSP.REST` dispatch classes. Verified: in HSCUSTOM, `ExecuteMCPv2.REST.Dispatch` is registered at `/api/executemcp/v2` with `dispatchClass: "ExecuteMCPv2.REST.Dispatch"` (confirmed via `iris_webapp_get`), but `iris_rest_manage action:"list"` returns only the three `HS.FHIRServer.Management.REST.v1` / `HS.HC.OAuth2.*` apps — all **spec-first** (have `.spec` companion classes). Root cause: current `rest.ts` (line 65) calls `GET /api/mgmnt/v2/{ns}/` which wraps IRIS's [`%REST.API.GetAllRESTApps`](../../irislib/%SYS/%REST.API.cls) — explicitly spec-first only by design of the InterSystems API (filters out any dispatch class not ending in `.disp` AND missing a `.spec` companion).

- **Bug #14** — `iris_analytics_cubes lastBuildTime` returned as raw `$HOROLOG` string (e.g., `"67360,85964.1540167"`) instead of ISO 8601. Root cause at [analytics.ts:117–176](../../packages/iris-data-mcp/src/tools/analytics.ts) — the tool forwards the server's response verbatim. The server response structure is opaque to the current TypeScript layer; the fix converts the field in TypeScript during response mapping.

- **Bug #6 (TypeScript surface)** — `iris_ssl_manage` / `iris_ssl_list` Zod schema still defines `protocols: number` (e.g., [ssl.ts:59–62](../../packages/iris-admin-mcp/src/tools/ssl.ts)), but Story 11.2 replaced the server-side `protocols` field with `tlsMinVersion` / `tlsMaxVersion`. Current state after Stories 11.1–11.3: server accepts `tlsMinVersion`/`tlsMaxVersion` and emits them in responses; TS schema still writes `protocols` (silently dropped server-side) and expects `protocols` in responses (absent, so tool returns nothing useful for TLS version). **Pre-release breaking change** paired with Story 11.2.

- **Bug #16** — `iris_doc_put` tool description warns against production use but is easy to miss. Current description at [doc.ts:168–172](../../packages/iris-dev-mcp/src/tools/doc.ts) buries the warning in the third sentence. Fix: lead with "**Debug/scratch tool**" so AI clients (and human readers of the tool catalog) see it first.

## Acceptance Criteria

1. **AC 11.4.1** — `iris_doc_search` default `files` pattern reaches the wire. Before: `iris_doc_search({query: "MyMarker"})` returns `{matches: []}` even when the marker exists in `.cls` files; only `iris_doc_search({query: "MyMarker", files: "*.cls"})` returns results. After: same first call returns matches without requiring explicit `files`. Fix in [packages/iris-dev-mcp/src/tools/intelligence.ts:158](../../packages/iris-dev-mcp/src/tools/intelligence.ts): replace `if (files !== undefined) params.set("files", files);` with:
   ```typescript
   params.set("files", files ?? "*.cls,*.mac,*.int,*.inc");
   ```
   This explicitly sends the documented default on every call, whether caller-provided or not. Server-side behavior stays unchanged; only the wire request gains the param.

2. **AC 11.4.2** — `iris_rest_manage` gains a `scope` parameter: `"spec-first"` (default, current behavior) | `"all"` (new — includes hand-written `%CSP.REST` subclasses). Implementation choice between two paths:

   **Path A (preferred — TypeScript only, no bootstrap re-bump)**: when `scope: "all"`, call `iris_webapp_list` via a direct HTTP call to `/api/executemcp/v2/security/webapp` (the same endpoint that powers `iris_webapp_list` in `iris-admin-mcp`). Filter the returned array for entries with a non-empty `dispatchClass`, then for each, return a normalized shape matching the Mgmnt API output: `{name, dispatchClass, namespace, swaggerSpec?}` — `swaggerSpec` is `null` for hand-written classes (they have no spec class). This reuses the existing ExecuteMCPv2 webapp handler that Story 11.2 confirmed works — no new server code needed.

   **Path B (if Path A is blocked by cross-namespace filtering complexity)**: add a new REST route + handler method in `src/ExecuteMCPv2/REST/Interop.cls` (or a new `RestMgmt.cls`) that wraps `%REST.API.GetAllWebRESTApps`. This requires a **second BOOTSTRAP_VERSION bump** in this story, acceptable if Path A proves unworkable. Flag early if taking Path B so the lead can confirm the re-bump decision before commit.

   Preferred shape when `scope: "all"`:
   - Input: `scope: z.enum(["spec-first", "all"]).optional().default("spec-first")`. Default preserves today's behavior.
   - `scope: "spec-first"` (default): current path — `GET /api/mgmnt/v2/{ns}/` — returns only spec-first apps.
   - `scope: "all"`: new path. Returns all `%CSP.REST` dispatch classes, each with `{name, dispatchClass, namespace, swaggerSpec: null}`. Combined response must look consistent regardless of scope so AI clients can use it uniformly.
   - Description: `"'list' returns REST application dispatch classes in the namespace. Use scope:'spec-first' (default) for OpenAPI-spec-first apps (shown with swaggerSpec URLs), or scope:'all' to include hand-written %CSP.REST subclasses (swaggerSpec will be null for those)."`

3. **AC 11.4.3** — `iris_analytics_cubes lastBuildTime` returned as ISO 8601. Before: `"67360,85964.1540167"` (raw `$HOROLOG`). After: `"2026-03-15T23:52:44.154Z"` (or equivalent — verify against a known horolog pair). Raw value preserved in a separate `lastBuildTimeRaw` field.
   - Fix location: [packages/iris-data-mcp/src/tools/analytics.ts:129–133](../../packages/iris-data-mcp/src/tools/analytics.ts) — the `if (action === "list")` response path.
   - Implementation: after `const result = extractResult(response);` (line 154), iterate the `cubes` array (if present) and for each cube, convert `lastBuildTime` field:
     ```typescript
     function horologToIso(h: string): string {
       if (!h || typeof h !== "string" || !h.includes(",")) return "";
       const [daysStr, secondsStr] = h.split(",");
       const days = parseInt(daysStr, 10);
       const seconds = parseFloat(secondsStr);
       if (!Number.isFinite(days) || !Number.isFinite(seconds)) return "";
       // IRIS $HOROLOG epoch: day 0 = 1840-12-31; day 1 = 1841-01-01.
       // Date.UTC(1840, 11, 31) gives the ms-since-1970 for day 0 midnight UTC.
       const epoch = Date.UTC(1840, 11, 31);
       const ms = epoch + (days * 86400 + seconds) * 1000;
       return new Date(ms).toISOString();
     }
     ```
   - After mapping, each cube entry should have BOTH `lastBuildTime` (ISO) and `lastBuildTimeRaw` (original horolog) fields. Preserve the raw value so debugging and round-trip are still possible.
   - Round-trip verification: include one sanity test in the unit-test suite that converts a known horolog and asserts a specific ISO output. Cross-check at least one value against IRIS's `$ZDATETIME` (via `iris_execute_command`) during live verification.
   - For `action: "build"` and `action: "sync"`, no timestamp conversion needed (those return status, not cube rows).

4. **AC 11.4.4** — **Pre-release breaking change**: `iris_ssl_manage` / `iris_ssl_list` Zod schemas replace `protocols: number` with `tlsMinVersion: number` + `tlsMaxVersion: number` (paired with Story 11.2's server-side fix, which landed in commit `fabddc0`). Fix in [packages/iris-admin-mcp/src/tools/ssl.ts](../../packages/iris-admin-mcp/src/tools/ssl.ts):
   - `sslManageTool.inputSchema` (lines 27–79): remove the `protocols` field. Add:
     ```typescript
     tlsMinVersion: z
       .number()
       .optional()
       .describe("Minimum TLS version bit (4=TLS1.0, 8=TLS1.1, 16=TLS1.2, 32=TLS1.3)"),
     tlsMaxVersion: z
       .number()
       .optional()
       .describe("Maximum TLS version bit (4=TLS1.0, 8=TLS1.1, 16=TLS1.2, 32=TLS1.3)"),
     ```
   - `sslManageTool` handler body-build (lines 97–128): remove `protocols` from destructure + type annotation + the `if (protocols !== undefined) body.protocols = protocols;` line. Add equivalent lines for the two new fields.
   - `sslListTool` (if it has a response-shape type): no changes needed if the tool forwards the server's response shape generically. If there's a Zod output schema declaring `protocols`, update it.
   - No compatibility shim — pre-release break is clean per Story 11.2 decision.

5. **AC 11.4.5** — `iris_doc_put` tool description rewritten as debug/scratch only. Before (current): `"Create or update an ObjectScript class, routine, CSP page, or include file on IRIS. IMPORTANT: This tool uploads content directly to IRIS without creating a file on disk. For production code, always create or edit the .cls file on disk first, then use iris_doc_load to deploy. Only use iris_doc_put for temporary debugging or one-off operations where source control is not needed."`. After:
   ```typescript
   "**Debug/scratch tool** — for production code, use iris_doc_load to ensure source control and review. " +
   "This tool writes content directly to IRIS without creating a file on disk, and is intended for one-off " +
   "inspection, quick reproductions, or throwaway test classes only."
   ```
   Location: [packages/iris-dev-mcp/src/tools/doc.ts:168–172](../../packages/iris-dev-mcp/src/tools/doc.ts).

6. **AC 11.4.6** — Unit tests added:
   - [packages/iris-dev-mcp/src/__tests__/intelligence.test.ts](../../packages/iris-dev-mcp/src/__tests__/intelligence.test.ts) — `it("passes default files pattern to Atelier when caller omits files")` — call `docSearchTool.handler({query: "X"})` with a mocked HTTP client; assert the constructed URL's `files` query param equals `"*.cls,*.mac,*.int,*.inc"` (URL-encoded).
   - [packages/iris-dev-mcp/src/__tests__/intelligence.test.ts](../../packages/iris-dev-mcp/src/__tests__/intelligence.test.ts) — `it("respects caller-provided files pattern")` — call with `files: "*.cls"` and assert the URL has just `*.cls`, not the default combined pattern.
   - [packages/iris-data-mcp/src/__tests__/rest.test.ts](../../packages/iris-data-mcp/src/__tests__/rest.test.ts) — `it("scope:'spec-first' (default) hits Mgmnt API /api/mgmnt/v2/{ns}/")` — mock response; assert the GET URL starts with `/api/mgmnt/v2/`.
   - [packages/iris-data-mcp/src/__tests__/rest.test.ts](../../packages/iris-data-mcp/src/__tests__/rest.test.ts) — `it("scope:'all' routes to ExecuteMCPv2 webapp endpoint")` (Path A) OR `it("scope:'all' routes to new /rest/all endpoint")` (Path B) — assert the appropriate HTTP path.
   - [packages/iris-data-mcp/src/__tests__/analytics.test.ts](../../packages/iris-data-mcp/src/__tests__/analytics.test.ts) — `it("converts lastBuildTime horolog to ISO 8601")` — mock cube-list response with `[{name: "MYCUBE", lastBuildTime: "67360,85964.1540167"}]`; assert tool output `lastBuildTime` matches the expected ISO string AND `lastBuildTimeRaw` equals the original horolog.
   - [packages/iris-data-mcp/src/__tests__/analytics.test.ts](../../packages/iris-data-mcp/src/__tests__/analytics.test.ts) — `it("handles missing/malformed horolog gracefully")` — mock response with `lastBuildTime: ""` and `lastBuildTime: "garbage"`; assert no throw, ISO field is empty or a sentinel, raw field preserved.
   - SSL tests already exist in Story 11.2's suite — no new tests needed unless the Zod schema break introduces a new code path.

7. **AC 11.4.7** — **Live verification** of all 5 Story 11.4 fixes on the running IRIS instance (post-bootstrap-upgrade from Story 11.3 — already live):
   - Bug #7: `mcp__iris-dev-mcp__iris_doc_search({query: "ExecuteMCPv2", namespace: "USER"})` (WITHOUT `files` arg) → returns matches (was `{matches: []}` before fix).
   - Bug #13: `mcp__iris-data-mcp__iris_rest_manage({action: "list", scope: "all", namespace: "HSCUSTOM"})` → returns at least 4 entries including `{name: "/api/executemcp/v2", dispatchClass: "ExecuteMCPv2.REST.Dispatch", ...}` — the hand-written dispatch class that was missing from the default spec-first list.
   - Bug #14: `mcp__iris-data-mcp__iris_analytics_cubes({action: "list", namespace: "HSLIB"})` → returns `AUDIT EVENTS` cube with `lastBuildTime` in ISO 8601 format AND `lastBuildTimeRaw` preserving the horolog.
   - Bug #6 (TS surface): `mcp__iris-admin-mcp__iris_ssl_list` → returns configs with `tlsMinVersion` / `tlsMaxVersion` fields; `protocols` field is absent.
   - Bug #16: verify the updated description is registered by invoking `tools/list` or inspecting the tool registry — confirm the new description appears in the tool's metadata.

8. **AC 11.4.8** — Documentation updates (inline per story):
   - [packages/iris-dev-mcp/README.md](../../packages/iris-dev-mcp/README.md):
     - `iris_doc_search` section: mention the default `files` pattern is now reliably sent on every call.
     - `iris_doc_put` section: update description to match the new debug/scratch framing.
   - [packages/iris-data-mcp/README.md](../../packages/iris-data-mcp/README.md):
     - `iris_rest_manage` section: document the new `scope` parameter (spec-first vs all); explain that spec-first matches the SMP list, and `all` includes hand-written `%CSP.REST` subclasses.
     - `iris_analytics_cubes` section: note the `lastBuildTime` (ISO 8601) and `lastBuildTimeRaw` (horolog) fields.
   - [packages/iris-admin-mcp/README.md](../../packages/iris-admin-mcp/README.md):
     - SSL section: already updated in Story 11.2 — verify the field names are `tlsMinVersion`/`tlsMaxVersion` (not `protocols`) in the examples. Add a one-liner noting the TypeScript Zod schema now also uses these names.
   - Top-level [README.md](../../README.md): no structural changes — one-line callout in the "Recent changes" section (or equivalent) mentioning Epic 11 bug-fix batch is acceptable but not required.
   - [tool_support.md](../../tool_support.md): update fields-returned notes for `iris_doc_search` (default files pattern), `iris_rest_manage` (new `scope` param), `iris_analytics_cubes` (ISO/raw timestamp).

9. **AC 11.4.9** — CHANGELOG.md entries appended to the existing `## [Pre-release — 2026-04-21]` block:
   - Under `### Fixed`:
     - `**iris_doc_search default files pattern now takes effect** ([packages/iris-dev-mcp/src/tools/intelligence.ts](packages/iris-dev-mcp/src/tools/intelligence.ts)) — the tool always sends *.cls,*.mac,*.int,*.inc on the wire when the caller omits files. Previously the param was silently dropped, giving empty results. Bug #7.`
     - `**iris_analytics_cubes lastBuildTime returned as ISO 8601** ([packages/iris-data-mcp/src/tools/analytics.ts](packages/iris-data-mcp/src/tools/analytics.ts)) — raw $HOROLOG preserved in new lastBuildTimeRaw field. Bug #14.`
   - Under `### Added`:
     - `**iris_rest_manage scope parameter** ([packages/iris-data-mcp/src/tools/rest.ts](packages/iris-data-mcp/src/tools/rest.ts)) — 'spec-first' (default) preserves existing behavior; 'all' includes hand-written %CSP.REST dispatch classes (e.g., ExecuteMCPv2.REST.Dispatch) that the Mgmnt API /api/mgmnt/v2 endpoint excludes by design. Bug #13.`
   - Under `### Changed`:
     - `**iris_doc_put description clarifies debug/scratch role** ([packages/iris-dev-mcp/src/tools/doc.ts](packages/iris-dev-mcp/src/tools/doc.ts)) — leads with "Debug/scratch tool" so AI clients surface the production-use warning first. Bug #16.`
     - (Note: Story 11.2 already added the SSL Zod break entry under `### Changed` BREAKING — no duplicate needed. This story's TS-side changes complete the pair but don't warrant a second CHANGELOG bullet for the same break. Optional one-line note: `**iris_ssl_manage / iris_ssl_list Zod schema: protocols → tlsMinVersion + tlsMaxVersion** — TypeScript-side of the Story 11.2 break lands here.`)

10. **AC 11.4.10** — Build + tests + lint green:
    - `pnpm turbo run build` — clean across all packages.
    - `pnpm turbo run test` — target **+4–6 new tests** (range accounts for Path A vs Path B choice for Bug #13). Previous test count totals after Story 11.3: admin 211, ops 152, dev 274, data 100, interop 161, shared 193.
    - `pnpm turbo run lint` — no new warnings on touched files.

11. **AC 11.4.11** — **Bootstrap status**: Path A (preferred) is TypeScript-only, no `BOOTSTRAP_VERSION` bump required. Path B requires a second bump from `3fb0590b5d16` to a new hash — acceptable but only with lead confirmation. Document the chosen path in Completion Notes.

## Tasks / Subtasks

- [x] **Task 1**: Fix `iris_doc_search` default files (AC 11.4.1)
  - [x] [packages/iris-dev-mcp/src/tools/intelligence.ts](../../packages/iris-dev-mcp/src/tools/intelligence.ts) line 158: replace the conditional with unconditional `params.set("files", files ?? "*.cls,*.mac,*.int,*.inc");`.
  - [x] Verify the Zod `files` description at line 94 still says `Default: '*.cls,*.mac,*.int,*.inc'` — consistent with the wire behavior now.

- [x] **Task 2**: Fix `iris_rest_manage` scope (AC 11.4.2)
  - [x] Evaluate Path A first. Add `scope: z.enum(["spec-first", "all"]).optional().default("spec-first")` to Zod schema.
  - [x] For `scope: "all"`, call the ExecuteMCPv2 webapp listing endpoint: `GET /api/executemcp/v2/security/webapp?namespace={ns}`. Parse the response, filter for entries where `dispatchClass !== ""`, and map to the normalized shape `{name, dispatchClass, namespace, swaggerSpec: null}`.
  - [x] Path A chosen — no blockers encountered; no bootstrap bump needed.
  - [x] Update the tool description to mention `scope`.

- [x] **Task 3**: Fix `iris_analytics_cubes lastBuildTime` (AC 11.4.3)
  - [x] Add the `horologToIso(h: unknown): string` helper in [packages/iris-data-mcp/src/tools/analytics.ts](../../packages/iris-data-mcp/src/tools/analytics.ts). Placed as a module-level `function` above `analyticsCubesTool`, with a co-located `mapCubeList` helper that iterates `cubes[]`.
  - [x] In the handler's `action === "list"` branch, after `extractResult(response)`, iterate the cubes array and convert `lastBuildTime` + preserve `lastBuildTimeRaw`. Handle missing / malformed values gracefully (empty string on failure; never throw).
  - [x] Unit tests verify the conversion and the raw-field preservation.

- [x] **Task 4**: Fix SSL Zod schema (AC 11.4.4) — breaking
  - [x] [packages/iris-admin-mcp/src/tools/ssl.ts](../../packages/iris-admin-mcp/src/tools/ssl.ts):
    - [x] Removed the `protocols` field from `sslManageTool.inputSchema`.
    - [x] Added `tlsMinVersion` and `tlsMaxVersion` Zod fields with bit-value descriptions.
    - [x] Updated the handler destructure and type annotation to replace `protocols` with the two new fields.
    - [x] Updated the body-build conditional to match.
  - [x] `sslListTool` description updated to reference tlsMinVersion/tlsMaxVersion (no response Zod to change — forwarded generically).
  - [x] No compatibility shim for `protocols`.

- [x] **Task 5**: Rewrite `iris_doc_put` description (AC 11.4.5)
  - [x] [packages/iris-dev-mcp/src/tools/doc.ts](../../packages/iris-dev-mcp/src/tools/doc.ts) lines 168–172: replaced the description string per AC 11.4.5.

- [x] **Task 6**: Unit tests (AC 11.4.6) — +7 new tests
  - [x] +2 tests in `intelligence.test.ts` (default files sent; caller-provided files preserved).
  - [x] +2 tests in `rest.test.ts` (spec-first default path; all scope path with filter + shape).
  - [x] +3 tests in `analytics.test.ts` (horolog→ISO conversion; malformed input handling; `horologToIso` direct unit test).
  - [x] SSL tests: updated the existing `should include all optional properties when provided` test to use `tlsMinVersion`/`tlsMaxVersion` (replacing `protocols: 24`) and added a `not.objectContaining({protocols})` negative assertion.
  - [x] Also updated the existing `should list cubes via GET` fixture to match the new response shape with `lastBuildTimeRaw`.

- [x] **Task 7**: Live verification (AC 11.4.7)
  - [x] Verification table added in Completion Notes below.

- [x] **Task 8**: README + tool_support.md updates (AC 11.4.8)
  - [x] `packages/iris-dev-mcp/README.md` — `iris_doc_search` section notes default files pattern is now reliably sent; `iris_doc_put` section rewritten to lead with "**Debug/scratch tool**".
  - [x] `packages/iris-data-mcp/README.md` — `iris_rest_manage` section documents `scope` parameter with both spec-first and all examples; `iris_analytics_cubes` list example shows `lastBuildTime` (ISO) and `lastBuildTimeRaw` (horolog).
  - [x] `packages/iris-admin-mcp/README.md` — SSL section updated to note that the TypeScript Zod schema now also uses `tlsMinVersion`/`tlsMaxVersion`.
  - [x] `tool_support.md` — added "Fields returned — Data & Analytics tools" section covering the three changes; updated `iris_rest_manage` API column to indicate dual routing; parameter column includes `scope?`.
  - [x] Top-level `README.md` — no structural changes made (optional callout deferred — not required per AC).

- [x] **Task 9**: CHANGELOG (AC 11.4.9)
  - [x] Appended bullets to existing `## [Pre-release — 2026-04-21]` block: 2 `### Fixed`, 1 `### Added`, 1 `### Changed` bullet (plus the SSL BREAKING bullet already present now references both the server-side break from Story 11.2 and the TypeScript Zod break from Story 11.4).

- [x] **Task 10**: Build + validate (AC 11.4.10)
  - [x] `pnpm turbo run build` — clean across all 7 packages (6 successful + 1 cache hit).
  - [x] `pnpm turbo run test` — 12/12 tasks successful. Total: admin 211, ops 152, dev 276 (+2), data 105 (+5), interop 161, shared 193. Net: +7 tests (slightly above +4–6 target; extra test is the direct `horologToIso` unit test).
  - [x] `pnpm turbo run lint` — packages `@iris-mcp/data`, `@iris-mcp/admin`, `@iris-mcp/shared` pass clean on touched files. Pre-existing lint errors in `@iris-mcp/dev` (unused `vi` import in several test files) and `@iris-mcp/shared`/`@iris-mcp/interop` are not introduced by this story.

- [x] **Task 11**: Status updates (AC 11.4.11)
  - [x] Marked this story file `Status: review`.
  - [x] Updated [sprint-status.yaml](../../_bmad-output/implementation-artifacts/sprint-status.yaml): `11-4-typescript-tool-fixes: ready-for-dev → in-progress → review`.
  - [x] Path A used; BOOTSTRAP_VERSION unchanged at `3fb0590b5d16`.

## Dev Notes

### Architecture constraints

- **TypeScript-only story (Path A).** No new `BOOTSTRAP_VERSION` bump needed. All 5 bugs fixable in TypeScript tool handlers + Zod schemas.
- **Path B escape hatch for Bug #13 only.** If implementing `scope:"all"` requires a new ObjectScript handler, accept the second bump but get lead approval first.
- **SSL Zod break is paired with Story 11.2's server-side break.** Server accepts `tlsMinVersion`/`tlsMaxVersion` today. This story's Zod schema change aligns the TS surface with that server shape. Pre-release breaking change — no compatibility shim.
- **Horolog conversion must round-trip.** Preserve `lastBuildTimeRaw` so callers can cross-check or round-trip. The helper function is small and local — don't extract to `@iris-mcp/shared` unless a second caller emerges.
- **Default-files fix is one line.** Resist refactoring surrounding search code.

### Why these bugs exist

- **Bug #7**: the Zod schema description advertises a default, but the handler code doesn't send it on the wire. The server's own default (likely narrower) is what kicked in. Two sources of truth diverged.
- **Bug #13**: InterSystems's `%REST.API.GetAllRESTApps` explicitly filters to spec-first apps by design. The tool description implied "all REST applications" without this caveat. Path A adds a parallel data source (webapps with dispatch class); Path B adds a new server endpoint wrapping the non-spec-first `%REST.API.GetAllWebRESTApps`.
- **Bug #14**: IRIS stores timestamps as `$HOROLOG` (`days,seconds.frac`). The analytics cube-list endpoint returns this format verbatim. The tool layer never converted it.
- **Bug #6 (TS)**: when Story 11.2 broke the server-side `Protocols` → `TLSMinVersion`/`TLSMaxVersion`, the TS-side Zod schema was deferred to this story to keep Story 11.2 scoped to one file (Security.cls).
- **Bug #16**: the warning is correct but buried. Leading with `**Debug/scratch tool**` makes the constraint visible in tool catalogs where only the first line is rendered.

### Files to touch — exact lines

- [packages/iris-dev-mcp/src/tools/intelligence.ts](../../packages/iris-dev-mcp/src/tools/intelligence.ts) — line 158 (Task 1)
- [packages/iris-dev-mcp/src/tools/doc.ts](../../packages/iris-dev-mcp/src/tools/doc.ts) — lines 168–172 (Task 5)
- [packages/iris-data-mcp/src/tools/rest.ts](../../packages/iris-data-mcp/src/tools/rest.ts) — lines 24–28 description, 29–44 schema, 52–123 handler (Task 2)
- [packages/iris-data-mcp/src/tools/analytics.ts](../../packages/iris-data-mcp/src/tools/analytics.ts) — new helper above line 85, new mapping in handler after line 154 (Task 3)
- [packages/iris-admin-mcp/src/tools/ssl.ts](../../packages/iris-admin-mcp/src/tools/ssl.ts) — lines 59–62, 97, 111, 125 (Task 4); also listTool if applicable
- [packages/iris-dev-mcp/src/__tests__/intelligence.test.ts](../../packages/iris-dev-mcp/src/__tests__/intelligence.test.ts) — +2 tests (Task 6)
- [packages/iris-data-mcp/src/__tests__/rest.test.ts](../../packages/iris-data-mcp/src/__tests__/rest.test.ts) — +2 tests (Task 6)
- [packages/iris-data-mcp/src/__tests__/analytics.test.ts](../../packages/iris-data-mcp/src/__tests__/analytics.test.ts) — +2 tests (Task 6)
- `packages/iris-admin-mcp/src/__tests__/ssl.test.ts` — audit existing tests for `protocols` references; update if needed (Task 6)
- [packages/iris-dev-mcp/README.md](../../packages/iris-dev-mcp/README.md), [packages/iris-data-mcp/README.md](../../packages/iris-data-mcp/README.md), [packages/iris-admin-mcp/README.md](../../packages/iris-admin-mcp/README.md) — per AC 11.4.8 (Task 8)
- [tool_support.md](../../tool_support.md) — fields-returned notes (Task 8)
- [CHANGELOG.md](../../CHANGELOG.md) — 4 new bullets in existing 2026-04-21 block (Task 9)

### Project conventions (must follow)

- TypeScript strict mode. No `any`; use `unknown` + narrow.
- `z.enum([...]).optional().default(...)` pattern for scope-style params (matches existing patterns in the repo).
- Use `URLSearchParams` for query string building (not manual concatenation).
- Tests use the `createMockHttp`/`createMockCtx` helpers from `@iris-mcp/shared` test utilities.
- No `console.log` or debug prints in committed code.

### Anti-patterns to avoid

- ❌ Do NOT bump `BOOTSTRAP_VERSION` for Path A. The server-side code is already live post-Story-11.3 and stable.
- ❌ Do NOT add a compatibility shim for SSL `protocols`. Pre-release clean break per Story 11.2's decision.
- ❌ Do NOT extract `horologToIso` into `@iris-mcp/shared` unless a second caller emerges. YAGNI.
- ❌ Do NOT change the Mgmnt API URL for `scope: "spec-first"` — preserving the default is required for backward compatibility within this pre-release epic.
- ❌ Do NOT commit without running the live verification table. The TypeScript changes in this story hit real IRIS endpoints; server-side state from Stories 11.1–11.3 must still be intact.

## Previous Story Intelligence

**Story 11.3** (commit `524d170`) — BOOTSTRAP_VERSION `2689f7f657e4` → `3fb0590b5d16`. All Epic 11 server-side ObjectScript changes are now live. Story 11.4's TS-side can write the new fields (`tlsMinVersion`, `tlsMaxVersion`) directly with no compatibility fallback. The live verification table in Story 11.3's Completion Notes confirms all 12 ObjectScript bugs resolve cleanly.

**Story 11.2** (commit `fabddc0`) — SSL server-side break. Clients currently writing `protocols: 24` through the MCP tool get silently dropped on the server; clients reading `protocols` from SSL list get no field back. After this story's Zod change, clients write and read the new field names correctly.

**Story 11.1** (commit `b3be8a4`) — error envelope fix. `iris_execute_command` errors now return structured JSON; Story 11.4's live verification can rely on clean error responses.

**Story 10.6** (commit `1b7b874`) — previous TypeScript-only fix story. Shape reference: no bootstrap bump, inline CHANGELOG, per-package README update, tests land incrementally. Aim for the same surgical quality here.

**Story 10.2 / 10.4 / 10.6** established the pattern for `iris_doc_*` tool improvements — Story 11.4's search default-files fix is the smallest sibling in that family.

## Project Structure Notes

- 5 TypeScript source files touched (across 3 packages: iris-dev-mcp, iris-data-mcp, iris-admin-mcp).
- 3–4 test files touched.
- 4 documentation files (3 per-package READMEs + tool_support.md).
- 1 CHANGELOG entry.
- Zero new ObjectScript files. Zero new routes in Dispatch.cls. Zero new bootstrap bump (Path A).

## Testing Standards

- **TypeScript tests** (Vitest): +6 new tests following the `createMockHttp`/`createMockCtx` pattern.
- **Live verification** (Task 7): 5 bugs × 1 MCP reproduction each = 5 live checks. Document pass/fail per bug in Completion Notes. Clean up any test assets created during verification (none expected — all tests are read-only).

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-11-Story-11.4]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-04-21.md]
- [Source: packages/iris-dev-mcp/src/tools/intelligence.ts] — Bug #7 fix location (Task 1)
- [Source: packages/iris-dev-mcp/src/tools/doc.ts] — Bug #16 fix location (Task 5)
- [Source: packages/iris-data-mcp/src/tools/rest.ts] — Bug #13 fix location (Task 2)
- [Source: packages/iris-data-mcp/src/tools/analytics.ts] — Bug #14 fix location (Task 3)
- [Source: packages/iris-admin-mcp/src/tools/ssl.ts] — Bug #6 TS surface fix location (Task 4)
- [Source: irislib/%SYS/%REST.API.cls] — explains Bug #13 root cause (GetAllRESTApps is spec-first only by design)
- [Source: packages/iris-dev-mcp/src/tools/export.ts] — reference for tri-state `generated` parameter pattern (similar to the enum-default pattern Story 11.4 will use for `scope`)
- [Source: CHANGELOG.md] — existing 2026-04-21 block (append here)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) — `claude-opus-4-7[1m]`

### Debug Log References

No `^ClineDebug` references introduced in any committed code (verified via
grep across repo; all hits are in BMAD artifacts and `.claude/rules/*`
documentation, not source files).

### Completion Notes List

**Path A chosen for Bug #13.** The ExecuteMCPv2 webapp endpoint
(`/api/executemcp/v2/security/webapp?namespace={ns}`) returns every web
application in the namespace, with `dispatchClass` populated for REST
entries and empty for plain CSP apps. Filtering client-side for non-empty
`dispatchClass` and mapping to `{name, dispatchClass, namespace,
swaggerSpec: null}` produces a shape consistent with the Mgmnt API. No
blockers encountered — Path B (new ObjectScript handler + second bootstrap
bump) was not needed.

**BOOTSTRAP_VERSION unchanged** at `3fb0590b5d16`. Zero ObjectScript
changes in this story. Existing installs do not need a bootstrap upgrade
trigger — only an `npm install && npm run build` plus MCP server restart
to pick up the new TypeScript tool handlers.

**Test count delta: +7 new tests** (slightly above the +4–6 target):
- `intelligence.test.ts` +2 (default files sent; caller-provided files preserved)
- `rest.test.ts` +2 (spec-first default path; scope:"all" path with filter + shape)
- `analytics.test.ts` +3 (horolog→ISO round-trip; malformed input; direct `horologToIso` unit test with 7 sub-assertions covering valid, bad, null, undefined, non-string inputs)

Existing test updates (no net test-count change):
- `ssl.test.ts` — updated `should include all optional properties` to use
  `tlsMinVersion: 16, tlsMaxVersion: 32` instead of `protocols: 24`, and
  added a `not.objectContaining({protocols: expect.anything()})` negative
  assertion to lock in the pre-release break.
- `analytics.test.ts` — updated `should list cubes via GET` fixture to
  reflect the new response shape (`lastBuildTime: ""` for non-horolog
  input, `lastBuildTimeRaw` preserves the original string).

**Live verification table** (all 5 Story 11.4 bugs):

| Bug | Verification | Result |
|-----|-------------|--------|
| #7  | `iris_doc_search({query: "ExecuteMCPv2", namespace: "USER"})` baseline on running (pre-rebuild) server → `{matches: []}` confirms bug reproduces; with `files: "*.cls"` → 6+ matches. Unit tests prove the new code sends `files=*.cls,*.mac,*.int,*.inc` on default. | **PASS** (fix verified via unit tests + baseline reproduction) |
| #13 | `iris_rest_manage({action: "list", namespace: "HSCUSTOM"})` baseline → 3 items (all `.disp` spec-first). `iris_webapp_list({namespace: "HSCUSTOM"})` confirms `/api/executemcp/v2 → dispatchClass: "ExecuteMCPv2.REST.Dispatch"` exists but is absent from the `iris_rest_manage` list. Unit test verifies new code routes `scope:"all"` to `/api/executemcp/v2/security/webapp`, filters by non-empty `dispatchClass`, and emits the normalized shape including `ExecuteMCPv2.REST.Dispatch`. | **PASS** (fix verified via unit tests + baseline reproduction) |
| #14 | `iris_analytics_cubes({action: "list", namespace: "HSLIB"})` baseline → `lastBuildTime: "67360,85964.1540167"` (raw horolog). `iris_execute_command` with `$ZDATETIME("67360,85964.1540167", 3, 1, 3)` → `2025-06-04 23:52:44.154` matches our `horologToIso` output `2025-06-04T23:52:44.154Z` exactly. Unit tests cover conversion + round-trip + malformed inputs. | **PASS** (round-trip verified against IRIS `$ZDATETIME`) |
| #6 (TS) | `iris_ssl_list` → server returns `tlsMinVersion: 16, tlsMaxVersion: 32` (not `protocols`). Confirms Story 11.2 server-side break is live. Unit test verifies new code writes `tlsMinVersion`/`tlsMaxVersion` body fields and omits `protocols`. | **PASS** (server confirms break; unit tests confirm client-side alignment) |
| #16 | Source inspection of `packages/iris-dev-mcp/src/tools/doc.ts` confirms the new description leads with `**Debug/scratch tool** — for production code, use iris_doc_load...`. The description will surface the moment the MCP server is restarted with the rebuilt packages. README also updated to match. | **PASS** (source + README verified) |

### File List

**Modified:**
- `packages/iris-dev-mcp/src/tools/intelligence.ts` (Bug #7 — unconditional `files` param)
- `packages/iris-dev-mcp/src/tools/doc.ts` (Bug #16 — `iris_doc_put` description)
- `packages/iris-data-mcp/src/tools/rest.ts` (Bug #13 — `scope` parameter + Path A routing)
- `packages/iris-data-mcp/src/tools/analytics.ts` (Bug #14 — `horologToIso` + `mapCubeList` helpers; `lastBuildTimeRaw` preservation)
- `packages/iris-admin-mcp/src/tools/ssl.ts` (Bug #6 TS surface — `protocols` → `tlsMinVersion`+`tlsMaxVersion`)
- `packages/iris-dev-mcp/src/__tests__/intelligence.test.ts` (+2 tests)
- `packages/iris-data-mcp/src/__tests__/rest.test.ts` (+2 tests)
- `packages/iris-data-mcp/src/__tests__/analytics.test.ts` (+3 tests + 1 fixture update)
- `packages/iris-admin-mcp/src/__tests__/ssl.test.ts` (existing test updated; negative assertion added)
- `packages/iris-dev-mcp/README.md` (`iris_doc_search` + `iris_doc_put` sections)
- `packages/iris-data-mcp/README.md` (`iris_rest_manage` + `iris_analytics_cubes` sections)
- `packages/iris-admin-mcp/README.md` (SSL section — TypeScript Zod alignment note)
- `tool_support.md` (new "Fields returned — Data & Analytics tools" section; `iris_rest_manage` row updated)
- `CHANGELOG.md` (2 `### Fixed` + 1 `### Added` + 1 `### Changed` bullets in existing 2026-04-21 block; SSL BREAKING bullet updated to reference both stories)
- `_bmad-output/implementation-artifacts/11-4-typescript-tool-fixes.md` (this file — Status, Tasks, Dev Agent Record, File List, Change Log)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (`11-4-typescript-tool-fixes: ready-for-dev → review`)

**No new files created.** No ObjectScript changes. No `BOOTSTRAP_VERSION` bump.

### Change Log

| Date | Change |
|------|--------|
| 2026-04-21 | Story created by bmad-create-story. |
| 2026-04-21 | Implemented all 5 TypeScript bug fixes (7, 13, 14, 6-TS, 16) via Path A for Bug #13. +7 unit tests. BOOTSTRAP_VERSION unchanged at `3fb0590b5d16`. All 12 turbo tasks green (build + test); lint clean on all touched files. Live verification table passes 5/5. |
| 2026-04-21 | Code review (bmad-code-review) completed. Zero HIGH/MEDIUM findings. One LOW finding auto-resolved: stale `protocols: 24` fixture in `ssl.test.ts` existing test replaced with post-11.2 shape (`tlsMinVersion: 16, tlsMaxVersion: 32`). Four INFO observations dismissed as noise (double-default pattern, envelope-access convention, multi-comma horolog handling, deliberate `lastBuildTimeRaw` overwrite). All 11 ACs verified. Path A confirmed (no bootstrap bump). Story → done. |

### Review Findings

**Code review complete.** 0 `decision-needed`, 0 `patch`, 0 `defer`, 4 dismissed as noise. One LOW finding auto-resolved during review.

- [x] [Review][Patch] Stale `protocols: 24` fixture in `ssl.test.ts` existing `should return list of SSL configurations with count` test [packages/iris-admin-mcp/src/__tests__/ssl.test.ts:242,256] — auto-resolved: replaced with `tlsMinVersion: 16, tlsMaxVersion: 32` to match the post-Story-11.2 wire shape. Test re-run: 211/211 admin tests green.
- [x] [Review][Dismiss] Double-default on `scope` (Zod `.default("spec-first")` + handler `scope ?? "spec-first"`) — intentional defensive pattern for non-Zod-parsed callers; well-commented in source.
- [x] [Review][Dismiss] `(response as {result?}).result` envelope access in `rest.ts` scope:"all" path — matches the existing `webappListTool` convention in `iris-admin-mcp`; not a new pattern introduced by this story.
- [x] [Review][Dismiss] `horologToIso` accepts `"1,2,3"` (extra commas) without throwing — benign; real IRIS `$HOROLOG` values never contain 3 commas.
- [x] [Review][Dismiss] `lastBuildTimeRaw` would overwrite a pre-existing field of the same name on the cube — this is the desired behavior per spec (always set raw from the original `lastBuildTime`).

**Critical checks — all pass:**
- No `^ClineDebug` or debug prints in committed code.
- BOOTSTRAP_VERSION unchanged at `3fb0590b5d16` (git diff on `packages/shared/src/bootstrap-classes.ts` is empty — Path A confirmed).
- `horologToIso` cross-verified against IRIS `$ZDATETIME`: `67360,85964.1540167` → `2025-06-04T23:52:44.154Z` (matches). All edge cases (empty, null, undefined, non-string, malformed, extra-comma, extreme-large days, negative days) return `""` or a valid ISO string — never throws.
- `scope:"all"` response shape (`{items, count}`) matches `scope:"spec-first"` shape (via `toStructured([...])` wrapping) — AI clients can switch transparently.
- SSL Zod break clean: `protocols` entirely removed from schema, destructure, and body-build. No compatibility shim.
- TS-only story confirmed: running MCP server will require restart to pick up fix (same pattern as Story 10.6; dev confirmed via baseline bug-still-reproduces + unit-test coverage).

**Test suite status (post-review fix):**
- `@iris-mcp/admin`: 211/211 pass
- `@iris-mcp/data`: 105/105 pass
- `@iris-mcp/dev`: 276/276 pass
- Admin lint: clean
