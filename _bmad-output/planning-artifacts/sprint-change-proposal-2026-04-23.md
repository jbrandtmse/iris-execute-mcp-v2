---
date: 2026-04-23
trigger_type: scope-addition
scope_classification: Minor
status: Approved
handoff: Development team (iris-dev-mcp)
---

# Sprint Change Proposal — 2026-04-23

## Epic 13: Post-Epic-12 Tooling Enhancements — Macro-Expanded Routine Lookup

---

## Section 1 — Issue Summary

### What triggered this change

On 2026-04-23 a competitive analysis of the newly-discovered [`intersystems-objectscript-routine-mcp`](https://github.com/cjy513203427/intersystems-objectscript-mcp) (npm: `intersystems-objectscript-routine-mcp`, v1.2.0) identified one concrete capability gap in the IRIS MCP Server Suite:

**LLMs have no dedicated path for fetching the macro-expanded compiled intermediate routine from a class name.** The external tool's `get_iris_routine` resolves a bare class name (e.g., `Pkg.MyClass`) to the compiled-intermediate doc (`Pkg.MyClass.1.int`) by trying `.1.int` → `.int` candidates in order. This surfaces what `$$$macros` expand to at runtime — a critical context for LLMs diagnosing runtime behavior, error traces, or generator-produced code that references expanded forms rather than the source `.cls`.

Our suite's `iris_doc_get` requires a fully-qualified doc name *with extension*. An LLM that knows only the class name cannot get to the `.1.int` without (a) knowing IRIS's generation-numbering convention, (b) guessing which extension IRIS emitted, and (c) handling 404s between candidates. `iris_macro_info` is adjacent — it returns individual macro definitions and source locations — but does not return the fully-expanded routine body.

The external tool's README states the motivating observation directly:

> LLMs lack this context — which is why even frontier models invent macros, because they don't know what the expanded code looks like.

### When and how the issue was discovered

User asked for competitive analysis of `sources/intersystems-objectscript-mcp` (clone on disk). Mary (analyst) cataloged its 3 tools, reviewed the 510-line [src/index.ts](../../sources/intersystems-objectscript-mcp/src/index.ts), and compared against the 87-tool suite. Two of the three tools (`get_iris_class`, `list_iris_includes`) are fully covered by `iris_doc_get` and `iris_doc_list({ category: "RTN", type: "inc" })` respectively. The third (`get_iris_routine`) has no suite equivalent for its headline class-to-intermediate resolution feature.

### Evidence

- **External tool's [`buildRoutineDocCandidates()`](../../sources/intersystems-objectscript-mcp/src/index.ts#L104)**: given a class name, tries `.1.int` → `.int` → raw in order.
- **Suite's [`iris_doc_get` schema](../../packages/iris-dev-mcp/src/tools/doc.ts#L57-L74)**: `name` description says *"Full document name with extension"* — no auto-resolution.
- **Suite's [`iris_macro_info`](../../packages/iris-dev-mcp/src/tools/intelligence.ts)**: returns macro definitions + locations, not expanded routine bodies. Orthogonal concern.
- **No overlap** with existing tools: grep of [packages/iris-dev-mcp/src/tools/](../../packages/iris-dev-mcp/src/tools/) confirms no tool currently takes a class name and returns compiled `.int` content.

### Issue type

**New requirement emerged** — not a defect in existing functionality, not a regression. Post-MVP enhancement scope, discovered via external-server survey. Aligns with the project goal of making the IRIS MCP Server Suite a superset of all known IRIS MCP servers.

### Decision already made (user, 2026-04-23)

After reviewing Options A/B/C:
- **Selected: Option B** — new dedicated tool.
- **Tool name**: `iris_routine_intermediate`.
- **Rationale**: LLM discoverability (one tool-choice hop vs. three for a param on `iris_doc_get`), pattern precedent (`iris_package_list` sibling to `iris_doc_list`), clean semantic boundary for `iris_doc_get`'s existing contract, isolated iteration surface, Atelier-only with zero bootstrap impact.

---

## Section 2 — Impact Analysis

### Epic impact

- **Epics 1–12**: all *done*. No existing epic is invalidated, requires rework, or is resequenced.
- **Epic 13**: net-new, appended. Single-tool-addition epic with docs rollup. No dependencies on in-flight work.
- **Deferred work from Epic 12** (per-alert `clear`, alert `acknowledge`) is *not* absorbed into Epic 13 by this proposal — those items remain deferred pending demand signal. Epic 13 is scoped narrowly to the macro-expansion gap.

### Story impact

- No in-flight stories affected — Epic 12 closed cleanly.
- Two new stories: 13.1 (tool) and 13.2 (docs rollup).

### Artifact conflicts

| Artifact | Impact |
|---|---|
| [prd.md](prd.md) | Gains FR110 in a new "Macro-Expanded Routine Lookup (Epic 13 Addition — 2026-04-23)" subsection. Existing FR numbering (FR1–FR109) untouched. |
| [epics.md](epics.md) | Gains Epic 13 appended after Epic 12. Existing epic content untouched. |
| [architecture.md](architecture.md) | No change. Tool uses the existing shared `IrisHttpClient` in `@iris-mcp/shared`; no new transport, no new IRIS-side classes, no new endpoint. |
| UX Design | N/A — suite has no UI surface. |
| [README.md](../../README.md) | Suite table: `@iris-mcp/dev` tool count `23` → `24`. One-line description addition for "macro-expanded routine lookup". |
| [packages/iris-dev-mcp/README.md](../../packages/iris-dev-mcp/README.md) | One new row in the tool catalog; one new `<details>` example block; any tool-count callouts updated. |
| [tool_support.md](../../tool_support.md) | One new row in the `@iris-mcp/dev` table (🟦 Atelier). Section heading count `(23)` → `(24)`. Per-table "Mix" line updated (Atelier `17` → `18`). Suite-wide rollup totals updated (`87` → `88`; Atelier `17` → `18`). |
| [CHANGELOG.md](../../CHANGELOG.md) | New 2026-04-23 `Added` entry for Epic 13. |
| [sprint-status.yaml](../implementation-artifacts/sprint-status.yaml) | New `epic-13` block with stories 13.1 and 13.2 in `backlog` status. |

### Tool-description cross-references (discoverability linking)

Per Epic 10's precedent for the `iris_package_list` / `iris_doc_list` pair, existing tool descriptions will be nudged to point at the new tool so LLMs land on the right one:

- `iris_doc_get` description — add one sentence: *"To fetch the macro-expanded compiled intermediate of a class by its bare name, see `iris_routine_intermediate`."*
- `iris_macro_info` description — add one sentence: *"For the fully-expanded routine body as IRIS compiles it, see `iris_routine_intermediate`."*

### Technical impact

- **TypeScript-only** in `@iris-mcp/dev`. One new file: `packages/iris-dev-mcp/src/tools/routine.ts` (or adjacent to `doc.ts`). Registered in `packages/iris-dev-mcp/src/tools/index.ts`.
- **No new IRIS-side classes**. Uses the standard Atelier `GET /doc/{name}` endpoint — the same one `iris_doc_get` uses — with client-side candidate iteration. `BOOTSTRAP_VERSION` unchanged → existing installs upgrade via `pnpm install && pnpm turbo run build` + MCP restart only. No ObjectScript redeploy, no bootstrap probe churn.
- **No shared-package breaking change**. Only additive: one new `ToolDefinition` export.
- **Deployment impact**: zero infrastructure change, zero configuration change, zero permission prompts. Pure TypeScript delta.

---

## Section 3 — Recommended Approach

### Selected path: New Epic with tool + docs stories

Add **Epic 13** with two stories. Mirrors Epic 10's post-MVP-additive pattern (not Epic 11/12's bug-batch pattern).

