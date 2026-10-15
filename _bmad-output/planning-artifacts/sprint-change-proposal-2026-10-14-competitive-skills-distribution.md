# Sprint Change Proposal — 2026-10-14 (competitive P1 gaps, companion skills pack, published install)

**Trigger:** Project Lead decision record [decision-record-2026-10-14-distribution-and-skills.md](decision-record-2026-10-14-distribution-and-skills.md), built on the competitive teardown [research/competitive-iris-agentic-dev-mcp-tools-gap-analysis-2026-10-14/research.md](research/competitive-iris-agentic-dev-mcp-tools-gap-analysis-2026-10-14/research.md) (iris-agentic-dev at `b6205bb`, ours at `fb676dc`).
**Facilitator:** correct-course (Developer agent) · **Project Lead:** Developer
**Mode:** Batch (chosen 2026-10-14) · **Scope classification:** **Moderate** — five new epics (38–42) and amendments to the PRD, architecture, epics, tracker and ledger. The MVP is unchanged and nothing is rolled back. One reversal of a standing decision: CI/CD is built now instead of "deferred to post-MVP" (D7).
**Approval:** APPROVED 2026-10-14 (Project Lead), with L-1 to L-4 resolved as recommended:

- **L-1:** one wave branch per group (wave-6 for Epics 38–40, wave-7 for 41, wave-8 for 42);
- **L-2:** PHI policy default `redact`;
- **L-3:** add the read-classified `iris_sql_query`;
- **L-4:** both new interop tools join interop `core`, and `iris_doc_edit` and `iris_sql_query` join dev `core`. The 13-tool `core` figure is a guideline, not a hard limit.

**Applied 2026-10-14:** every item in §4.1–§4.7. Results are recorded under each section and in §5. The changes are uncommitted; the Lead commits.

---

## 1. Issue Summary

The Project Lead decided three groups of work on 2026-10-14, to be planned in this order:

1. **Close the P1 competitive gaps** from the iris-agentic-dev teardown. These are G1, G2 and G5 (agent code editing), G32–G35 plus G50 (interop message forensics), G21 and G22 (SQL write safety), G23 then G24 (test depth), and G48 (our own broken `--transport http`). G8, G17, G41, G45 and G47 are declined, with reasons in the gap register.
2. **Ship our own companion skills and rules pack.** It has one always-on ObjectScript pre-write rule, about 6–10 knowledge skills, and the 11 generated workflow skills plus new ones for the P1 tools. Competitor content is adapted only under its MIT notice.
3. **Replace "clone and build" with a published install:** npm `1.0.0` with no beta tag, a `@1` major pin, Node 22+, the VS Code extension on both stores, IPM revived, and CI built before the first release. This goes last because its Claude Code plugin ships the skills pack.

**Why now:** nothing is published, so every `npx -y @iris-mcp/<pkg>` path in `client-config` (`synthesize.ts:126`) and the extension (`serverDefinitionProvider.ts:69`) fails. The registry returns 404. The competitor ships a working edit/compile/test loop and interop message forensics that we lack (research §Gap register).

