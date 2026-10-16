# Epic 38 Context: Agent Code Editing & Write Safety

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make agent writes to IRIS safe and minimal. Agents can read a document by line range and edit only the lines they mean to change, under an expected-text check, and a class's Storage block can never be dropped silently. SQL writes can be held to read-only mode or capped by rows affected, and the read-classified `iris_sql_query` still works under the `read-only` preset. The suite rejects any transport other than stdio. Stories 38.0 to 38.6 shipped all of this. The remaining story, 38.7, fixes 11 defects the epic found:

- a governance config that fails open;
- a production delete that can remove any class;
- the launcher passing `MCP_TRANSPORT` through to the servers it starts;
- document I/O that reports errors as success, gets 409s it cannot handle, or calls a dead `modifiedSince` route;
- promote writes whose status is never checked;
- live-gate cleanup that depends on test order;
- an overclaiming SQL cap message;
- default-suite gates that run in parallel.

Each fix is proven live or by mutation. The architecture spine binds every story. Where a story's text and the spine disagree, the spine wins, and the story text is amended in place.

## Stories

- Story 38.0: Epic 37 Deferred Cleanup
- Story 38.1: Reject the Unimplemented HTTP Transport
- Story 38.2: Line-Range Document Read
- Story 38.3: Storage Block Drop Guard
- Story 38.4: Surgical Line Edit Tool
- Story 38.5: SQL Write Safety
- Story 38.6: Editing and SQL Safety Docs, Prompt and Capstone
- Story 38.7: Epic 38 Burn-Down

## Requirements & Constraints

- **Wave rules.**
  - Probe every API and code-reuse claim live before coding. When a claim is wrong, amend the story text.
  - `GOVERNANCE_BASELINE` stays frozen at `1e62c5ad5bf7`/141 and is checked with `:check` only.
  - 38.7 adds no tool, action or key, so the counts stay put: dev 31 package / 32 advertised tools, suite 107/112, dev `core` 14/15 runtime, 12 prompts.
  - A changed bootstrapped class regenerates the embed in the same story and records `BOOTSTRAP_VERSION` from `d352a6a32158` to the new value.
  - Changesets are `patch`/`minor` only: no `changeset version`, no publish, no CI wiring.
- **Burn-down bar.**
  - Every entry is fixed and then proven, either live on the real surface or by mutation (revert, see it go red, restore). Name the path that was exercised.
  - Every entry, DW-529 included, gets a terminal ledger disposition through `ledger.sh`.
  - Tallies are counted mechanically.
