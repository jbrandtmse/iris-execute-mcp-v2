---
date: 2026-04-20
trigger_type: scope-addition
scope_classification: Minor
status: Approved
handoff: Development team (iris-dev-mcp)
---

# Sprint Change Proposal — 2026-04-20

## Epic 10: Namespace Browsing and Bulk Export Tools

---

## Section 1 — Issue Summary

### What triggered this change

During a live MCP session on 2026-04-20, two gaps in the `@iris-mcp/dev` tool surface were observed:

1. **No way to answer "what packages are in this namespace?" structurally.** `iris_doc_list` returns per-document rows with pagination — it has no aggregation, distinct-by-prefix, or rollup mode. To produce a top-level package summary for the USER namespace, the only viable path was raw SQL:

   ```sql
   SELECT DISTINCT $PIECE(Name, '.', 1) AS TopPackage, COUNT(*) AS ClassCount
   FROM %Dictionary.ClassDefinition
   GROUP BY $PIECE(Name, '.', 1)
   ORDER BY ClassCount DESC
   ```

   That query returned **79 packages across 6,552 classes in one round trip**. Using `iris_doc_list` for the same question would have required paginating every document and aggregating client-side — minutes of round-trips and thousands of rows just to answer a structural question.

2. **No way to pull IRIS-side code to disk in bulk.** `iris_doc_load` deploys *to* IRIS, but there is no inverse. A developer or AI client wanting a local working copy (for grep, diff, version control, or offline inspection) must call `iris_doc_get` per document, with no filter surface, no directory mapping, no manifest, and no error tolerance.

### When and how the issue was discovered

The user invoked `iris_doc_list` expecting to get a package-level answer and observed the gap; the SQL workaround was suggested as a fallback. In the same session, the user noted the symmetric gap for bulk download (the inverse of `iris_doc_load` which had been exercised during retesting).

### Evidence

- Live SQL result: 79 packages, 6,552 classes in USER namespace, one round trip.
- `iris_doc_list` tool schema inspection: no aggregation parameters (`category`, `type`, `filter`, `generated`, `modifiedSince`, `cursor` are all row-level filters).
- Absence of any `iris_doc_export` or equivalent tool in `@iris-mcp/dev`.

### Issue type

**New requirement emerged** — not a technical limitation discovered during implementation, not a misunderstanding of original requirements. The MVP (Epics 1–9) is complete and shipping; this is post-MVP enhancement scope driven by observed day-to-day usage gaps.

---

## Section 2 — Impact Analysis

### Epic impact

- **Epics 1–9**: all *done* (per project memory as of 2026-04-10). No existing epic is invalidated, requires rework, or is resequenced.
- **Epic 10**: net-new, appended. No dependencies on in-flight work.

### Story impact

- No in-flight stories affected — the MVP sprint log is closed.
- Three new stories in Epic 10 (10.1, 10.2, 10.3).

### Artifact conflicts

| Artifact | Impact |
|---|---|
| [prd.md](prd.md) | Gains FR108 (package listing) and FR109 (bulk export) in a new "Namespace Browsing and Bulk Export" subsection. Existing FR numbering (FR1–FR105, FR106–107 deferred) untouched. |
| [epics.md](epics.md) | Gains Epic 10 appended after Epic 9. Existing epic content untouched. |
| [architecture.md](architecture.md) | No change. Both tools use the existing shared `IrisHttpClient` in `@iris-mcp/shared`; no new transport, no new IRIS-side classes. |
| UX Design | N/A — suite has no UI surface. |
| [README.md](README.md) | Suite table: `@iris-mcp/dev` tool count `21` → `23`. One-line description update. |
| [packages/iris-dev-mcp/README.md](packages/iris-dev-mcp/README.md) | Two new rows in the tool catalog; two new `<details>` example blocks; any tool-count callouts updated. |
| [tool_support.md](tool_support.md) | Two new rows in the `@iris-mcp/dev` table (both 🟦 Atelier). Section heading count `(21)` → `(23)`. Table "Mix" line updated. Suite-wide rollup totals updated. |
| [CHANGELOG.md](CHANGELOG.md) | New 2026-04-20 `Added` entry for Epic 10. |

