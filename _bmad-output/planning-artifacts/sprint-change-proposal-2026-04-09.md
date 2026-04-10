---
date: 2026-04-09
author: Mary (Business Analyst)
project: iris-execute-mcp-v2
scope: Moderate
triggering_issue: Beta user — Claude Desktop rejects tool names containing dots
resolution: Create Epic 9 — flatten tool names from `iris.x.y` to `iris_x_y`
status: Approved — 2026-04-09
routing: /epic-cycle 9
---

# Sprint Change Proposal — Tool Name Flattening (Dots → Underscores)

## 1. Issue Summary

**Trigger:** A beta user attempted to install the IRIS MCP v2 suite in **Claude Desktop** and received *"tool name not valid"* errors. The user reported that Claude Desktop requires tool names to match `[A-Za-z0-9_]` — no periods allowed.

**Discovery context:** The project is code-complete across Epics 1–8 (all `done`, retrospectives complete) and sitting on the launch pad awaiting first npm publish. The defect was found during beta testing after Story 8.6 (the @iris-mcp/all meta-package) was merged.

**Root cause — confirmed via Perplexity research:**

- **MCP Specification (2025-03-26)** permits dots: `^[a-zA-Z0-9._-]{1,128}$` ([modelcontextprotocol.io/specification/draft/server/tools](https://modelcontextprotocol.io/specification/draft/server/tools))
- **Anthropic Messages API `tools[].name`** is stricter: `^[a-zA-Z0-9_-]+$` — **no dots allowed**
- **Claude Desktop** passes the tool list directly to the Messages API, so dotted names are rejected at registration time before ever reaching the model
- **Claude Code** silently rewrites dots to underscores in its `mcp__{server}__{tool}` prefix. This is why the defect was invisible during development — Claude Code was transparently normalizing the names
- Upstream discussion of this spec/client divergence: [SEP-986](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/986), [claude-code#19882](https://github.com/anthropics/claude-code/issues/19882), [claude-code#22138](https://github.com/anthropics/claude-code/issues/22138)

**Evidence:**

- Beta user bug report (verbatim, via Josh)
- Grep of `packages/*/src/tools/` confirms all 85 tool definitions use the `iris.namespace.verb` dot pattern
- `npm view @iris-mcp/dev` returns 404 — confirmed unreleased, no external consumers of the dotted names
- Per-package `package.json` files all at `0.0.0` or `0.0.1` (pre-publish state)

**Classification:** *Technical limitation discovered during beta testing.* The MCP ecosystem is inconsistent about tool-name validation, and the dot convention sits in the narrow gap where the spec allows it but the dominant client (Claude Desktop) does not. This is a **release blocker** for any client that routes through the Anthropic Messages API.

---

## 2. Impact Analysis

### 2.1 Epic Impact

| Epic | Status | Impact |
|---|---|---|
| Epic 1 — Shared Infrastructure | done | Test fixtures reference tool names (~2 files in `packages/shared/src/__tests__/`) |
| Epic 2 — iris-dev-mcp | done | 9 tool files (~31 names) + test files |
| Epic 3 — Custom REST + execution | done | TypeScript-side rename only; ObjectScript REST endpoints are independent and unaffected |
| Epic 4 — iris-admin-mcp | done | 10 tool files (~26 names) + test files |
| Epic 5 — iris-interop-mcp | done | 8 tool files (~19 names) + test files |
| Epic 6 — iris-ops-mcp | done | 6 tool files (~16 names) + test files |
| Epic 7 — iris-data-mcp | done | 3 tool files (~7 names) + test files |
| Epic 8 — Documentation & Release | done | **Package READMEs will need update** — 5 files, ~200 tool-name references |

**Verdict:** No epic requires structural reopening. The scope of every epic (what tools exist, what they do, what arguments they take) is unchanged. Only the *surface identifier* changes. Therefore this is handled as a **new standalone Epic 9** — a pre-publish cleanup epic — rather than reopening any existing epic's `done` state.

### 2.2 Artifact Conflicts

Full blast-radius investigation (run via Explore agent, 2026-04-09):

| Bucket | Files | Approx. occurrences | Change type |
|---|---|---|---|
| Tool definitions | 36 files in `packages/*/src/tools/` | 85 | `name: "iris.x.y"` → `name: "iris_x_y"` |
| Test files | 46 `*.test.ts` files under `packages/**/__tests__/` | ~383 | Mechanical rename in assertions, mocks, describe blocks |
| Shared infrastructure | 5 files under `packages/shared/src/` | ~85 | Tool-type tests, server-base tests, bootstrap references |
| Package READMEs | 5 files (`packages/*/README.md`) | ~200 | Update tool tables, usage examples (Story 8.2 output) |
| Planning artifacts (living) | `architecture.md`, `prd.md`, `epics.md` | ~300 | Mechanical rename of tool-name references |
| Planning artifacts (snapshots) | product brief, implementation-readiness report, 2026-04-06 sprint-change-proposal | ~280 | **Leave untouched** — historical records frozen in time |
| Client config docs | `docs/client-config/*.md` | 0 | ✅ Already clean — MCP client configs reference the server binary, not individual tool names |
| Bootstrap generator | `scripts/gen-bootstrap.mjs` | 0 | Generator is dynamic; verify output after rename by running `gen:bootstrap` |
| Root CHANGELOG | (does not exist) | — | **Create** to document the pre-release breaking change |
| CI workflows | `.github/workflows/` | (none exist) | N/A |

**Other artifacts unaffected:**

- ObjectScript classes (`src/**/*.cls`) — the IRIS-side REST service is separate from the MCP tool naming layer
- `.mcp.json` — references servers, not tools
- UI/UX specs — none exist (CLI/MCP server suite)

### 2.3 Technical Impact

- **Breaking change for beta users** who cloned the repo and scripted against the dotted names. The user base is small (per the recent "clone-from-repo install instructions" commit, most beta users are pointing their MCP client at a local checkout). A CHANGELOG entry and a note in the pre-release banner README is sufficient notification.
- **Zero impact on Claude Code users** — Claude Code was already rewriting dots to underscores under the hood. Any existing prompts referencing `mcp__iris_dev_mcp__iris_doc_get` (the Claude-Code-rewritten form) will continue to work unchanged after the rename.
- **Positive impact on Claude Desktop users** — unblocks the entire ecosystem target, which was the motivating reason for building a client-agnostic MCP suite.

---

## 3. Recommended Approach

**Selected path: Option 1 — Direct Adjustment (standalone Epic 9).**

### 3.1 Options evaluated

| Option | Viability | Notes |
|---|---|---|
| **Option 1: Direct adjustment** (new standalone Epic 9) | ✅ **Selected** | All 8 existing epics remain `done`. Epic 9 captures the cleanup cleanly with its own retrospective. |
| **Option 2: Rollback** | ❌ Not viable | Nothing to roll back; the work is correct, only the naming convention needs to shift |
| **Option 3: MVP review** | ❌ Not needed | MVP scope is unchanged; tool count (85) and capability are identical |

### 3.2 Effort, risk, and timeline

- **Effort:** Low-Medium. ~95% of the work is mechanical regex replace. ~5% is the regression-guard test + the architecture rationale note.
- **Risk:** Low. Pre-release (no npm publish → no external consumers). No collision risk — tool names remain unique across all 5 servers after the dot-strip. Existing test suite catches any missed references.
- **Timeline:** Zero delay to launch. Epic 9 is a *prerequisite* to first npm publish, so it is on the critical path but does not extend it.

### 3.3 Rationale for flat (`iris_x_y`) over server-scoped (`iris_dev_x_y`)

Developer chose **flat** on 2026-04-09. Justification:

- Tool names are already unique across all 5 servers even after the dot-strip (verified via grep)
- Server namespacing is already handled by the MCP client's automatic `mcp__{server}__{tool}` prefix
- Flat names read more like conventional identifiers and keep the rename one-dimensional
- Adding a server prefix would be a second renaming dimension (scope) on top of the character swap, increasing risk and review surface for no functional benefit

---

## 4. Detailed Change Proposals

### Change 1 — Rename all 85 tool identifiers

Apply pattern replace across `.ts` files in `packages/*/src/tools/`:

```
Pattern:  name:\s*"iris\.([a-z_]+)\.([a-z_]+)"
Replace:  name: "iris_$1_$2"
```

Example transforms:

```
name: "iris.doc.get"         →   name: "iris_doc_get"
name: "iris.task.manage"     →   name: "iris_task_manage"
name: "iris.config.manage"   →   name: "iris_config_manage"
name: "iris.execute.command" →   name: "iris_execute_command"
```

The `iris_` prefix is preserved. Server namespacing remains the MCP client's responsibility via its `mcp__{server}__` prefix.

### Change 2 — Update all test files

46 `*.test.ts` files under `packages/**/__tests__/`. Mechanical rename in:
- String literals matching tool names in assertions
- Mock fixture data
- `describe()` / `it()` block descriptions that reference tool names

No test **logic** changes. If the existing test suite passes before and after the rename, the change is proven correct.

### Change 3 — Regenerate the 5 package READMEs

Files: `packages/{iris-dev-mcp,iris-admin-mcp,iris-interop-mcp,iris-ops-mcp,iris-data-mcp}/README.md`.

Mechanical replace across tool tables, usage examples, and backticked inline references. Narrative content stays identical (this is Story 8.2's output, only the identifier strings change).

### Change 4 — Update `architecture.md`

Two edits:

1. **Mechanical rename** of all tool-name references (confirmed at least one at line 447: `iris.doc.get`)
2. **Add a new subsection** titled **"Tool naming convention"** with this exact text:

   > Tool names use the flat `iris_<domain>_<verb>` pattern (lowercase ASCII + underscores). This convention matches the Anthropic Messages API `tools[].name` regex `^[a-zA-Z0-9_-]+$`, which is stricter than the MCP specification (the MCP spec permits dots, hyphens, and dots-plus-underscores). Claude Desktop routes tool registrations through the Anthropic Messages API and rejects dotted names at registration time. Claude Code silently rewrites dotted names to underscores as part of its internal `mcp__{server}__{tool}` prefixing, but other MCP clients may not. The flat underscore convention is the only naming style that works reliably across all current MCP clients in the ecosystem.

### Change 5 — Update living planning artifacts

Files: `prd.md`, `epics.md`. Mechanical rename of tool-name references only. **No prose or acceptance-criteria changes** — only the string identifiers that appear in prose examples.

### Change 6 — Leave dated snapshots untouched

Per the developer's explicit instruction on 2026-04-09, the following historical snapshot documents are preserved as point-in-time records and will NOT be updated:

- `product-brief-iris-execute-mcp-v2.md` and `-distillate.md`
- `implementation-readiness-report-2026-04-05.md`
- `sprint-change-proposal-2026-04-06.md`
- Previous epic retrospectives

### Change 7 — Add regression guard test

New file: `packages/shared/src/__tests__/tool-naming.test.ts`.

Test logic:

1. Iterate all tools registered across all 5 servers (via a bootstrap or test harness import)
2. Assert every `tool.name` matches `/^[a-z0-9_]{1,64}$/`
3. Assert tool names are unique across the suite (no collisions after the flatten)

**Purpose:** Prevent any future regression from ever landing. This test is the durable guarantee that Epic 9's fix sticks.

### Change 8 — Verify `bootstrap-classes.ts` is not stale

Per existing feedback memory (`feedback_bootstrap_drift_check.md`): run `npm run gen:bootstrap` and inspect the diff. Bootstrap embeds ObjectScript classes — not MCP tool names — so this is **expected to be a no-op**, but must be verified before npm publish.

### Change 9 — Create root `CHANGELOG.md`

First entry:

> **[Pre-release breaking change — 2026-04-09]**
> Tool names changed from dot notation (e.g. `iris.doc.get`) to flat underscore notation (e.g. `iris_doc_get`).
> **Why:** Anthropic Messages API and Claude Desktop reject tool names containing dots. This was caught in beta testing prior to first npm publish. Flat underscore naming is the only convention that works across all current MCP clients.
> **Who is affected:** Beta users who scripted against the old names using Claude Desktop or any client routing through the Anthropic API. Claude Code users are unaffected — Claude Code was already rewriting dots to underscores internally.

### Change 10 — Update clone-install pre-release banner

File: root `README.md` (the pre-release banner added in commit `5851d6a`). Add one line pointing at the CHANGELOG entry so beta users pulling fresh see the rename note.

---

## 5. Implementation Handoff

**Scope classification:** **Moderate.**

- Not *Minor* because it crosses 100+ files and touches public artifacts (READMEs, architecture docs)
- Not *Major* because no requirements, architecture, or epic scope change — it's a mechanical rename with a documented rationale

### 5.1 Epic 9 structure

**Epic 9 — Tool Name Flattening for Anthropic API / Claude Desktop Compatibility**

Three stories:

- **Story 9.1 — Rename tool identifiers in source and tests**
  Scope: `packages/*/src/tools/**/*.ts` and all `packages/**/__tests__/**/*.test.ts`. Pure mechanical rename + full test-suite pass.

- **Story 9.2 — Update documentation and add regression guard**
  Scope: package READMEs (5), `architecture.md` (including the new "Tool naming convention" subsection), `prd.md`, `epics.md`, new `tool-naming.test.ts` regression guard, `CHANGELOG.md` creation, clone-install banner update.

- **Story 9.3 — Beta-user notification and pre-publish smoke test**
  Scope: Run full integration/smoke tests against a live IRIS instance using the renamed tools, perform a Claude Desktop installation smoke test (either internally or coordinated with the reporting beta user) to confirm the error is resolved, and confirm `gen:bootstrap` produces a clean diff.

### 5.2 Routing

**Primary routing: `/epic-cycle 9`**

The epic-cycle workflow will:

1. Run `/bmad-sprint-planning` (step 0)
2. Create Story 9.0 (Epic 8 deferred cleanup triage) per step 0.5 — this is automatic and independent of the rename work
3. Execute stories 9.1, 9.2, 9.3 in sequence via the dev-agent + code-review-agent pipeline
4. At epic completion, pause at Step 5 and ask the developer whether to run a retrospective

**Retrospective:** The developer has pre-approved a **separate retrospective for Epic 9** (distinct from Epic 8's existing retrospective). Answer `yes` at the Step 5 prompt.

### 5.3 Success criteria

- All 85 tool names match `/^iris_[a-z0-9_]+$/` — verified by new regression test
- Full test suite passes (unit + integration)
- New regression test exists in `packages/shared/src/__tests__/tool-naming.test.ts`
- `architecture.md` contains the "Tool naming convention" subsection with the exact text from Change 4
- `CHANGELOG.md` exists at repo root with the Change 9 entry
- Claude Desktop smoke test confirms the suite installs without the "tool name not valid" error
- `gen:bootstrap` produces a clean diff (or any new diff is understood and intentional)
- After Epic 9 is `done`, npm publish path is unblocked

### 5.4 Out of scope

- Historical snapshot cleanup (explicitly excluded per developer decision)
- Reopening or amending any prior epic retrospective
- Any tool capability or signature change
- Any rename beyond the dot-strip character swap (no server-scoping, no hyphens)
