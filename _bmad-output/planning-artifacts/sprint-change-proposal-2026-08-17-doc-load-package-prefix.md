# Sprint Change Proposal — 2026-08-17 (`iris_doc_load` package-prefix loss)

**Trigger:** Externally-reported defect (Cline/VS Code transcript, unrelated project/machine) — analyzed and written up as `docs/bugs-2026-08-17.md`
**Facilitator:** Mary (Business Analyst) → correct-course · **Project Lead:** Developer
**Mode:** Batch · **Scope classification:** **Moderate** (new story added to current epic; PRD/architecture documents updated; no MVP change, no rollback, no epic restructure)

---

## 1. Issue Summary

While diagnosing an unrelated user support transcript, analysis confirmed a defect in `iris_doc_load` (`iris-dev-mcp`): a bulk-upload glob pattern whose only wildcard character sits in the *final* path segment (e.g. `.../src/ClineTest/*.cls`, as opposed to `.../src/**/*.cls`) silently strips the package-name directory (`ClineTest`) from every uploaded document's IRIS name. The upload step reports success (`uploaded: N, failed: 0`) with no validation; the defect only surfaces later, at compile time, as a confusing IRIS-side error (`Class 'User.Wumpus' does not exist`) that gives no hint the real cause is upstream path mapping.

Root cause, full repro, and evidence: [`docs/bugs-2026-08-17.md`](../../docs/bugs-2026-08-17.md). Full mechanism: `extractBaseDir()`/`filePathToDocName()` in `packages/iris-dev-mcp/src/tools/load.ts:48-101` infer the base directory purely from *where the glob pattern's first wildcard character appears*, folding any literal directory segment before it — including a package-name directory — into the stripped prefix.

This is not a new failure class: it matches project rule #17 (`.claude/rules/iris-objectscript-basics.md`), captured from an earlier incident. This is an independent, second repro on an unrelated machine and project, with zero warning surfaced before the confusing downstream failure — evidence this deserves a real code fix rather than remaining a documented workaround.

**Issue type:** Technical limitation discovered during support/diagnosis (pre-existing defect, newly and independently reproduced).

**Project Lead direction (2026-08-17):** Add this as a new story to the current epic (**Epic 35 — Pre-Beta Defect Remediation**), and reflect the change in the PRD, Architecture, and Epics documents.

---

## 2. Impact Analysis

### Epic Impact

- **Epic 35 (Pre-Beta Defect Remediation — Live-Surface Findings)** — currently in flight on branch `epic35` (35.0 done, 35.2 done, 35.1 in review, 35.3-35.8 backlog). This defect fits the epic's own charter ("no misleading tool contract") but arrived through a **different channel** than the epic's original nine findings (the post-Epic-34 sweep) — it's an externally-reported defect, not a sweep finding. **Direct Adjustment**: add it as a new story, **Story 35.9**, appended after the existing rollup/gate story (35.8) rather than renumbering anything already planned.
- No other epic is affected. No future epic becomes obsolete or newly necessary.

### Story Impact

- **New: Story 35.9** — `iris_doc_load` package-prefix validation fix (full ACs in §4 below).
- **No existing Epic 35 story is modified.** In particular, Story 35.8's epic gate (AC 35.8.4) explicitly covers "all nine findings" (F1-F9) from the sweep — it is intentionally left unchanged and does NOT absorb this tenth, differently-sourced defect. Story 35.9 carries its own complete, self-contained live-proof and mutation-evidence ACs (matching the rigor of 35.1-35.7), so it has no dependency on 35.8's rollup.
- **Why append rather than renumber:** Story 35.8 ("Docs + Artifact Rollup, epics.md Backfill, Epic Gate") is already cross-referenced by exact number in three other files — `35-0-epic-34-deferred-cleanup.md` (a **done**, closed story), `deferred-work.md`, and `sprint-status.yaml` itself — as "after Story 35.8" / "Stories 35.1-35.8". Renumbering it to 35.9 would require editing a closed story file's cross-reference text, which is unnecessary churn for a purely additive change. Appending the new story at 35.9 avoids touching any already-planned or already-closed content.

### Artifact Conflicts

