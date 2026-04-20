---
date: 2026-04-20
trigger_type: post-merge-bug-fix
scope_classification: Minor
status: Approved
handoff: Development team (iris-dev-mcp)
parent_epic: Epic 10
---

# Sprint Change Proposal — 2026-04-20 (Story 10.4)

## `iris_doc_export` Response-Envelope Cap

---

## Section 1 — Issue Summary

### What triggered this change

During a post-Epic-10 stress test on 2026-04-20 (immediately after Stories 10.1–10.3 merged), the user requested `iris_doc_export` of the entire `%SYS` namespace:

```
iris_doc_export destinationDir=".../irissys" namespace="%SYS" system="true"
```

The export succeeded on disk — 3,957 files written in 21.3 seconds, `manifest.json` authoritative with all 3,957 files + 2,174 skipped entries. But the **MCP response envelope itself** was **559,724 characters (≈560 KB)**, which exceeded the MCP token cap. The caller could not read the tool result directly; summary stats had to be extracted via `jq` against the saved tool-result file.

Root cause: `iris_doc_export` embeds the entire `skippedItems[]` array inline in the response. In the `%SYS` case, 2,174 skipped items — each with a `docName`, `reason`, and (potentially) `hint` field — added up to far more than the MCP message budget.

### Issue type

**Technical limitation discovered during post-merge stress test.** The implementation is correct for small-to-medium batches; only the extreme-failure-count case blows up. Same defect class as the `iris_task_history` pagination bug fixed in the 2026-04-19 bug-fix pass.

### Evidence

- Tool response size: 559,724 chars on `%SYS` export.
- 2,174 skipped items, all CSP static assets (CSS/JS/images under `/csp/.../` that `docnames` lists but `/doc/{name}` returns 404 for).
- Manifest file correct: 3,957 `files` + 2,174 `skipped` entries.
- On-disk state correct: 523 top-level entries, all file content intact (spot-checked `ExecuteMCPv2/Utils.cls`).

---

## Section 2 — Impact Analysis

### Epic impact
- Epic 10 reopens for **one story** (10.4). Epic status: `done` → `in-progress` until 10.4 ships.
- Stories 10.1–10.3 are untouched.

### Story impact
- None in-flight.
- Net-new Story 10.4.

### Artifact conflicts

| Artifact | Impact |
|---|---|
| [prd.md](prd.md) | **No change**. FR109 already says the export is "resilient: per-document failures ... are collected into a skipped-items list". Capping the *inline response copy* of that list is an implementation-quality detail, not a new functional requirement. |
| [epics.md](epics.md) | Epic 10 Stories bullet list gains `10.4`; new Story 10.4 block appended after Story 10.3. |
| [architecture.md](architecture.md) | No change. |
| [README.md](README.md) (suite) | No change. |
| [packages/iris-dev-mcp/README.md](packages/iris-dev-mcp/README.md) | No change — the CSP-asymmetry note was landed during the bug-discovery session, separate from this story. |
| [tool_support.md](tool_support.md) | No change. |
| [CHANGELOG.md](CHANGELOG.md) | Small addition: `### Fixed` subsection appended to the existing `## [Pre-release — 2026-04-20]` entry (same date as the Epic 10 rollup — not a new date block). |

### Technical impact
- **TypeScript-only** in [packages/iris-dev-mcp/src/tools/export.ts](packages/iris-dev-mcp/src/tools/export.ts). Add a module-level `RESPONSE_SKIPPED_CAP = 50` constant and slice the response's `skippedItems` to that cap. Manifest stays uncapped.
- New `skippedItemsTruncated?: true` field on the response envelope, present only when the cap is hit (matches the `truncated?: true` pattern from `iris_package_list` AC 10.1.7).
- One-sentence addition to the zod `description` field flagging the CSP static-asset asymmetry (self-documenting for AI clients).
- Two new unit tests in `packages/iris-dev-mcp/src/__tests__/export.test.ts` (target: 269/269, up from 267).
- **No `BOOTSTRAP_VERSION` change** — TypeScript-only. Existing installs upgrade via `pnpm install && pnpm turbo run build` + MCP restart.
- **No new IRIS-side code.**

---

## Section 3 — Recommended Approach

### Selected path: Direct Adjustment — add Story 10.4 to Epic 10

Clean fit. Epic 10 is the right home for a defect in a tool Epic 10 just added.

| Option | Verdict | Rationale |
|---|---|---|
| **Option 1 (chosen) — Direct Adjustment** | Viable | Epic 10 is the natural home. One story, tight scope, low risk. |
| **Option 2 — Rollback** | N/A | Nothing to roll back; Epic 10 is shipped and the tool works for normal use. |
| **Option 3 — MVP Review** | N/A | MVP unaffected. |
| **Option 4 — New Epic 11** | Viable-but-worse | Would fragment the narrative. Epic 10 already contains three stories for this tool family; 10.4 belongs there. |