### Alternatives considered

| Option | Verdict | Rationale |
|---|---|---|
| **Option 1 — Direct adjustment** (absorb into Epic 2 or an existing closed epic) | Not viable | All epics 1–12 are closed. Bolting new stories onto done epics muddies the sprint log. |
| **Option 2 — Standalone story** (no epic wrapper) | Viable but rejected | No precedent in the project — every tool addition has lived under an epic. Also harder to thread sprint-status tracking without an epic row. |
| **Option 3 — Fold into a future larger epic** | Rejected — premature | No larger Epic 13 scope is currently defined. Waiting would delay a clearly-scoped, low-risk enhancement. |
| **Option 4 (chosen) — New Epic 13** | Viable | Clean separation. Additive only. Pattern-consistent with Epic 10. One tool + one docs story = two-PR epic. |

### Effort, risk, timeline

- **Effort**: Low. Story 13.1 is ~100–150 LOC (schema + candidate loop + error mapping + tests) — the external repo's implementation is ~150 lines total including error handling, and we can lift the candidate-resolution logic. Story 13.2 is docs-only, ~1 commit.
- **Risk**: Very low. Additive tool, no breaking changes, no ObjectScript deploy, no new IRIS endpoint, no new authentication path. Uses the same `/api/atelier/v{N}/{ns}/doc/{name}` endpoint as `iris_doc_get` — tested machinery.
- **Timeline**: fits one focused pairing session per story. Likely total under half a day.

