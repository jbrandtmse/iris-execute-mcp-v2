# Sprint Change Proposal — 2026-08-14

**Trigger**: External bug report [docs/bugs-2026-08-14.md](../../docs/bugs-2026-08-14.md) (live debugging session, 2026-08-14) + stakeholder enhancement request (raise `iris_execute_classmethod` positional-argument ceiling from 10 to 20).

**Prepared by**: Correct Course workflow (Scrum Master), incremental review mode.
**Decision status**: Edit proposals 1–3 individually approved by stakeholder during drafting; final approval recorded below.

---

## 1. Issue Summary

Three related deficiencies in `iris_execute_classmethod` (`@iris-mcp/dev`, endpoint `POST /api/executemcp/v2/classmethod`, handler `ExecuteMCPv2.REST.Command::ClassMethod()`):

1. **Defect — device output corrupts the response.** Any target classmethod that `Write`s to the current device during execution produces `"IRIS returned a non-JSON response … Expected an Atelier envelope"`. Three independent live reproductions documented in the bug report (`MALOCALDEV.PatchContainer.Go()`, `%UnitTest.Manager.RunTest` via wrapper, `CICD.ConfigureAll.Now()` — the last also switches namespace mid-run). **Root cause confirmed in code**: `Execute()` (the `/command` handler, `src/ExecuteMCPv2/REST/Command.cls` lines 50–83) captures Write output via a null-device `ReDirectIO` mnemonic, but `ClassMethod()` (lines 121–210, same class) performs **no I/O capture at all** — target `Write`s interleave with the HTTP response stream. The bug report's hypothesis matches the code exactly, and the fix mechanism already exists 100 lines above the defect.
2. **Gap — no `ByRef`/`Output` argument support.** Only the single return value round-trips; methods whose real result lives in an `Output` parameter require a bespoke wrapper class per target. Notably, **PRD FR38 already promises "output parameter support"** — this is an unfulfilled existing requirement, not new scope.
3. **Limit — 10-argument ceiling → 20.** Enforced by an explicit if/elseif ladder in `ClassMethod()` (lines 160–188; `Else` branch errors "maximum is 10"). A deliberate Story 3.3 design tradeoff (ObjectScript has no spread/apply for `$ClassMethod`), not a bug; raising it means extending the ladder. The TS layer states the limit only in description text (no Zod `.max`).

**Out of scope / already resolved**: the two older bug files (`docs/known-bugs-2026-04-20.md`, `docs/known-bugs-2026-05-29-mapping-subscript.md`) were fixed in Story 10.5 (commit `8295e58`) and commit `0c62ca4` respectively.

## 2. Impact Analysis

- **Epic impact**: Epics 1–33 complete and merged; nothing in flight; no future epics affected. Requires one **new Epic 34**, following the established change-proposal-added epic pattern (Epics 23–33).
- **Story impact**: three new stories (**34.1** probe, **34.2** ObjectScript handler, **34.3** TS tool + docs + smokes). No existing story re-opened. *(Renumbered 2026-08-14 from 34.0/34.1/34.2 per stakeholder decision during the `/epic-cycle` readiness check: `/epic-cycle`'s mandatory retro-review gate auto-creates "Story 34.0: Epic 33 Deferred Cleanup" — Epic 33's retro exists and `deferred-work.md` carries 15 unresolved LOW items from Story 33.5 — so 34.0 is reserved for it instead of colliding. This departs from the project's usual X.0-is-the-probe convention (Epics 23–33), deliberately. Per Rule #37 those items are on their FIRST deferral, so the gate's triage may legitimately re-defer them.)*
- **Artifact conflicts**:
  - **PRD**: additive dated subsection "Epic 34 — `iris_execute_classmethod` Fidelity (added 2026-08-14)" with **new FR142** (device-output capture + `{byRef, value?}` markers + 20-arg ceiling), following the Epic 30 / Epics 31–33 house pattern. FR142 completes FR38's existing output-parameter clause; FR37/FR38 themselves are unchanged. *(Amended 2026-08-14 on stakeholder review: the initial "no new FRs" call was revised — capture is genuinely new capability not covered by FR37 (commands only) or FR38.)*
  - **Architecture**: none — verified architecture.md makes no claim Epic 34 falsifies (no arg-limit or classmethod-capture claims; route list and FR mappings stay true); no new component/route/package, so no G-series decision entry warranted.
  - **UX**: N/A.
  - **epics.md / sprint-status.yaml**: additive Epic 34 entries (proposals below).