**Evidence re-verified against the source before planning (Rules #14/#47), 2026-10-14:**

| Claim in the record | Verified | Note |
|---|---|---|
| `--transport http` throws (G48) | ✓ `packages/shared/src/server-base.ts:2165-2173` ("HTTP transport not yet implemented"); `transport.ts:9-26` accepts `http` | PRD FR7 (`prd.md:440`) still promises Streamable HTTP |
| Root `engines` claims `>=18`; dev needs Node 22 | ✓ `package.json:37-39`; `load.ts:12` imports `globSync` | No package declares `engines.node` |
| `@iris-mcp/all` ships nothing | ✓ `"files": []`, no `bin` (`packages/iris-mcp-all/package.json:6`) | |
| `test-helpers` exports point at `src/` | ✓ `packages/shared/package.json:17-24` (two subpaths, not one) | DW-506 |
| Versions diverge | ✓ `client-config` 0.0.1; the other 7 at 0.0.2; launcher 0.1.0 | Changesets already has `fixed: [["@iris-mcp/*"]]`; **22 changesets are pending** |
| No license/repository/author | ✓ none of the 8 `@iris-mcp/*` manifests has them (the launcher does) | Root `LICENSE` is MIT © 2026 jbrandtmse |
| Unpinned `npx` | ✓ `synthesize.ts:126`; `serverDefinitionProvider.ts:69` | DW-260 |
| Wrong `npx` command in the client-config README | ✓ `packages/client-config/README.md:17` | |
| Broken `zpm` fallback; stale IPM manifest | ✓ `bootstrap.ts:95-96`; `ipm/module.xml` has 18 `<Resource>` at `<Version>0.1.0` | The record says 29 embedded classes. A grep of `gen-bootstrap.mjs` finds 30 `.cls` mentions; Story 42.4 pins the count mechanically (Rule #51) |
| No CI | ✓ no `.github/workflows/`; OcuPilot's `ci.yml`, `ci-throwaway.sh` and `ci-ipm-archive.sh` are present at `../OcuPilot` | |
| Client adapters | **16**, not 13: `adapters.ts` has claude-code, claude-desktop, cursor, vscode, cline, roo-code, windsurf, codex, gemini, zed, goose, kimi, kimi-code, pi, jetbrains-junie, kilo-code | PRD FR141 still says 13. The installer story covers all 16 (Rule #56) |
| `iris_doc_put` ignores conflicts? (competitor defect) | ✗ for ours: we send `ignoreConflict=1` only on request (`doc.ts:184,215`) | Our conflict check exists. The line-edit tool must keep it |
| Tool counts and `core` sizes | dev 29 / admin 26 / interop 22 / ops 21 / data 7. Dev `core` = 12 + framework = 13 runtime; interop `core` = 9 + 1 = 10 | Built dists, 2026-10-14. The 13-tool `core` figure is a **guideline, not a hard limit** (Project Lead, 2026-10-14) |

**Found during this analysis: a tracker time bomb.** The `/epic-cycle` kit installed today (`b79a173`, BMAD 6.11 pipeline) writes `sprint-status.yaml` only through `sprint_plan.py generate`, which derives each key from the exact heading slug. The tracker's keys were hand-abbreviated by the earlier LLM sprint planner: `1-1-…-and-package-structure` for a heading slugging to `…-package-structure`, `10-1-iris-package-list` for `` `iris_package_list` — Package Listing … ``. Fifteen runtime X.0/cleanup stories also had no heading at all. A dry-run `generate` showed that the first real write would **drop 159 `done` keys** and re-add 144 of them as `backlog`. The first `/epic-cycle` run on Epic 38 would have done exactly that, and `ledger.sh` refuses any owner that is not a tracker key. The Lead approved reconciling now; see §4.2(a).

**Issue type:** a strategic direction decided by the Project Lead, from competitive research, plus a release-readiness reversal of the deferred publish. Neither is a defect, apart from G48 and the tracker finding.

---

## 2. Impact Analysis

### Epic impact

- **No in-flight epic.** Epic 37 is `done` and its retrospective `optional`. Epics 1–37 are unchanged in substance.
- **Adds Epics 38–42**, run sequentially in the record's order: **38** code editing and write safety, **39** interop message forensics, **40** test depth, **41** skills and rules pack, **42** published install. Story numbers start at **N.1** in every epic; **N.0 is left free** for `/epic-cycle`'s retro-review gate, which inserts it (`.claude/commands/epic-cycle.md:399-401`).
- **The Epic 38 gate (38.0) inherits Epic 37's transferred Rule #37 obligation** (Epic 37 preamble, Lead exception L-5 of 2026-09-16). That obligation was measured before the ledger moved to the DW grammar (`fb676dc`). The gate re-measures through `ledger.sh load` and drains under Rule 17. This proposal settles 13 of the 136 non-terminal entries (§4.3). Twelve move to named Epic 42 story owners and one goes terminal, so they leave the gate's decision sheet.

### Story impact

No existing story changes. 32 new stories:

| Epic | Stories |
|---|---|
| 38 | 6 |
| 39 | 6 |
| 40 | 4 |
| 41 | 7 |
| 42 | 9 |

Five gate stories (38.0–42.0) are created at run time.

### Artifact conflicts

- **PRD:**
  - FR7 promises Streamable HTTP, which conflicts with G48 → reject.
  - Language & Runtime says Node 18/20/22, which conflicts with D4 → Node 22+.
  - Installation & Distribution predates D1–D7.
  - New FRs are needed (FR146–FR160).
  - FR141's "13-client" registry is stale at 16. It's noted, not rewritten, because it is history.
- **Architecture:**
  - "Node.js 18+ LTS" (`:73`) conflicts with D4.
  - "CI/CD pipeline (GitHub Actions) deferred to post-MVP" (`:351`) conflicts with D7.
  - The open item "Streamable HTTP transport server config (resolve in Epic 1)" (`:1065`, `:1112`) is closed by G48.
  - It needs one new dated decision record.
- **epics.md:** Epics 38–42 are appended, and the 15 heading stubs are already applied.
- **sprint-status.yaml:**
  - The key reconciliation is already applied.
  - The new keys arrive through `generate` after approval.
- **deferred-work.md:** 13 trailers, written through `ledger.sh` only.
- **`_bmad/custom/branch-naming.yaml`:** the ACTIVE comment changes per L-1. It is comment only.
- **UX:** no UX document exists. The extension UI is unchanged; only its publisher and launch pin change (Epic 42).

### Technical impact

- **ObjectScript and bootstrap:** `BOOTSTRAP_VERSION` (`2159ec9e6f69` at Epic 37 close) moves in every story that adds or edits a bootstrapped class, within that same story (Rule #24). These are likely 38.3 and 38.5 (pending probe), 39.1 and 39.3–39.5, 40.1 and 40.3, and 42.2, which changes the version scheme itself. A new class enters both rosters (Rule #39).
- **New tools:**

  | Tool | Server | Classification |
  |---|---|---|
  | `iris_doc_edit` | dev | write, `defaultEnabled` (S-3) |
  | `iris_sql_query` | dev | read, if L-3 |
  | `iris_message_search` | interop | read |
  | `iris_message_body` | interop | read |

  Every one carries `mutates` (Rule #28) and a visibility disposition (Rule #53). `GOVERNANCE_BASELINE` stays frozen at `1e62c5ad5bf7`/141, checked with `:check` only (Rules #23/#25).
- **Behavior changes:** each is documented and pinned. The `iris_doc_put` storage guard refuses a put that drops a Storage block, and L-2 may change the existing `iris_message_resend` preview body summary. Everything else is additive, with mechanical back-compat proofs (Rule #19).
- **Shared IRIS instance:** other projects use it, and it is never stopped. LineByLine coverage (instance-wide monitor), TestProduction runs (production start/stop), and any message-body fixture work run only in disposable namespaces or under explicit refuse-if-busy guards. CI never touches it: the throwaway refuses the live ports.
- **Runtime floor:** Node 22+. Nothing is published, so no installed consumer breaks.

---

## 3. Recommended Approach

**Direct adjustment:** add Epics 38–42. No rollback and no MVP reduction.

**Ordering rationale:**

- The groups follow the record's order. Group 3 goes last because its plugin (42.8) ships Group 2's pack, and its README and re-certification (42.9) describe the finished surface.
- Inside Group 1:
  - **Epic 38 first.** It carries the "fix now" G48 rejection as 38.1, and it touches only `@iris-mcp/shared` and `iris-dev-mcp`.
  - **Epic 39 next.** It is the largest, and its PHI policy (39.2) must exist before any body-reading story.
  - **Epic 40 last.** Its shared-instance coverage risk benefits from 38 and 39's live-gate harness.
- The SQL write-safety story set and the G48 fix are not epics in the record, so they sit in Epic 38 under its "safe agent writes" theme.

**Effort (story count, not time):** 32 stories plus 5 gates. Epic 42 needs Project Lead accounts (npm organization with 2FA, VS Code Marketplace publisher, Open VSX namespace, InterSystems Developer Community, GitHub environment and trusted publishing), each needed only when its story comes up.

**Risks:**

1. **Package scope (D1 fallback):** `@iris-mcp/*` is already baked into every pin, doc and test. If the `iris-mcp` npm organization is unavailable, the fallback personal scope means a rename story. *Create or confirm the organization before 42.1 starts.*
2. **DW-508 is HIGH with high fix-risk.** It gets a dedicated story (42.2) and must land before 42.6 publishes.
3. **PHI policy correctness (39.2).** The redaction field list must be exhaustive as of a dated source (Rule #56), and the docs must not claim compliance.
4. **Shared-instance safety** for coverage and TestProduction (see Technical impact).
5. **CI on GitHub runners** pulls a pinned `iris-community` / `irishealth-community` image. The Docker setup is adapted from OcuPilot, not copied.
6. **The Rule #37 drain at the Epic 38 gate** may charter a large burn-down before 38.1 runs.

### Decisions recorded this session (Project Lead, 2026-10-14)

- **S-1 — Tracker reconciliation:** reconcile now (applied, §4.2(a)).
- **S-2 — G48:** reject `--transport http` cleanly now. A real Streamable HTTP transport goes to the P2 list, because it needs an auth, bind-address and session design first; the competitor's HTTP endpoint has no auth.
- **S-3 — G2 line edits:** a **new tool `iris_doc_edit`, enabled by default.** It ships `mutates: "write"` plus the orthogonal `defaultEnabled` marker. That is Rule #32's mechanism, never a read misclassification and never a frozen-baseline entry. This **extends Rule #32's stated use**, which was recovery tooling, to an ergonomic write, by Lead decision; Story 38.4 cites S-3 wherever it relies on it. It stays blocked by `IRIS_GOVERNANCE_PRESET=read-only`, as every `defaultEnabled` write is (FR132).
- **S-4 — Mode:** Batch.

### Open decisions for approval (each has a recommended default)

- **L-1 — Branching:** recommend one wave branch per group, each cut off `main`, with epic branches `epic38`…`epic42` under them per `branch-naming.yaml`:
  - `feature/feature-wave-6-competitive-gaps` (Epics 38–40);
  - `feature/feature-wave-7-skills-pack` (41);
  - `feature/feature-wave-8-published-install` (42).
- **L-2 — PHI policy default:** recommend **`redact`** as the default policy everywhere:
  - HL7 v2 bodies are redacted field by field against a dated, sourced PHI field list;
  - bodies the policy cannot redact reliably (non-HL7 persistent objects, streams, XML) are **blocked** under `redact`, with a reason;
  - `allow` and `block` are explicit per-profile choices.

  **Consequence:** the existing `iris_message_resend` preview `bodySummary` falls under the policy. Under the default it changes, and under `allow` it stays byte-identical to today. The alternative is default `allow`: strictly additive, but no protection until an operator opts in. The pre-1.0 window is the cheap time to choose the safer default.
- **L-3 — SQL reads under the `read-only` preset:** today `iris_sql_execute` is a baseline **write**, so `read-only` blocks every query, SELECT included. Recommend Story 38.5 also add a **read-classified `iris_sql_query`** that enforces read-only server-side, the only shape in which `read-only` setups can still query. The alternative is the `readOnly` mode on `iris_sql_execute` only, with no new tool (the tool count stays at 30).
- **L-4 — `core` visibility of the new tools.** The Project Lead confirmed on 2026-10-14 that `core`'s 13 runtime tools per server is a guideline, not a hard limit. A tool that belongs in the everyday loop goes into `core` even when that passes 13. Recommend:
  - **interop `core` includes `iris_message_search` + `iris_message_body`** as a `TOOL_PAIRS` pair (10 → 12 runtime);
  - **dev `core` includes `iris_doc_edit`**, in a new `TOOL_PAIRS` pair with `iris_doc_get`, because edits are addressed by `iris_doc_get`'s line numbers (13 → 14 runtime);
  - **dev `core` includes `iris_sql_query`** if L-3 is approved, so `core` setups under the `read-only` preset can still query (14 → 15 runtime).

  Each story records the resulting `core` size and why the tool is everyday-loop (Rule #53). No existing `core` tool is removed.

---

## 4. Detailed Change Proposals

### 4.1 — `epics.md` — append after the end of file (after Epic 37's `**Out of scope**` footer)

The block between the markers is appended verbatim on approval.

<!-- BEGIN epics.md append (sprint-change-proposal-2026-10-14) -->

# Competitive Response, Skills Pack & Published Install (Epics 38–42 — added 2026-10-14)

Source: the Project Lead decision record [decision-record-2026-10-14-distribution-and-skills.md](./decision-record-2026-10-14-distribution-and-skills.md) and the competitive teardown [research/competitive-iris-agentic-dev-mcp-tools-gap-analysis-2026-10-14/research.md](./research/competitive-iris-agentic-dev-mcp-tools-gap-analysis-2026-10-14/research.md) (gap IDs `G<n>` resolve in its gap register). See [sprint-change-proposal-2026-10-14-competitive-skills-distribution.md](./sprint-change-proposal-2026-10-14-competitive-skills-distribution.md) for the Lead decisions S-1 to S-4 and L-1 to L-4 cited below. All were approved 2026-10-14 as recommended:

- L-1: one wave branch per group;
- L-2: PHI policy default `redact`;
- L-3: add the read-classified `iris_sql_query`;
- L-4: the new interop tools and the new dev tools join `core`.

The epics run in order 38 → 42.

**Shared by every epic in this wave:**

- Story numbers start at N.1. N.0 is left free for `/epic-cycle`'s retro-review gate, which inserts it.
- **Branching (L-1).** One wave branch per group, each cut off `main` when its first epic starts:
  - `feature/feature-wave-6-competitive-gaps` for Epics 38–40;
  - `feature/feature-wave-7-skills-pack` for Epic 41;
  - `feature/feature-wave-8-published-install` for Epic 42.

  Epic branches are `epic{N}`, per `_bmad/custom/branch-naming.yaml`. At the SC-1 prompt, name the wave branch.
- **Probe before building.** Each story verifies its API claims live before coding (Rules #14/#16/#47) and amends this text in place if a claim is wrong.
- **Classification and visibility.** A new tool or action carries `mutates` (Rule #28) and a visibility disposition in every preset (Rule #53).
- **Bootstrap discipline.** A story that changes a bootstrapped class regenerates the embed in the same story and records `BOOTSTRAP_VERSION` from → to (Rule #24). A new class enters both rosters (Rule #39).
- **Frozen baseline.** `GOVERNANCE_BASELINE` stays frozen at `1e62c5ad5bf7`/141, checked with `:check` only (Rules #23/#25).
- **Live proof.** Endpoint-backed stories smoke the live HTTP route, including one destructive-path refusal (Rule #26). Every gate is proven red on the path it guards (Rule #59).
- **Shared IRIS instance.** Other projects use it, and it is never stopped. Writes go only to disposable `ExecuteMCPv2.Temp.*` classes, tables and namespaces, which the story removes afterwards. Message-body fixtures are synthetic only; a story never reads another project's messages.

## Epic 38: Agent Code Editing & Write Safety (added 2026-10-14)

**Goal:** An agent can read a document by line range, change only the lines it means to change under an expected-text check, and cannot silently drop a class's Storage block. SQL writes can be confined to read-only or capped by rows affected. The suite no longer accepts a transport it cannot run.

**Context:** P1 gaps G1, G2, G5, G21 and G22 (SQL write safety, a story set), and G48 (our own defect), from research recommendations 1, 3 and 5. The competitor's `iris_doc` modes `fragment`, `insert`, `delete_lines` (with a `STALE_CONTENT` guard) and its storage guard are their implementation (research [3]). Their put ignores conflicts. Ours does not (`doc.ts:184,215`), and our line edits keep that check. `iris_sql_execute` runs any DML with no limit; it is a frozen-baseline write, so the `read-only` preset blocks even SELECTs (research [26]; `baseline-classifications.ts:204`).

**Constraints:**

- `iris_doc_edit` is a new write tool enabled by default (Lead decision S-3, extending Rule #32's `defaultEnabled` beyond recovery tooling). It must never be classified `read`, never enter the frozen baseline, and stays blocked under `IRIS_GOVERNANCE_PRESET=read-only`.
- `core`'s 13 runtime tools per server is a guideline, not a hard limit (Project Lead, 2026-10-14). `iris_doc_edit` and `iris_sql_query` join dev `core` (L-3, L-4). Each story records the resulting `core` size and why the tool is everyday-loop. No existing `core` tool is removed.

**Out of scope:**

- Implementing Streamable HTTP. That is a P2 candidate that needs an auth design (S-2).
- Server-side source control (G4, P2).
- Compile-by-wildcard (G6).
- Inline multi-document fetch (G3).
- A storage guard on `iris_doc_load`. 38.3 records it as a candidate with a reopen trigger.

### Story 38.1: Reject the Unimplemented HTTP Transport

G48, "fix now" (S-2). Pure TypeScript in `@iris-mcp/shared` plus the five entry points. No tool, key or bootstrap change.

- **AC 38.1.1** — Root cause confirmed and recorded:
  - `resolveTransport()` (`packages/shared/src/transport.ts:9-26`) accepts `http` from the environment variable and the CLI flag;
  - `McpServerBase.start()` reaches `server-base.ts:2165-2173` and throws "HTTP transport not yet implemented" after startup work has begun.

  Record the variable and flag names exactly.
- **AC 38.1.2** — `http`, and any value other than `stdio`, is rejected at **configuration time**: inside `resolveTransport`, before any IRIS traffic. The error names the value, says stdio is the only supported transport, and exits non-zero, the same fail-fast class as the other configuration errors (architecture M1). The dead HTTP branch in `start()` is removed and its signature narrows to `stdio`.
- **AC 38.1.3** — Back-compat (Rule #19): with no transport configured, or `stdio`, startup behavior and the startup fetch sequence are byte-identical to today, pinned with `toEqual`. The 38 `stageDefaultStartup` test files pass unmodified.
- **AC 38.1.4** — Unit tests cover the environment and flag forms of `http` and an unknown value: message, exit, and no fetch. Reverting the fix turns them red on the real entry path, `resolveTransport` as called by each `index.ts` (Rule #59).
- **AC 38.1.5** — Live check: launch the built `iris-dev-mcp` dist in a fresh Node process with the transport set to `http`, `IRIS_HOST=127.0.0.1` and `IRIS_PORT=9`. It exits with the message and opens no connection.
- **AC 38.1.6** — Docs: every mention of Streamable HTTP or `--transport http` is listed with a verdict (Rule #56). That covers the root README, the five server READMEs and `docs/client-config/*`. `CHANGELOG.md` and a changeset are updated. A real HTTP transport is filed through `ledger.sh new` as `decision-pending`, with `note=human=` naming the auth design it needs.
- **AC 38.1.7** — Gates:
  - `pnpm turbo run build test lint type-check` passes;
  - governance `:check` exits 0;
  - tool counts are unchanged;
  - `bootstrap-classes.ts` is absent from the diff.

### Story 38.2: Line-Range Document Read

G1. `iris_doc_get` gains an optional line range. The read key is unchanged and no tool is added.

- **AC 38.2.1** — Probe and record:
  - the line structure the Atelier `GET /doc` returns for `.cls` (UDL), `.mac`, `.int` and `.inc`;
  - how `metadataOnly` interacts with a range.

  Line numbers are defined once, as 1-based indexes into that `content` array. 38.4 uses the same numbering.
- **AC 38.2.2** — New optional parameters `startLine` and `endLine` (1-based, inclusive):
  - `endLine` past the end clamps to the last line;
  - `startLine` past the end, `startLine > endLine`, or a range combined with `metadataOnly` returns a clear `isError` and never an empty success.
- **AC 38.2.3** — Response:
  - the text form carries line numbers in one documented format;
  - `structuredContent` carries `name`, `startLine`, `endLine`, `totalLines` and the lines.
- **AC 38.2.4** — Back-compat (Rule #19): with neither parameter, the request and the response are byte-identical to today, pinned with `toEqual` against pre-feature output.
- **AC 38.2.5** — Oracle (Rule #36): for a live class over 500 lines, every ranged read equals the matching slice of a full read. Boundary cases (first line, last line, a single line, a clamped end) are pinned from the live capture.
- **AC 38.2.6** — The tool description and docs explain when to use a range: large classes, and a read before `iris_doc_edit`. Minimal docs ship in this story (Rule #43).

### Story 38.3: Storage Block Drop Guard

G5. A cheap safety check on the document write path that 38.4 reuses.

- **AC 38.3.1** — Probe and record, with live captures:
  - how Storage definitions appear in the UDL that Atelier returns (`Storage Default { … }`, several storage definitions, `%Storage.SQL`, classes without one);
  - whether `iris_doc_put` today regenerates storage when it is omitted;
  - the data-layout consequence, on a disposable persistent class with rows.
- **AC 38.3.2** — The guard is one shared function. It takes the current server source and the proposed new source of a `.cls` document, and returns the names of any Storage definitions that the new source drops.
- **AC 38.3.3** — On `iris_doc_put` for an existing `.cls` whose current source has a Storage definition that the new content drops, the tool refuses:
  - with a distinct error code that names the dropped definitions;
  - writing nothing;
  - unless `allowStorageRegeneration: true` is passed.

  Changed storage content is allowed; only a drop is guarded. Non-class documents and new classes never pay the extra read. The parameter is documented with its default (Rule #10).
- **AC 38.3.4** — Back-compat (Rule #19): a put that keeps its storage, targets a non-class document, or creates a new class has a byte-identical fetch sequence and response, pinned. The refusal is the only behavior change. It is recorded in `CHANGELOG.md` as a safety change, anchored to this story.
- **AC 38.3.5** — Live check (Rule #26): on a disposable persistent class with rows:
  - a storage-dropping put is refused, and the row count and the storage definition are unchanged;
  - the override succeeds;
  - the fixture is removed afterwards.

  Fixtures are varied (Rule #58): several storage definitions, CRLF content, a Storage keyword inside a comment or string (which must not count), and a class whose storage was already absent.
- **AC 38.3.6** — `iris_doc_load` is out of scope. It is filed as a `wontfix-accepted` ledger row with `reopen_if=` naming an observable trigger.

### Story 38.4: Surgical Line Edit Tool

G2. New dev tool `iris_doc_edit` (S-3). This story owns applying edits; it reuses 38.2's numbering and 38.3's guard and does not redesign them (Rule #52).

- **AC 38.4.1** — Probe first (Rules #47/#45): verify the research claim that `client-config/src/diff.ts` holds a reusable line-span and diff engine (research [57]). It is a JSONC/YAML/TOML pending-edit renderer, so the probe records whether any part of it is generic. A server never imports `client-config`. Reused code moves into `@iris-mcp/shared`; otherwise a small line-diff utility is written there.
- **AC 38.4.2** — Input: `name`, an `edits` array and optional `namespace`. Each edit is one of:
  - `insert` (`afterLine`, `text`);
  - `delete` (`startLine`, `endLine`);
  - `replace` (`startLine`, `endLine`, `text`).

  Every edit carries `expected`: the exact current text of the lines it addresses, or of the anchor line for an insert. All edits are addressed against the document as read, applied bottom-up, and are all-or-nothing. Overlapping ranges are rejected before any write.
- **AC 38.4.3** — If any `expected` differs from the server's current text, the tool refuses with a `STALE_CONTENT` error, writes nothing, and returns the current text of each mismatched range. The write never uses `ignoreConflict`. A change between our read and our write surfaces as a conflict error and is never retried silently.
- **AC 38.4.4** — 38.3's storage guard applies. An edit that removes a Storage definition is refused unless `allowStorageRegeneration: true` is passed.
- **AC 38.4.5** — Response:
  - a unified diff of the change;
  - a renumbered excerpt around each edit (with a documented number of context lines);
  - the new `totalLines`;

  never the whole document. `structuredContent` mirrors it.
- **AC 38.4.6** — Governance and visibility:
  - `mutates: "write"`, `defaultEnabled` per S-3 (registration-time cross-validation accepts it);
  - annotations truthful and consistent with `iris_doc_put`;
  - disabled under the `read-only` preset (test);
  - absent from the frozen baseline;
  - `developer` and `core` include it (L-4; dev `core` 13 → 14 runtime, a guideline figure);
  - a new `TOOL_PAIRS` pair with `iris_doc_get`, because its edits are addressed by `iris_doc_get`'s line numbers.

  Counts: dev 29 → 30, with advertised and suite counts moving per Rule #31. Docs state "enabled by default", why (S-3), and how to disable it (Rule #30).
- **AC 38.4.7** — Fixtures are varied (Rule #58): CRLF and LF, tabs, a missing final newline, a BOM, an edit at line 1 and at the last line, an empty-text replace, and multi-line `expected`. The live smoke uses a disposable class:
  - a valid edit applies and compiles;
  - a stale `expected` is refused and the document is byte-identical afterwards;
  - a concurrent change is reported as a conflict;
  - the fixture is removed.
- **AC 38.4.8** — Compiling is not part of this tool. The description directs agents to `iris_doc_compile`.

### Story 38.5: SQL Write Safety

G21 with G22 folded in. It changes `iris_sql_execute` (a write key) and adds the read-classified `iris_sql_query` (L-3).

- **AC 38.5.1** — Probe first and record:
  - how `iris_sql_execute` executes today (endpoint, statement path);
  - how to classify a statement reliably. Prefer the statement type from preparing it through `%SQL.Statement` over a keyword blocklist; compare both on adversarial fixtures (comments, string literals containing keywords, CTEs, `CALL`, multi-statement input);
  - whether DML can run inside a transaction and be rolled back by our endpoint, with the effects of triggers and non-transactional side effects;
  - whether a custom endpoint is needed (if so, the bootstrap moves).
- **AC 38.5.2** — Read-only mode:
  - a `readOnly: true` parameter;
  - an operator variable `IRIS_SQL_READ_ONLY` that forces the mode for every call; a parameter cannot weaken it.

  In read-only mode, any non-query statement is refused before execution, naming its statement type.
- **AC 38.5.3** — Rows-affected cap:
  - a `maxRowsAffected` parameter;
  - an operator ceiling `IRIS_SQL_MAX_ROWS_AFFECTED`.

  Enforcement uses the mechanism the probe chose (a transaction, then a check of `%ROWCOUNT`, then rollback over the cap). The refusal reports the row count and the cap. Residual side effects found by the probe are documented.
- **AC 38.5.4** — Every DML result returns `rowCount` (`%ROWCOUNT`), an additive field. `countOnly: true` returns a query's row count without transferring rows (G22).
- **AC 38.5.5** — Defaults: all new controls are off by default, so behavior is byte-identical to today (Rule #19, `toEqual` pin), and the defaults are stated explicitly (Rule #10). The new variables are documented with their defaults (Rule #43).
- **AC 38.5.6** — A new read-classified tool `iris_sql_query` (L-3):
  - server-enforced read-only, using the same statement classification as AC 38.5.2;
  - `mutates: "read"`, so it is enabled by default and available under the `read-only` preset, which a test proves;
  - in the `developer` and `core` presets (L-4; dev `core` 14 → 15 runtime), so `core` setups under the `read-only` preset can still query;
  - dev 30 → 31.
- **AC 38.5.7** — Live check on a disposable table:
  - a `DELETE` over the cap is refused and the rows are intact;
  - read-only mode refuses `UPDATE`;
  - `countOnly` equals the `COUNT(*)` oracle;
  - the table is dropped afterwards.

### Story 38.6: Editing and SQL Safety Docs, Prompt and Capstone

The epic's closing story. It enriches the docs; each earlier story already shipped minimal docs (Rule #43).

- **AC 38.6.1** — Docs:
  - root README, the `iris-dev-mcp` README and `tool_support.md` cover every new parameter, tool and variable with its default state (Rule #30);
  - `CHANGELOG.md` and changesets are updated.
- **AC 38.6.2** — A new MCP prompt that edits a class in place: ranged read → `iris_doc_edit` with `expected` → `iris_doc_compile` → `iris_execute_tests`, with a total-count check. Update `deploy-and-test-class` where it now overlaps. Then:
  - `pnpm gen:skills`;
  - `gen:skills:check` passes clean;
  - `validate:prompts` passes.
- **AC 38.6.3** — Capstone (Rule #21), one integration test in the **default** suite, armed by the existing live-gate convention and listed in `prepublish-gate.mjs`'s `gateTestFiles` (the lesson from Epic 37's HIGH). It runs:
  1. a ranged read;
  2. an edit with `expected`;
  3. a stale edit, which is refused;
  4. a storage-dropping put, which is refused;
  5. a read-only SQL refusal;
  6. a rows-affected refusal.

  It runs against live IRIS on disposable fixtures and is proven red by reverting one guard (Rule #59: name the path).
- **AC 38.6.4** — Epic-close checks are recorded:
  - governance `:check`;
  - tool counts;
  - `BOOTSTRAP_VERSION` from → to;
  - `check-epics-sync.mjs` OK.

## Epic 39: Interop Message Forensics (added 2026-10-14)

**Goal:** An integration engineer can find messages by header fields, body content and Search Table values, and can read any message body. Everything that returns body content or body-derived values is governed by a per-profile PHI data policy.

**Context:** P1 gaps G32, G33, G34, G35 and G50, from research recommendation 2.

- G32 is nearly free: `iris_message_resend`'s `resendFiltered` dry run already searches headers by item, status and time window. It is write-classified and disabled by default, so nobody can use it to search (research [34]).
- The competitor reads 3 body classes and pastes unescaped input into generated ObjectScript (research [15][16]). We cover every body class and never interpolate caller input.

**Constraints:**

- Message fixtures are synthetic, created in a disposable interop-enabled namespace (or a documented scratch namespace the story creates), and removed afterwards. A story never reads another project's namespace.
- Search requires a scope filter (Rule #38): a time window, or an item plus a window. Output caps are documented as output caps, never as timeout protection.
- The new tools (`iris_message_search`, `iris_message_body`) are a `TOOL_PAIRS` unit, and both join interop `core` (L-4; 10 → 12 runtime).
- The PHI policy default is `redact` (L-2).

**Out of scope:**

- G31 (production needs-update check);
- G37 (lookup table listing);
- G38 (HL7 schema browsing; probe first, P2);
- G36 (same-server drift).

### Story 39.1: Message Header Search

G32. New read tool `iris_message_search`, mode `headers`.

- **AC 39.1.1** — Probe first (Rule #47): read `MessageResend.cls` and `message-resend.ts`, and record the exact filter set `resendFiltered`'s dry run supports, how it queries `Ens.MessageHeader`, and its caps and window rules.
- **AC 39.1.2** — The search logic is extracted into one shared ObjectScript helper used by both `resendFiltered` and the new endpoint. `resendFiltered`'s requests and responses stay byte-identical (Rule #19 pin). The bootstrap moves (Rule #24); a new class enters both rosters (Rule #39).
- **AC 39.1.3** — Mode `headers` filters by:
  - source or target config item;
  - status;
  - a time window (required, bounded);
  - session id;
  - body class name;
  - error-only.

  Results are paged, with a cap. Timestamps are ISO 8601 with a `…Raw` sibling (Rule #11).
- **AC 39.1.4** — Governance and visibility:
  - `mutates: "read"`, enabled by default;
  - `developer` and `core` include it (L-4; interop `core` 10 → 11 runtime), and 39.5 declares the `TOOL_PAIRS` membership when its partner lands;
  - interop 22 → 23.

  Docs state the default state (Rule #30).
- **AC 39.1.5** — Oracle (Rule #36): results equal a hand-written `Ens.MessageHeader` SQL query over the same synthetic fixture.
  - Not-configured branch (Rule #41): a namespace without interoperability returns `notApplicable`, not an error.
  - Second-namespace smoke (Rule #34).

### Story 39.2: PHI Data Policy

G50. A framework policy that the body-touching stories consume. This story owns the model and the redaction engine; 39.3–39.5 own applying it to their outputs (Rule #52).

- **AC 39.2.1** — Policy model:
  - a per-profile `dataPolicy` of `block`, `redact` or `allow`, plus an operator default variable;
  - configuration is accepted from the `IRIS_PROFILES` entry and the governance file;
  - the precedence is documented and validated fail-fast, like other configuration (architecture M1);
  - the default is `redact` (L-2).

  The model is recorded in the architecture's dated decision record (Rule 20).
- **AC 39.2.2** — Redaction engine for HL7 v2: field-level redaction of a PHI field list that is **exhaustive as of a named date with its source** (Rule #56). For example, the HIPAA Safe Harbor identifiers mapped to the segments and fields that carry them: PID, NK1, GT1, IN1, PV1, and others as the source dictates. The tests use varied fixtures (Rule #58):
  - escape sequences;
  - repetitions and components;
  - Z-segments;
  - a missing PID;
  - CR and CRLF segment terminators.
- **AC 39.2.3** — Under `redact`, a body type the engine cannot redact reliably is **blocked** with a reason, never passed through. Under `block`, every body value is withheld. Under `allow`, nothing changes.
- **AC 39.2.4** — The existing `iris_message_resend` preview `bodySummary` falls under the policy. Under `allow` it is byte-identical to today (pin). Under the default `redact` (L-2), HL7 v2 bodies are redacted and other body types are blocked with a reason. The change is recorded in `CHANGELOG.md`.
- **AC 39.2.5** — Policy outcomes (redacted or blocked) are visible in the response and in the JSONL audit log's outcome field. The docs say the policy reduces exposure and is not a compliance certification.

### Story 39.3: Message Body Content Search

G33. Mode `body` on `iris_message_search`.

- **AC 39.3.1** — Input:
  - `bodyClass` (required);
  - a structured filter `[{property, op, value}]`, validated against that class's SQL-projected properties from the class dictionary;
  - the 39.1 scope filters.

  The search **never accepts raw SQL `WHERE` text**, and caller values are always passed as parameters.
- **AC 39.3.2** — The search returns header rows only, never body values. Under `block` the mode is refused (it reveals presence); under `redact` and `allow` it runs.
- **AC 39.3.3** — An injection fuzz over property names, operators and values, in the style of the 36.4 subscript fuzz, finds 0 violations. It runs in the default suite with an independent oracle.
- **AC 39.3.4** — Oracle (Rule #36): results equal a hand-written JOIN of `Ens.MessageHeader` and the body table over synthetic fixtures.

### Story 39.4: Search Table Lookup

G34. Mode `searchTable` on `iris_message_search`.

- **AC 39.4.1** — Probe first (Rule #16) and record live:
  - the `Ens.Config.SearchTableProp` shape;
  - how the search table classes in use store values (for example `EnsLib.HL7.SearchTable`);
  - how the competitor's lookup maps to it (research [15]).
- **AC 39.4.2** — Input:
  - a search table class;
  - a property name, validated against the namespace's configured `SearchTableProp` rows;
  - a value and an operator;
  - the scope filters.

  The lookup returns header rows only.
- **AC 39.4.3** — A namespace with no search tables configured returns `notApplicable` (Rule #41). The policy applies as in 39.3.
- **AC 39.4.4** — Live check: a synthetic HL7 message indexed by a medical record number in the disposable namespace is found by that number. The oracle is SQL over the search table (Rule #36).

### Story 39.5: Message Body Reader

G35. New read tool `iris_message_body`.

- **AC 39.5.1** — Input: 1–N header ids (bounded). The tool resolves each body class and id.
- **AC 39.5.2** — Renders by body kind. The renderer list is **exhaustive as of a named date with its source** (Rule #56):
  - HL7 v2 → ER7 text;
  - XML virtual documents → XML;
  - persistent objects → JSON (`%JSONExport` where available; otherwise a property dump from the dictionary);
  - streams → text;
  - anything else → class and id only, with a reason.

  A size cap applies, with a `truncated` flag.
- **AC 39.5.3** — The policy is enforced per body (39.2). The response states the outcome for each body.
- **AC 39.5.4** — Governance and visibility:
  - `mutates: "read"`;
  - a `TOOL_PAIRS` unit with `iris_message_search`;
  - `developer` and `core` include it (L-4; interop `core` 11 → 12 runtime);
  - interop 23 → 24.
- **AC 39.5.5** — Live check on synthetic fixtures. Under `redact`, an assertion proves that no synthetic PHI value appears anywhere in the output (text or structured). Under `allow`, the value appears.

### Story 39.6: Message Forensics Docs, Prompt and Capstone

- **AC 39.6.1** — Docs:
  - root and interop READMEs and `tool_support.md` cover the new tools, modes and policy configuration, with default states (Rule #30);
  - `CHANGELOG.md` and changesets are updated.
- **AC 39.6.2** — Prompts: update `trace-message-flow` to search, read the body, then draw the diagram. Add one new prompt for finding a patient's messages by Search Table value, under the policy. Then run `gen:skills`, `gen:skills:check` and `validate:prompts`.
- **AC 39.6.3** — Capstone (Rule #21), in the default suite and listed in the live-gate roster:
  1. synthetic HL7 traffic is generated in the disposable namespace;
  2. header search finds it;
  3. Search Table lookup finds it;
  4. the body read under `redact` leaks no PHI value;
  5. the body read under `allow` shows the value.

  It is proven red by disabling redaction (Rule #59).

## Epic 40: Developer Test Depth (added 2026-10-14)

**Goal:** A developer can measure line-by-line code coverage of the classes their tests exercise, as a per-class and per-method summary and as Cobertura XML with a target check, and can run TestProduction-based tests without disturbing the instance.

**Context:** P1 gap G23 (then G24 at P2), from research recommendation 4. The competitor measures `.1` routines only and never writes Cobertura (research [13]). Prior art to evaluate, not assume: the community TestCoverage tool on Open Exchange (it uses `%Monitor.System.LineByLine` and maps INT lines back to class source). If any code is adapted, it gets the same notice treatment as Epic 41.

**Constraints:**

- `%Monitor.System.LineByLine` is an **instance-wide** monitor on a shared instance. A coverage run must refuse when a monitor session is already active, stop only its own session (always, in a `finally`), and never stop someone else's.
- TestProduction runs must not disturb any running production. They are refused when a different production is running in the target namespace, and smoked only in a disposable namespace.

**Out of scope:**

- Coverage of code outside the selected classes' routines;
- performance profiling;
- G25 (INT-offset mapping as a standalone tool).

### Story 40.1: Line Coverage Probe and Engine

This story ships per-routine INT-line coverage, with a complete response shape. 40.2 owns class-source mapping, aggregation, Cobertura and targets (Rule #52).

- **AC 40.1.1** — Probe first (Rule #16) and record:
  - the `%Monitor.System.LineByLine` API (start, stop, routine list, metrics, process scope);
  - its privileges;
  - whether a second session can start while one is active;
  - its overhead;
  - how to enumerate every INT routine generated for a class (`.1` … `.N`).
- **AC 40.1.2** — Execution-path decision, recorded with evidence: the Atelier work queue that `iris_execute_tests` uses today, or our custom `POST /tests` route, which has no tool caller today (research [55]). Whichever path is not chosen is either given its caller or documented.
- **AC 40.1.3** — The surface is a `coverage` option on `iris_execute_tests`. Running tests is already a write key, so no new key is added, unless the probe shows a separate tool is required, in which case it is `mutates: "write"` and default-disabled (Rule #28). The new endpoint enters the bootstrap and both rosters (Rules #24/#39).
- **AC 40.1.4** — Shared-instance guard: if a LineByLine session is already active, the run is refused with a clear error and the active session is untouched. The run's own session is always stopped, including after a timeout or error. A test kills the run mid-flight and confirms no monitor is left running.
- **AC 40.1.5** — Output: for each routine of each selected class, the covered and executable INT lines and a percentage. The live oracle is a fixture class with hand-countable branches, with the expected values captured from the live run (Rule #36).

### Story 40.2: Coverage Reports and Targets

- **AC 40.2.1** — INT lines are mapped to class source lines and methods, using the mapping the probe found. Accuracy is verified on fixtures that include generated methods, macros, embedded SQL and multi-line statements (Rule #58).
- **AC 40.2.2** — Summary: per class and per method, the coverage percentage and the uncovered line ranges, in `structuredContent` and in a compact text form.
- **AC 40.2.3** — Cobertura XML is written to a caller-supplied local path, following the path conventions of `iris_doc_export`. The XML validates against the Cobertura DTD, and one known file is checked round-trip.
- **AC 40.2.4** — A `minCoverage` target gives a pass/fail verdict per class and overall. The verdict never turns a completed test run into a tool error.

### Story 40.3: TestProduction Runs

G24.

- **AC 40.3.1** — Probe first: does `iris_execute_tests` already run `%UnitTest.TestProduction` subclasses, and how do they start and stop their production? If they already run, this story adds only the safety guard and the docs.
- **AC 40.3.2** — Guard: a TestProduction run is refused when a production other than the test's own is running in the namespace. The refusal names that production, and it is left untouched.
- **AC 40.3.3** — Live check in a disposable namespace:
  - a passing and a failing TestProduction fixture each report correctly;
  - the guard refuses while a different production runs;
  - the namespace is removed afterwards.

### Story 40.4: Test Depth Docs, Prompt and Capstone

- **AC 40.4.1** — Docs:
  - the `coverage` option, its shared-instance guard, the Cobertura path and the targets, each documented with its default (Rule #30);
  - `CHANGELOG.md` and changesets are updated.
- **AC 40.4.2** — Update the `deploy-and-test-class` prompt with an optional coverage step, then run `gen:skills`, `gen:skills:check` and `validate:prompts`.
- **AC 40.4.3** — Fixes found by the research (recommendation 8):
  - `iris_test_status` returns `structuredContent` (research [56]);
  - `iris_execute_tests`' `readOnlyHint`/`idempotentHint` contradict its write classification and its "do not re-submit" contract. This is DW-498; the Epic 40 gate is recommended to route it here.
- **AC 40.4.4** — Capstone (Rule #21), in the default suite and listed in the live-gate roster: a coverage run over a fixture yields the expected summary and a valid Cobertura file, and a pre-started monitor session causes a refusal. It is proven red by removing the guard (Rule #59).

## Epic 41: Companion Skills & Rules Pack (added 2026-10-14)

**Goal:** Every agent working on ObjectScript gets our hard-won rules as one always-on pre-write checklist, 6–10 model-invoked knowledge skills, and the workflow skills generated from our MCP prompts. The pack is installed into each client's native location, with the competitor's MIT notice shipped wherever any adapted content ships.

**Context:** decision record Part 2.

- The pack is our own equivalent of the competitor's kit, not a copy. The core is written from `.claude/rules/` and our epic retros. Competitor content is adapted only where it is clearly the better start, for example the list and SQL pattern skills.
- Claude Code constraints, confirmed 2026-10-14:
  - skills load from `.claude/skills/`, `~/.claude/skills/` and plugin `skills/`, never from `.agents/skills/`;
  - `AGENTS.md` is read natively only when there is no `CLAUDE.md`;
  - `.claude/rules/*.md` loads automatically, scoped by a `paths:` glob;
  - plugins cannot carry rules;
  - MCP prompts are user-invoked slash commands, while skills are model-invoked from their description.

**Constraints (licensing):** the competitor's kit is MIT, © 2025 InterSystems Corporation.

- `THIRD_PARTY_NOTICES.md` carries their full MIT text and a provenance table mapping each derived file to its source at commit `b6205bb`.
- The notice ships wherever the skills ship.
- Each derived `SKILL.md` carries one header line: "Adapted from intersystems-community/iris-agentic-dev (MIT, © 2025 InterSystems Corporation); see THIRD_PARTY_NOTICES".
- The named authors, Tim Leavitt and Tom Dyar, are credited.
- Nothing is derived from `kb/ipm-module-authoring.md` or `iris-objectscript-eval`.
- The pack is never presented as InterSystems' and never implies endorsement. "IRIS" and "ObjectScript" may be used descriptively.

**No benchmarking in this repo.** The Project Lead benchmarks elsewhere. The in-repo checks are the tool-name validator, extended to the whole pack, plus live probes of factual claims (Rule #16).

**Out of scope:**

- The Claude Code plugin (Story 42.8, which consumes this pack);
- a compile-on-save hook (a 42.8 candidate);
- skills about MCP server internals.

### Story 41.1: Pack Layout, Licensing and Provenance

- **AC 41.1.1** — Layout decision, recorded in the architecture (Rule 20):
  - a source tree for hand-authored knowledge skills and rules;
  - generated workflow skills stay generated and DO-NOT-EDIT (Rule #18);
  - one build step assembles a distributable pack directory that 41.6's installer and 42.8's plugin both consume;
  - the pack ships inside `@iris-mcp/client-config`, the installer's npm package, unless the decision records why not.

  `gen:skills:check` keeps passing and never treats hand-authored files as stale.
- **AC 41.1.2** — The competitor source is fetched at `b6205bb` into a scratch directory as untrusted data: read only, never executed.
- **AC 41.1.3** — `THIRD_PARTY_NOTICES.md` holds:
  - their full MIT text;
  - the provenance table;
  - author credits;
  - a statement that the pack is not endorsed by InterSystems.

  It is exact to their LICENSE file, which is verified byte for byte.
- **AC 41.1.4** — A mechanical check runs in the default suite and is proven red (Rule #59). It confirms that:
  - every file carrying the adaptation header has a provenance row;
  - every row's file exists and carries the header;
  - no row cites an excluded source;
  - the notice is listed in every distribution manifest that exists so far.

  41.6 and 42.8 extend this check to the installer payload and the plugin folder.
- **AC 41.1.5** — `validate:prompts` is extended to every `SKILL.md` and rule file in the pack, so tool-name tokens are checked against the live catalog.

### Story 41.2: Always-On ObjectScript Pre-Write Rule

- **AC 41.2.1** — Content: a short pre-write checklist distilled from `.claude/rules/iris-objectscript-basics.md`, `object-script-testing.md` and the code-level project rules (#7, #8, #15 and others). It is user-facing wording: no internal rule numbers and no project paths.
- **AC 41.2.2** — Single source. It and the existing `objectscript-review` prompt (and its generated skill) never diverge: either one generates the other, or the prompt is retired with a recorded reason.
- **AC 41.2.3** — It is emitted in two forms:
  - a Claude Code rule file with `paths:` frontmatter `**/*.cls`, `**/*.mac` and `**/*.inc`;
  - an `AGENTS.md` section between stable markers, so the installer can insert and update it idempotently.
- **AC 41.2.4** — Every factual claim, such as which `$$$Assert*` macros exist or the Quit-in-Try/Catch rule, is probed live on the instance (Rule #16), and the probe log is kept in the story record. A claim that fails its probe is corrected, and the source rule file is flagged for the retro.
- **AC 41.2.5** — The `paths:` semantics are re-checked against the current Claude Code docs (Rule #14) and recorded with the date.

### Story 41.3: Core Knowledge Skills

ObjectScript gotchas, `%Status` and error handling, `%UnitTest`.

- **AC 41.3.1** — Three `SKILL.md` files, each with `name` and a model-invocation `description` that says when to load it. They are written from our rules and retros. Any competitor-derived passage carries the header and a provenance row (41.1).
- **AC 41.3.2** — Every factual claim is probed live, with a probe log. Code snippets are compiled in a disposable `ExecuteMCPv2.Temp.*` class, and test snippets run through `iris_execute_tests` with a total-count check (Rule #35). Then the fixtures are deleted.
- **AC 41.3.3** — Tool-name tokens validate. No internal rule numbers or repository paths appear in user-facing text.

### Story 41.4: Platform Knowledge Skills

Embedded SQL, IRIS system-class discipline, and interoperability patterns. Adapted list and SQL pattern skills are included only where the competitor's is clearly the better start.

- **AC 41.4.1** — System-class discipline covers:
  - `Config.*` (configuration), `SYS.*` (runtime) and `Security.*` (authorization), and when to join them;
  - checking for deprecated properties;
  - safe `%SYS` switching (no `New $NAMESPACE` in REST handlers);
  - per-process versus instance-wide counters.

  Each claim is probed live.
- **AC 41.4.2** — Interoperability patterns cover:
  - business service, process and operation signatures;
  - `Ens.Request` and `Ens.Response`;
  - adapters;
  - production XData as the source of truth.

  Each claim is probed live.
- **AC 41.4.3** — The total knowledge-skill count is 6–10, counted mechanically (Rule #51), and every adapted skill passes 41.1's provenance check.

### Story 41.5: Workflow Skills Refresh

- **AC 41.5.1** — The 11 generated workflow skills, plus every prompt added by 38.6, 39.6 and 40.4, are regenerated. Each description is rewritten for model invocation, because skills are chosen from their description. The MCP prompt text keeps its user-facing role.
- **AC 41.5.2** — A generated pack catalog (README) lists the knowledge skills, the workflow skills and the rule, with what each is for.
- **AC 41.5.3** — `gen:skills:check` and the extended `validate:prompts` pass.

### Story 41.6: Skills and Rules Installer

`packages/client-config` installs the pack into each client's native location.

- **AC 41.6.1** — A per-client disposition table covers **all 16 adapters** in `adapters.ts`. It is exhaustive as of a named date, with the documentation source for each row (Rule #56). For each client it gives the native skill location, the rule location and format, or "`AGENTS.md` fallback" with the reason. The minimum:
  - Claude Code → `.claude/skills/` and `.claude/rules/`;
  - VS Code / Copilot → `.github/instructions/` (`*.instructions.md` with `applyTo:`);
  - Cursor → `.cursor/rules/`;
  - other agents → `.agents/skills/` and `AGENTS.md`.

  Review asks what is missing (Rule #56).
- **AC 41.6.2** — The installer is driven by the existing engine:
  - a dry-run diff before any write;
  - idempotent re-install;
  - update and uninstall of only the files it owns;
  - `THIRD_PARTY_NOTICES.md` written alongside every installed copy of adapted content.

  An existing `AGENTS.md`, `CLAUDE.md` or instructions file is preserved byte for byte outside the marked block. The fixtures are varied (Rule #58): CRLF, a BOM, comments, no trailing newline, and an existing foreign block.
- **AC 41.6.3** — When a project has a `CLAUDE.md`, the Claude Code route uses `.claude/rules/`, and the installer reports how to import `AGENTS.md` (`@AGENTS.md`) instead of assuming it is read.
- **AC 41.6.4** — It is a CLI command on `iris-mcp-clients`. The extension UI is out of scope.

### Story 41.7: Skills Pack Docs and Capstone

- **AC 41.7.1** — Docs: the root README gets a pack section; the client-config README covers the installer commands; `skills/README.md` is superseded by the generated catalog.
- **AC 41.7.2** — Capstone (Rule #21), in the default suite: the installer CLI runs against a temporary project for every client route, and the test asserts:
  - the exact paths;
  - valid frontmatter;
  - the notice is present;
  - a re-install is idempotent;
  - an uninstall leaves foreign content intact.

  It is proven red (Rule #59).
- **AC 41.7.3** — A one-time live check, recorded: a real Claude Code session in the temporary project lists the installed skills, and the rule activates for a `.cls` path.

## Epic 42: Published Install & Distribution (added 2026-10-14)

**Goal:** Installing the suite becomes "install Node 22, run one command":

- npm `1.0.0` of every `@iris-mcp/*` package, published with provenance by a gated release workflow;
- the VS Code extension on the Marketplace and Open VSX;
- the IPM package on the IPM registry and Open Exchange;
- a Claude Code plugin that brings all five servers and the skills pack;
- an MCP Registry listing.

**Context:** decision record Part 3, decisions D1–D7.

- The original plan made npm primary, kept IPM secondary, and listed on the MCP Registry and Open Exchange (`prd.md:202-211`).
- Publishing was deferred twice. The git-clone beta ran by 2026-09-11 (`epic-36-retro-2026-09-11.md:62-63`).
- The code already targets `npx`, but nothing is published.
- CI follows the OcuPilot reference design (`../OcuPilot/.github/workflows/ci.yml`), adapted rather than copied. It is the Lead's own code, so there is no licensing question.

**Ledger:** 12 entries are routed to this epic's stories by the 2026-10-14 correct-course, and DW-439 is closed: DW-300, DW-394, DW-389, DW-260, DW-34, DW-443, DW-387, DW-47, DW-31, DW-506, DW-508, DW-441.

**Accounts only the Project Lead can create:**

| Account | Needed by |
|---|---|
| npm account with 2FA and the `iris-mcp` organization (D1) | 42.5. Confirm or create it before 42.1, because the scope is baked into every pin |
| VS Code Marketplace publisher | 42.7 |
| Open VSX namespace | 42.7 |
| InterSystems Developer Community account | 42.8 |
| GitHub Actions environment with required approval, and npm trusted publishing or a token | 42.5 |

**Constraints:**

- CI never touches the shared IRIS instance: the throwaway refuses the live ports.
- The CI workflow is secret-free and publishes nothing. Secrets live only in the release workflow.
- There is no beta tag (D2).
- The pin is major-only: `@1` (D3).
- The floor is Node 22+ (D4).

**Out of scope:**

- A public beta;
- `2.0` planning;
- OcuPilot's parallel test shards.

### Story 42.1: Pre-Publish Package Fixes

The decision record's fix table, except DW-508 (42.2) and IPM (42.4). Ledger: DW-394, DW-31, DW-506, DW-260.

- **AC 42.1.1** — Node floor:
  - `engines.node` is `>=22` in the root and in every publishable `package.json`;
  - every mention of Node 18 or 20 in docs is listed with a verdict and fixed (Rule #56);
  - a test asserts that every manifest declares the floor.
- **AC 42.1.2** — `@iris-mcp/all` (`"files": []`, no `bin`): probe what a global install of its tarball actually links. Then either add a real launcher or correct the README's `npm i -g @iris-mcp/all` claim. The choice and the evidence are recorded.
- **AC 42.1.3** — DW-506: the `./test-helpers` subpaths are removed from the published exports (through `publishConfig.exports` or a dev-only mechanism). An exports-versus-tarball check (`npm pack --dry-run` list against `exports`) runs in the default suite and is proven red.
- **AC 42.1.4** — DW-394: all `@iris-mcp/*` packages are aligned at `1.0.0` under the existing Changesets `fixed` group. Probe how the 22 pending changesets interact (`changeset status`) and record the mechanism that makes the release produce exactly `1.0.0`, with one consolidated `1.0.0` CHANGELOG section.
- **AC 42.1.5** — DW-31: every package carries `license` (MIT, matching the root `LICENSE`), `repository` (with `directory`), `author`, `keywords`, `homepage` and `bugs`, asserted by a mechanical test.
- **AC 42.1.6** — DW-260 (D3): `synthesize.ts:126` and the extension's `serverDefinitionProvider.ts` write `npx -y @iris-mcp/<pkg>@1`. The other half of DW-260, the launcher's missing neutral `cwd` (a local `node_modules` can shadow the package), is probed with a recorded verdict and fixed if it is real. Certification fixtures and docs are updated.
- **AC 42.1.7** — The documented `npx … @iris-mcp/client-config iris-mcp-clients` command (`packages/client-config/README.md:17`) is corrected. The correct invocation of a scoped package with a differently named `bin` is probed, and every documented instance is fixed (Rule #56).
- **AC 42.1.8** — The `npm pack --dry-run` file list for each package is recorded in the story record.

### Story 42.2: Bootstrap Downgrade Guard

DW-508, HIGH. A dedicated story; it must land before 42.6 publishes.

- **AC 42.2.1** — Root cause confirmed: `probeCustomRest` compares the deployed hash with the embedded `BOOTSTRAP_VERSION` for equality only, so any mismatch redeploys, including a **downgrade**. An older build can silently reinstall the vulnerable pre-36.4 `Global.cls`.
- **AC 42.2.2** — Fix: the embedded and deployed version carries a monotonic sequence plus the hash. The probe distinguishes older (upgrade, as today), equal (current) and **newer**. When the deployed version is newer, the bootstrap does not redeploy and logs a warning naming both versions and the remedy.
- **AC 42.2.3** — The generator, the drift test and the version scheme are updated together (Rules #18/#24). The rosters change only if a class is added (Rule #39).
- **AC 42.2.4** — Residual, documented: a server built before this fix will still downgrade. The README tells operators to upgrade every client on a shared instance together.
- **AC 42.2.5** — Live check (Rule #48) in a disposable namespace:
  - classes deployed by a newer build are **not** redeployed by an older-sequenced build, and the class bodies are byte-identical before and after;
  - an older deployment is upgraded.

  Proven red by reverting to equality comparison.

### Story 42.3: CI Workflow

DW-443. A secret-free `.github/workflows/ci.yml`.

- **AC 42.3.1** — Gates job:
  - build, test, lint and type-check;
  - governance `:check`, `gen:skills:check`, `validate:prompts` and `check-epics-sync.mjs`;
  - the version, metadata and exports checks from 42.1.

  It runs on a Node matrix of one exact version at the floor of each supported major (22.x, 24.x, 26.x). A self-test keeps the matrix equal to `engines.node`.
- **AC 42.3.2** — One throwaway-IRIS job. `scripts/ci-throwaway.sh` is adapted from OcuPilot's:
  - a pinned `iris-community` 2026.2 image;
  - its own scratch compose file;
  - a readiness wait;
  - logs captured on failure;
  - teardown always.

  It refuses the live instance's ports. The live suites (`IRIS_REQUIRE_LIVE`), `prepublish-gate.mjs` and `verify-iris-reachable.mjs` run against it.
- **AC 42.3.3** — Package job: `npm pack` every package, install the tarballs in a clean directory, launch each `bin` through `npx` with a stdio `initialize`, and smoke-test it. The IPM offline proof joins this job in 42.4 (seam).
- **AC 42.3.4** — Pipeline hygiene:
  - every action is pinned to a commit SHA and every tool to an exact version;
  - `permissions: contents: read`;
  - superseded runs are cancelled;
  - no `continue-on-error` and no `|| true`;
  - a `sysctl` port reservation prevents the runner port race;
  - a self-test asserts the pins and that the checks declared in code equal the workflow's `run:` steps.
- **AC 42.3.5** — DW-443: the publish-time gates also run at a point the tarball path actually reaches (`prepack` and/or CI as the gate), and they are proven red on the tarball path specifically (Rule #59).
- **AC 42.3.6** — Each self-test and gate is broken once in a throwaway branch and the run goes red. The run URLs are recorded.

### Story 42.4: IPM Package Revival

DW-34, D6.

- **AC 42.4.1** — `ipm/module.xml` is generated from the bootstrap's class manifest (`gen-bootstrap.mjs` `classes[]`), with its version taken from the npm version (single source). It is generated and output-only (Rule #18). A drift test in the default suite is proven red. The class count is pinned mechanically (Rule #51).
- **AC 42.4.2** — Offline install proof in CI, adapted from OcuPilot's `ci-ipm-archive.sh`: build the archive on one throwaway container and install it on a second one with `--network none`. The test asserts:
  - nothing was fetched from a registry;
  - the classes compiled;
  - the REST application was configured.

  It runs on both `iris-community` and `irishealth-community` (edition matrix).
- **AC 42.4.3** — The bootstrap's `zpm "install iris-execute-mcp-v2"` fallback message (`bootstrap.ts:95-96`) is made accurate for the published package.
- **AC 42.4.4** — Publishing to the IPM registry happens in 42.5's release workflow; the Open Exchange listing is in 42.8.

### Story 42.5: Release Workflow

DW-387, D7. New, with no OcuPilot precedent.

- **AC 42.5.1** — `.github/workflows/release.yml` triggers on a version tag and runs only after CI has passed on that commit. It requires approval through a protected GitHub environment, and secrets live only in this workflow.
- **AC 42.5.2** — A root pre-flight release script runs the full gate set once, then publishes in dependency order (client-config, shared, admin, data, dev, interop, ops, all) with npm provenance. It is the only supported publish command (DW-387).
- **AC 42.5.3** — After npm: the extension to both stores (42.7), then the IPM package (42.4). A failed step stops the rest and reports which channels were published.
- **AC 42.5.4** — A dry-run mode exercises every step without publishing, and is proven before the first real run.

### Story 42.6: Tarball Smoke and 1.0.0 Publish

DW-47, DW-300, D2.

- **AC 42.6.1** — Local tarball smoke, the Story 9.3 rerun:
  1. `npm pack` every package;
  2. install the tarballs in a clean directory;
  3. launch through `npx` in a real MCP client (Claude Code) against IRIS;
  4. make one read call per server.

  The result is recorded.
- **AC 42.6.2** — `1.0.0` is published through the release workflow by tagging `v1.0.0`. Prerequisites: 42.1–42.5 done, and the Lead's npm organization and environment in place.
- **AC 42.6.3** — Post-publish verification:
  - every package is at `1.0.0` with a provenance attestation;
  - `npx -y @iris-mcp/dev@1` starts in a clean environment;
  - the registry 404s are gone.

### Story 42.7: VS Code Extension Publish

DW-389, D5.

- **AC 42.7.1** — The publisher is a project-name publisher (for example `iris-mcp`), with "intersystems" kept out of the name. `extensions/iris-mcp-launcher` gets `private: true` for npm (DW-389), after confirming that `vsce package` and `vsce publish` still work.
- **AC 42.7.2** — The extension launches `npx -y @iris-mcp/<pkg>@1` (from 42.1). It is published to the VS Code Marketplace and to Open VSX through the release workflow, after npm `1.0.0`.
- **AC 42.7.3** — Install from each store into a clean VS Code and into an Open VSX client (VSCodium or Cursor). The extension starts the servers, and the result is recorded.

### Story 42.8: Claude Code Plugin and Registry Listings

- **AC 42.8.1** — `.claude-plugin/plugin.json` and a `marketplace.json` in this repo. The plugin brings:
  - all 5 MCP servers (`npx -y @iris-mcp/<pkg>@1`, with the IRIS connection supplied through the plugin's user configuration or environment);
  - Epic 41's skills pack;
  - `THIRD_PARTY_NOTICES.md`.

  41.1's provenance check is extended to the plugin folder. The format is verified against the current Claude Code plugin docs (Rule #14).
- **AC 42.8.2** — Rules cannot ride in a plugin. The plugin README points to the 41.6 installer for the always-on rule.
- **AC 42.8.3** — The optional compile-on-save hook is evaluated, the result recorded, and the hook shipped as opt-in only if the Lead approves. Otherwise it is filed as a candidate.
- **AC 42.8.4** — Live check: in a clean Claude Code, add the marketplace, install the plugin, and confirm the five servers connect and the skills list. The result is recorded.
- **AC 42.8.5** — An MCP Registry listing (the current registry requirements are probed; namespace verification as required), and an Open Exchange listing for the IPM package. Listing needs the Lead's InterSystems Developer Community account.

### Story 42.9: Install Docs and Client Re-Certification

DW-441.

- **AC 42.9.1** — README rewrite: install becomes "install Node 22, run one command", with one path per client:
  - the plugin for Claude Code;
  - the extension for VS Code;
  - the `iris-mcp-clients` CLI for the rest.

  Every "not yet published" or clone-and-build caveat in the docs is listed with a verdict and removed (Rule #56).
- **AC 42.9.2** — Post-publish re-certification: each client adapter is re-certified against the published `1.0.0` packages with the existing certify scripts, and the certification table is regenerated. Rows that only a human can certify are marked as such, with the date.
- **AC 42.9.3** — The CHANGELOG `1.0.0` release notes and the PRD's distribution section match what shipped.

<!-- END epics.md append -->

### 4.2 — `sprint-status.yaml`

**(a) Reconciliation, APPLIED 2026-10-14 (S-1).**

- 144 story keys were renamed in place to the slugs `sprint_plan.py` derives from their `epics.md` headings. The status (`done`) and every comment were kept, and the diff is renames only: 144 lines each way.
- 15 heading stubs were inserted into `epics.md`, each before its epic's first story heading (33.5 before Epic 34), so `generate` keeps the existing runtime keys:

  | Kind | Keys |
  |---|---|
  | X.0 gate stories | `2-0` … `9-0`, `12-0`, `14-0`, `15-0`, `16-0`, `17-0`, `34-0` |
  | Cleanup story | `33-5-late-findings-cleanup` |

  Each stub points to its story file.
- Proof:
  - `sprint_plan.py generate --dry-run`: `in_sync: true`, `new_entries: []`, `dropped_orphans: []`, `changed: 0`, 37 epics / 192 stories;
  - `check-epics-sync.mjs`: OK, 192 keys / 192 sections, 0 orphans (after §4.6);
  - `ledger.sh load`: `owner_unknown=0`, unchanged.

  Terminal ledger entries still name their old owner keys. That is harmless: `load` only reads the owners of non-terminal entries, and all 136 of those are `burndown`.
- `sprint_plan.py validate` reports one remaining problem: `last_updated` holds prose, not `%m-%d-%Y %H:%M`. The first real `generate` in (b) rewrites it.

**(b) On approval:** run `sprint_plan.py generate` once, the sanctioned writer, after §4.1 is appended. It adds:

- `epic-38` … `epic-42` as `backlog`;
- the 32 story keys as `backlog`;
- `epic-N-retrospective: optional`.

Expected keys:

```text
38-1-reject-the-unimplemented-http-transport      38-2-line-range-document-read
38-3-storage-block-drop-guard                     38-4-surgical-line-edit-tool
38-5-sql-write-safety                             38-6-editing-and-sql-safety-docs-prompt-and-capstone
39-1-message-header-search                        39-2-phi-data-policy
39-3-message-body-content-search                  39-4-search-table-lookup
39-5-message-body-reader                          39-6-message-forensics-docs-prompt-and-capstone
40-1-line-coverage-probe-and-engine               40-2-coverage-reports-and-targets
40-3-testproduction-runs                          40-4-test-depth-docs-prompt-and-capstone
41-1-pack-layout-licensing-and-provenance         41-2-always-on-objectscript-pre-write-rule
41-3-core-knowledge-skills                        41-4-platform-knowledge-skills
41-5-workflow-skills-refresh                      41-6-skills-and-rules-installer
41-7-skills-pack-docs-and-capstone                42-1-pre-publish-package-fixes
42-2-bootstrap-downgrade-guard                    42-3-ci-workflow
42-4-ipm-package-revival                          42-5-release-workflow
42-6-tarball-smoke-and-1-0-0-publish              42-7-vs-code-extension-publish
42-8-claude-code-plugin-and-registry-listings     42-9-install-docs-and-client-re-certification
```

The real run's output must show `dropped_orphans: []`, with every new entry in the list above and nothing else. Then rerun `validate` and `check-epics-sync.mjs`.

**Result (APPLIED 2026-10-14):**

- `generate` reported 42 epics and 224 stories, `dropped_orphans: []` and `changed: 0`. It added exactly the 42 expected entries: 5 epics, 32 stories and 5 retrospectives.
- `validate`: `valid: true`, no problems. `last_updated` is now `10-14-2026 20:00`.
- A second `generate` was a byte-for-byte no-op, so the file is idempotent.
- `check-epics-sync.mjs` is OK.

**Finding: `generate` keeps no comment inside `development_status`.** The kit says it "preserves comments", but it rebuilds that map from scratch. The top-of-file header (118 lines) survived. Of the 192 comment lines inside the map (per-epic notes, sprint-change-proposal pointers, decisions), 191 were removed; only the first survived.

Restoring them in place would last only until `/epic-cycle`'s next status write. So all 192 were preserved verbatim, grouped under the key each preceded, in `_bmad-output/implementation-artifacts/sprint-status-comment-archive-2026-10-14.md`. A pointer comment in the tracker header, which `generate` keeps (proven by the idempotent rerun), says to put new epic notes in `epics.md`. The original file is also in git history.

### 4.3 — `deferred-work.md`, 13 trailers through `ledger.sh append` only (after 4.2(b), so the owner keys validate)

The ledger is `_bmad-output/implementation-artifacts/deferred-work.md`. Every trailer carries `by=correct-course`. Owners are the Epic 42 story keys.

| Entry | Now | Trailer (`status` / `owner` / `note`) |
|---|---|---|
| DW-300 npm publish after beta | decision-pending | `status=routed owner=42-6-tarball-smoke-and-1-0-0-publish note=decided D1/D2/D7 (decision-record-2026-10-14): publish 1.0.0 through the CI release workflow` |
| DW-439 beta distribution | decision-pending | `status=dropped note=not pipeline work - human action complete: git-clone beta ran by 2026-09-11 (epic-36-retro-2026-09-11.md:62-63); public beta declined by D2 (decision-record-2026-10-14)` |
| DW-394 version boundary | decision-pending | `status=routed owner=42-1-pre-publish-package-fixes note=decided D2 (decision-record-2026-10-14): align every @iris-mcp/* package at 1.0.0` |
| DW-389 extension publisher | routed | `status=routed owner=42-7-vs-code-extension-publish note=decided D5 (decision-record-2026-10-14): project-name publisher on Marketplace + Open VSX; private:true for npm` |
| DW-260 unpinned `npx` | wontfix-accepted | `status=routed owner=42-1-pre-publish-package-fixes note=reopened - reopen_if fired: publish decided; D3 (decision-record-2026-10-14) major pin @1; neutral-cwd half probed in 42.1` |
| DW-34 IPM via Open Exchange | dropped | `status=routed owner=42-4-ipm-package-revival note=reopened by D6 (decision-record-2026-10-14): revive IPM, generated manifest, offline install proof, publish` |
| DW-443 gates only on prepublishOnly | routed | `status=routed owner=42-3-ci-workflow note=D7 (decision-record-2026-10-14): CI gates; prove RED on the tarball path (Rule #59)` |
| DW-387 no multi-package release gate | decision-pending | `status=routed owner=42-5-release-workflow note=decided D7 (decision-record-2026-10-14): release workflow with root pre-flight script as sole publish command` |
| DW-47 pre-publish smoke rerun | decision-pending | `status=routed owner=42-6-tarball-smoke-and-1-0-0-publish note=decided D2 (decision-record-2026-10-14): local tarball smoke required before 1.0.0` |
| DW-31 package metadata | wontfix-accepted | `status=routed owner=42-1-pre-publish-package-fixes note=reopened - reopen_if fired: npm publish decided (decision-record-2026-10-14)` |
| DW-506 `test-helpers` exports | routed | `status=routed owner=42-1-pre-publish-package-fixes note=pre-publish fix table (decision-record-2026-10-14)` |
| DW-508 silent downgrade (HIGH) | routed | `status=routed owner=42-2-bootstrap-downgrade-guard note=pre-publish fix table (decision-record-2026-10-14); must land before 42.6 publishes` |
| DW-441 post-publish re-certification | decision-pending | `status=routed owner=42-9-install-docs-and-client-re-certification note=decided (decision-record-2026-10-14 story 8); human-only client rows recorded as such` |

**Result (APPLIED 2026-10-14 through `ledger.sh append`; the diff is 13 insertions and 0 deletions).** `ledger.sh load` before and after:

| Count | Before | After |
|---|---|---|
| `routed` | 105 | 113 |
| `decision_pending` | 31 | 25 |
| `terminal` | 390 | 388 |
| `owner:burndown` | 136 | 126 |
| `owner_unknown` | 0 | 0 |

- 12 entries are now owned by Epic 42 keys: 42-1 has 4, 42-6 has 2, and 42-2, 42-3, 42-4, 42-5, 42-7 and 42-9 have 1 each. `slice unknown` is empty.
- The draft of this section predicted `routed` 112 and `terminal` net −1. It missed that DW-31 was also terminal (`wontfix-accepted`), so **three** entries were reopened (DW-260, DW-34 and DW-31), not two. The tool's counts above are authoritative (Rule #51).

### 4.4 — `prd.md`

1. **FR7** (`:440`):
   - OLD: "Server can operate via stdio or Streamable HTTP transport".
   - NEW: "Server operates via stdio transport; any other configured transport (including `http`) is rejected at startup with a clear configuration error. An authenticated Streamable HTTP transport is a post-MVP candidate pending an auth design (decision 2026-10-14, Epic 38 Story 38.1)."

   Lines `:216` and `:224` gain "(stdio; Streamable HTTP not yet offered — see FR7)".
2. **Language & Runtime Support, Node.js row** (`:273`):
   - OLD: `| Node.js | 18 LTS, 20 LTS, 22 LTS | Minimum 18 for native `fetch` support |`.
   - NEW: `| Node.js | 22 and later (CI tests the floor of 22, 24, 26) | Minimum 22: iris-dev-mcp uses `fs.globSync`; Node 18 and 20 are end-of-life (2025-04-30, 2026-04-30). Decision D4, 2026-10-14 |`.
3. **Installation & Distribution** (`:200-211`): keep the package list and append:
   - "**Status 2026-10-14 (decision record D1–D7, Epic 42):**
     - npm `1.0.0` for every `@iris-mcp/*` package, published with provenance by a gated GitHub Actions release workflow (no beta tag);
     - clients launch `npx -y @iris-mcp/<pkg>@1` (major pin);
     - IPM revived with a manifest generated from the bootstrap class list and an offline install proof, listed on Open Exchange;
     - the VS Code extension on the Marketplace and Open VSX;
     - a Claude Code plugin bringing all five servers plus the skills pack;
     - an MCP Registry listing."
4. **New FR block** after FR145, "Epics 38–42 — Competitive Response, Skills Pack & Published Install (added 2026-10-14)", sourced from the decision record and the research:
   - **FR146:** Developer can read a document by 1-based line range (`iris_doc_get` `startLine`/`endLine`) with the total line count (Story 38.2).
   - **FR147:** Developer can edit a document surgically (`iris_doc_edit`: insert, delete or replace line ranges, each guarded by expected current text). A mismatch refuses with no write. Conflicts are never ignored. The response is a unified diff, not the whole document. It is a write enabled by default, and blocked under the `read-only` preset (Story 38.4, Lead decision S-3).
   - **FR148:** A document write that would drop a class's existing Storage definition is refused unless explicitly overridden (Story 38.3).
   - **FR149:** Operator and developer can confine `iris_sql_execute` to read-only statements, cap the rows a DML statement may affect, receive `%ROWCOUNT`, and count rows without transferring them. If L-3 is approved, a read-classified `iris_sql_query` serves SELECTs under the `read-only` preset (Story 38.5).
   - **FR150:** Integration engineer can search messages by header fields, by body content (structured, parameterized filter on a body class) and by Search Table value, with a required scope window (`iris_message_search`, Stories 39.1, 39.3 and 39.4).
   - **FR151:** Integration engineer can read any message body by header id: HL7 as ER7, XML, persistent objects as JSON, streams as text (`iris_message_body`, Story 39.5).
   - **FR152:** Operator can set a per-profile PHI data policy (`block`/`redact`/`allow`, default per L-2) governing every surface that returns body content or body-derived values, including the existing resend preview (Story 39.2).
   - **FR153:** Developer can measure line-by-line coverage of the classes a test run exercises: per class and method, uncovered ranges, Cobertura XML and a target verdict. It is guarded so it never disturbs another monitor session on a shared instance (Stories 40.1 and 40.2).
   - **FR154:** Developer can run `%UnitTest.TestProduction` tests without disturbing a different running production (Story 40.3).
   - **FR155:** Agents get an always-on ObjectScript pre-write rule and 6–10 knowledge skills alongside the generated workflow skills, shipped with the competitor's MIT notice wherever adapted content ships (Stories 41.1–41.5).
   - **FR156:** Developer can install the skills and rules pack into each supported client's native location from `iris-mcp-clients`, with dry-run, idempotent re-install and uninstall (Story 41.6).
   - **FR157:** User can install the suite from npm (`@iris-mcp/*` `1.0.0`, Node 22+) with clients launching `@1` (Stories 42.1 and 42.6).
   - **FR158:** The bootstrap never downgrades IRIS-side classes deployed by a newer build (Story 42.2).
   - **FR159:** IRIS administrator can install the IRIS-side classes through IPM, offline-provable (Story 42.4).
   - **FR160:** Claude Code users can install the whole suite plus skills as one plugin. VS Code users can install the extension from the Marketplace or Open VSX (Stories 42.7 and 42.8).

   NFR-level release requirement: releases run only from a tagged commit with green CI, through an approved protected environment, with npm provenance (Stories 42.3 and 42.5).

### 4.5 — `architecture.md`

1. **Technical Constraints** (`:73`):
   - OLD: "Node.js 18+ LTS (native fetch), TypeScript 5.0+, IRIS 2023.1+".
   - NEW: "Node.js 22+ (D4, 2026-10-14: `fs.globSync`; Node 18/20 end-of-life), TypeScript 5.0+, IRIS 2023.1+".
2. **Infrastructure & Deployment** (`:351`):
   - OLD: "CI/CD pipeline (GitHub Actions) deferred to post-MVP".
   - NEW: "CI/CD pipeline (GitHub Actions): built in Epic 42 (D7, 2026-10-14). See the N-series record below."
   - Versioning gains: "`1.0.0` is the first published version; clients pin the major (`@1`, D3)."
3. **Gap Analysis item 2 and the open list** (`:1065`, `:1112`, Streamable HTTP config): append "Closed 2026-10-14: HTTP transport rejected at configuration time until an authenticated design exists (Story 38.1, decision S-2)."
4. **New dated record** after the M1 paragraph, before `## Implementation Patterns & Consistency Rules`: "### Competitive Response, Skills Pack and Published Install (Epics 38–42 — added 2026-10-14)". It contains:
   - **N1 — A transport the server cannot run is a configuration error.** Unsupported transports fail fast in `resolveTransport`, under M1's configuration class. An HTTP transport returns only with an auth, bind and session design.
   - **N2 — Document writes are guarded and minimal.** Line numbers are 1-based indexes into the Atelier `GET /doc` content array, defined once and shared by ranged reads and edits. Edits are expected-text-guarded, all-or-nothing, and never use `ignoreConflict`. The Storage-drop guard is one shared function on every document-writing path. `iris_doc_edit` is a `defaultEnabled` write by Lead decision S-3 (Rule #32's marker, extended beyond recovery tooling).
   - **N3 — SQL safety is enforced server-side by statement type, not keyword matching, where the probe confirms it is available.** Caps are enforced transactionally and the residual side effects are documented. A read-classified path exists if L-3 is approved.
   - **N4 — Message forensics never interpolates caller input.** Body and Search Table filters are structured and validated against the dictionary. A per-profile PHI data policy (`block`/`redact`/`allow`) governs every body-derived output. Under `redact`, anything the engine cannot redact reliably is blocked, never passed through. The model and precedence are recorded here at Story 39.2.
   - **N5 — Instance-wide monitors on a shared instance are refuse-if-busy and always-release.** This covers LineByLine coverage and TestProduction production control.
   - **N6 — The skills pack has one source per artifact and ships its notice everywhere.** Hand-authored knowledge skills and the rule have one source, generated workflow skills stay generated, and one assembled pack is consumed by both the installer and the plugin. `THIRD_PARTY_NOTICES.md` ships wherever adapted content ships, checked mechanically. The layout is recorded at Story 41.1.
   - **N7 — Distribution:**
     - npm is primary (`1.0.0`, Node 22+, `@1` pins);
     - IPM is generated from the bootstrap manifest;
     - CI is secret-free on throwaway IRIS containers that refuse the live ports;
     - releases come only from a tagged, CI-green commit through an approved environment, with provenance;
     - the bootstrap version is monotonic (sequence plus hash), so a newer deployment is never downgraded (DW-508, Story 42.2).

### 4.6 — `scripts/check-epics-sync.mjs`, APPLIED 2026-10-14

The story-key regex at `:57` is widened from `[a-z0-9-]+` to `[A-Za-z0-9_-]+`, with a comment. Generated slugs keep `_` from tool names in titles, for example `10-1-iris_package_list-…`. Without the fix, 32 sections showed as false orphans after §4.2(a). It now matches `ledger.sh`'s own key class (`[A-Za-z0-9_-]+`).

### 4.7 — `_bmad/custom/branch-naming.yaml`, ACTIVE comment (APPLIED 2026-10-14, per L-1)

Comment only, no schema field. It records the wave-6 branch as ACTIVE next for Epics 38–40 (not yet created; it is cut off `main` when Epic 38 starts), notes that wave-5 is merged into `main` and closed (verified with `git merge-base --is-ancestor`), and lists the planned wave-7 (Epic 41) and wave-8 (Epic 42). The file still parses as YAML. The same plan is restated in the wave's shared section in `epics.md`.

**Also applied:** the PRD (§4.4) and the architecture (§4.5). The architecture update also corrected a second "Node.js 18+ LTS" mention in the starter-template section (`:128`), which §4.5 had not listed.

### 4.8 — Not changed by this proposal (by design)

- Code, the bootstrap embed, `GOVERNANCE_BASELINE`, presets and tool arrays: every change there belongs to its story.
- The decision record and the research report: inputs, left as written.
- Epic 37's retrospective (`optional`): the Lead may still run it. The Epic 38 gate reads the ledger either way.

---

## 5. Implementation Handoff

**Scope:** Moderate. Backlog reorganization through the PO/Dev pipeline.

**Route:** `/epic-cycle 38`, then 39, 40, 41 and 42 in order, each on its L-1 branch. `/epic-cycle` creates each N.0 gate.

**Lead actions, in the order they become blocking:**

1. Answer L-1 to L-4 at approval.
2. Before 42.1: confirm or create the `iris-mcp` npm organization (D1).
3. Before 42.5: the GitHub environment with required approval, and npm trusted publishing or a token.
4. Before 42.7: the VS Code Marketplace publisher and the Open VSX namespace.
5. Before 42.8: the InterSystems Developer Community account.

**On approval, the agent applies, in this order:**

1. §4.1, then §4.2(b), so the new keys exist.
2. §4.3, the 13 `ledger.sh append` calls.
3. §4.4 and §4.5.
4. §4.7.
5. Verification: `sprint_plan.py validate`, `check-epics-sync.mjs`, and `ledger.sh load` with `slice 42-…` per owner.

The agent records the results here and leaves the commit to the Lead.

**Success criteria:**

- the tracker is in sync, with 0 dropped orphans on every `generate`;
- every one of the 13 entries shows its new effective status and owner through `ledger.sh show`;
- `check-epics-sync.mjs` passes;
- each epic closes with its capstone green and proven red on its path;
- after Epic 42, `npx -y @iris-mcp/dev@1` works for a stranger on Node 22.

---

## Appendix — Change navigation checklist (Step 2 record)

| # | Item | Status | Note |
|---|---|---|---|
| 1.1 | Triggering story | [N/A] | Strategic decision, not a story defect (G48 excepted) |
| 1.2 | Core problem | [x] | §1 |
| 1.3 | Evidence | [x] | §1 table, re-verified live in source |
| 2.1 | Current epic viable | [x] | No epic in flight |
| 2.2 | Epic-level changes | [x] | Add 38–42 |
| 2.3 | Future epics | [x] | 38.0 inherits the Rule #37 obligation |
| 2.4 | Obsolete or new epics | [x] | 5 new; none obsolete |
| 2.5 | Order and priority | [x] | Record order; G48 first |
| 3.1 | PRD conflicts | [!] | FR7, runtime table, distribution → §4.4 |
| 3.2 | Architecture conflicts | [!] | Node floor, CI deferral, HTTP open item → §4.5 |
| 3.3 | UX | [N/A] | No UX document |
| 3.4 | Other artifacts | [!] | Tracker time bomb (fixed), check-epics-sync regex (fixed), ledger, branch-naming |
| 4.1 | Direct adjustment | [x] | Viable, chosen |
| 4.2 | Rollback | [N/A] | Nothing to roll back |
| 4.3 | MVP review | [N/A] | MVP unchanged |
| 4.4 | Path selected | [x] | Direct adjustment |
| 5.x | Proposal components | [x] | §§1–5 |
| 6.1–6.2 | Review and approval | [x] | Approved 2026-10-14, L-1 to L-4 as recommended |
| 6.3 | Tracker update | [x] | Reconciled; 42 new entries through `generate`; comment archive (§4.2) |
| 6.4–6.5 | Handoff | [x] | `/epic-cycle 38` on `feature/feature-wave-6-competitive-gaps`; commit by the Lead |

---

## 6. Post-approval amendments (2026-10-15)

After approval, the Lead asked whether the PRD and the architecture spine needed updating. The PRD had three more stale lines: the custom REST base path, the tool-naming convention, and a second "Node.js 18+" line. They are fixed.

The project had no architecture spine. `/epic-cycle` fell back to `architecture.md`, which has no AD blocks, so planning and review saw no decisions. A `bmad-architecture` run (fast path, adopt-only) created the spine:

- **Location:** `architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md`, with its memlog and `reviews/`.
- **Review:** two reconcile passes and a three-lens reviewer gate ran on it. The lenses were the rubric, technology currency, and an adversary. Together they found 141 findings, and the high and critical claims were verified in code before fixing.
- **Result:** 33 ADs, linter-clean, `status: final`.

**Lead decisions taken during the spine review (2026-10-15):**

| # | Decision |
|---|---|
| SR-1 | **Migrate to MCP TypeScript SDK v2 before `1.0.0`.** The MCP specification `2026-07-28` and SDK v2 shipped in July 2026, and v1.x gets fixes only to about 2027-01-27. This adds **Epic 43**, which runs after Epic 41 and before Epic 42 (spine AD-32; FR161). |
| SR-2 | **A new key inherits its parent key's explicit disable.** `iris_doc_edit:apply` has `iris_doc_put` as its parent, and `iris_sql_query` has `iris_sql_execute`. Story 38.4 adds the mechanism (spine AD-4 and AD-6). |
| SR-3 | **The always-on ObjectScript rule is unscoped.** A `paths:` rule loads only on local-file access, so it never loads when classes are written through the MCP tools (spine AD-28; Story 41.2). |
| SR-4 | **The IRIS 2023.1 support claim is kept, labelled best effort** below the oldest CI-tested image. InterSystems' own minimum is 2024.1 (Stack; Epic 42). |
| SR-5 | **Feedback:** the `core` preset's 13 tools is a guideline, not a hard limit (L-4 as revised). |
| SR-6 | **SDK v2 serves both protocol revisions over stdio, settled now rather than in Story 43.2.** A live probe ([research/mcp-sdk-v2-stdio-probe-2026-10-15.md](research/mcp-sdk-v2-stdio-probe-2026-10-15.md)) showed one `serveStdio` process serving a client pinned to `2026-07-28`, `auto` negotiation, a 2025-era client and the repo's v1.29 client, all with identical tools. Story 43.2 lost its "if not viable" exit and gained a cross-era equivalence pin. Claude Code negotiates the modern era by default. |
| SR-7 | **Human confirmation through elicitation, as new Story 43.3.** The docs story is now 43.4. On clients that can elicit, every confirmation gate asks the person; on other clients, `confirm: true` applies as today. A decline refuses and never asks again, and a confirmation is bound to the exact arguments it showed (spine AD-34; FR162). The Tasks extension stays deferred; an operator setting that requires a human is a recorded candidate. |

**Story amendments in `epics.md`.** These were made in place, where a story would otherwise contradict the spine; each is marked "amended 2026-10-14/15". New requirements otherwise live in the spine, which the planning stage reads.

- **38.3.6** — Record exclusions for `iris_doc_load` and `iris_env_promote` `execute`.
- **38.4.2, 38.4.4 and 38.4.6** — `iris_doc_edit` changes:
  - it takes an `action` enum (`apply`); without one, `defaultEnabled` throws at registration;
  - the storage override is a separate default-disabled action, `regenerateStorage`;
  - it declares `parent: iris_doc_put`;
  - `destructiveHint: true`.
- **38.5.4 and 38.5.6** — `rowsAffected` and `totalCount` replace a colliding `rowCount`. `iris_sql_query` inherits the operator SQL controls, runs in an always-rolled-back transaction on the same prepared statement, and declares `parent: iris_sql_execute`.
- **39.1, 39.3 and 39.4** — Search kinds are `action` values (`headers`, `body`, `searchTable`) with their own governance keys. Validation of identifiers and operators runs IRIS-side, and the fuzz drives the REST route directly.
- **39.2.5** — The audit `outcome` keeps its closed domain, and policy effects go in a new field. Captured PHI parameters are redacted. The story records the policy's scope.
- **40.1.3 and 40.1.4** — The coverage surface and its governance go to the Lead at planning. One IRIS-side job owns the monitor's lifetime, with an ownership record and orphan reclaim.
- **41.2.3 and 41.2.5** — The rule is unscoped (SR-3).
- **42.1.5 and 42.1.6** — Story 42.1 probes the MCP Registry requirements before `1.0.0` and keeps InterSystems branding out. Every `npx` spec is pinned from one constant, the SDK floor goes out of the advisory range, and `@types/node` is pinned to the floor major.
- **Epic 42 preamble** — It runs after Epic 43, lists the release mechanics Story 42.5 must probe (npm trusted publishing, the first-publish route against D2, the VS Code Marketplace authentication change on 2026-12-01), and states the IRIS support claim.
- **Wave preamble** — The run order is 38 → 39 → 40 → 41 → 43 → 42. The spine is binding. Epic 43 is on wave-8.

**Tracker.** `generate` added `epic-43`, three stories and the Epic 43 retrospective. A rerun is idempotent, `validate` passes, and `check-epics-sync.mjs` is OK. The ledger is unchanged (`owner_unknown=0`).

**Found while running the kit's writer.** `sprint_plan.py generate` keeps no comment inside `development_status`. The 192 per-epic comment lines are preserved verbatim in `_bmad-output/implementation-artifacts/sprint-status-comment-archive-2026-10-14.md`, and a header pointer tells future agents to put epic notes in `epics.md`.

**Run order reminder.** Run `/epic-cycle 43` before `/epic-cycle 42`. The tracker's "next story" recommendation follows epic numbers, not the run order.