---

## Section 4 — Detailed Change Proposals

All five proposals below are for batch review.

### Proposal 1 — Epic 13 header in [epics.md](epics.md)

**Location**: append after the end of Epic 12 (end of file).

```markdown
---

## Epic 13: Post-Epic-12 Tooling Enhancements — Macro-Expanded Routine Lookup

**Goal**: Close the capability gap between the IRIS MCP Server Suite and the external `intersystems-objectscript-routine-mcp` server by adding a dedicated tool that resolves a class name to its compiled-intermediate routine — the macro-expanded form that IRIS actually executes and that error traces reference.

**Scope**: One new tool in `@iris-mcp/dev` plus documentation rollup. Pure TypeScript, Atelier-only — no `ExecuteMCPv2.*` classes, so `BOOTSTRAP_VERSION` is unchanged and existing installs upgrade via `pnpm install && pnpm turbo run build` plus an MCP server restart.

**Functional Requirements (new)**:
- **FR110** (macro-expanded routine lookup): Developer can retrieve the compiled-intermediate routine (`.1.int` or `.int`) corresponding to a class, given only the class name — without needing to know IRIS's generation-numbering or extension conventions. The tool resolves the class name to a candidate list (`.1.int` → `.int`) and returns the content of the first candidate that exists. Fails fast on auth or network errors; returns a structured "not compiled" hint on all-candidates-404.

**Stories**:
- 13.1 `iris_routine_intermediate` — class-to-compiled-intermediate routine lookup
- 13.2 Documentation rollup (README suite + per-package + tool_support.md + CHANGELOG + tool-description cross-refs)

**Out of scope (deferred)**:
- Per-alert `clear` by index and alert `acknowledge` (carried forward from Epic 12 deferred-work.md) — not absorbed; those remain deferred pending demand.
- Fetching `.mac` (pre-expansion source routine) by class name — `iris_doc_get` handles this via exact name today; add to Epic 13 only if demand materializes.
- Iterating generation numbers beyond `.1.int` (e.g., `.2.int`) — IRIS rarely emits `.N.int` for N > 1 in normal compilation; defer to future hardening pass.
```

---

### Proposal 2 — Story 13.1 `iris_routine_intermediate` in [epics.md](epics.md)

**Location**: append after the Epic 13 header.