- **PRD** (`prd.md`) — the Reliability NFR section (§"Non-Functional Requirements" → Reliability) states a "must not silently fail" principle for connection loss but has no equivalent statement for bulk multi-file operations producing a misleading *success*. One new bullet needed.
- **Architecture** (`architecture.md`) — no existing architectural decision is invalidated. This is a genuine new pattern worth codifying (content-derived identity as ground truth for bulk source uploads), distinct from the *other* pending Epic-35 architecture candidate (I/O isolation for device-writing APIs), which stays correctly deferred to the epic retro per Rule #1. This one is being decided and recorded now, per Project Lead direction. One new dated decision-record subsection needed, following the existing H1-J1 addendum convention.
- **Epics** (`epics.md`) — Epic 35's Context paragraph needs a short note attributing this story's different origin (correct-course, not the sweep); a new Story 35.9 section needs to be added.
- **`sprint-status.yaml`** — one new backlog entry.
- **UI/UX** — not applicable; this project has no UI/UX specification (backend MCP tool suite).
- **Other artifacts** — no CI/CD, deployment script, or monitoring changes required. `docs/bugs-2026-08-17.md` (already written) stands as the defect record and needs no further edits.

### Technical Impact

Confined to `packages/iris-dev-mcp/src/tools/load.ts` (fix + new optional `baseDir` parameter) and its test/doc surface. No governance surface change (Constraint E-1 — additive parameter on an existing action, not a new action key); no bootstrap/ObjectScript change (TS-only fix, no IRIS-side handler touched); frozen governance baseline untouched (Constraint E-2).

---

## 3. Recommended Approach

**Selected: Option 1 — Direct Adjustment.** Add Story 35.9 within the current epic structure; update the three planning artifacts named by the Project Lead.

- **Option 2 (Rollback)** — not viable/not relevant. Nothing needs to be reverted; this is a newly surfaced, pre-existing defect, not a regression from recent work.
- **Option 3 (MVP Review)** — not viable/not needed. This does not affect MVP scope, goals, or achievability; it is a targeted defect fix within an already-planned defect-remediation epic.

**Effort estimate:** Low-Medium (one focused story, no epic restructuring, no renumbering of existing content).
**Risk level:** Low (purely additive across all four artifacts; no existing story, AC, or cross-reference is altered).
**Timeline impact:** None to Epic 35's existing sequence — Story 35.9 slots in after the already-planned 35.8 rollup.

---

## 4. Detailed Change Proposals

### 4.1 — `epics.md`

**A. Epic 35 Context — add attribution paragraph**

Location: immediately after the existing Context paragraph, before Constraint E-1 (currently line ~4636-4638).

OLD (unchanged, for anchor reference):
```
**Context**: The sweep exercised all 109 tools across the 5 servers against a live IRIS 2026.1
instance. ... Full evidence, source citations and oracles: `sprint-change-proposal-2026-08-17.md`.

**Constraint E-1 (no governance surface change)**: ...
```

NEW (inserted between them):
```
**Correct-course addition (2026-08-17):** A tenth, MEDIUM-severity defect — `iris_doc_load`
silently drops the IRIS package prefix when a bulk-upload glob pattern places a literal
package-directory segment directly before a single-segment wildcard (e.g. `.../ClineTest/*.cls`
instead of `.../**/*.cls`) — was reported independently (an external user's Cline transcript,
unrelated project) and added to this epic via `/bmad-correct-course`. It is NOT one of the nine
sweep findings above and is out of scope for Story 35.8's epic gate (AC 35.8.4, which covers
F1-F9 only); it closes in the newly added **Story 35.9**. Full evidence, root cause and repro:
`docs/bugs-2026-08-17.md` and `sprint-change-proposal-2026-08-17-doc-load-package-prefix.md`.
```

**B. New Story 35.9 — inserted after AC 35.8.6, before the epic's `**Out of scope**` footer line**

