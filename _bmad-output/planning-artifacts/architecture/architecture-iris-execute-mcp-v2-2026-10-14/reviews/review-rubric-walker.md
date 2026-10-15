---
review: rubric-walker (pre-handoff)
target: ../ARCHITECTURE-SPINE.md
inputs:
  - ARCHITECTURE-SPINE.md (31 ADs, status draft, 2026-10-14T20:15)
  - _bmad-output/planning-artifacts/epics.md (Epics 38-42, lines 4963-5656)
  - sprint-change-proposal-2026-10-14-competitive-skills-distribution.md; decision-record-2026-10-14-distribution-and-skills.md
  - .claude/commands/epic-cycle.md (how the pipeline consumes the spine)
  - code spot-checks in packages/, extensions/, src/, ipm/ (built dist enumerated for tool metadata)
  - live: iris_server_info on the dev instance (read only)
date: 2026-10-14
mode: read-only (no file other than this one was edited)
---

# Rubric-walker review: ARCHITECTURE-SPINE.md before handoff to Epic 38

## Verdict

**Ready for Epic 38 once five HIGH fixes land. All five are text edits to the spine; none needs a new architectural decision except the `iris_doc_edit` destructive-hint call in H-2.** There is no critical finding, and no [ASSUMPTION] blocks Epic 38 from starting.

The adopted decisions are sound, and most AD Rules match the code (see "Spot-checks that passed"). The risk is in how the pipeline reads the spine: `epic-cycle.md:281` checks every AD whose `Binds:` covers a story's area, and a mismatch is HIGH. So:

- Rules that describe the end state of Epics 38-42 in the present tense will raise false HIGHs on the stories that come before them (H-1).
- Four Rules contradict existing code or an Epic 38 AC as written (H-2, H-3, H-5).
- One cross-story contract that Epics 38-40 all need is not decided (H-4).

The reconcile pass's source-coverage work is not repeated here. Findings that overlap it are noted.

## Checklist walk

| # | Check | Result |
|---|---|---|
| 1 | Fixes the real divergence points for Epics 38-42 | Mostly. Missed: the MCP-level refusal shape (H-4); additive output fields (H-5); who releases a monitor after the client's wait budget runs out (M-9); pack placement against the plugin's source (M-10); where workflow-skill descriptions live (M-11); `action` versus `mode` for multi-operation reads (L-4); REST route naming (L-5). |
| 2 | Every Rule is enforceable and prevents its divergence | Mostly. Exceptions: AD-4 never defines "destructive" (H-2); AD-17's Binds reach far beyond its Rule (H-3); AD-31 promises an error mapping that does not exist (M-6); the tool-description convention is contradicted by half the catalog (M-1). |
| 3 | Nothing in Deferred lets two units diverge | Holds. One small tightening (L-7). |
| 4 | Ratifies the codebase rather than contradicting it | Spot-checks mostly pass. Contradictions: H-2, H-3 (`clean`), M-1, M-2, M-6, L-1, L-2, L-3. |
| 5 | Every dimension at this altitude is decided, deferred or open | Deployment, environments and CI/release are decided. Not decided: post-publish operations (M-4) and how the IRIS support floor is verified (M-3). |
| 6 | Are any [ASSUMPTION]s unsafe enough to block Epic 38? | No. AD-9 matches the code (`sql.ts:31-35` already sets `rowsCapped`). AD-25's needs tightening before Story 38.5 (M-8). AD-26's needs completing before Story 39.2 (M-7). AD-14 and AD-19 are safe. |
| 7 | Over-reach: story-level detail, or future state written as required | H-1 (future state in the present tense across six ADs), H-3 (AD-17 Binds), M-6 (AD-31). The AD-15 table of sanctioned changes is wave-specific; prune it at wave close (L-8). |

---

## Critical

None.

---

## High

### H-1. Six ADs describe the end state of Epics 38-42 in the present tense, with nothing marking what has not landed yet (AD-23, AD-24, AD-25, AD-26, AD-28, AD-29; Stack; Conventions)