- **Sanctioned behavior changes** (orchestrator decision #17, AD-15). Each is named in `CHANGELOG.md` with the story:
  - DW-533: the new refusal;
  - DW-542: `isError`;
  - DW-554: fail-fast;
  - DW-549: the version-checked save, under Fixed, following decision #7.

  Everything else is byte-identical and pinned with `toEqual`. That includes every valid governance config, the 38.2 no-range `iris_doc_get` literals, and `iris_doc_load`'s default `ignoreConflict: true` path.
- **Shared IRIS instance.**
  - Never stop it, and never start a production on it.
  - Write only to disposable `ExecuteMCPv2.Temp.*` fixtures. Remove them before and after each run, and assert they are gone.
  - Name the target with all six `IRIS_*` variables. `default` is localhost:52773, HSCUSTOM, IRIS 2026.2 build 221U, Atelier v8. The code's default namespace is `USER`.
  - HSCUSTOM has no current non-Stopped production.
- **Owned elsewhere; do not fix incidentally.**
  - Storage guards on `iris_doc_load`, promote and the XML import (DW-544/545/546, terminal). DW-549 and DW-530 change only version and status handling.
  - The launcher suite being red on macOS (DW-532, Story 42.7).
  - `destructiveHint` corrections (DW-560, Story 42.1).
  - The HTTP transport (DW-538, a Lead action item).
  - Helper consolidation (DW-543/550/557/561, terminal).

## Technical Decisions

- **DW-554: governance config (AD-6, AD-8).**
  - One shared validator, `parseGovernanceRoot` in `governance.ts`, serves `IRIS_GOVERNANCE`, `IRIS_GOVERNANCE_FILE`, the governance CLI's write commands and promote's target-policy check. Fix it there once, so all of them agree.
  - The shape the code implements and the README documents is `{"global":{...},"profiles":{"<name>":{...}}}`. Non-object layers and non-boolean values already fail. The defect is that unknown top-level keys are silently dropped.
  - The bullet's "neither `global` nor a known profile" wording, and the ledger's `{"<profile>":{...}}`, do not match that shape. Reconcile them and amend the text (Rule #42). Whether an unrecognized name under `profiles` should also fail is the story's decision to make and record.
  - Errors name the variable (plus the path, for the file), state the documented shape, and never echo file contents.
- **DW-533 and DW-531: production delete.**
  - Where: the bootstrapped `Interop.cls` `ProductionManage` delete, behind `iris_production_manage:delete`, a frozen-baseline write that is enabled by default.
  - The defect: it deletes any existing class, so it also gets around an `iris_doc_delete` disable. Refuse a non-production class and write nothing.
  - Keep 38.0's guarantees:
    - the state guard runs before both delete paths;
    - "non-Stopped" means any state except 2 and -2, checked only for the current production;
    - Running keeps its exact message;
    - the orphan `Ens.Config.Production` row (no class) is still removed, with `orphanRemoved: true`.
  - DW-531 seam: one classmethod that runs status, then `DeleteBlockedByState(pTarget, pCurrentName, pState)`, then the message. The handler calls it, and tests drive it with an injected name and state.
  - Precedent: the route's existing error envelope, with no new code. Keep AD-33 additive and restore the namespace per AD-13.
  - IRIS tests live in `InteropHostGuardTest` (predicates) and `InteropProductionDeleteTest` (real HTTP). Compare `total` with the `Test*` count.
- **DW-539: launcher environment.**
  - `extensions/iris-mcp-launcher/src/env.ts` `LAUNCHER_OWNED_VARS` nulls ambient variables, because the stdio definition's env is layered on top of the editor's. `MCP_TRANSPORT` is missing from that list. It is never renamed.
  - The launcher spawns only stdio servers, so nulling it loses nothing.
  - `selectServers.test.ts` pins the env object with `toEqual`.
  - Run the targeted launcher files and record the baseline-red set (DW-532) as pre-existing.
- **Document I/O (AD-24).**
  - **Version flow (38.3).** An unversioned PUT to an existing document returns a 409 that carries the current document (9 keys) and its `ts`. Save once more with `If-None-Match: <ts>`. A 409 on that save is a `DOCUMENT_CONFLICT` and is never retried.
    - DW-549 applies this flow to load's `ignoreConflict: false` path, with outcomes reported per file. Also fix load's description, and replace its resolving-PUT fake with the real 409 shape (Rule #54).
  - **Soft errors.** Atelier can answer HTTP 200 with `content: ""` and a non-empty `result.status`. The shared `atelierDocStatusError` detects this.
    - DW-542: the no-range read reuses the ranged read's M6 handling.
    - DW-530: promote `execute` checks each PUT. Execute halts on the first error (AD-17). A status can come from a post-save source-control hook, so the error text never claims that nothing was stored (DW-535).
  - **modifiedSince (DW-528, DW-529).**
    - Today the three tools send `GET /modified/<ts>`, which returns 405.
    - The real route is `POST /modified/CLS` with a `[{dbname, dbhash}]` body, and it reads `generated`. It compares database hashes, not timestamps.
    - Probe whether a timestamp can map onto it. If not, refuse with a clear error and keep the parameter: removing it is breaking (AD-15).
    - Fix the descriptions and the dev README in the same change.
    - DW-529: apply `category`/`type` on that branch, or stop reporting them in `filtersApplied`.
  - **Write-path roster.** `document-write-paths.test.ts` pins each `.put(` site with a count per file. New sites move the counts, which are taken from the scan. Their verdicts stay `excluded`.
- **DW-558: SQL cap text.**
  - The `overCap` text ("Its row changes were undone") lives in TypeScript `sql.ts`, so there is no bootstrap move.
  - Hedge the claim to journaled storage. Do not add storage detection; it is high-risk.
  - Update the pins in `sql-safety.test.ts`, the dev live gate and the 38.5 wire gate, and add one docs line.
- **Live gates.**
  - A gate carries its own `process.env.IRIS_REQUIRE_LIVE ===` check and is listed in its package's `prepublish-gate.mjs` `gateTestFiles`. `live-gate-roster.test.ts` enforces the listing.
  - **DW-556.** Cleanup and the nothing-left assertions go in `beforeAll`/`afterAll`, never in a final `it()`. The dev `doc-edit-live-gate` and `doc-put-storage-guard-live-gate` still end in `describe("cleanup …")`. The epic says three gates, so enumerate the set mechanically. Then re-run each armed gate.
  - **DW-562.**
    - `iris-mcp-all/vitest.config.ts` has no `fileParallelism`; only the prepublish scripts pass `--no-file-parallelism`.
    - The three bootstrapping gates are the 38.4 wire gate, the 38.5 wire gate and the capstone. Each calls `assertDeployedBootstrapVersion` in `beforeAll`.
    - Vitest 2.1.9 has `fileParallelism` and `poolMatchGlobs`, but not `sequence.groupOrder`.
    - Prove the fix red on the default-suite path (Rule #59).
- **Refusals.** A refusal is `isError` and changes nothing. Codes come only from `refusals.ts`, and argument errors carry no code. Error text reads `<what happened>. <what to do about it>.`, passes through `SanitizeError`, and has one leading `ERROR #N:` stripped.

## Cross-Story Dependencies

- **Reused from earlier stories:**
  - 38.0: `atelierDocStatusError`, `stripLeadingBom`, and the delete predicates plus the orphan path;
  - 38.1: stdio-only `resolveTransport` (exit 1 before any IRIS traffic). `inheritedEnv` in `process-gate-helpers.ts` drops `MCP_TRANSPORT` for the process gates;
  - 38.2: the M6 handling;
  - 38.3: the 409 flow, the refusal catalog and the write-path roster;
  - 38.4 and 38.5: the parent keys and `Sql.cls`;
  - 38.6: `assertDeployedBootstrapVersion` and the capstone.
- **Bootstrap.** DW-533 and DW-531 share one handler, so do them together with one regeneration. The moved `BOOTSTRAP_VERSION` then fails each bootstrapping gate's deployed==shipped check until an armed start redeploys through the normal bootstrap path. Land DW-562's serialization first, so those redeploys never race.
- **Pairings.** Do DW-528 and DW-529 together. DW-549 and DW-530 reuse the 38.3 and 38.0 helpers.
- **Build loop.** Dev and `iris-mcp-all` import shared through `dist`, so rebuild shared first; process gates fail on a stale dist. Run build and test per package when the turbo run flakes.
- **Epic close.** Record:
  - `:check` exit 0;
  - unchanged tool counts;
  - `BOOTSTRAP_VERSION` over the whole epic, from `2159ec9e6f69` to the value 38.7 records;
  - `check-epics-sync.mjs` OK.
