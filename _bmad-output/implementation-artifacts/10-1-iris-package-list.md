# Story 10.1: `iris_package_list` — Package Listing with Depth + Prefix

Status: done

## Story

As an AI client or developer exploring an unfamiliar namespace,
I want to list the packages present at a chosen depth with the same filtering surface as `iris_doc_list`,
so that I can answer "what's in this namespace?" in one round trip without paginating every document or running raw SQL against `%Dictionary.ClassDefinition`.

## Acceptance Criteria

1. **AC 10.1.1** — Tool registered as `iris_package_list` in `@iris-mcp/dev`. Flat underscore name per Epic 9 convention. Annotations: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`.
2. **AC 10.1.2** — Input schema:
   - `depth` (number, optional, default 1) — how many dotted segments to roll up at. `1` = top-level packages, `3` = `Foo.Bar.Baz` rollup.
   - `prefix` (string, optional) — narrow to packages starting with this prefix (e.g., `"EnsLib"`). When combined with `depth`, returns sub-packages at `prefix.*…` up to `depth` segments **past** the prefix (so `prefix: "EnsLib"`, `depth: 2` returns `EnsLib.HTTP`, `EnsLib.JMS`, etc. — two segments total).
   - `category` (enum `CLS | RTN | CSP | OTH | *`, optional, default `*`).
   - `type` (string, optional) — file extension filter (`cls`, `mac`, `inc`, etc.).
   - `generated` (boolean, optional, default `false`) — include generated documents.
   - `system` (enum `true | false | only`, optional, default `false`) — `false` excludes `%*` packages; `true` includes both; `only` returns `%*` only.
   - `modifiedSince` (ISO 8601 string, optional) — only documents modified since this timestamp contribute to the rollup.
   - `namespace` (string, optional) — per-call namespace override.
3. **AC 10.1.3** — Output shape:
   ```json
   {
     "packages": [
       { "name": "EnsLib", "docCount": 1322, "depth": 1 },
       { "name": "Ens",    "docCount":  450, "depth": 1 }
     ],
     "count": 79,
     "namespace": "USER",
     "depth": 1,
     "prefix": null,
     "totalDocs": 6552
   }
   ```
   `docCount` is the number of documents rolled up under that package; `totalDocs` is the grand total scanned (before rollup). Rows sorted by `docCount` desc, then `name` asc.
4. **AC 10.1.4** — Implementation walks the Atelier `GET /docnames/{cat}/{type}` endpoint and aggregates **client-side**. No new IRIS-side endpoint, no SQL, no `ExecuteMCPv2.*` class.
5. **AC 10.1.5** — Unit tests in `packages/iris-dev-mcp/src/__tests__/packages.test.ts` cover: default (depth 1, no filters), depth 2 with prefix, `system: false` / `true` / `only`, `modifiedSince` propagation, empty namespace, category/type combinations.
6. **AC 10.1.6** — Tool description explicitly contrasts with `iris_doc_list` so AI clients pick the right tool: "Use `iris_package_list` when you want a structural overview; `iris_doc_list` when you want individual document names."
7. **AC 10.1.7** — When rollup exceeds 1000 package rows (rare — only at very high depths on very large namespaces), response is capped and includes `truncated: true` and `limit: 1000`.
8. **AC 10.1.8** — Build, test, lint all pass: `pnpm turbo run build`, `pnpm turbo run test`, `pnpm turbo run lint`.

## Tasks / Subtasks

- [x] **Task 1**: Create `packages/iris-dev-mcp/src/tools/packages.ts` (AC 10.1.1, 10.1.2, 10.1.4)
  - [x] Export `packageListTool: ToolDefinition`.
  - [x] Input schema via `z.object({...})` — mirror the enum/string style used in existing `doc.ts`.
  - [x] `scope: "NS"`, `annotations` per AC 10.1.1.
  - [x] Handler signature: `async (args, ctx) => { … }`.

- [x] **Task 2**: Implement the fetch-and-aggregate loop (AC 10.1.3, 10.1.4, 10.1.7)
  - [x] **When `modifiedSince` is set**: call `GET /api/atelier/v{N}/{ns}/modified/{ts}` (single request — Atelier returns full list). Follow the pattern from [packages/iris-dev-mcp/src/tools/doc.ts:407](packages/iris-dev-mcp/src/tools/doc.ts#L407).
  - [x] **Otherwise**: call `GET /api/atelier/v{N}/{ns}/docnames/{cat}/{type}` with `filter`, `generated` query params (same as `iris_doc_list` — see [packages/iris-dev-mcp/src/tools/doc.ts:421-431](packages/iris-dev-mcp/src/tools/doc.ts#L421-L431)).
  - [x] **No `filter` query param is derivable from `prefix`**: the Atelier `filter` is a SQL LIKE substring match, which would match `"SomeEnsLib"` in addition to `"EnsLib.*"`. Apply `prefix` filter client-side after fetching (safer than guessing Atelier semantics — documented per project memory that filter is SQL LIKE, not glob).
  - [x] Extract doc list via `extractAtelierContentArray(response.result)` (same helper used in `doc.ts`).
  - [x] Filter by `prefix` (`name.startsWith(prefix + ".") || name === prefix + "." || name === prefix`).
  - [x] Filter by `system` tri-state on the first segment:
    ```ts
    const isSystem = (name: string) => name.startsWith("%");
    if (system === "only" && !isSystem(docName)) continue;
    if (system === false && isSystem(docName)) continue;
    // system === true → include both
    ```
    Default is `false` (match `iris_doc_list`'s implicit behavior of excluding system when filter/category aren't explicit).
  - [x] Roll up to `depth`: `const pkg = docName.split(".").slice(0, depth).join(".");` — but **guard against file extension segments**. The Atelier docnames include extensions (`Foo.Bar.Baz.cls`), so pre-strip the extension: take `name.replace(/\.(cls|mac|int|inc|bas|mvi|mvb|csp|csr)$/i, "")` before splitting.
  - [x] Accumulate in a `Map<string, number>`: `map.set(pkg, (map.get(pkg) ?? 0) + 1)`.
  - [x] Sort by `docCount desc, name asc`. Cap at 1000 rows → set `truncated: true, limit: 1000`.
- [x] **Task 3**: Return output object (AC 10.1.3, 10.1.6)
  - [x] Shape per AC 10.1.3. Include `namespace`, `depth`, `prefix` (null when not provided), `totalDocs` (pre-rollup count), and optional `truncated`/`limit`.
  - [x] Description string on the tool explicitly mentions `iris_doc_list` to help AI-client routing (AC 10.1.6).

- [x] **Task 4**: Register the tool (AC 10.1.1)
  - [x] Import `packageListTool` in [packages/iris-dev-mcp/src/tools/index.ts](packages/iris-dev-mcp/src/tools/index.ts) and add to the exported array. Tool count goes `21` → `22` (Story 10.2 will take it to 23).
  - [x] Update any `expect(tools.length).toBe(…)` assertions in [packages/iris-dev-mcp/src/__tests__/index.test.ts](packages/iris-dev-mcp/src/__tests__/index.test.ts).

- [x] **Task 5**: Unit tests (AC 10.1.5)
  - [x] Create `packages/iris-dev-mcp/src/__tests__/packages.test.ts`.
  - [x] Use the same mock pattern as [packages/iris-dev-mcp/src/__tests__/doc.test.ts](packages/iris-dev-mcp/src/__tests__/doc.test.ts) / `load.test.ts` (mock `IrisHttpClient`, assert URL shape, assert output).
  - [x] **Test cases** (one `it` each, table-driven where feasible):
    1. Default — no filters, depth 1, returns top-level packages sorted by count.
    2. `depth: 2, prefix: "EnsLib"` — returns only `EnsLib.*` two-segment packages.
    3. `system: false` (default) — excludes `%` packages.
    4. `system: true` — includes both user and `%` packages in results.
    5. `system: "only"` — returns only `%` packages.
    6. `modifiedSince` — calls `/modified/{ts}` endpoint instead of `/docnames/`; aggregation still works.
    7. Empty namespace (no docs) — returns `{ count: 0, totalDocs: 0, packages: [] }`.
    8. `category: "CLS", type: "cls"` — verifies the URL path includes the right category/type.
    9. `depth: 3` with a deep prefix — verifies segment-count math.
    10. `truncated: true` when mock returns > 1000 distinct packages.

- [x] **Task 6**: Build & validate (AC 10.1.8)
  - [x] `pnpm turbo run build` — must succeed.
  - [x] `pnpm turbo run test --filter=@iris-mcp/dev` — all tests including the 10 new ones.
  - [x] `pnpm turbo run lint` — no warnings. (New files introduce zero lint issues; 8 pre-existing errors in unrelated files exist on `main` before this story — out of scope per project convention.)

## Dev Notes

### Architecture constraints

- **TypeScript-only**. No new IRIS-side `ExecuteMCPv2.*` class. `BOOTSTRAP_VERSION` does NOT change. Existing installs pick this up via a rebuild + MCP server restart.
- **No new dependencies**. Use `zod` (already in use), `IrisHttpClient` (from `@iris-mcp/shared`), `atelierPath` (from `@iris-mcp/shared`), `extractAtelierContentArray` (from `@iris-mcp/dev/src/tools/doc.ts` — re-export if needed or duplicate the 5-line helper).
- **Reuse the `ctx.resolveNamespace(namespace)` pattern** — every namespace-scoped tool in this package uses it.

### Reference implementations to mirror

| Concern | Reference file | Lines |
|---|---|---|
| Tool definition + zod schema + annotations | [packages/iris-dev-mcp/src/tools/doc.ts](packages/iris-dev-mcp/src/tools/doc.ts) | 328–390 (docListTool) |
| Handler structure (pagination + extract content array) | [packages/iris-dev-mcp/src/tools/doc.ts](packages/iris-dev-mcp/src/tools/doc.ts) | 393–446 |
| `modifiedSince` branch | [packages/iris-dev-mcp/src/tools/doc.ts](packages/iris-dev-mcp/src/tools/doc.ts) | 406–419 |
| Unit test mock pattern | [packages/iris-dev-mcp/src/__tests__/doc.test.ts](packages/iris-dev-mcp/src/__tests__/doc.test.ts) | whole file |
| Extension-stripping logic (already exists in `load.ts`) | [packages/iris-dev-mcp/src/tools/load.ts](packages/iris-dev-mcp/src/tools/load.ts) | `filePathToDocName` / `extractBaseDir` helpers |

### Project conventions (must follow)

- **Tool name**: `iris_package_list` (flat underscore per Epic 9). NO dots.
- **File location**: `packages/iris-dev-mcp/src/tools/packages.ts` (one file per tool group).
- **Export name**: `packageListTool` (camelCase, matches `docListTool`, `docLoadTool`, etc.).
- **Test file location**: `packages/iris-dev-mcp/src/__tests__/packages.test.ts`.
- **Use `booleanParam` / `z.enum()` from `./zod-helpers.ts`** where an existing helper applies (e.g., booleanParam for the `generated` flag — see how `load.ts` uses it).
- **Description strings on zod fields**: be specific and example-rich so AI clients format calls correctly.

### Anti-patterns to avoid

- ❌ Don't query `%Dictionary.ClassDefinition` via `iris_sql_execute` inside the handler — the whole point is to avoid that. Stick to Atelier `/docnames/`.
- ❌ Don't try to pass `prefix` as the Atelier `filter` query — `filter` is SQL LIKE substring, not prefix. Filter client-side.
- ❌ Don't reinvent extension stripping; factor it cleanly into a small helper in `packages.ts`. Story 10.2 will also need extension-aware logic — if the helper is generic enough, that's fine, but don't block Story 10.2 on a premature shared abstraction (Story 10.2 will extract the real shared helper).
- ❌ Don't add a `cursor` parameter. Unlike `iris_doc_list`, this tool returns a bounded summary (≤1000 rows after rollup); pagination adds complexity without value.
- ❌ Don't call IRIS-side `ExecuteMCPv2.*` — per AC 10.1.4, this is Atelier-only.

### Project Structure Notes

- Aligned with existing `@iris-mcp/dev` layout. No new subdirectories. No `src/ExecuteMCPv2/*` changes.
- No `gen:bootstrap` run required (no `.cls` file edits).
- No README or CHANGELOG changes here — those land in Story 10.3.

### Testing standards

- Vitest (already in use).
- Mock `IrisHttpClient` via the pattern in `doc.test.ts` / `load.test.ts`.
- Every AC must have at least one test.
- Test the URL that the handler constructs (`mockHttp.get.mock.calls[0][0]`) to verify the Atelier path is correct.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-10-Story-10.1]
- [Source: _bmad-output/planning-artifacts/prd.md#Namespace-Browsing-and-Bulk-Export-Epic-10-Addition-2026-04-20] — FR108
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-04-20.md] — Sprint Change Proposal §4 Proposal 2
- [Source: packages/iris-dev-mcp/src/tools/doc.ts#L328-L446] — `iris_doc_list` implementation to mirror
- [Source: packages/iris-dev-mcp/src/__tests__/doc.test.ts] — test pattern
- [Source: packages/shared/src/atelier.ts] — `atelierPath` helper
- [Source: packages/shared/src/http-client.ts] — `IrisHttpClient` interface

## Previous Story Intelligence

Most relevant completed story: **Story 3.9 — Bulk Document Load from Disk** ([_bmad-output/implementation-artifacts/3-9-bulk-document-load-from-disk.md](_bmad-output/implementation-artifacts/3-9-bulk-document-load-from-disk.md)). That story added `iris_doc_load` as the inverse of what Story 10.2 will build (`iris_doc_export`). Key patterns from 3.9 that apply here:

- Export helper functions for direct unit testing (`filePathToDocName`, `extractBaseDir`) — mirror by making the rollup helper testable if the test suite benefits.
- Used Node.js built-ins rather than new dependencies — hold the line.
- Tool count tracking in `index.test.ts` had to be updated — remember to do the same here.

Also relevant: **Story 2.5 — Code Intelligence Tools** ([_bmad-output/implementation-artifacts/2-5-code-intelligence-tools.md](_bmad-output/implementation-artifacts/2-5-code-intelligence-tools.md)) — introduced `iris_doc_search` / `iris_doc_index` which also wrap Atelier endpoints. The handler / schema / description style there is closest to what this story needs.

## Recent Bug-Fix Context (2026-04-19)

During the manual retest pass that led to this epic, six bugs were fixed including:
- **`IrisApiError.message` now includes `status.errors[]` detail** ([packages/shared/src/errors.ts](packages/shared/src/errors.ts)). When your handler catches `IrisApiError` (it shouldn't need to for this tool, but if it does), the error message is now genuinely informative.
- **`iris_doc_search` case-insensitive default** ([packages/iris-dev-mcp/src/tools/intelligence.ts](packages/iris-dev-mcp/src/tools/intelligence.ts)). When documenting your tool, remember: Atelier defaults are not always what's documented; always test the live behavior.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) — `claude-opus-4-7[1m]`

### Debug Log References

- Full monorepo build: `pnpm turbo run build` — 6/6 tasks successful.
- Full monorepo tests: `pnpm turbo run test` — 12/12 tasks successful, 228 tests in `@iris-mcp/dev` (20 new for `iris_package_list`).
- Lint scoped to new files: `npx eslint src/tools/packages.ts src/__tests__/packages.test.ts src/__tests__/index.test.ts src/tools/index.ts` → exit 0 (zero lint issues introduced).
- Pre-existing lint errors (8 total in `compile.test.ts`, `custom-rest.integration.test.ts`, `doc.test.ts`, `format.test.ts`, `intelligence.test.ts`, `server.test.ts`, `sql.test.ts`, `load.ts`) confirmed present on clean `main` prior to this story (verified via `git stash` + `pnpm turbo run lint`). Out of scope for Story 10.1.

### Completion Notes List

- Implemented `iris_package_list` as a TypeScript-only tool — no `.cls` edits, no `BOOTSTRAP_VERSION` bump, no new dependencies.
- Exposed three small pure helpers from `packages.ts` (`stripDocExtension`, `rollupPackage`, `PACKAGE_ROW_LIMIT`) so test coverage can target the rollup math directly; the story's "Previous Story Intelligence" section recommended this pattern from Story 3.9.
- Reused `extractAtelierContentArray` from `doc.ts` (imported, not duplicated) — the helper is only 5 lines but Story 10.2 will likely need the same shape, and both sites stay in sync this way.
- Used `z.enum(["true", "false", "only"])` for `system` to avoid conflating Boolean-coerced "true"/"false" with the string literal "only" (zod unions with `booleanParam` are awkward here; enum is simpler and self-documenting). The handler treats the enum string values directly.
- The tool's description explicitly contrasts with `iris_doc_list` per AC 10.1.6 and a dedicated test asserts the description contains `iris_doc_list`.
- Sort is stable and deterministic: `docCount desc` then `name asc` via `localeCompare`. Truncation at `PACKAGE_ROW_LIMIT` (1000) is exercised by a test that generates 1001 distinct top-level packages.
- Anti-patterns avoided: no SQL against `%Dictionary.ClassDefinition`; no attempt to pass `prefix` as Atelier `filter` (SQL LIKE would over-match); no `cursor` parameter (bounded output).

### File List

**Created**
- `packages/iris-dev-mcp/src/tools/packages.ts` — `iris_package_list` tool definition, schema, handler, and pure helpers (`stripDocExtension`, `rollupPackage`, `PACKAGE_ROW_LIMIT`).
- `packages/iris-dev-mcp/src/__tests__/packages.test.ts` — 20 unit tests covering all ACs plus helper unit coverage.

**Modified**
- `packages/iris-dev-mcp/src/tools/index.ts` — registered `packageListTool` in the exported `tools` array.
- `packages/iris-dev-mcp/src/__tests__/index.test.ts` — bumped tool count 21 → 22 and added `iris_package_list` to the name assertions in both locations.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story status `ready-for-dev` → `in-progress` → `review`; `last_updated` bumped to `2026-04-19`.
- `_bmad-output/implementation-artifacts/10-1-iris-package-list.md` — status update, task checkboxes, Dev Agent Record, Change Log.

### Change Log

| Date       | Change                                                                                     |
|------------|--------------------------------------------------------------------------------------------|
| 2026-04-19 | Added `iris_package_list` tool to `@iris-mcp/dev` with 20 unit tests. Tool count 21 → 22. |
| 2026-04-20 | Code review applied: CSP/slash-path bucket (`NON_CLASS_BUCKET`), test coverage for `iris_execute_tests`, `totalDocs` docstring clarification. Tests 228 → 230 (+2 new). |

### Review Findings

- [x] [Review][Patch] CSP/forward-slash doc paths pollute rollup [packages/iris-dev-mcp/src/tools/packages.ts] — `/csp/...` docs produced one package row each (observed live on USER as `/csp/user/menu` and similar). Fixed by bucketing any stem containing `/` under `NON_CLASS_BUCKET = "(csp)"` inside `rollupPackage`. Two new tests cover the helper and the handler integration.
- [x] [Review][Patch] `iris_execute_tests` missing from `.toContain` assertions [packages/iris-dev-mcp/src/__tests__/index.test.ts] — Pre-existing oversight from Story 3.9; Story 10.1 touches this block so the fix is in-scope. Added the missing `expect(names).toContain("iris_execute_tests")` line.
- [x] [Review][Patch] `totalDocs` semantic ambiguity [packages/iris-dev-mcp/src/tools/packages.ts] — Spec prose says "grand total scanned (before rollup)", which could be read as the raw fetch size. Implementation counts post-filter (pre-rollup), which is what the tests assert. Added an explanatory comment above the result construction documenting that `totalDocs` equals the sum of every `docCount` (post prefix+system filter).
- [x] [Review][Defer] `generated` flag ignored on `/modified/{ts}` branch — Pre-existing inconsistency shared with `iris_doc_list`. See deferred-work.md.
- [x] [Review][Defer] Digit-prefixed package rows like `"2"` on USER — Technically correct rollup of numeric-prefixed class stems. Users can filter with `category: "CLS"` if undesired. See deferred-work.md.