**Problem.** AD-14 is the only AD that separates current rules from "Not yet implemented — lands in Story N". The others state future behavior as if it were already required, and their `Binds:` cover files that earlier stories touch. The current code:

- `transport.ts:9-29` still accepts `http`, and an unknown value falls back to stdio with a warning. AD-23's rejection lands in 38.1.
- There is no Storage-drop guard and no `iris_doc_edit` (AD-24; lands in 38.3 and 38.4).
- `iris_sql_execute` has no statement-type check and there is no `iris_sql_query` (AD-25; 38.5).
- There is no `dataPolicy`, and the `iris_message_resend` preview is not redacted (AD-26; 39.2).
- There is no `THIRD_PARTY_NOTICES.md`, no assembled pack, and no provenance check (AD-28; 41.1 and 41.6).
- The root `package.json:38` declares `"node": ">=18.0.0"`, and no package declares `engines`. Versions are `0.0.1` (client-config) and `0.0.2`. There is no `.github/` directory. `synthesize.ts` writes unpinned `npx` (AD-29 and the Stack Node and CI rows; 42.1, 42.3 and 42.5).
- Conventions: `iris_test_status` returns no `structuredContent` (fixed in 40.4.3), and `iris_execute_tests` declares `readOnlyHint: true` (DW-498, fixed in 40.4.3).

**False HIGHs this produces under `epic-cycle.md:281`:**

- **38.2** changes `iris_doc_get`, which AD-24 binds. The reviewer finds no shared Storage-drop guard and no `iris_doc_edit`.
- **39.1** extracts the search helper out of `MessageResend.cls`, which AD-26 binds through the resend preview. The reviewer finds the preview unredacted.
- **Any 38-41 story that adds a changeset** (38.1.6, 38.6.1, …) touches `.changeset/`, which AD-29 binds. The reviewer finds versions that are not `1.0.0` and `engines` that is not `>=22`.
- **Any gate added in 38-41** (38.6.3 capstone, 39.3.3 fuzz, 41.1.4 provenance check) breaks AD-29's "a new gate is registered both in the code-declared check list and in `ci.yml`", because neither the list nor `ci.yml` exists until 42.3.

**Fix.**

1. Add one sentence to the preamble: "A clause tagged *(lands in Story N.M)* binds that story and every story after it. Before that, the current behavior is the known state, not a finding."
2. Tag the clauses:
   - AD-23: the whole Rule, 38.1.
   - AD-24: the guard, 38.3; `iris_doc_edit`, 38.4.
   - AD-25: the statement-type check and the caps, 38.5.
   - AD-26: the policy, 39.2; search and body, 39.3-39.5.
   - AD-28: notices and the mechanical check, 41.1; the pack and the installer, 41.1 and 41.6.
   - AD-29: `engines`, the version and `@1`, 42.1; CI and gate registration, 42.3; publishing, 42.5 and 42.6.
   - Stack: the Node row, 42.1; CI images, 42.3.
   - Conventions: `structuredContent` and annotations, with the two known exceptions named.
3. Until 42.3 lands, a new gate registers in its package's `prepublish-gate.mjs` roster (see M-2) and in nothing else.

### H-2. AD-4 says "a tool with any destructive action is `destructiveHint: true`" without defining "destructive", and existing tools contradict it (AD-4; Conventions "Tool annotations")

**Problem.** These annotations were read from the built dist:

| Tool | `destructiveHint` | Why it looks destructive |
|---|---|---|
| `iris_sql_execute` | `false` | runs `DELETE`, `DROP` and `TRUNCATE` |
| `iris_execute_command` | `false` | runs arbitrary code |
| `iris_doc_put` | `false` | overwrites a whole document; 38.3 exists because it can drop Storage |
| `iris_execute_tests` | (`readOnlyHint: true`) | DW-498 |

`architecture.md:89` gave a narrower rule ("`*_manage` tools that handle both create and delete"), and the spine broadened it without a definition.

Two Epic 38 stories hit this directly:

- **38.4.6** requires `iris_doc_edit`'s annotations to be "consistent with `iris_doc_put`", which means `false`. But `iris_doc_edit` has a `delete` edit, so AD-4 says `true`. The plan and review stages will disagree.
- **38.5** changes `iris_sql_execute`. A reviewer applying AD-4 flags `destructiveHint: false`. Fixing it changes `tools/list`, and AD-15 requires a Lead decision for that. Only 40.4's `iris_execute_tests` correction is sanctioned, so 38.5 halts on an intent gap.

**Fix.**

1. Define the term in AD-4: "Destructive means the tool can delete, or irreversibly overwrite, existing state."
2. Scope the Rule: "This binds new tools and new actions. An existing tool's annotation changes only through a sanctioned AD-15 change."
3. List the known divergences (`iris_sql_execute`, `iris_execute_command`, `iris_doc_put`, `iris_global_set`, `iris_env_promote` `execute`, and DW-498), routed to one ledger entry with an owner, either 40.4 next to DW-498 or a Lead decision.
4. Have the Lead decide `iris_doc_edit`'s `destructiveHint` now, and amend AC 38.4.6 to match.

### H-3. AD-17's Binds ("any future bulk or data-loss write") reach Epic 38's guarded writes, and its "dry run is the default" is false for a tool it names (AD-17)

**Problem.**

- `iris_production_control:clean` has no dry run and no filters or caps. It runs immediately, and only `killAppData` needs `confirm: true` (`production.ts:100-146`). AD-17 names it in Binds and then states "Dry run is the default".
- "Any future … data-loss write" also catches three Epic 38 stories:
  - 38.3: the storage override is `allowStorageRegeneration: true`, not `confirm: true`;
  - 38.4: `delete` edits have no dry-run default;
  - 38.5: a `DELETE` is bounded by a rows-affected cap with rollback, not by a dry run.
- A reviewer can flag all three as HIGH. A planner reading AD-17 may instead add dry-run or `confirm` to `iris_sql_execute`, which changes a frozen-baseline tool's behavior and violates AD-15.

**Fix.** Split the Rule by the kind of write:

- **(a) Bulk or multi-item writes** (`iris_message_resend` `resend` and `resendFiltered`, `iris_env_promote` `execute`, and future bulk writes): required filters and windows, refuse-not-truncate caps, a dry-run default, and `confirm: true`. Plan hashing applies to promote.
- **(b) `iris_production_control:clean`**: no dry run. `killAppData` requires `confirm: true`.
- **(c) Single-document writes and SQL DML** are governed by AD-24 and AD-25, not by AD-17.

Narrow Binds to match.

### H-4. The MCP-level refusal shape is not decided, and Epics 38-40 add at least nine refusals (missing divergence point; Conventions)

**Problem.**

- AD-17's "standard envelope" is the IRIS-side three-part envelope (AD-11), not the MCP tool result. The tool result shape is undecided.
- Existing refusals already differ:
  - a governance denial is `isError: true` with `structuredContent.code: "GOVERNANCE_DISABLED"` (`server-base.ts:1448-1451`);
  - `iris_process_manage` returns `refused: true` and a `reason` (`process.ts:24,53`);
  - compile failures are `isError: false` (`compile.ts:175`).
- Epics 38-40 add more refusals:
  - 38.3.3: storage drop ("a distinct error code");
  - 38.4.3: `STALE_CONTENT`, and a conflict;
  - 38.5.2: SQL read-only, naming the statement type;
  - 38.5.3: the rows-affected cap;
  - 39.3.2: body mode under `block`;
  - 39.5.3: per-body blocked outcomes;
  - 40.1.4: an active LineByLine session;
  - 40.3.2: a different production is running.
- The 38.6.3 capstone asserts four refusals that come from three different stories, and the 38.6.2 prompt has to branch on `STALE_CONTENT`. If each story invents its own shape, both are tied to arbitrary choices, and agents have no uniform way to detect a refusal.

**Fix.** Add a Conventions row named "Refusals":