```markdown
### Story 35.9: MEDIUM - `iris_doc_load` Silent Package-Prefix Loss on Glob Path Mapping

**Added 2026-08-17 (correct-course, independent of the Epic 34 sweep).** Reported via an
external user's Cline (VS Code) transcript on an unrelated project/machine, surfaced through
analysis rather than the sweep. Full repro, root cause, and evidence: `docs/bugs-2026-08-17.md`.

- **AC 35.9.1** - Root cause confirmed at `packages/iris-dev-mcp/src/tools/load.ts:82-101`
  (`extractBaseDir`) and `:48-65` (`filePathToDocName`): the base directory used to strip each
  matched file's path is inferred purely from WHERE THE FIRST GLOB METACHARACTER APPEARS in the
  pattern, folding any literal directory segment before it (including a package-name directory)
  into the stripped prefix. A pattern like `.../src/ClineTest/*.cls` (wildcard only in the
  trailing segment) silently uploads `ClineTest.Wumpus.cls` as unqualified `Wumpus.cls` - upload
  reports success (`uploaded: N, failed: 0`); the defect only surfaces later as a confusing
  IRIS-side compile error (`Class 'User.Wumpus' does not exist`) with no hint the real cause is
  upstream path mapping. Confirmed repro attached in the bug report.
- **AC 35.9.2** - Probe-first (#16): before coding, confirm LIVE what IRIS actually does when
  `PUT /doc/<name>` receives content whose own `Class Pkg.Name Extends ...` (or `ROUTINE Name`)
  declaration disagrees with the URL-supplied document name - does the server store it under the
  literal PUT name, the content-declared name, or reject the mismatch outright? And confirm live
  that an unqualified class/document name genuinely falls back to the `User` package on compile
  (the mechanism inferred, not yet live-verified, in `docs/bugs-2026-08-17.md`'s root-cause
  section). Record the probe output in Dev Notes; the fix design in AC 35.9.3 depends on which
  behavior is real.
- **AC 35.9.3** - Fix: for `.cls`/`.mac`/`.int`/`.inc` uploads, parse the file's own declared
  identity (the `Class <Pkg.Name> Extends ...` line, or `ROUTINE <Name>`) and cross-validate it
  against the path-derived doc name. On divergence, refuse the upload for that file with a clear,
  actionable error naming BOTH the path-derived name and the content-declared name (not a generic
  failure) - never upload a mismatched or unqualified doc silently. CSP/slash-style docs (no
  embedded class/routine identity) keep today's pure path-derived naming unchanged.
- **AC 35.9.4** - Additive, optional `baseDir` parameter on `iris_doc_load` (Constraint E-1:
  additive parameter on an existing action, not a new action): when supplied, used verbatim as
  the base directory instead of glob-shape inference, so a programmatic caller can state the
  package root deterministically. Omitted => today's `extractBaseDir` inference is unchanged
  (Rule #19).
- **AC 35.9.5** - Audit (#56): check `iris_doc_export`'s inverse helpers (`docNameToFilePath`,
  and its own use of `filePathToDocName`/`extractBaseDir` conventions per `epics.md` Story 10.2)
  for the same class of unvalidated path-shape assumption. Report the audit result even if
  nothing further is found.
- **AC 35.9.6** - Rule #48 mutation evidence: revert the validation and show the ORIGINAL
  reported transcript's exact repro (`.../ClineTest/*.cls`, two classes) silently uploading
  unqualified `Wumpus.cls`/`WumpusCave.cls` and failing at compile with the misleading
  `User.Wumpus` error; restore the fix and show the SAME repro now refused at upload time with a
  clear, correct mismatch message instead.
- **AC 35.9.7** - Rule #19 back-compat: every correctly-shaped existing call (e.g., `src/**/*.cls`,
  matching the tool's documented convention and Rule #17) produces byte-identical doc names and
  behavior. Proven mechanically against the existing `load.test.ts` suite plus new fixtures for
  the mismatch and `baseDir` paths.
- **AC 35.9.8** - Live proof (#26) on a real namespace: the exact reported scenario end-to-end -
  two classes under a package directory uploaded with the trap-shaped glob, showing the new
  refusal and message - then the SAME two files uploaded with the corrected glob (or the new
  `baseDir` parameter) succeeding and compiling clean.
- **AC 35.9.9** - Docs (#43, self-documenting - not deferred to Story 35.8's rollup):
  `iris_doc_load`'s Zod `description` gains the concrete failure-mode example (wrong glob shape
  vs. right) and documents the new `baseDir` parameter; `packages/iris-dev-mcp/README.md` and
  `tool_support.md` updated to match.
- **AC 35.9.10** - Gates: `pnpm turbo run build test lint type-check` green;
  `gen:governance-baseline:check` (`:check` ONLY) exit 0 at frozen `1e62c5ad5bf7`/141/201/60
  (Constraint E-2); tool counts unmoved (Constraint E-1, #31 - additive parameter only, no new
  tool or action key); changeset added.
```

### 4.2 — `sprint-status.yaml`

Location: Epic 35 block, after `35-8-docs-artifact-rollup-epic-gate: backlog`, before `epic-35-retrospective: optional`.

OLD:
```yaml
  35-8-docs-artifact-rollup-epic-gate: backlog
  epic-35-retrospective: optional
```

NEW:
```yaml
  35-8-docs-artifact-rollup-epic-gate: backlog
  35-9-doc-load-package-prefix-validation: backlog
  epic-35-retrospective: optional
```

### 4.3 — `prd.md`

Location: `### Reliability` NFR section, immediately after the existing connection-loss bullet.