### Technical impact

- **TypeScript-only** in `@iris-mcp/dev`. Two new files: `packages/iris-dev-mcp/src/tools/packages.ts` and `packages/iris-dev-mcp/src/tools/export.ts`. Both registered in `packages/iris-dev-mcp/src/tools/index.ts`.
- **No new IRIS-side classes**. Both tools use the standard Atelier REST API (`docnames` + `doc/{name}`). `BOOTSTRAP_VERSION` unchanged → existing installs upgrade via `pnpm install && pnpm turbo run build + MCP restart` only. No ObjectScript redeploy, no bootstrap probe churn.
- **Shared helper extracted**: `docNameToFilePath(docName, basePath, { useShortPaths })` — inverse of the existing `filePathToDocName` in `load.ts`. Both helpers colocated so `iris_doc_load` and `iris_doc_export` round-trip cleanly.
- **Deployment impact**: zero infrastructure change, zero configuration change, zero permission prompts. Pure TypeScript delta.

---

## Section 3 — Recommended Approach

### Selected path: Hybrid-new-epic

Add **Epic 10** with three stories (two tool stories + one doc rollup story).

### Alternatives considered

| Option | Verdict | Rationale |
|---|---|---|
| **Option 1 — Direct Adjustment** (modify Epic 2 or Epic 3 to absorb new stories) | Not viable | Epics 2 and 3 are closed. Bolting new stories onto a done epic muddies the sprint log and breaks the invariant that done epics stay frozen. |
| **Option 2 — Rollback** | N/A | Nothing to roll back — no completed work is being invalidated. |
| **Option 3 — MVP Review** | N/A | MVP is done and shipping. This is post-MVP enhancement, not a scope reduction. |
| **Option 4 (chosen) — New Epic** | Viable | Clean separation. Additive only. Risk-isolated from the MVP. |

### Effort, risk, timeline

- **Effort**: Low-Medium. Story 10.1 is ~200 LOC (schema + rollup + tests). Story 10.2 is ~400 LOC (schema + fetch loop + manifest + progress + cancellation + tests). Story 10.3 is docs-only.
- **Risk**: Low. Additive tools, no breaking changes, no ObjectScript deploy, no new IRIS endpoint, no new authentication path.
- **Timeline**: fits a single small sprint or one focused pairing session per story.

---

## Section 4 — Detailed Change Proposals

All six proposals below were reviewed and approved incrementally.

### Proposal 1 — Epic 10 header in [epics.md](epics.md)

**Location**: append after the end of Epic 9 (line ~2260).

```markdown
---

## Epic 10: Namespace Browsing and Bulk Export Tools (iris-dev-mcp)

**Goal**: Let AI clients survey a namespace at package granularity and pull code to disk in bulk, without paging through every document or falling back to raw SQL.

**Scope**: Two new tools in `@iris-mcp/dev`, one doc/rollup story. Both tools use only the Atelier REST API — no new `ExecuteMCPv2.*` classes, so the IRIS-side `BOOTSTRAP_VERSION` is unchanged and existing installs upgrade via `pnpm install && pnpm turbo run build` plus an MCP server restart.

**Functional Requirements (new)**:
- **FR-NEW-1** (package listing): Developer can enumerate the packages in a namespace at a configurable depth (1 = top-level, 2 = two-segment, etc.), optionally narrowed to a prefix, with the same filter surface as `iris_doc_list` (category, type, generated, modifiedSince, system inclusion).
- **FR-NEW-2** (bulk export): Developer can download the content of every document matching a filter (prefix, category, type, generated, modifiedSince) to a local directory, with an optional manifest of written files and error-tolerance controls.

**Stories**:
- 10.1 `iris_package_list` — package listing with depth + prefix
- 10.2 `iris_doc_export` — bulk download to disk
- 10.3 Documentation rollup (README suite + per-package + tool_support.md + CHANGELOG)

**Out of scope (deferred)**:
- Round-trip diffing (download → local edit → upload) — handled separately by existing `iris_doc_load` + editor tools.
- Incremental sync / snapshot manifests — deferred to a post-Epic-10 enhancement if demand materializes.
```

---