- A refusal is `isError: true` and changes nothing.
- `structuredContent.code` is a stable SCREAMING_SNAKE code (the precedent is `GOVERNANCE_DISABLED`). It is accompanied by the fields a caller needs to act, such as dropped definition names, current text, the row count and cap, or the blocking production.
- The text follows the Error-text convention.
- Codes are declared once in `@iris-mcp/shared` and documented in the tool description.
- Inside a successful multi-item read (39.5), a per-item outcome is a field, not `isError`.
- `notApplicable` and verdicts such as `minCoverage` (40.2.4) are successes.

### H-5. AD-15 does not say whether an additive output field is breaking, and Story 38.5 contradicts itself on it (AD-15)

**Problem.**

- AD-15 says that when a feature is unused, the response is byte-identical, and that "adding an optional input field is non-breaking". It says nothing about output fields.
- AC 38.5.4 adds `rowCount` to every DML result with nothing configured. AC 38.5.5 then requires a byte-identical `toEqual` pin with the controls off. Both cannot hold.
- AC 40.4.3 adds `structuredContent` to `iris_test_status`, which is not in the sanctioned table.
- AD-19 already treats new audit fields as additive, so the spine is inconsistent with itself.

**Fix.** Add to AD-15:

- "Adding a field to an existing tool's output (a new `structuredContent` key, or a new trailing text line) is non-breaking."
- "The back-compat pin proves that every pre-existing field is byte-identical: it pins the old shape with the new key removed, or the full new shape in the story that adds it."
- "Removing, renaming or retyping an existing field, or changing its default, is breaking."

---

## Medium

### M-1. The "three sentences, no implementation detail" description convention contradicts the catalog (Conventions "Tool descriptions")

**Evidence.** I enumerated the 105 tools from the built dist:

- 49 descriptions run past three sentences, and 26 run past five (for example `iris_execute_classmethod` 19, `iris_database_action` 17, `iris_resource_manage` 13, `iris_env_promote` 12).
- 17 name `IRIS_*` operator variables, and 3 mention Atelier.

The row comes from `architecture.md:640` and was never enforced. It also conflicts with the spine's own requirement that a governed write states its default state, and with 38.5's need to describe its operator controls.

**Fix.** "Lead with what the tool does, when to use it, and what it returns. Then state the default state of any governed write and the operator controls that affect the call. Never name REST paths. Existing descriptions are grandfathered, and a story that edits one may leave its length as it is."

### M-2. The live-gate convention names the wrong file, and Epic 39 has no gate roster (Conventions "TypeScript files")

**Evidence.** There are three per-package gate rosters, each with its own `gateTestFiles`:

- `packages/iris-mcp-all/scripts/prepublish-gate.mjs` (Epics 35 and 37);
- `packages/iris-dev-mcp/scripts/prepublish-gate.mjs` (5 files, including the Epic 36 gates);
- `packages/iris-data-mcp/scripts/prepublish-gate.mjs`.

`iris-interop-mcp` has none. The Epic 38 capstone belongs in dev's roster. The Epic 39 capstone (AC 39.6.3, "listed in the live-gate roster") has no roster to join.

**Fix.** "Live-IRIS gates are armed by `IRIS_REQUIRE_LIVE` and listed in the owning package's `scripts/prepublish-gate.mjs` `gateTestFiles`. A package that has no roster creates one, wired to `prepublishOnly`. Cross-package gates go in `iris-mcp-all`. From 42.3, CI runs every roster."

### M-3. The IRIS support floor (2023.1) is claimed but never exercised (Stack; operational envelope)

**Evidence.**

- The dev instance reports IRIS 2026.2 (Build 221U), Atelier API 8 (`iris_server_info`, 2026-10-14). The CI images are 2026.2 only.
- Every probe in Epics 38-40 therefore runs on 2026.2: `%SQL.Statement` statement types (38.5), `%Monitor.System.LineByLine` (40.1), `Ens.Config.SearchTableProp` (39.4), `%JSONExport` (39.5).
- `requireMinVersion` gates the Atelier API version, not the IRIS version.
- 1.0.0 is a semver commitment to the floor stated in the README (`README.md:45`).