OLD:
```
### Reliability

- Connection loss to IRIS must be detected within 2 seconds and reported with an error response containing error code, human-readable message, and recovery suggestion — not silently fail
- HTTP session expiration must be handled with automatic re-authentication
```

NEW:
```
### Reliability

- Connection loss to IRIS must be detected within 2 seconds and reported with an error response containing error code, human-readable message, and recovery suggestion — not silently fail
- Bulk multi-file document operations (e.g., `iris_doc_load`) must not silently produce a misleading success result when a derived identifier (such as an inferred IRIS document/class name) could plausibly diverge from caller intent — where ground truth exists (e.g., a file's own declared class/routine name), the tool must validate against it and surface an explicit, actionable error at the point of divergence rather than deferring to a confusing downstream failure (Epic 35, Story 35.9)
- HTTP session expiration must be handled with automatic re-authentication
```

**Rationale:** This mirrors the existing connection-loss bullet's "not silently fail" principle, extended to the class of defect this session diagnosed — a plausible-looking success that is actually wrong. No FR change: this is a validation/contract NFR on an already-covered capability (FR17), not a new capability.

### 4.4 — `architecture.md`

Location: new dated addendum subsection under "Core Architectural Decisions," after the existing "Server Manager Workspace-Candidate Trust (Epic 32...)" subsection and before "## Implementation Patterns & Consistency Rules."

NEW (inserted section):
```markdown
### Bulk-Upload Path-Mapping Self-Validation (Epic 35, Story 35.9 — added 2026-08-17)

Added via `sprint-change-proposal-2026-08-17-doc-load-package-prefix.md`, itself triggered by
`docs/bugs-2026-08-17.md` (an externally-reported defect, not the Epic 35 sweep). `iris_doc_load`
derives each uploaded document's IRIS name purely from where the caller's glob pattern happens to
place its first wildcard character (`extractBaseDir`/`filePathToDocName`,
`packages/iris-dev-mcp/src/tools/load.ts`) — a heuristic with no connection to the file's actual
declared identity, so a common glob shape (a literal package directory immediately before a
trailing `*.ext`) silently strips the package prefix and uploads succeed under the wrong name,
with the failure only surfacing later as a confusing, seemingly-unrelated IRIS compile error.

**K1 — Content is the source of truth for bulk source-file uploads, not glob-pattern shape.** For
file types that embed their own identity (`.cls`/`.mac`/`.int`/`.inc` — a `Class Pkg.Name Extends
...` or `ROUTINE Name` declaration), the path-derived document name is no longer trusted blindly:
it is cross-validated against the content-declared name, and a divergence refuses the upload for
that file with an explicit error naming both candidates, rather than uploading a mismatched or
unqualified document silently. This establishes a general pattern for this codebase's bulk/
path-mapping tools: **wherever an operation both (a) infers an identifier from a filesystem path
AND (b) has an independent, authoritative identifier available in the artifact itself, the two
must be cross-validated rather than trusting the path alone.** File types with no embedded
identity (CSP/slash-style docs) keep pure path-derived naming — there is no ground truth to
validate against. Paired with an additive, optional `baseDir` parameter so a programmatic caller
(an agent, in particular) can state the package root deterministically instead of relying on
glob-shape inference at all; omitted, behavior is byte-identical to today (Rule #19). This is a
narrower, single-tool decision compared to H1–J1 above — recorded here because it changes
`iris_doc_load`'s validation contract, not because it introduces new epic-scale mechanism.
```

---

## 5. Implementation Handoff

**Scope classification: Moderate** — backlog reorganization (new story + doc updates) within an already-active epic; no PRD/MVP invalidation, no architecture invalidation, no rollback.

- **Route to:** Product Owner / Scrum Master, to accept Story 35.9 into the Epic 35 backlog (already sequenced correctly after 35.8 in `sprint-status.yaml`); then Development (via the normal `bmad-dev-story` flow when Story 35.9 is picked up) to implement per its ACs.
- **This correct-course session's own deliverable:** apply the four artifact edits in §4 directly (epics.md, sprint-status.yaml, prd.md, architecture.md) upon approval below. `docs/bugs-2026-08-17.md` (the underlying defect record) was already written in this session and needs no further changes.
- **Success criteria:** all four files updated exactly as shown in §4; Epic 35's existing stories (35.0-35.8) and their cross-references in `35-0-epic-34-deferred-cleanup.md`/`deferred-work.md` remain completely untouched; `sprint-status.yaml` gains exactly one new `backlog` key.
