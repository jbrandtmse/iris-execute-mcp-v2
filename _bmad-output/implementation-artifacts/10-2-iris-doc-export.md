# Story 10.2: `iris_doc_export` — Bulk Download of Documents to Local Files

Status: done

## Story

As an AI client or developer who needs a local working copy of IRIS code,
I want to download every document matching a filter to a local directory,
so that I can read, grep, diff, or version-control IRIS-side code without round-tripping each file through `iris_doc_get`.

## Acceptance Criteria

1. **AC 10.2.1** — Tool registered as `iris_doc_export` in `@iris-mcp/dev`. Annotations: `readOnlyHint: false` (writes to local disk), `destructiveHint: false` (does not delete local files it didn't create), `idempotentHint: true` (re-running with same args is safe — overwrites with identical content), `openWorldHint: false`. Tool count bumps 22 → 23.

2. **AC 10.2.2** — Input schema mirrors `iris_doc_list` / `iris_package_list` filtering surface, inverts `iris_doc_load`'s destination:
   - `destinationDir` (string, **required**) — absolute local directory to write files into. Created recursively if it doesn't exist.
   - `prefix` (string, optional) — narrow to documents whose dotted name starts with this value (`"EnsLib"`, `"MyApp.Services"`). Empty/omitted means all matching documents in the namespace.
   - `category` (enum `CLS | RTN | CSP | OTH | *`, optional, default `*`).
   - `type` (string, optional) — file extension filter (`cls`, `inc`, `mac`, `int`).
   - `generated` (enum `true | false | both`, optional, default `false`) — `false` = source only, `true` = generated only, `both` = everything. **Note**: this differs from `iris_doc_list`/`iris_package_list` which use a plain boolean; the tri-state here matches the user's explicit ask for "yes,no,both".
   - `system` (enum `true | false | only`, optional, default `false`) — same tri-state semantics as `iris_package_list`.
   - `modifiedSince` (ISO 8601 string, optional) — only export documents modified since this timestamp.
   - `namespace` (string, optional) — per-call namespace override.
   - `includeManifest` (boolean, optional, default `true`) — when true, write a `manifest.json` in `destinationDir` listing everything downloaded plus any skipped items with reasons.
   - `ignoreErrors` (boolean, optional, default `true`) — when true, per-document failures (long path, disk-full, encoding) are logged into the result and the batch continues. When false, the first error aborts the run with `isError: true, partial: true`.
   - `useShortPaths` (boolean, optional, default `false`) — on Windows, map each package segment to its first 8 characters to stay under MAX_PATH. Ignored on non-Windows. When used, the manifest records the mapping so files can round-trip back to their full doc names on re-upload.
   - `overwrite` (enum `never | ifDifferent | always`, optional, default `ifDifferent`) — skip existing files when content matches (fast re-sync), always overwrite, or never overwrite (refuse and note in skipped list).
   - `continueDownloadOnTimeout` (boolean, optional, default `true`) — when true, the download loop ignores the MCP request's cancellation signal and runs to completion; already-written files stay on disk, the manifest is written at the end. When false, cancellation aborts immediately.

3. **AC 10.2.3** — Path mapping: **dots-as-directories**. `EnsLib.HTTP.GenericService.cls` → `<destinationDir>/EnsLib/HTTP/GenericService.cls`. The inverse mapping lives alongside `filePathToDocName` / `extractBaseDir` in the shared dev-mcp module so `iris_doc_load` and `iris_doc_export` round-trip cleanly.

4. **AC 10.2.4** — Output shape (happy path + error reporting):
   ```json
   {
     "destinationDir": "C:/dev/iris-export",
     "namespace": "USER",
     "filtersApplied": { "prefix": "EnsLib", "category": "CLS", "system": "false", "generated": "false" },
     "total": 1322,
     "exported": 1319,
     "skipped": 3,
     "skippedItems": [
       {
         "docName": "EnsLib.Some.Deeply.Nested.Package.ReallyLongClassName.cls",
         "reason": "ENAMETOOLONG: local path exceeds 260 characters on Windows",
         "hint": "Rerun with useShortPaths: true, or enable Windows long-path support in the registry (LongPathsEnabled)."
       }
     ],
     "manifest": "C:/dev/iris-export/manifest.json",
     "durationMs": 18432
   }
   ```
   When `ignoreErrors: false` and a failure occurs: `isError: true`, `partial: true`, and the response body describes which doc failed. Files already written are left on disk.

5. **AC 10.2.5** — `manifest.json` shape (when `includeManifest: true`):
   ```json
   {
     "namespace": "USER",
     "exportedAt": "2026-04-20T14:22:09Z",
     "filtersApplied": { "prefix": "EnsLib", "category": "CLS" },
     "files": [
       { "docName": "EnsLib.HTTP.GenericService.cls", "localPath": "EnsLib/HTTP/GenericService.cls", "bytes": 14582, "modifiedOnServer": "2025-06-04T18:37:28Z" }
     ],
     "skipped": [ /* same shape as in AC 10.2.4 */ ],
     "shortPathMap": null
   }
   ```
   When `useShortPaths: true`, `shortPathMap` is `{ "EnsLib/HTTP/GenericService.cls": "EnsLib/HTTP/GenericSe.cls" }` (original → shortened). `localPath` in each file entry is relative to `destinationDir` for portability.

6. **AC 10.2.6** — Implementation uses Atelier `GET /docnames` to enumerate (same shape as `iris_doc_list`) and `GET /doc/{name}` per file for content. Parallelism: up to **4 concurrent** document fetches via a bounded promise queue — per-file writes stream to disk, no in-memory buffering of the whole batch.

7. **AC 10.2.7** — When the resolved filter matches zero documents, the tool returns a successful empty result (`total: 0, exported: 0, skipped: 0, skippedItems: []`) with no manifest written. Not an error.

8. **AC 10.2.8** — Unit tests in `packages/iris-dev-mcp/src/__tests__/export.test.ts` cover:
   1. Small batch happy path (3-5 docs) — verifies dots-as-directories mapping.
   2. Large batch pagination — enumeration walks all pages (if the Atelier endpoint paginates at all — confirm via mock whether `docnames` has server-side pagination, and test accordingly).
   3. `ignoreErrors: true` with an injected per-file failure — batch continues, skipped item recorded.
   4. `ignoreErrors: false` with injected failure — returns `isError: true, partial: true`.
   5. `overwrite: ifDifferent` — unchanged file is not rewritten (byte-compare).
   6. `overwrite: never` — existing file refuses overwrite, noted in skipped list.
   7. `overwrite: always` — existing file is rewritten.
   8. `useShortPaths: true` on Windows — long path segment is shortened; `shortPathMap` populated in manifest.
   9. `useShortPaths: true` on non-Windows — flag is ignored; no truncation.
   10. Path traversal safety — `destinationDir` containing `..` is rejected; mapped doc name that would escape `destinationDir` is rejected.
   11. `system` tri-state — `false` excludes `%*`, `true` includes both, `only` returns only `%*`.
   12. `generated` tri-state — `false` / `true` / `both` propagate to the Atelier `generated` query param correctly.
   13. `modifiedSince` — uses `/modified/{ts}` endpoint.
   14. Empty result — `total: 0`, no manifest written.
   15. `continueDownloadOnTimeout: false` with simulated abort — loop stops, `partial: true` returned.
   16. Manifest temp-rename semantics — `.manifest.json.tmp` during the loop, renamed to `manifest.json` on success.
   17. CSP paths with forward slashes — `/csp/user/menu.csp` maps to `csp/user/menu.csp` under `destinationDir` (leading slash stripped, forward slashes preserved as directory separators). Cross-reference the Story 10.1 CSP-bucket finding.

9. **AC 10.2.9** — Progress and cancellation:
   - While the export loop runs, the tool emits MCP `notifications/progress` messages with `progress: exported, total: <total>` at least every **50 files or 2 seconds**, whichever comes first. Clients that honor progress notifications keep the connection alive and show the running count.
   - Cancellation semantics depend on `continueDownloadOnTimeout`:
     - `true` (default) — detach the download from the request's `AbortSignal`. Cancellation does not stop the loop. The tool's eventual return is still sent best-effort. The `manifest.json` at `destinationDir/manifest.json` is the authoritative record of what completed.
     - `false` — honor the `AbortSignal`. Stop the current in-flight `iris_doc_get`, finalize the partial manifest (with `"aborted": true`), return `isError: true, partial: true`.
   - In both modes, `manifest.json` is written on cancellation/error so the caller can recover and resume (`overwrite: ifDifferent` makes re-running cheap).

10. **AC 10.2.10** — Build, test, lint all pass: `pnpm turbo run build`, `pnpm turbo run test --filter=@iris-mcp/dev`, `pnpm turbo run lint`. Tool count assertions updated 22 → 23 in [packages/iris-dev-mcp/src/__tests__/index.test.ts](packages/iris-dev-mcp/src/__tests__/index.test.ts).

## Tasks / Subtasks

- [x] **Task 1**: Extract the inverse-mapping helper alongside `filePathToDocName` in [packages/iris-dev-mcp/src/tools/load.ts](packages/iris-dev-mcp/src/tools/load.ts) (AC 10.2.3)
  - [x] Add `docNameToFilePath(docName: string, baseDir: string, opts?: { useShortPaths?: boolean }): string` — inverse of `filePathToDocName`.
  - [x] Logic: split doc name at the last dot to separate stem from extension, replace dots in stem with `/`, join with `baseDir`, preserve extension. Extension list mirrors Story 10.1's `stripDocExtension`.
  - [x] `useShortPaths: true`: after splitting stem on `.`, truncate each segment to its first 8 characters (preserving case). Filename segment (last before extension) is **not** shortened — only directory segments.
  - [x] Handle CSP-style doc names with forward slashes (`/csp/user/menu.csp`): treat `/` as already-a-separator (strip leading `/`, keep the rest as directory structure, do not split further on `.`).
  - [x] Export both functions from `load.ts` for direct unit testing. Add a small "Helpers" JSDoc banner distinguishing them from the `docLoadTool` definition.
  - [x] Extend [packages/iris-dev-mcp/src/__tests__/load.test.ts](packages/iris-dev-mcp/src/__tests__/load.test.ts) with a `describe("docNameToFilePath", () => {…})` block covering:
    - `"EnsLib.HTTP.GenericService.cls"` + `"C:/dev/exp"` → `"C:/dev/exp/EnsLib/HTTP/GenericService.cls"`.
    - `"MyApp.Utils.cls"` with `useShortPaths: true` → `"C:/dev/exp/MyApp/Utils.cls"` (short enough to not change; test a longer name for actual shortening).
    - `"ReallyLongPackageNameHere.AnotherLongOne.Foo.cls"` with `useShortPaths: true` → `"C:/dev/exp/ReallyLo/AnotherL/Foo.cls"`.
    - `"/csp/user/menu.csp"` → `"C:/dev/exp/csp/user/menu.csp"` (strip leading slash, keep forward slashes).
    - `"NoExtension"` (no file extension at all) → `"C:/dev/exp/NoExtension"`.

- [x] **Task 2**: Create `packages/iris-dev-mcp/src/tools/export.ts` (AC 10.2.1, 10.2.2)
  - [x] Export `docExportTool: ToolDefinition`.
  - [x] Input schema via `z.object({...})` — mirror the style of `packages.ts` for the shared fields (`system` enum, `modifiedSince`, `category`, `type`, `prefix`, `namespace`). Add `generated` as an enum (not boolean — see AC 10.2.2).
  - [x] `scope: "NS"`, annotations per AC 10.2.1.
  - [x] Zod field descriptions must be specific with examples so AI clients format calls correctly.

- [x] **Task 3**: Implement the fetch-enumerate-download loop (AC 10.2.3, 10.2.6, 10.2.7, 10.2.9)
  - [x] **Enumeration**:
    - When `modifiedSince` is set → `GET /api/atelier/v{N}/{ns}/modified/{ts}`. Single request.
    - Otherwise → `GET /api/atelier/v{N}/{ns}/docnames/{cat}/{type}`. Pass `generated=1/0` (if `both`, omit the param). No `filter` param for `prefix` — filter client-side (Story 10.1 pattern; project memory documents Atelier's `filter` is SQL LIKE substring).
    - Extract list via `extractAtelierContentArray(response.result)` (import from [packages/iris-dev-mcp/src/tools/doc.ts](packages/iris-dev-mcp/src/tools/doc.ts)).
  - [x] **Client-side filtering**: apply `prefix`, `system` tri-state (same logic as Story 10.1 — import `isSystemPackageName` helper from `packages.ts` if useful, else inline).
  - [x] **Early-exit**: if filtered list is empty, return `{ total: 0, exported: 0, skipped: 0, skippedItems: [], durationMs, …filtersApplied }` with no manifest write.
  - [x] **Bounded concurrency**: pool of **4** workers pulling from a `Deque<DocName>`. Each worker does `GET /doc/{name}`, then writes to disk, then updates a shared counter. Use `Promise.allSettled` so a single failure doesn't abort the pool.
  - [x] **Streaming write**: use `fs.promises.writeFile` with the content returned by Atelier. Docs are small (< 1 MB each); stream only if individual content exceeds 1 MB. Avoid accumulating all content in RAM.

- [x] **Task 4**: Overwrite semantics (AC 10.2.2 `overwrite`, AC 10.2.4 skipped items)
  - [x] `overwrite: always` → write unconditionally.
  - [x] `overwrite: never` → if file exists, add to `skippedItems` with `reason: "exists"` and skip.
  - [x] `overwrite: ifDifferent` (default) → if file exists, read it, byte-compare to incoming content, write only if different. Report unchanged files in a separate "unchanged" count if practical (optional nicety; not an AC requirement — if skipped for simplicity, bundle unchanged into `exported` and mention this in a LOW note).

- [x] **Task 5**: Long-path + `useShortPaths` (AC 10.2.2 `useShortPaths`, AC 10.2.4 skippedItems)
  - [x] Before writing each file, compute the resolved absolute path via `path.resolve(destinationDir, docNameToFilePath(…))`.
  - [x] If `process.platform === "win32"` and the resolved path length ≥ 260, **without** `useShortPaths`, treat as a skip: push to `skippedItems` with `reason: "ENAMETOOLONG: local path exceeds 260 characters on Windows"` and `hint: "Rerun with useShortPaths: true, or enable Windows long-path support in the registry (LongPathsEnabled)."`.
  - [x] With `useShortPaths: true`, the shortened mapping should already fit; if it still doesn't (extremely deep namespace), emit the skip with the same hint.
  - [x] Record the `docName → shortenedLocalPath` pair in a `Map` that becomes `shortPathMap` in the manifest.

- [x] **Task 6**: Security — path traversal (AC 10.2.8 #10)
  - [x] Resolve `destinationDir` via `path.resolve()` and reject if it contains `..` after normalization (compare the resolved path to itself — if the normalized form differs from a naive join, something's off).
  - [x] For each mapped local path, verify `path.resolve(destinationDir, mappedPath).startsWith(path.resolve(destinationDir) + path.sep)`. If not, reject with a hard error (not a skip) — this is a server-side sanity check, not user-driven.
  - [x] Mirror the defensive approach in existing `iris_doc_load` — precedent is in [packages/iris-dev-mcp/src/tools/load.ts](packages/iris-dev-mcp/src/tools/load.ts).

- [x] **Task 7**: Manifest write (AC 10.2.5, AC 10.2.9)
  - [x] During the loop, write to `destinationDir/.manifest.json.tmp` incrementally (or once at the end — simpler, and the temp file survives a crash). Decision: **write once at the end** of the loop, but write to the `.tmp` path first and `fs.rename` atomically to `manifest.json` on success.
  - [x] On cancellation (when `continueDownloadOnTimeout: false` and an abort fires), finalize the partial manifest to `manifest.json` with `"aborted": true` at the top level.
  - [x] Include `filtersApplied` (echoing the actual resolved values with defaults applied), `exportedAt` as ISO 8601, `files[]`, `skipped[]`, `shortPathMap` (null when `useShortPaths: false`).
  - [x] `localPath` entries are **relative to `destinationDir`** for portability across machines.

- [x] **Task 8**: Progress notifications (AC 10.2.9)
  - [x] Probe `ctx` for a progress helper. If `@modelcontextprotocol/sdk` exposes `ctx.sendProgress?.({ progress, total })`, use it. If not, wrap whatever progress API the shared server-base exposes. **First action**: check [packages/shared/src/server-base.ts](packages/shared/src/server-base.ts) and [packages/shared/src/tool-types.ts](packages/shared/src/tool-types.ts) to see what's on the `ctx` object. If no helper exists, document that gracefully — emit progress only if the helper exists; fall through silently otherwise. Do NOT block on this.
  - [x] Throttle emissions: emit every 50 files OR every 2 seconds, whichever comes first. Use a `lastEmitMs` timestamp + counter. The final emission (100%) is always sent.
  - [x] Keep emission cheap — just `{ progress, total }`, no stringification.

- [x] **Task 9**: Cancellation detachment (AC 10.2.9 `continueDownloadOnTimeout`)
  - [x] When `true` (default): the download loop creates its own `AbortController` internally rather than passing `ctx.signal` to `fetch()`. This decouples the loop's lifecycle from the request's. The handler still awaits the loop and returns a response; if the client has given up, the response is lost but disk state is correct.
  - [x] When `false`: pass `ctx.signal` through. On abort, stop the pool (reject in-flight `GET`s), finalize the partial manifest, return `isError: true, partial: true`.
  - [x] **Simplification**: in test code, mock `ctx` with a controllable `AbortSignal` so both modes can be verified without actual timeouts.

- [x] **Task 10**: Register the tool (AC 10.2.1, 10.2.10)
  - [x] Import `docExportTool` in [packages/iris-dev-mcp/src/tools/index.ts](packages/iris-dev-mcp/src/tools/index.ts) and add to the exported array. Tool count `22` → `23`.
  - [x] Update `expect(tools.length).toBe(…)` assertions in [packages/iris-dev-mcp/src/__tests__/index.test.ts](packages/iris-dev-mcp/src/__tests__/index.test.ts) and the `.toContain("iris_doc_export")` list entries (Story 10.1 code review already patched one omission here — don't miss this).

- [x] **Task 11**: Unit tests (AC 10.2.8)
  - [x] Create `packages/iris-dev-mcp/src/__tests__/export.test.ts`.
  - [x] Use the same `IrisHttpClient` mock pattern as [packages/iris-dev-mcp/src/__tests__/load.test.ts](packages/iris-dev-mcp/src/__tests__/load.test.ts) and [packages/iris-dev-mcp/src/__tests__/packages.test.ts](packages/iris-dev-mcp/src/__tests__/packages.test.ts).
  - [x] Mock the filesystem: use `vi.mock("node:fs/promises", …)` or write to an `os.tmpdir()` directory unique per test and clean up in `afterEach`. Prefer the latter — tests that actually touch disk catch more bugs (mkdir, rename, byte-compare logic).
  - [x] 17 test cases per AC 10.2.8 list (23 total in file, covering all 17 ACs plus annotations and extra path-traversal variants).

- [x] **Task 12**: Build & validate (AC 10.2.10)
  - [x] `pnpm turbo run build --filter=@iris-mcp/dev` — must succeed.
  - [x] `pnpm turbo run test --filter=@iris-mcp/dev` — all tests including the 17 new ones. 266/266 pass (baseline 230 + 11 docNameToFilePath + 23 export + 2 index.test tool-count updates).
  - [x] `pnpm turbo run lint --filter=@iris-mcp/dev` — no new warnings on touched files (`export.ts`, `load.ts`, `index.ts`, `export.test.ts`, `load.test.ts`, `index.test.ts` all lint-clean).

### Review Findings

Reviewed 2026-04-20 via `bmad-code-review` skill (Blind Hunter + Edge Case Hunter + Acceptance Auditor). Result: 1 MEDIUM + 2 LOW auto-resolved, 2 LOW deferred, 4 LOW dismissed. Final test count 267/267.

- [x] [Review][Patch] Short-path collision detection — two doc names (e.g., a CSP-style `/csp/foo/bar.cls` and a dotted `csp.foo.bar.cls`, or two `useShortPaths: true` truncations that collapse to the same 8-char stub) could silently overwrite each other on disk. Added a `reservedPaths` Map tracking the first docName to claim each absolute path; subsequent collisions now skip with `reason: "short-path collision: resolves to same local path as '<other docName>'"`. New test #18 in `export.test.ts` covers the CSP-vs-dotted case (platform-independent). [export.ts:438-446, 503-523] [export.test.ts:514-537]
- [x] [Review][Patch] Manifest self-description on hardError path — when `ignoreErrors: false` aborts mid-run, the manifest was written with no flag indicating incompleteness (only the in-memory `ExportResult` carried `partial: true`). A caller inspecting only the on-disk `manifest.json` could mistake it for a clean run. Added optional `partial?: boolean` to the `Manifest` interface and threaded `partial: true` from the hardError branch through `writeManifest`. Extended the existing `ignoreErrors: false` test to assert `manifest.partial === true` and `manifest.aborted === undefined`. [export.ts:72-81, 666-682, 772-789] [export.test.ts:203-220]
- [x] [Review][Patch] Soften `continueDownloadOnTimeout` JSDoc overclaim — the "ignores AbortSignal cancellation" wording implied the tool controls the HTTP layer's cancellation behavior, which it doesn't. Reworded the module-level JSDoc and the inline comment at the worker pool to clarify that the loop simply doesn't propagate the external signal into its own polling check; the HTTP layer's cancellation is a separate concern. [export.ts:21-27, 620-625]
- [x] [Review][Defer] `.manifest.json.tmp` can leak if `fsp.rename` fails. Logged to `deferred-work.md` under "code review of 10-2-iris-doc-export".
- [x] [Review][Defer] `docNameToFilePath` weird-input edge cases (`.cls`, `Foo..cls`, `.LeadingDot.cls`). Normalize via `path.resolve` downstream; Atelier does not produce these. Logged to `deferred-work.md`.

Dismissed (not written to file): 4 LOW findings on style/docs that are correct as-is (processOne's `""` baseDir + slash-strip is intentional; `as string` cast on `last` is defensive but harmless; prefix filter excluding CSP paths is documented behavior; path-traversal test raw-string form is correct per dev agent's debug note).

## Dev Notes

### Architecture constraints

- **TypeScript-only**. No new IRIS-side `ExecuteMCPv2.*` class. `BOOTSTRAP_VERSION` does NOT change. Existing installs pick this up via a rebuild + MCP server restart.
- **No new dependencies**. Node.js built-ins only: `node:fs/promises`, `node:path`, `node:os`, `AbortController`. Use `zod`, `IrisHttpClient`, `atelierPath`, `extractAtelierContentArray` (reuse from `doc.ts` via import).
- **Reuse** the `ctx.resolveNamespace(namespace)` pattern and the client-side filter helpers introduced in Story 10.1 (`stripDocExtension`, `isSystem`-style logic) where practical. If a helper in `packages.ts` is useful, import it rather than duplicating — but do not extract into a shared `helpers.ts` yet unless clean (if 10.1's helpers are tightly coupled to rollup math, just re-implement the small parts here).

### Reference implementations to mirror

| Concern | Reference file | Lines |
|---|---|---|
| Bulk Atelier loop + per-file error collection | [packages/iris-dev-mcp/src/tools/load.ts](packages/iris-dev-mcp/src/tools/load.ts) | whole file (inverse of what we're building) |
| Tool definition + zod schema + annotations | [packages/iris-dev-mcp/src/tools/packages.ts](packages/iris-dev-mcp/src/tools/packages.ts) | whole file |
| `modifiedSince` branch | [packages/iris-dev-mcp/src/tools/doc.ts](packages/iris-dev-mcp/src/tools/doc.ts) | 406–419 |
| `extractAtelierContentArray` helper | [packages/iris-dev-mcp/src/tools/doc.ts](packages/iris-dev-mcp/src/tools/doc.ts) | export near top |
| Disk I/O + mkdir + write file | [packages/iris-dev-mcp/src/tools/load.ts](packages/iris-dev-mcp/src/tools/load.ts) | `readFileSync`, `globSync` usage — invert for writing |
| Unit test mock pattern (HTTP) | [packages/iris-dev-mcp/src/__tests__/packages.test.ts](packages/iris-dev-mcp/src/__tests__/packages.test.ts) | whole file |
| Unit test real-disk pattern (mkdir/writeFile in tests) | [packages/iris-dev-mcp/src/__tests__/load.test.ts](packages/iris-dev-mcp/src/__tests__/load.test.ts) | look for any fs usage |

### Project conventions (must follow)

- **Tool name**: `iris_doc_export` (flat underscore per Epic 9). NO dots.
- **File location**: `packages/iris-dev-mcp/src/tools/export.ts`.
- **Export name**: `docExportTool` (camelCase, matches `docListTool`, `docLoadTool`, `packageListTool`).
- **Test file**: `packages/iris-dev-mcp/src/__tests__/export.test.ts`.
- **Zod field descriptions**: specific, example-rich.

### Anti-patterns to avoid

- ❌ Do NOT buffer all document content in memory. Write each file as it's fetched.
- ❌ Do NOT query `%Dictionary.ClassDefinition` via `iris_sql_execute`. Use Atelier only.
- ❌ Do NOT pass `prefix` as the Atelier `filter` query param — `filter` is SQL LIKE substring (project memory documents this).
- ❌ Do NOT write the manifest incrementally with synchronous fs calls during the loop — that will slow a 1000-doc export to a crawl. Write once at the end.
- ❌ Do NOT forget to validate `destinationDir` for path traversal. This is user-supplied input that resolves to disk writes.
- ❌ Do NOT over-engineer the progress notification — if the MCP SDK doesn't expose a helper, fall through silently. Don't block Story 10.2 on MCP SDK changes.
- ❌ Do NOT swallow errors silently when `ignoreErrors: true` — every skipped item must appear in `skippedItems` with a reason.
- ❌ Do NOT write files outside `destinationDir`. The path traversal check must be hard (reject, not skip).

### Previous Story Intelligence

**Story 10.1** just landed (commit `a863798`). Key learnings that apply:

- **Export helpers for testability**: `packages.ts` exports `stripDocExtension`, `rollupPackage`, `NON_CLASS_BUCKET`. Import `stripDocExtension` if your extension logic needs it; otherwise write a local helper.
- **CSP paths with forward slashes are real**: Story 10.1 surfaced `/csp/user/menu.csp` during live verification and had to patch `rollupPackage` to bucket them. For export, CSP paths will want to be written to disk with their forward slashes preserved as directory separators (strip leading `/`). See Task 1 and AC 10.2.8 #17.
- **`system` tri-state shape**: `z.enum(["true", "false", "only"])` works cleanly without coercion conflicts — mirror this for `generated` (AC 10.2.2).
- **Tool count test assertion backfill**: the code reviewer for 10.1 had to backfill a missing `.toContain("iris_execute_tests")` assertion in `index.test.ts`. When you bump count 22 → 23, also verify every tool name in the `toContain` list is present — add `iris_doc_export` AND any others you notice are missing.
- **Live-verification expectation**: after your code lands, you will need the user to restart `iris-dev-mcp` before a cross-namespace live call can run. Budget for that.
- **Import over duplicate**: Story 10.1 imported `extractAtelierContentArray` from `doc.ts` rather than duplicating the 5-line helper. Do the same.

**Story 3.9** (`iris_doc_load`) — the inverse of this tool — is your closest architectural precedent. The disk-write-safety approach, error-collection pattern (`UploadFailure` struct), and bulk-loop structure should all invert cleanly. Read [_bmad-output/implementation-artifacts/3-9-bulk-document-load-from-disk.md](_bmad-output/implementation-artifacts/3-9-bulk-document-load-from-disk.md) for the completion notes.

### Recent Bug-Fix Context (2026-04-19)

During the manual retest pass that led to this epic:
- **`iris_doc_load` prefix-leakage bug** was fixed (commit `96e70ff`). `extractBaseDir` now returns the parent directory for literal paths. You don't need to worry about this; it's already fixed.
- **`IrisApiError.message` now includes `status.errors[]` detail** ([packages/shared/src/errors.ts](packages/shared/src/errors.ts)). If your handler catches `IrisApiError` when a per-file `GET /doc/{name}` fails, `error.message` is now informative — include it in the skipped-item `reason`.

### Project Structure Notes

- Aligned with existing `@iris-mcp/dev` layout. No new subdirectories. No `src/ExecuteMCPv2/*` changes. No `gen:bootstrap`.
- No README or CHANGELOG changes here — those land in Story 10.3 (the doc rollup).
- After this story, tool count becomes 23. Story 10.3 will then update README tool-count callouts and `tool_support.md`.

### Testing standards

- Vitest. Mock `IrisHttpClient` via the pattern in `packages.test.ts` / `load.test.ts`.
- Use a real tmp directory (`os.tmpdir()` + crypto-random suffix) for disk-touching tests. Clean up in `afterEach`.
- Test the URL that the handler constructs (`mockHttp.get.mock.calls[0][0]`) for enumeration + each doc fetch.
- Every AC must have at least one test.
- Windows-only assertions: use `if (process.platform !== "win32") return;` at the top of those tests, or structure the test to simulate `process.platform` via a mock.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-10-Story-10.2]
- [Source: _bmad-output/planning-artifacts/prd.md#Namespace-Browsing-and-Bulk-Export-Epic-10-Addition-2026-04-20] — FR109
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-04-20.md] — Sprint Change Proposal §4 Proposal 3
- [Source: _bmad-output/implementation-artifacts/10-1-iris-package-list.md] — Story 10.1 (previous story, just landed)
- [Source: _bmad-output/implementation-artifacts/3-9-bulk-document-load-from-disk.md] — inverse tool (`iris_doc_load`)
- [Source: packages/iris-dev-mcp/src/tools/load.ts] — disk-I/O + helpers to invert
- [Source: packages/iris-dev-mcp/src/tools/packages.ts] — tool-definition style + client-side filtering patterns
- [Source: packages/iris-dev-mcp/src/tools/doc.ts#L328-L446] — `iris_doc_list` for enumeration pattern + `extractAtelierContentArray` export
- [Source: packages/shared/src/atelier.ts] — `atelierPath` helper
- [Source: packages/shared/src/http-client.ts] — `IrisHttpClient` interface
- [Source: packages/shared/src/server-base.ts] — check for `ctx.sendProgress` helper (AC 10.2.9 Task 8)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) via BMAD dev-story workflow.

### Debug Log References

No bugs encountered during implementation.

One build-time TypeScript error (TS2379 — `serverTs: string | undefined` vs optional property under `exactOptionalPropertyTypes`) fixed immediately by switching to conditional spread: `{ docName, ...(serverTs !== undefined ? { serverTs } : {}) }`.

One test setup issue: `path.join(tmp, "..", "escape")` normalized away the literal `..`, causing the traversal-rejection test to reach the HTTP layer with a mocked response that wasn't configured. Fixed by using a raw-string concatenation (`` `${tmp}/../escape` ``) so the `..` survives into the validation check.

### Completion Notes List

- **Helper extracted**: `docNameToFilePath(docName, baseDir, opts?)` added to `load.ts` alongside `filePathToDocName`/`extractBaseDir`. Handles dotted class names, CSP forward-slash names, `useShortPaths` (8-char truncation of directory segments only), and unknown/missing extensions. Round-trips cleanly with `filePathToDocName` for dotted names.
- **New tool `iris_doc_export`** (`packages/iris-dev-mcp/src/tools/export.ts`, ~540 LOC):
  - Bounded concurrency via a 4-worker pool pulling from a shared cursor index into a matches array. `Promise.allSettled` guards against a single worker's crash aborting the pool.
  - Overwrite policy tri-state (`never`/`ifDifferent`/`always`): `ifDifferent` byte-compares existing on-disk content to the fetched buffer and skips the write when identical, so unchanged files don't churn mtimes.
  - Windows long-path handling: `useShortPaths: true` on `win32` truncates every non-filename segment to its first 8 chars and records the full→short mapping in `manifest.shortPathMap`. Any resolved path still ≥260 chars on `win32` is reported as a skip with the ENAMETOOLONG reason and hint text from AC 10.2.4.
  - Path-traversal hard guard: `validateDestinationDir` rejects both `..` segments (before resolution) and non-absolute paths; `assertInsideRoot` throws (hard error, not skip) if a mapped doc path escapes `destinationDir` after `path.resolve`.
  - Manifest: written once at end via atomic `.manifest.json.tmp` → `rename("manifest.json")`. Fields: `namespace`, `exportedAt` (ISO), `filtersApplied` (echoed with resolved defaults), `files[]` with `localPath` relative to `destinationDir`, `skipped[]`, `shortPathMap` (null when `useShort: false`), and optional `aborted: true` when a cancellation interrupted the loop. No manifest is written on empty-result runs per AC 10.2.7.
  - Progress: defensive probe of `ctx.sendProgress` (not currently declared on `ToolContext` — present only if future transports attach one). Emits throttled to every 50 files or 2 seconds. Final 100% emission always sent. Silent no-op when hook is absent.
  - Cancellation: honors `ctx.signal` only when `continueDownloadOnTimeout: false`. Default `true` detaches completely — the loop runs to completion even if the client disconnects, so disk state stays the authoritative record. Tests simulate abort via a thin `{...ctx, signal}` override.
  - Empty-match path returns `{ total: 0, exported: 0, skipped: 0, skippedItems: [] }` early with no manifest file created, matching AC 10.2.7.
- **Tool registration**: added `docExportTool` to `packages/iris-dev-mcp/src/tools/index.ts` after `docLoadTool` (natural grouping with the other bulk-doc tool). Tool count 22 → 23.
- **Test coverage**: 23 test cases in `export.test.ts` covering all 17 AC 10.2.8 numbered scenarios plus annotations and additional path-traversal variants. All tests use real `os.tmpdir()` directories with `crypto.randomBytes` unique suffixes and clean up in `afterEach`. Four additional `docNameToFilePath` tests in `load.test.ts` (total 11 new helper tests; happy-path, extensions, short-path truncation, CSP, trailing slash, no-extension, round-trip).
- **Validation**: `pnpm turbo run build --filter=@iris-mcp/dev` clean, `pnpm turbo run test --filter=@iris-mcp/dev` reports 266/266 passing (baseline 230 + 11 `docNameToFilePath` + 23 `export` + 2 index-test count updates; exceeds 247 target), `pnpm turbo run lint --filter=@iris-mcp/dev` clean for all Story 10.2 touched files. Pre-existing lint errors in 7 unrelated files (`'vi' is defined but never used` in other test files + `'data' unused` in `custom-rest.integration.test.ts`) are out of scope per AC 10.2.10 ("no new warnings on touched files").

### File List

**New files:**
- `packages/iris-dev-mcp/src/tools/export.ts` — `iris_doc_export` tool implementation (Tasks 2-9).
- `packages/iris-dev-mcp/src/__tests__/export.test.ts` — 23 unit tests covering AC 10.2.8 (Task 11).

**Modified files:**
- `packages/iris-dev-mcp/src/tools/load.ts` — Added `docNameToFilePath` helper (inverse of `filePathToDocName`) with `useShortPaths` option; added shared extension regex; refactored `let relative` to `const` (lint fix) (Task 1).
- `packages/iris-dev-mcp/src/__tests__/load.test.ts` — Added 11 `docNameToFilePath` test cases including round-trip with `filePathToDocName` (Task 1).
- `packages/iris-dev-mcp/src/tools/index.ts` — Imported and registered `docExportTool` (Task 10).
- `packages/iris-dev-mcp/src/__tests__/index.test.ts` — Bumped tool count 22 → 23, added `iris_doc_export` to `toContain` and `toEqual` lists (Task 10).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — Story 10.2 status ready-for-dev → in-progress → review.
- `_bmad-output/implementation-artifacts/10-2-iris-doc-export.md` — Task checkboxes, Dev Agent Record, Status updated.

### Change Log

| Date | Change | Author |
|---|---|---|
| 2026-04-20 | Story 10.2 implementation complete. Added `iris_doc_export` tool (bulk document download) + `docNameToFilePath` helper. 23 new unit tests. Tool count 22 → 23. All build/test/lint clean. | Dev (Claude Opus 4.7) |