**Fix.** Pick one and record it:

- (a) 42.3 adds the oldest available community image to the matrix.
- (b) Raise the floor at 1.0.0 to the oldest version actually tested.
- (c) Add a rule: a story that depends on an IRIS API records the earliest version it verified, and feature-detects so that older instances get `notApplicable` or a structured refusal.

Until a choice is made, list it under Open questions with 42.3 as owner.

### M-4. Operations after publishing are not decided or deferred (operational envelope; AD-29; Structural Seed)

**What is missing.**

- **Bad releases.** `@1` delivers every 1.x release to every user at next launch (D3, AD-15), and npm's unpublish window is narrow. The spine does not say whether the answer is fix-forward or `npm deprecate`, or who decides.
- **Vulnerability disclosure.** There is no `SECURITY.md`, and 1.0.0 ships `iris_execute_command` and SQL tools.
- **Versions outside the fixed group.** The extension is at `0.1.0`, outside the Changesets group, with publisher `TBD-at-publish-time`. The plugin's version is unspecified. Only IPM is tied to npm (AD-14).
- **Channels.** The Structural Seed omits two channels Epic 42 ships to: the MCP Registry and the in-repo Claude Code plugin marketplace.

**Fix.** Add AD-32, "Release operations": the policy for a bad release, a disclosure channel, a version policy for the extension, the plugin and IPM, and the list of channels. Or put each item in Deferred or Open questions with an owner story (42.5, 42.7, 42.8 or 42.9). Add the two channels to the Structural Seed.

### M-5. The extension's `client-config` launch is unpinned, and neither AD-29 nor AC 42.1.6 covers it (AD-29; Rule #56 completeness)

**Evidence.** `extensions/iris-mcp-launcher/src/clientsEngine.ts:25,78` falls back to `npx -y -p @iris-mcp/client-config iris-mcp-clients`, with no `@1`. Its own comment warns that a guessed fallback "would run a DIFFERENT engine version". AD-29 says "Clients launch `npx -y @iris-mcp/<pkg>@1`", and AC 42.1.6 lists only `synthesize.ts` and `serverDefinitionProvider.ts`.

**Fix.** AD-29: "Every `npx` launch the suite writes or spawns pins `@1`. That covers synthesized client entries, the extension's server definitions, the extension's client-config CLI fallback, and the plugin's server entries." Amend AC 42.1.6 to match.

### M-6. AD-31 promises a permission-error mapping that does not exist, and binds every tool (AD-31)

**Evidence.** "A permission failure surfaces as an actionable error naming the missing resource." `http-client.ts` has no 403 or `<PROTECT>` mapping (only the 401 re-auth and the CSRF warning), and IRIS does not reliably name the resource. Because AD-31 binds "every tool and REST handler", any story whose error path is reviewed can be flagged.

**Fix.** "Permission failures propagate IRIS's own error text through `SanitizeError`, and add resource guidance where IRIS identifies the resource. There are no client-side pre-checks." If the mapping is wanted, add it as a target tagged with an owner story.

### M-7. AD-26's list of residual exposures is incomplete (AD-26 [ASSUMPTION]; Rule #56)

**Problem.** The assumption names only generic SQL, global and document tools as residual exposure. It leaves out:

- `iris_production_logs`, which returns `Ens_Util.Log` text. HL7 parse errors routinely quote segment content.
- `iris_message_diagram`'s sanitized error summaries.
- `iris_execute_command` and `iris_execute_classmethod` output.
- `iris_global_get`, which the assumption mentions only as a category.

**Fix.** "Story 39.2 lists every tool that can return body or body-derived text, exhaustive as of a named date (Rule #56). Each is either governed by `dataPolicy` or recorded as residual exposure that operators restrict through governance or visibility." Review then asks what is missing.

### M-8. AD-25's "every SQL-executing tool" is ambiguous (AD-25 [ASSUMPTION]; affects 38.5)

**Problem.**