- **Technical impact**:
  - `src/ExecuteMCPv2/REST/Command.cls` is a **bootstrapped class** (`gen-bootstrap.mjs` roster line 26) → Story 34.2 must regenerate `gen:bootstrap` and record the BOOTSTRAP_VERSION from→to (Rule #24). Not a new class → no roster changes (Rule #39 not triggered).
  - `packages/iris-dev-mcp/src/tools/execute.ts` — schema/description/response surfacing.
  - **No new tool, no new governance key or action** → Rules #28/#31/#53 not triggered; frozen baseline untouched (Rules #23/#25).
  - **Strictly additive** (Rule #19 + standing back-compat gate — the suite has live users): existing plain-scalar-args calls must return unchanged `returnValue`/`argCount`; new `output` and `byRefValues` fields are additive; `structuredContent` stays an object.
  - Rule #7 discipline (single render, full I/O restore before render) applies to the new capture path; Rule #16 probe-first applies to the by-ref and capture/`ZN` interplay claims.

## 3. Recommended Approach

**Direct Adjustment — add Epic 34** (selected; stakeholder-confirmed). Effort: Low–Medium. Risk: Low (capture mechanism proven in the same class; ladder extension mechanical; by-ref semantics pinned by a probe story first). Timeline: one small epic, no impact on other work.

- Rollback: not viable — nothing to roll back.
- MVP review: N/A — MVP long shipped.

**ByRef design (stakeholder-selected): explicit marker objects.** An `args` entry that is a JSON object `{"byRef": true, "value": <optional initial>}` is passed by reference (omitted `value` = undefined, `Output`-style); scalar entries behave exactly as today; any other object entry is rejected with a clear validation error (object args are undocumented/unsupported today, so this is non-breaking). Post-call values of marked args return in an additive `byRefValues` response field keyed by zero-based arg index. (The alternative — uniform pass-by-reference of every arg — was considered and declined by the stakeholder.)

## 4. Detailed Change Proposals

### Proposal 1 (APPROVED) — epics.md: append Epic 34

Append after Epic 33: epic header + goal/scope/FR mapping + Stories 34.1/34.2/34.3 with ACs (renumbered from 34.0/34.1/34.2 — see Story impact above), as drafted and approved in-session. Key ACs: capture parity with `Execute()` incl. Rule #7 discipline (34.2.1); marker-object by-ref with `byRefValues` (34.2.2); 20-arg ladder with boundary tests 0/1/10/11/20 and count-21 rejection (34.2.3); Rule #19 back-compat pin (34.2.4); BOOTSTRAP_VERSION bump (34.2.5); TS schema/docs updates with unchanged counts/annotations (34.3.1–34.3.3); live-smoke epic gate = the three bug-report reproductions pass without wrapper classes, plus Output-param, 20-arg, and second-namespace runs (34.3.4, Rules #21/#22/#26/#34).

**Documentation scope (stakeholder-directed, 2026-08-14)**: AC 34.3.3 names every doc surface explicitly (audited by grep this session): `packages/iris-dev-mcp/README.md` in BOTH spots (tool summary table ~L213 and detail block ~L915); `docs/migration-v1-v2.md` mapping row ("Same functionality" → enhanced); `docs/tool_support.md` and root `README.md` verified to currently not mention the tool — the story records checked-no-edit-needed or adds coverage if warranted; CHANGELOG entry. Review re-asks the Rule #56 completeness question against these surfaces.

### Proposal 2 (APPROVED) — sprint-status.yaml: append Epic 34 block

```yaml
epic-34: backlog
34-1-classmethod-invocation-probe: backlog
34-2-handler-capture-byref-20args: backlog
34-3-ts-tool-docs-smokes: backlog
epic-34-retrospective: backlog
```

(34.0 intentionally absent — reserved for the `/epic-cycle` retro-review gate's auto-created "Epic 33 Deferred Cleanup" story, which `/bmad-create-story` will add at run time.)

with the approved explanatory comment block (trigger, design, additive/back-compat notes, epic gate).

### Proposal 3 (APPROVED) — docs/bugs-2026-08-14.md: append disposition

Disposition section recording acceptance, Epic 34 tracking, and that Story 34.3's live smoke re-runs the report's three reproductions as the epic-done gate.

## 5. Implementation Handoff

- **Scope classification**: **Minor–Moderate** — planning-artifact additions (this proposal, applied by SM) + one new backlog epic for the dev team via the standard `/epic-cycle` pipeline.
- **Handoff**: SM applies the three approved artifact edits (done as part of this workflow). Development proceeds via `create-story` → `dev-story` → review for Stories 34.1–34.3 when the epic is scheduled.
- **`/epic-cycle` readiness (checked 2026-08-14)**: working tree clean, no submodules, artifacts internally consistent. Two run-start decisions pre-recorded so a fresh-context lead does not have to guess: (a) **story numbering** — 34.0 reserved for the retro-review gate's cleanup story (above); (b) **branching** — this project is TICKETLESS and does not match `/epic-cycle`'s default JIRA `{TICKET}-epic{N}` pattern; history uses `feature/feature-wave-N-<description>` → `epic{N}` (e.g. `epic31`, `epic33`) merged to `main`. For Epic 34: cut **`feature/feature-wave-4-classmethod-fidelity`** off `main` (wave-3 is already merged), epic branch **`epic34`**. Answer `/epic-cycle`'s SC-1 prompt with this convention (option "override and use as-is"). Codifying it in `_bmad/custom/branch-naming.yaml` remains an open optional cleanup.
- **Success criteria (epic-done gate)**: all three reproduction shapes from docs/bugs-2026-08-14.md succeed against the built dist without wrapper classes; an `Output`-parameter method's post-call value round-trips; a 20-argument call succeeds and a 21-argument call is cleanly rejected; existing plain-args calls byte-stable on `returnValue`/`argCount`; BOOTSTRAP_VERSION bump recorded; docs updated on all surfaces.