### Proposal 2 — Story 10.1 `iris_package_list` in [epics.md](epics.md)

**Location**: append after the Epic 10 header.

```markdown
### Story 10.1: `iris_package_list` — Package Listing with Depth + Prefix

**As an** AI client or developer exploring an unfamiliar namespace,
**I want** to list the packages present at a chosen depth with the same filtering surface as `iris_doc_list`,
**so that** I can answer "what's in this namespace?" in one round trip without paginating every document or running raw SQL against `%Dictionary.ClassDefinition`.

**Acceptance Criteria**:

- **AC 10.1.1** — Tool registered as `iris_package_list` in `@iris-mcp/dev`. Flat underscore name per Epic 9 convention. Annotations: `readOnlyHint: true`, `idempotentHint: true`.
- **AC 10.1.2** — Input schema:
  - `depth` (number, optional, default 1) — how many dotted segments to roll up at. `1` = top-level packages, `3` = `Foo.Bar.Baz` rollup.
  - `prefix` (string, optional) — narrow to packages starting with this prefix (e.g., `"EnsLib"`). When combined with `depth`, returns sub-packages at `prefix.*...` up to `depth` segments past the prefix.
  - `category` (enum `CLS | RTN | CSP | OTH | *`, optional, default `*`) — same semantics as `iris_doc_list`.
  - `type` (string, optional) — file extension filter (`cls`, `mac`, `inc`, etc.).
  - `generated` (boolean, optional, default false) — include generated documents.
  - `system` (enum `true | false | only`, optional, default `false`) — controls whether IRIS system packages (`%*`) appear in the rollup:
      - `false` (default) — exclude system packages; only user/project code is counted
      - `true` — include both user/project and system packages
      - `only` — return system packages only (useful for inspecting what's available in `IRISLIB`, `HSLIB`, etc.)
    The filter is applied to the first dotted segment of each document name: a package starts with `%` → system.
  - `modifiedSince` (ISO 8601 string, optional) — when provided, only documents modified since this timestamp contribute to the rollup.
  - `namespace` (string, optional) — per-call namespace override.
- **AC 10.1.3** — Output shape:
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
  `docCount` is the number of documents rolled up under that package entry; `totalDocs` is the grand total of documents scanned (before rollup). Rows sorted by `docCount` desc, then `name` asc.
- **AC 10.1.4** — Implementation walks the Atelier `docnames` endpoint using the existing paginated `IrisHttpClient` shape and aggregates client-side. No new IRIS-side endpoint. Pagination follows the same cursor pattern as `iris_doc_list`.
- **AC 10.1.5** — Unit tests in `packages/iris-dev-mcp/src/__tests__/packages.test.ts` cover: default (depth 1, no filters), depth 2 with prefix, system filter `false` / `true` / `only`, modifiedSince propagation, empty namespace, and the category/type combinations already in `list.test.ts`.
- **AC 10.1.6** — Tool description explicitly contrasts with `iris_doc_list` so AI clients pick the right tool: "Use `iris_package_list` when you want a structural overview; `iris_doc_list` when you want individual document names."
- **AC 10.1.7** — When the rollup would return more than 1000 package rows (rare but possible at very high depth), the response is capped and a `truncated: true` flag is returned alongside `limit: 1000`.

**Implementation Notes**:
- Location: new `packages/iris-dev-mcp/src/tools/packages.ts`. Register in `packages/iris-dev-mcp/src/tools/index.ts`.
- Reuses the `IrisHttpClient` in `@iris-mcp/shared` — no new transport code.
- The depth rollup uses `name.split(".").slice(0, depth).join(".")` keyed into a `Map<string, number>` for the count.
- `system: false` is the default because most AI-client questions are about user/project code, not IRIS internals — matches the intent of the `generated: false` default in `iris_doc_list`.
```

---

### Proposal 3 — Story 10.2 `iris_doc_export` in [epics.md](epics.md)

**Location**: append after Story 10.1.