- `iris_sql_analyze` runs `EXPLAIN` on caller SQL (`SqlAdvisor.cls:197`, `%ExecDirect(, "EXPLAIN "_pQuery)`).
- `iris_production_messages` and the new `iris_message_search` run SQL internally.

Read broadly, the assumption makes a reviewer require `IRIS_SQL_READ_ONLY`, `MAX_ROWS` and `TIMEOUT` on the interop search tools.

**Fix.** "Every operator SQL control applies to every tool that executes caller-supplied SQL text: `iris_sql_execute` and `iris_sql_query`. Story 38.5 records whether `iris_sql_analyze`'s `explain` and `indexUsage` paths are in scope. Tools that build their own SQL are bound by AD-20 and AD-26, not by these controls."

### M-9. AD-16 and AD-27 don't say who releases a coverage session after the client stops waiting (AD-16, AD-27; affects 40.1)

**Problem.** When the wait budget expires, `iris_execute_tests` returns `status: "running"` (AD-16), but the LineByLine session must still be stopped (AD-27, "including after a timeout"). Story 40.1 could stop the session from the TypeScript call, which would end it too early or leave it running. It could also release it from the IRIS-side job. The spine doesn't choose.

**Fix.** Add to AD-27: "The IRIS-side job that starts a session or production releases it in its own cleanup, independent of the client's wait budget. The TypeScript tool never owns the session's lifetime. A cancel through the companion tool (AD-16) triggers the same release."

### M-10. Pack placement versus the plugin's source is not constrained, and AD-2 doesn't place the pack's cross-package checks (AD-28, AD-2; affects 41.1 and 42.8)

**Problem.**

- AD-28's default puts the assembled pack inside `@iris-mcp/client-config`. Story 42.8's plugin is a `.claude-plugin/` folder in this repo, served from an in-repo marketplace. A plugin installed from the git source cannot see an npm tarball, so the pack also has to exist, committed, at the plugin's path. 41.1 may not see this coming.
- Building the pack and running 41.1.4 and 41.1.5 means reading `packages/*/src/prompts` and `skills/`. AD-2 does not say whether `client-config` may depend on server packages. By AD-2's own rule, cross-package checks belong in `iris-mcp-all`.

**Fix.** Add to AD-28 as inputs for 41.1:

- "The pack is either a committed generated artifact, with a `--check` drift gate, or the plugin's source type is verified to read npm (Rule #14)."
- "The pack build and its provenance and tool-name checks live in `iris-mcp-all` or `scripts/`, never as a `client-config` → server dependency."

### M-11. AD-28 doesn't say where a workflow skill's model-invocation description lives (AD-28, AD-14; affects 41.5)

**Problem.** AC 41.5.1 rewrites each generated skill's description for model invocation, while "the MCP prompt text keeps its user-facing role". There are three ways to do it:

- hand-edit the generated skills, which violates AD-14;
- change the prompt descriptions, which changes `prompts/list` (AD-15);
- add a second source.

**Fix.** "The skill description is a separate field on each prompt's source definition. Only `gen:skills` reads it, and it never reaches `prompts/list`, which a `toEqual` pin proves."

---

## Low

- **L-1 (AD-14, Deployment).**
  - Problem: "only for custom-REST servers, on that profile's first custom-REST use" misstates the code. All five servers set `needsCustomRest: true`. Bootstrap runs when a profile is established, including the `default` warm-up at startup (`server-base.ts:2113`), not on the first custom-REST call. The failure report is logged (`server-base.ts:2360-2365`, `logger.warn`), not returned.
  - Fix: reword to "on each profile's first establishment; failures are logged with the per-step report and manual remediation".
- **L-2 (Conventions, TypeScript files).**
  - Problem: there are camelCase files outside `src/prompts/`: `sqlAdvisor.ts`, `sqlAnalyze.ts`, `defaultSettings.ts`, and the whole extension (`clientsEngine.ts`, …).
  - Fix: grandfather the named files and exempt `extensions/iris-mcp-launcher`.