### Effort, risk, timeline
- **Effort**: Low. ~50 LOC of production change + 2 unit tests.
- **Risk**: Low. Additive response-envelope shaping, no behavior change for small-skip cases, no new parameters.
- **Timeline**: One sprint-hour-equivalent. Single PR.

---

## Section 4 — Detailed Change Proposals

All proposals approved in batch 2026-04-20.

### Proposal 1 — Story 10.4 block added to [epics.md](epics.md)

```markdown
### Story 10.4: `iris_doc_export` response-envelope cap (post-merge bug-fix)

**As an** AI client calling `iris_doc_export` against a namespace with many per-file failures,
**I want** the response envelope to stay under the MCP token cap,
**so that** I can read the exporter's return value even when `skippedItems` is large (e.g., a `%SYS` export where the 2,174 CSP static-asset 404s blow past 560 KB).

**Trigger**: Discovered 2026-04-20 during a post-Epic-10 stress test — exporting all of `%SYS` produced a 559,724-character response that exceeded the MCP token cap. The caller could not read the result; the on-disk manifest was still correct and authoritative. Same defect class as the `iris_task_history` pagination fix landed in the 2026-04-19 bug-fix pass.

**Acceptance Criteria**:

- **AC 10.4.1** — Response envelope's `skippedItems[]` is capped at **50 entries** (chosen to stay well under the MCP token cap even for long doc-name + reason strings).
- **AC 10.4.2** — When the cap is hit, the response gains a `skippedItemsTruncated: true` field and the first `content[0].text` line prefixes the summary with "`N skipped items; showing first 50. Full list in manifest.json`". When the cap is not hit, `skippedItemsTruncated` is absent (not `false`) — matches existing `truncated` pattern from `iris_package_list` AC 10.1.7.
- **AC 10.4.3** — `manifest.json` stays **uncapped**. The manifest is the authoritative record of what was exported and what was skipped; capping the manifest would defeat its purpose. Verified via a test case.
- **AC 10.4.4** — The `iris_doc_export` tool `description` field (zod schema) gains one sentence flagging the CSP static-asset asymmetry: *"Note: some namespaces include CSP static assets (e.g., `/csp/.../*.css`) in docnames but return 404 on fetch — pass `category: \"CLS\"` or `\"RTN\"` to exclude them."* This keeps the tool self-documenting for AI clients that don't read the README.
- **AC 10.4.5** — Unit tests in `packages/iris-dev-mcp/src/__tests__/export.test.ts` cover:
  - **Large skipped list (>50 items)** — response includes first 50 + `skippedItemsTruncated: true`; manifest is NOT truncated (contains all items).
  - **Small skipped list (≤50 items)** — response includes all items; `skippedItemsTruncated` is absent.
  - Both tests use injected per-file failures (same mock pattern as existing `ignoreErrors` tests in the file).
- **AC 10.4.6** — CHANGELOG.md gets a short entry appended to the existing `## [Pre-release — 2026-04-20]` section (NOT a new date block — this landed the same day as the Epic 10 rollup):
  - Under a new `### Fixed` subheading inside the 2026-04-20 entry, one bullet pointing at the response-cap fix.
- **AC 10.4.7** — Build + tests + lint green. `pnpm turbo run build --filter=@iris-mcp/dev`, `pnpm turbo run test --filter=@iris-mcp/dev` (target: **269/269** = 267 baseline + 2 new), `pnpm turbo run lint --filter=@iris-mcp/dev`.

**Tasks / Subtasks**:

- [ ] **Task 1**: Cap `skippedItems[]` in response
  - [ ] In `packages/iris-dev-mcp/src/tools/export.ts`, after the worker pool finishes and before the response is assembled, compute `skippedItemsTruncated = allSkipped.length > RESPONSE_SKIPPED_CAP` (new `const RESPONSE_SKIPPED_CAP = 50;` at module top).
  - [ ] Response uses `allSkipped.slice(0, RESPONSE_SKIPPED_CAP)`; manifest still uses `allSkipped` (the full array).
  - [ ] Add `skippedItemsTruncated: true` to the response ONLY when the cap is hit. Omit the field otherwise (don't set `false`).
  - [ ] Update the `text` content line: if truncated, prefix with `N skipped items; showing first 50. Full list in manifest.json`.

- [ ] **Task 2**: Tool description update (AC 10.4.4)
  - [ ] Append the CSP-asymmetry sentence to the tool's zod `description` string.
  - [ ] Keep it to one sentence — AI clients read this inline; don't bloat it.

- [ ] **Task 3**: Unit tests (AC 10.4.5)
  - [ ] Add two `it` cases in `export.test.ts`. Mock `IrisHttpClient` to return 60 failed GETs, assert response has 50 items + `skippedItemsTruncated: true`; assert `manifest.skipped.length === 60`.
  - [ ] Mirror test for 10 failed GETs: response has 10 items, NO `skippedItemsTruncated` field.

- [ ] **Task 4**: CHANGELOG (AC 10.4.6)
  - [ ] Append a `### Fixed` subheading inside the existing 2026-04-20 section (the Added section stays above it). One bullet.

- [ ] **Task 5**: Build + validate (AC 10.4.7)

**Implementation Notes**:
- Same pattern as the `iris_task_history` fix from 2026-04-19: server-side cap, `truncated` signal, authoritative full list lives elsewhere (there: `total` vs `count`; here: `manifest.json` vs inline `skippedItems`).
- No changes to `docs/` or per-package READMEs — the README's CSP-asymmetry note was landed manually during the bug-discovery session (not part of this story's commit). The CHANGELOG entry can reference it.
- No `BOOTSTRAP_VERSION` change.

**Out of scope**:
- Capping `files[]` in the response — this is the happy-path list; if someone exports 10k files successfully they still want to see counts (not individual entries). `files[]` is already fine because the response doesn't include per-file paths by default; only counts. (Verify this assumption during implementation — if `files[]` is in the response envelope, also cap it at 50 and note `filesTruncated`.)
- Configurable cap value — 50 is a sensible default; adding a `responseMaxSkipped` parameter is speculative and can be added later if demand shows up.
```

### Proposal 2 — Epic 10 Stories bullet list updated in [epics.md](epics.md)

```diff
 **Stories**:
 - 10.1 `iris_package_list` — package listing with depth + prefix
 - 10.2 `iris_doc_export` — bulk download to disk
 - 10.3 Documentation rollup (README suite + per-package + tool_support.md + CHANGELOG)
+- 10.4 `iris_doc_export` response-envelope cap (post-merge bug-fix)
```

### Proposal 3 — sprint-status.yaml updated

```diff
   epic-10: in-progress
   10-1-iris-package-list: done
   10-2-iris-doc-export: done
   10-3-documentation-rollup: done
+  10-4-doc-export-response-cap: backlog
   epic-10-retrospective: optional
```

Epic 10 status stays `in-progress` until Story 10.4 lands.

### Proposal 4 — No PRD change (explicit non-edit)

FR109 already covers "resilient ... skipped-items list." Capping the inline-response copy is an implementation-quality detail. The full skipped-items list in the manifest is uncapped. No FR to add.

### Proposal 5 — No README change in this story

The CSP-asymmetry note was added to [packages/iris-dev-mcp/README.md](packages/iris-dev-mcp/README.md) during the bug-discovery session, independently of this story. Story 10.4's only doc deliverable is the CHANGELOG bullet (AC 10.4.6) and the tool-description sentence (AC 10.4.4).

---

## Section 5 — Implementation Handoff

### Scope classification

**Minor** — direct implementation by `@iris-mcp/dev` dev team.

### Recipients
- **Primary**: `@iris-mcp/dev` development team. Any developer familiar with `packages/iris-dev-mcp/src/tools/export.ts`.
- **Secondary (review)**: reviewer of the `@iris-mcp/dev` package.

### Sequencing
Single PR. No dependencies. Can be picked up immediately after this proposal is approved.

### Success criteria
- Re-running the `%SYS` export that triggered this story produces a response envelope under ~50 KB (well within the MCP token cap), with `skippedItemsTruncated: true` and a summary line pointing at `manifest.json`.
- `manifest.json` still contains all 2,174 skipped entries (uncapped).
- Build + test + lint green: `pnpm turbo run build --filter=@iris-mcp/dev` + `pnpm turbo run test --filter=@iris-mcp/dev` (≥269/269) + `pnpm turbo run lint --filter=@iris-mcp/dev`.
- Tool description for `iris_doc_export` includes the CSP-asymmetry sentence (verifiable via `mcp__iris-dev-mcp__iris_doc_export` schema probe).

### Deliverables checklist

- [ ] `packages/iris-dev-mcp/src/tools/export.ts` (modified — cap + description update)
- [ ] `packages/iris-dev-mcp/src/__tests__/export.test.ts` (modified — 2 new tests)
- [ ] `CHANGELOG.md` (modified — `### Fixed` subheading in 2026-04-20 entry)
- [ ] `_bmad-output/planning-artifacts/epics.md` (Story 10.4 block appended + Stories bullet updated)
- [ ] `_bmad-output/implementation-artifacts/sprint-status.yaml` (10.4 entry added, epic-10 remains in-progress)

### No cross-server or breaking-change concerns

- `@iris-mcp/admin`, `@iris-mcp/interop`, `@iris-mcp/ops`, `@iris-mcp/data` are not modified.
- `@iris-mcp/shared` not touched.
- No schema-compatibility break: existing successful (≤50 skipped) responses are byte-identical. Large-skipped-list responses gain one optional field; clients that don't read it still see the first 50 `skippedItems` as before.
- No `BOOTSTRAP_VERSION` change → existing installs pick up the fix via TypeScript rebuild + MCP server restart.