```markdown
### Story 10.2: `iris_doc_export` — Bulk Download of Documents to Local Files

**As an** AI client or developer who needs a local working copy of IRIS code,
**I want** to download every document matching a filter to a local directory,
**so that** I can read, grep, diff, or version-control IRIS-side code without round-tripping each file through `iris_doc_get`.

**Acceptance Criteria**:

- **AC 10.2.1** — Tool registered as `iris_doc_export` in `@iris-mcp/dev`. Annotations: `readOnlyHint: false` (writes to local disk), `destructiveHint: false` (does not delete local files it didn't create), `idempotentHint: true` (re-running with same args overwrites files with the same content), `openWorldHint: false`.
- **AC 10.2.2** — Input schema (mirrors `iris_doc_list` filtering surface, inverts `iris_doc_load`'s destination):
  - `destinationDir` (string, **required**) — absolute local directory to write files into. Created if it doesn't exist.
  - `prefix` (string, optional) — narrow to documents whose name starts with this value (e.g., `"EnsLib"`, `"MyApp.Services"`). Empty/omitted means all matching documents in the namespace.
  - `category` (enum `CLS | RTN | CSP | OTH | *`, optional, default `*`).
  - `type` (string, optional) — file extension filter (e.g., `cls`, `inc`, `mac`, `int`).
  - `generated` (enum `true | false | both`, optional, default `false`) — `false` = source only, `true` = generated only, `both` = everything.
  - `system` (enum `true | false | only`, optional, default `false`) — same semantics as `iris_package_list`.
  - `modifiedSince` (ISO 8601 string, optional) — only export documents modified since this timestamp.
  - `namespace` (string, optional) — per-call namespace override.
  - `includeManifest` (boolean, optional, default `true`) — when true, write a `manifest.json` in `destinationDir` listing everything downloaded plus any skipped items with reasons.
  - `ignoreErrors` (boolean, optional, default `true`) — when true, per-document failures (long path, disk-full, encoding issues) are logged into the result and the batch continues. When false, the first error aborts the run.
  - `useShortPaths` (boolean, optional, default `false`) — on Windows, map each package segment to its first 8 characters to stay under MAX_PATH. Ignored on non-Windows. When used, the manifest records the mapping so the files can be round-tripped back to their full doc names on upload.
  - `overwrite` (enum `never | ifDifferent | always`, optional, default `ifDifferent`) — skip existing files when the content matches (fast re-sync), always overwrite, or never overwrite (refuse and note in skipped list).
  - `continueDownloadOnTimeout` (boolean, optional, default `true`) — when true, the download loop ignores the MCP request's cancellation/abort signal and runs to completion. Already-written files stay on disk; the manifest is written at the end. When false, cancellation aborts immediately and the tool returns `{ isError: true, partial: true }` with whatever had been exported. Useful when the client times out waiting for the response but you still want the download to finish on disk.
- **AC 10.2.3** — Path mapping: dots-as-directories. `EnsLib.HTTP.GenericService.cls` → `<destinationDir>/EnsLib/HTTP/GenericService.cls`. The helper comes from the shared dev-mcp module alongside `filePathToDocName` / `extractBaseDir` (extract the inverse function during this story so `iris_doc_load` and `iris_doc_export` stay in lockstep).
- **AC 10.2.4** — Output shape:
  ```json
  {
    "destinationDir": "C:/dev/iris-export",
    "namespace": "USER",
    "filtersApplied": { "prefix": "EnsLib", "category": "CLS", "system": false, "generated": "false" },
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
  When `ignoreErrors: false` and a failure occurs, the tool returns `isError: true` with the first failure's details and a `partial: true` flag — files already written are left on disk.
- **AC 10.2.5** — `manifest.json` shape (when `includeManifest: true`):
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
  When `useShortPaths: true`, `shortPathMap` is `{ "EnsLib/HTTP/GenericService.cls": "EnsLib/HTTP/GenericSe.cls" }` (original → shortened) so `iris_doc_load` can reconstruct the real doc name on re-upload.
- **AC 10.2.6** — Implementation uses Atelier `GET /docnames` to enumerate (same machinery as `iris_doc_list`) and `GET /doc/{name}` per file for content. Parallelism: fetch up to 4 documents concurrently with a bounded promise queue — streaming per-file writes to disk, no in-memory buffering of the whole batch.
- **AC 10.2.7** — When the resolved filter matches zero documents, the tool returns a successful empty result (`total: 0, exported: 0`) with no manifest written. Not an error.
- **AC 10.2.8** — Unit tests in `packages/iris-dev-mcp/src/__tests__/export.test.ts` cover: small batch success, large batch pagination, `ignoreErrors` true vs false on injected failure, `overwrite: ifDifferent` skip path, `useShortPaths` mapping, manifest structure, and path traversal safety (reject `..` in `destinationDir` or mapped paths).
- **AC 10.2.9** — Progress and cancellation:
  - While the export loop runs, the tool emits MCP `notifications/progress` messages with `progress: exported, total: <total>` at least every **50 files or 2 seconds**, whichever comes first. Clients that honor progress notifications keep the connection alive and show the running count.
  - Cancellation semantics depend on `continueDownloadOnTimeout`:
    - `true` (default) — detach the download from the request's `AbortSignal`. Cancellation does not stop the loop. The tool's eventual return is still sent (best-effort — client may have closed the stream). The manifest at `destinationDir/manifest.json` is the authoritative record of what completed.
    - `false` — honor the `AbortSignal`. Stop the current in-flight `iris_doc_get`, finalize the partial manifest (with `"aborted": true`), return `isError: true, partial: true`.
  - In both modes, a final `manifest.json` is written even on cancellation/error so the caller can recover and resume (`overwrite: ifDifferent` makes re-running cheap).

**Implementation Notes**:
- Location: new `packages/iris-dev-mcp/src/tools/export.ts`. Register in `packages/iris-dev-mcp/src/tools/index.ts`.
- Extracts a shared `docNameToFilePath(docName, basePath, { useShortPaths })` helper — inverse of `filePathToDocName` in `load.ts`. Both helpers live in one spot so the round-trip stays symmetric.
- **Security**: `destinationDir` must be validated — reject if the resolved absolute path contains `..` segments after normalization, or if a mapped doc name (via `useShortPaths`) would write outside `destinationDir`. Mirror the defensive approach in existing `iris_doc_load`.
- **Windows long-path hint**: only emit when `process.platform === "win32"` and the error is `ENAMETOOLONG` or path length exceeds 260.
- **Cancellation detachment**: when `continueDownloadOnTimeout: true`, the handler spawns the download loop with a *new* `AbortController` it owns, rather than passing the request's `ctx.signal` down to `fetch`. This decouples the loop's lifecycle from the request's. The handler still returns a response promise so clients that *are* still listening get the summary; clients that gave up get nothing, but the disk state is correct.
- **Progress emission**: use the MCP SDK's `ctx.sendProgress?.({ progress, total })` helper if available (check `@modelcontextprotocol/sdk` version in `packages/shared`). If the SDK doesn't expose a progress helper, wrap the transport call the same way existing tools batch output. Keep progress calls cheap — don't `JSON.stringify` the full manifest on each tick.
- **Manifest safety on interruption**: write `manifest.json` with a temp name (`.manifest.json.tmp`) during the loop, rename to `manifest.json` on success. If a prior interrupted run left `manifest.json.tmp`, the next `iris_doc_export` invocation can read it to understand what finished and skip via `overwrite: ifDifferent`.
```

---

### Proposal 4 — Story 10.3 Documentation Rollup in [epics.md](epics.md)

**Location**: append after Story 10.2.

```markdown
### Story 10.3: Documentation Rollup — README Suite + Per-Package + tool_support.md + CHANGELOG

**As a** user evaluating or upgrading the IRIS MCP Server Suite,
**I want** the new tools documented consistently across the suite and per-package READMEs, the API catalog, and the changelog,
**so that** I can discover, choose, and use them the same way I would any pre-existing tool — and so that existing `@iris-mcp/dev` installs know what the upgrade brings.

**Acceptance Criteria**:

- **AC 10.3.1** — [README.md](README.md) (suite-level):
  - Update the `@iris-mcp/dev` row of the Servers table so the tool count reflects the new total (`21` → `23`).
  - Update the bullet description of `@iris-mcp/dev` to mention "package browsing and bulk export" alongside the existing "document CRUD, compilation, …".
  - No other changes — the suite README stays high-level.
- **AC 10.3.2** — [packages/iris-dev-mcp/README.md](packages/iris-dev-mcp/README.md):
  - Add `iris_package_list` and `iris_doc_export` to the tool catalog table, in the same column format as the existing rows (Tool / Description / Key Parameters / Annotations).
  - Add two `<details>` example blocks in the "Tool Examples" section, one per tool, showing a realistic input + expected output. For `iris_doc_export`, show both the happy-path result and the skipped-item + manifest shape.
  - Update any "Tools: N" count callouts in the package README to the new number.
- **AC 10.3.3** — [tool_support.md](tool_support.md):
  - Add two rows to the `@iris-mcp/dev` table. Both are 🟦 Atelier:
    - `iris_package_list` → `GET /docnames/{cat}/{type}` (aggregated client-side)
    - `iris_doc_export` → `GET /docnames/{cat}/{type}` + `GET /doc/{name}` (bulk)
  - Update the per-table "**Mix:**" line: `15 Atelier · 6 ExecuteMCPv2 · 0 other` → `17 Atelier · 6 ExecuteMCPv2 · 0 other`.
  - Update the "Suite-wide rollup" section totals if it sums Atelier/ExecuteMCPv2 counts.
  - Update the `@iris-mcp/dev` heading count: `(21)` → `(23)`.
- **AC 10.3.4** — [CHANGELOG.md](CHANGELOG.md):
  - New `## [Pre-release — 2026-04-20]` entry (or extend the existing 2026-04-20 bug-fix entry with an `### Added` section).
  - Call out that the change is TypeScript-only — no `BOOTSTRAP_VERSION` bump, no ObjectScript redeploy on existing installs.
- **AC 10.3.5** — Discoverability linking in tool descriptions: the `iris_doc_list` and `iris_doc_get` tool descriptions each get a single sentence pointing to the new tool for bulk use cases. E.g., `iris_doc_list`: "For a structural overview at package granularity, see `iris_package_list`." `iris_doc_get`: "To pull many documents at once, see `iris_doc_export`."
- **AC 10.3.6** — Cross-reference check: grep the repo for any document listing tool counts per package (beyond the three files above) and update as found. Known candidates: `_bmad-output/planning-artifacts/prd.md` (FR numbering), `packages/iris-mcp-all/README.md`. Do NOT update `_bmad-output/implementation-artifacts/*` — those are historical sprint logs.

**Implementation Notes**:
- This story lands as the final commit of Epic 10, after 10.1 and 10.2 are merged.
- No code change; pure docs. Lands in one commit.
- PR description should link to Stories 10.1 and 10.2 so the doc delta is reviewable against the tool implementations.
```

---

### Proposal 5 — PRD FR108–FR109 in [prd.md](prd.md)

**Location**: append a new subsection after line 607 (end of Debugging/FR106-107 section) and before line 609 (`## Non-Functional Requirements`).

```markdown
### Namespace Browsing and Bulk Export (Epic 10 Addition — 2026-04-20)

- FR108: Developer can list the packages in a namespace at a configurable depth (1 = top-level, N = N-segment rollup), optionally narrowed to a prefix, with the same filter surface as `iris_doc_list` (category, type, generated, system inclusion, modifiedSince). System packages (`%*`) are excluded by default; `system` is tri-state (`false | true | only`) so developers can inspect IRIS internals, user code, or both.
- FR109: Developer can bulk-download documents from a namespace to a local directory, filtered by prefix, category, type, generated state, system inclusion, and modifiedSince. The export is resilient: per-document failures (long paths, disk-full, encoding) are collected into a skipped-items list rather than aborting the batch by default, a `useShortPaths` option maps long path segments to shorten the output for Windows MAX_PATH limits, and a manifest JSON records what was exported so runs can be audited and resumed. Progress is emitted via MCP `notifications/progress` and, by default, the download continues to completion on disk even if the MCP client cancels or times out.
```

**Numbering notes**:
- FR108 and FR109 pick up after FR107 (deferred XDebug), keeping the linear sequence intact.
- FR106–107 remain deferred as before — no conflict with the new entries.
- The existing FR16–FR39 (Development) block is not renumbered. The new requirements reference the same dev-mcp server but land in a dedicated subsection because they originate from a post-MVP epic.

---

### Proposal 6 — This Sprint Change Proposal document

Written to `_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-20.md` (this file). Structure:

- §1 Issue Summary — gaps discovered during 2026-04-20 session
- §2 Impact Analysis — no existing epic touched; TypeScript-only; PRD/README/tool_support deltas
- §3 Recommended Approach — Hybrid-new-epic (Epic 10)
- §4 Detailed Change Proposals — all six embedded verbatim
- §5 Implementation Handoff — Minor scope, dev team

---

## Section 5 — Implementation Handoff

### Scope classification

**Minor** — direct implementation by the development team.

- Not Moderate (no backlog reorganization required — purely additive; existing sprint log frozen).
- Not Major (no fundamental replan — MVP unaffected, no architecture change, no PM/Architect escalation).

### Recipients

- **Primary**: `@iris-mcp/dev` development team. If operating under BMad agent mode, the dev persona (Amelia). Otherwise any developer familiar with the existing `packages/iris-dev-mcp/src/tools/*` pattern.
- **Secondary (review)**: any reviewer of the [packages/iris-dev-mcp/](packages/iris-dev-mcp/) package — the changes are self-contained to that package plus documentation files.

### Suggested sequencing

1. **Story 10.1** (`iris_package_list`) — implement first. Small surface, all-client-side aggregation, establishes the pagination-walk pattern that 10.2 will reuse.
2. **Story 10.2** (`iris_doc_export`) — extract the shared `docNameToFilePath` helper during this story. The bulk loop + manifest + progress + cancellation semantics live here.
3. **Story 10.3** (docs rollup) — lands after 10.1 and 10.2 are merged. One commit, pure docs.

Each story ships as its own PR to keep review focused. The three PRs stack linearly.

### Success criteria

- `iris_package_list` returns the 79-row rollup for the USER namespace in **one round trip in < 2 seconds**, matching the SQL workaround's performance.
- `iris_doc_export` successfully round-trips a mid-size package (e.g., `ExecuteMCPv2` — 19 classes) through: `iris_doc_export` → local edit → `iris_doc_load` with `overwrite: ifDifferent` skipping unchanged files.
- Windows long-path failures and `useShortPaths` mapping are both tested on a Win32 platform. Hint text is verified to match the pattern shown in AC 10.2.4.
- Unit test coverage matches the existing `packages/iris-dev-mcp/src/__tests__/*.test.ts` bar: mock `IrisHttpClient`, every AC covered, table-driven where the input surface permits.
- Docs delta (Story 10.3) is reviewable in a single PR — reviewer can diff against proposals 1–5 in this document for correctness.

### Deliverables checklist

- [ ] `packages/iris-dev-mcp/src/tools/packages.ts` (new)
- [ ] `packages/iris-dev-mcp/src/tools/export.ts` (new)
- [ ] `packages/iris-dev-mcp/src/tools/index.ts` (modified — register two tools)
- [ ] `packages/iris-dev-mcp/src/tools/load.ts` (modified — extract shared helper)
- [ ] `packages/iris-dev-mcp/src/__tests__/packages.test.ts` (new)
- [ ] `packages/iris-dev-mcp/src/__tests__/export.test.ts` (new)
- [ ] `_bmad-output/planning-artifacts/epics.md` (Epic 10 appended)
- [ ] `_bmad-output/planning-artifacts/prd.md` (FR108/FR109 added)
- [ ] `README.md` (suite table + description)
- [ ] `packages/iris-dev-mcp/README.md` (tool catalog + examples)
- [ ] `tool_support.md` (two new rows, mix/rollup updated)
- [ ] `CHANGELOG.md` (2026-04-20 Added entry)

### No cross-server or breaking-change concerns

- `@iris-mcp/admin`, `@iris-mcp/interop`, `@iris-mcp/ops`, `@iris-mcp/data` are not modified.
- No shared-package breaking changes (the optional helper extraction in `@iris-mcp/dev` is internal).
- No `BOOTSTRAP_VERSION` change → existing installs pick up the new tools via a TypeScript rebuild + MCP server restart only.
- No existing tool schemas are modified. Only two new tools are added. Backward-compatible by construction.