- **L-3 (AD-11, Error classes).**
  - Problem: `KeyringUnavailableError` (`shared/src/cli/credentials.ts:107`) is missing from the list.
  - Fix: add it, or scope the list to the tool-call path.
- **L-4 (AD-4, the operation selector).**
  - Problem: `iris_sql_analyze` uses `action` with per-action read keys, while `iris_message_search` plans `mode`. With `mode`, an operator can't disable body or Search Table search through governance without also blocking body reads (`dataPolicy: block`).
  - Fix: "Use `action`, with per-action `mutates`, for any sub-operation an operator may want to govern separately. `mode` is only for presentation variants." Decide this before 39.1 fixes the key.
- **L-5 (Conventions, REST routes).**
  - Problem: the existing pattern is not recorded: `/<domain>/<resource>[/<verb>]`, GET for reads, POST for writes, and POST for a read that needs a body (`/interop/message/resend/preview`, `/security/permission`). Epics 38.5, 39.1, 39.5 and 40.1 add routes.
  - Fix: add a Conventions row.
- **L-6 (AD-29, Changesets before 1.0.0).**
  - Problem: there are 24 files in `.changeset/` (including `config.json`), with `client-config` at 0.0.1 and the rest at 0.0.2. Epics 38-41 keep adding changesets before 42.1.4 consolidates to 1.0.0.
  - Fix: "Changesets in Epics 38-41 use `patch` or `minor`; 42.1.4 owns the 1.0.0 mechanism; no story before 42.6 runs `changeset version` or publishes."
- **L-7 (Deferred, SDK `extra`).**
  - Problem: the deferral is implicit.
  - Fix: add "No handler consumes the SDK `extra` argument until then", so that a long-running Epic 40 tool doesn't wire cancellation on its own.
- **L-8 (front matter and AD-15).**
  - Problem: the spine is `status: draft`. Rule 6 resolves "newest final, else newest", so a later draft in another run folder would replace this spine.
  - Fix: set `status: final` at handoff. The AD-15 table of sanctioned changes is specific to this wave; prune it into the CHANGELOG at the Epic 42 retro.

---

## Spot-checks that passed (code agrees with the AD)

- **AD-1:** no `fetch(` and no `process.env` in any `packages/iris-*-mcp/src/tools` file.
- **AD-2:**
  - package.json dependencies match: servers depend on `shared`, `all` depends on the five servers, and `client-config` and `shared` import no leaf.
  - The extension reaches `client-config` only as a subprocess (`clientsEngine.ts:3-6`).
- **AD-3:** the `dispatchToolCall` order is `safeParse`, then `resolveProfile`, then `computeGovernanceKey` and the gate, then the context, then the handler. The audit wrapper is `handleToolCall` (`server-base.ts:1236-1460`).
- **AD-5:** `governance-baseline.ts` has 141 keys and hash `1e62c5ad5bf7`.
- **AD-6:** the six-layer cascade matches `governance.ts:27-33`.
- **AD-7:** ENABLE, then DISABLE, then the preset, then visible (`tool-visibility.ts:18-25`). An unknown name warns.
- **AD-9:**
  - `process.cwd()` appears only in `server-manager-source.ts`.
  - The existing SQL clamp already sets `rowsCapped` (`sql.ts:31-35`), which matches the caller-tightens assumption.
- **AD-11:** `errors.ts` defines `IrisConnectionError`, `IrisApiError` and `McpProtocolError`. `ProfileResolutionError` is in `profiles.ts:128`.
- **AD-14:** `BOOTSTRAP_VERSION` is `2159ec9e6f69`, matching the proposal. `ipm/module.xml` is at 0.1.0 with `Configure`, as AD-14 and AD-31 expect.
- **AD-16:** `execute.ts:581,666-673` returns the `running` envelope.
- **AD-31:** `Setup.cls:61,77` sets `AutheEnabled=32`, with no `MatchRoles`.
- **Stack:** pnpm 9.15.0. The Changesets `fixed` group is `[["@iris-mcp/*"]]`.