```markdown
### Story 13.1: `iris_routine_intermediate` — Class-to-Compiled-Intermediate Routine Lookup

**As an** AI client or developer debugging an IRIS class that uses `$$$macros`,
**I want** to fetch the compiled-intermediate routine (`.1.int`) for a class by its bare name,
**so that** I can see what the macros expand to at runtime — the form IRIS actually executes and that error traces reference — without needing to know IRIS's generation-numbering or extension conventions.

**Acceptance Criteria**:

- **AC 13.1.1** — Tool registered as `iris_routine_intermediate` in `@iris-mcp/dev`. Flat underscore name per Epic 9 convention. Annotations: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`. `scope: "NS"`.
- **AC 13.1.2** — Input schema:
  - `name` (string, **required**) — class name, with or without the `.cls` suffix (e.g., `"Ens.Director"`, `"Ens.Director.cls"`, `"MyApp.Service"`). Leading `.` or `..` segments rejected by `validateDocName()` (same path-traversal guard used by `iris_doc_get`).
  - `namespace` (string, optional) — per-call namespace override. Defaults to configured namespace.
  - `format` (enum `"udl" | "xml"`, optional, default `"udl"`) — Atelier document format for the returned content. Matches `iris_doc_get`'s `format` param.
- **AC 13.1.3** — Resolution algorithm (mirrors external tool's [buildRoutineDocCandidates](../../sources/intersystems-objectscript-mcp/src/index.ts#L104)):
  1. Strip `.cls` suffix if present.
  2. Build candidate list in order: `<Name>.1.int`, `<Name>.int`.
  3. For each candidate, call `GET /api/atelier/v{N}/{ns}/doc/{candidate}` via the shared `IrisHttpClient`:
     - **Success (200)**: return the candidate's content immediately; record which candidate was resolved.
     - **404**: continue to next candidate.
     - **401/403**: fail fast with auth error — do not continue candidate loop.
     - **5xx transient**: one retry per candidate (aligned with existing `iris_doc_get` retry behavior, if any; otherwise single attempt).
     - **Network misconfig** (`ECONNREFUSED`, `ETIMEDOUT`, etc.): fail fast with connection-hint message.
  4. If all candidates 404: return a structured "not compiled" error suggesting the caller compile the class via `iris_doc_compile` first.
- **AC 13.1.4** — Output shape on success:
  ```json
  {
    "name": "Ens.Director",
    "resolvedDoc": "Ens.Director.1.int",
    "namespace": "%SYS",
    "content": "...lines joined by \\n...",
    "candidatesTried": ["Ens.Director.1.int"]
  }
  ```
  On all-candidates-404:
  ```json
  {
    "name": "Ens.Director",
    "namespace": "%SYS",
    "candidatesTried": ["Ens.Director.1.int", "Ens.Director.int"],
    "hint": "No compiled intermediate routine found. The class may not be compiled in this namespace — try iris_doc_compile first."
  }
  ```
  Returned with `isError: true` in the all-404 case, matching the pattern from `iris_doc_get`.
- **AC 13.1.5** — Implementation location: new `packages/iris-dev-mcp/src/tools/routine.ts`. Register in `packages/iris-dev-mcp/src/tools/index.ts`. Reuses `validateDocName()` and the shared `IrisHttpClient` — no new transport code.
- **AC 13.1.6** — Tool description explicitly contrasts with `iris_doc_get` and `iris_macro_info` so LLMs pick the right tool. Required phrasing:
  > Given a class name, fetch the compiled-intermediate routine — the macro-expanded form IRIS actually executes at runtime. Auto-resolves the class name to the `.1.int` / `.int` candidate IRIS emits during compilation; use `iris_doc_get` when you need a specific doc by exact name with extension. Use `iris_macro_info` when you need individual macro definitions and source locations rather than the expanded routine body.
- **AC 13.1.7** — Cross-reference back-links added:
  - `iris_doc_get` description gets one sentence: "To fetch the macro-expanded compiled intermediate of a class by its bare name, see `iris_routine_intermediate`."
  - `iris_macro_info` description gets one sentence: "For the fully-expanded routine body as IRIS compiles it, see `iris_routine_intermediate`."
- **AC 13.1.8** — Unit tests in new `packages/iris-dev-mcp/src/__tests__/routine.test.ts`:
  - Happy path: `.1.int` resolves on first try; response shape correct.
  - Fallback path: `.1.int` returns 404, `.int` succeeds; `candidatesTried` reflects both.
  - All-404 path: both candidates 404; returns `isError: true` with hint.
  - Auth-failure path: 401 on first candidate; fails fast without trying next.
  - Network-misconfig path: connection-refused error surfaces hint.
  - Namespace override: explicit `namespace` arg overrides configured default.
  - `.cls` suffix stripping: `"Pkg.Class.cls"` and `"Pkg.Class"` produce identical candidate lists.
  - Path traversal rejected: `"../Secret"` returns validation error without making an HTTP call.
- **AC 13.1.9** — No `BOOTSTRAP_VERSION` change. No ObjectScript changes. Verified by test harness: `bootstrap-classes.ts` hash unchanged.
- **AC 13.1.10** — Build + tests + lint green. Target test count growth: +8 dev-mcp tests. Overall: 1145 + 8 = 1153 (approximately, depending on intervening changes).

**Implementation Notes**:
- The external tool's candidate logic is straightforward — port the algorithm (not the code) to match the suite's existing `ToolDefinition` / `IrisHttpClient` idioms.
- The response body from Atelier `/doc/` is `{result: {name, cat, content: [lines]}}`. The `content` array joins with `\n` for the tool's output `content` field. Preserve `cat` and other metadata only if it informs the caller (likely drop to keep the response compact — the key payload is the content string and which candidate resolved).
- Do NOT reuse the external tool's `axios` stack; use the suite's shared `IrisHttpClient` so auth, timeouts, and error handling are unified.
- The `.mac` extension is intentionally **not** in the candidate list. `.mac` is source routine (pre-expansion), not compiled intermediate — a user wanting source routine should use `iris_doc_get` with the explicit `.mac` name. Document this distinction in the tool description's "see also" paragraph.
```

---

### Proposal 3 — Story 13.2 Documentation Rollup in [epics.md](epics.md)

**Location**: append after Story 13.1.

```markdown
### Story 13.2: Documentation Rollup — README Suite + Per-Package + tool_support.md + CHANGELOG + Cross-Refs

**As a** user evaluating or upgrading the IRIS MCP Server Suite,
**I want** `iris_routine_intermediate` documented consistently across the suite and per-package READMEs, the API catalog, the changelog, and related tool descriptions,
**so that** I can discover, choose, and use it the same way I would any pre-existing tool — and so that existing `@iris-mcp/dev` installs know what the upgrade brings.

**Acceptance Criteria**:

- **AC 13.2.1** — [README.md](../../README.md) (suite-level):
  - Update the `@iris-mcp/dev` row of the Servers table so the tool count reflects the new total (`23` → `24`).
  - Update the bullet description of `@iris-mcp/dev` to mention "macro-expanded routine lookup" alongside the existing capabilities.
  - No other changes — the suite README stays high-level.
- **AC 13.2.2** — [packages/iris-dev-mcp/README.md](../../packages/iris-dev-mcp/README.md):
  - Add `iris_routine_intermediate` to the tool catalog table in the same column format as existing rows.
  - Add one `<details>` example block in the "Tool Examples" section showing a realistic input (e.g., `Ens.Director`) + expected output including the `resolvedDoc` field.
  - Update any "Tools: N" count callouts in the package README to the new number.
- **AC 13.2.3** — [tool_support.md](../../tool_support.md):
  - Add one row to the `@iris-mcp/dev` table: `iris_routine_intermediate` → 🟦 Atelier → `GET /api/atelier/v{N}/{ns}/doc/{name}` (candidate fallback).
  - Update the per-table "**Mix:**" line: `17 Atelier · 6 ExecuteMCPv2 · 0 other` → `18 Atelier · 6 ExecuteMCPv2 · 0 other`.
  - Update the `@iris-mcp/dev` heading count: `(23)` → `(24)`.
  - Update the "Suite-wide rollup" section totals: `Atelier 17` → `Atelier 18`, `Total 87` → `Total 88`, and the dev-row total `23` → `24`.
- **AC 13.2.4** — [CHANGELOG.md](../../CHANGELOG.md):
  - New `## [Pre-release — 2026-04-23]` entry with an `### Added` section.
  - Entry: "**New tool `iris_routine_intermediate`** ([packages/iris-dev-mcp/src/tools/routine.ts](packages/iris-dev-mcp/src/tools/routine.ts)) — fetches the compiled-intermediate routine (`.1.int` / `.int`) corresponding to a class name, for LLMs that need to see macro-expanded code. Closes capability gap vs. external `intersystems-objectscript-routine-mcp`. FR110 / Epic 13."
  - Call out that the change is TypeScript-only — no `BOOTSTRAP_VERSION` bump, no ObjectScript redeploy on existing installs.
- **AC 13.2.5** — Cross-reference linking in existing tool descriptions (already listed in AC 13.1.7 but verified as part of docs rollup):
  - `iris_doc_get` description: one-sentence pointer added.
  - `iris_macro_info` description: one-sentence pointer added.
- **AC 13.2.6** — Cross-reference check: grep the repo for any document listing tool counts per package (beyond the three files in AC 13.2.1–13.2.3) and update as found. Known candidates: [`_bmad-output/planning-artifacts/prd.md`](../_bmad-output/planning-artifacts/prd.md) (FR numbering), [`packages/iris-mcp-all/README.md`](../../packages/iris-mcp-all/README.md). Do NOT update [`_bmad-output/implementation-artifacts/*`](../_bmad-output/implementation-artifacts/) — those are historical sprint logs.

**Implementation Notes**:
- This story lands as the final commit of Epic 13, after 13.1 is merged.
- No code change; pure docs. Lands in one commit.
- PR description should link to Story 13.1 so the doc delta is reviewable against the tool implementation.
```

---

### Proposal 4 — PRD FR110 in [prd.md](prd.md)

**Location**: append a new subsection after line 612 (end of Epic 10 FR108/FR109 section) and before line 614 (`## Non-Functional Requirements`).

```markdown
### Macro-Expanded Routine Lookup (Epic 13 Addition — 2026-04-23)

- FR110: Developer can retrieve the compiled-intermediate routine for a class by its bare name, without needing to know IRIS's generation-numbering or extension conventions. The tool resolves the class name to a candidate list (`.1.int`, `.int`) and returns the content of the first candidate that exists, reporting which candidate resolved. On all-candidates-404, returns a structured hint suggesting compilation. Fails fast on authentication or network errors (does not exhaust the candidate list on auth failure). Surfaces the macro-expanded form IRIS actually executes at runtime — distinct from `iris_macro_info` which returns individual macro definitions and source locations, and from `iris_doc_get` which requires a fully-qualified doc name with extension.
```

**Numbering notes**:
- FR110 picks up after FR109 (Epic 10's bulk export), keeping the linear sequence intact.
- The existing FR16–FR39 (Development) block is not renumbered. This new requirement lands in a dedicated subsection because it originates from a post-MVP epic, consistent with how Epic 10's FR108/FR109 were added.

---

### Proposal 5 — Sprint status update in [sprint-status.yaml](../implementation-artifacts/sprint-status.yaml)

**Location**: append after the `epic-12-retrospective: done` line.

```yaml

  # Epic 13: Post-Epic-12 Tooling Enhancements — Macro-Expanded Routine Lookup
  # Added 2026-04-23 via bmad-correct-course. See sprint-change-proposal-2026-04-23.md.
  # TypeScript-only, Atelier-only. No BOOTSTRAP_VERSION bump required.
  # One new tool (iris_routine_intermediate) + docs rollup.
  epic-13: backlog
  13-1-iris-routine-intermediate: backlog
  13-2-documentation-rollup: backlog
  epic-13-retrospective: optional
```

**Note**: No Story 13.0 (Epic 12 deferred cleanup) is proposed. Epic 12's deferred items (per-alert `clear`, alert `acknowledge`) are not in Epic 13 scope and remain deferred pending demand. If a triage pass is desired, it can be added as a prefix story before 13.1 — but the default recommendation is to skip the deferred-cleanup step for this narrow epic.

---

## Section 5 — Implementation Handoff

### Scope classification

**Minor** — direct implementation by the development team.

- Not Moderate (no backlog reorganization required — purely additive; existing sprint log frozen).
- Not Major (no fundamental replan — MVP unaffected, no architecture change, no PM/Architect escalation).

### Recipients

- **Primary**: `@iris-mcp/dev` development team. If operating under BMad agent mode, the dev persona (Amelia). Otherwise any developer familiar with the existing [packages/iris-dev-mcp/src/tools/*](../../packages/iris-dev-mcp/src/tools/) pattern.
- **Secondary (review)**: any reviewer of the [packages/iris-dev-mcp/](../../packages/iris-dev-mcp/) package — the changes are self-contained to that package plus documentation files.

### Suggested sequencing

1. **Story 13.1** (`iris_routine_intermediate`) — implement first. Straightforward tool with a well-defined candidate-resolution algorithm lifted from the external repo. All-client-side logic, no IRIS-side changes.
2. **Story 13.2** (docs rollup) — lands after 13.1 is merged. One commit, pure docs + cross-ref additions to existing tool descriptions.

Each story ships as its own PR to keep review focused. Two PRs stack linearly.

### Success criteria

- `iris_routine_intermediate({ name: "Ens.Director", namespace: "%SYS" })` returns the `.1.int` content with `resolvedDoc: "Ens.Director.1.int"` in one round trip in < 2 seconds.
- Cold-case fallback: for a class that compiles without `.1.int` (edge case — some generator-produced classes), `.int` is attempted and returned with `candidatesTried: ["<Name>.1.int", "<Name>.int"]` in the response.
- Not-compiled case: for a class name whose class doesn't exist OR is not compiled, `isError: true` with the hint string suggesting `iris_doc_compile`.
- Auth-failure case: 401 on first candidate does not exhaust the candidate list; fails fast with auth error.
- Unit test coverage matches the existing [packages/iris-dev-mcp/src/__tests__/*.test.ts](../../packages/iris-dev-mcp/src/__tests__/) bar: mock `IrisHttpClient`, every AC covered, table-driven where the input surface permits.
- Docs delta (Story 13.2) is reviewable in a single PR — reviewer can diff against proposals 1–4 in this document for correctness.
- `BOOTSTRAP_VERSION` unchanged at end of Epic 13 (verified by `pnpm run gen:bootstrap` producing no diff).

### Deliverables checklist

- [ ] `packages/iris-dev-mcp/src/tools/routine.ts` (new)
- [ ] `packages/iris-dev-mcp/src/tools/index.ts` (modified — register one tool)
- [ ] `packages/iris-dev-mcp/src/tools/doc.ts` (modified — one-sentence cross-ref on `iris_doc_get` description)
- [ ] `packages/iris-dev-mcp/src/tools/intelligence.ts` (modified — one-sentence cross-ref on `iris_macro_info` description)
- [ ] `packages/iris-dev-mcp/src/__tests__/routine.test.ts` (new)
- [ ] `_bmad-output/planning-artifacts/epics.md` (Epic 13 appended)
- [ ] `_bmad-output/planning-artifacts/prd.md` (FR110 added)
- [ ] `_bmad-output/implementation-artifacts/sprint-status.yaml` (epic-13 block added)
- [ ] `README.md` (suite table + description)
- [ ] `packages/iris-dev-mcp/README.md` (tool catalog + example)
- [ ] `tool_support.md` (one new row, mix/rollup updated)
- [ ] `CHANGELOG.md` (2026-04-23 Added entry)

### No cross-server or breaking-change concerns

- `@iris-mcp/admin`, `@iris-mcp/interop`, `@iris-mcp/ops`, `@iris-mcp/data` are not modified.
- No shared-package breaking changes (no new exports from `@iris-mcp/shared`; reuses existing `IrisHttpClient` and `atelierPath` helpers).
- No `BOOTSTRAP_VERSION` change → existing installs pick up the new tool via a TypeScript rebuild + MCP server restart only.
- No existing tool schemas are modified. One new tool is added, and two existing tool *descriptions* gain one-sentence cross-references (neither changes input/output semantics). Backward-compatible by construction.
