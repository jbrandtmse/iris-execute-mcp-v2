# Epic 44 Context: Correctness & Safety Fixes

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Fix the defects that shipped in `1.1.0` and were found by Epic 42's reviews, plus one gap the Story 44.2 probe found. Each fix is proven on the path it guards (Rule #59). After this epic, a DocDB database created through the suite can be used by every other DocDB tool. VS Code users keep a working MCP setup after VS Code removes the Local harness in February 2027, and the launcher extension's own servers keep their connection settings and credentials in Copilot-harness sessions. A human confirmation counts only for the scope its dialog showed. Bootstrap's `compiled` tells the truth about partial compile failures. An armed integration run can no longer report "passed" for a test that tested nothing. The work is strictly fix-forward: no new tool, no MVP change, and nothing rolled back.

## Stories

- Story 44.1: DocDB Create Registers the Database
- Story 44.2: VS Code Copilot MCP Configuration Targets
- Story 44.6: Launcher Provider Works in Copilot Sessions
- Story 44.3: Confirmation Bound to the Scope Shown
- Story 44.4: Bootstrap Compile Result Accuracy
- Story 44.5: Integration Suites Cannot Pass Without Testing
- Story 44.7: Epic 44 Burn-down

## Requirements & Constraints

- **Probe before building.** Each story verifies its API and documentation claims first, and amends the epic text in place (tagged with the decision number) if a claim is wrong.
- **No new tool and no new governance key.** Tool counts stay unchanged. `GOVERNANCE_BASELINE` stays frozen at `1e62c5ad5bf7`/141, checked with `:check` only. A story that needs a new tool, action or key stops and amends the epic first.
- **Back-compat.** Each story names the behaviour that must not move and pins it with an assertion that fails on drift (`toEqual` against a pre-story capture). 44.5: no product code changes, and the default-suite test count moves only by the new check.
- **Live proof.** Endpoint-backed stories drive the live route, including one destructive-path refusal. Fixes are proven live or mutation-verified.
- **Pinning gates.** Each story's gate runs in the default suite, is proven red on the path it actually guards, and names that path.
- **Epic-done.** No cross-cutting capstone (the fixes are independent). Done when the default suite is green and one armed CI run of the wave-branch tip is green, with 44.5's guard-return check in the gates job and no skip outside the allowlist. 44.5 records the run URL.
- **Release.** One release, at the end of the epic, approved by the Lead, shipped before 2027-02-01. It carries at least `@iris-mcp/client-config` (44.2), `@iris-mcp/shared` (44.6) and the launcher vsix (44.6, attached to the GitHub Release by hand; no new release path). No story publishes anything.
- **Out of scope:** the remote/HTTP transport; store publishing, the GitHub-release job and the plugin directory; any other ledger item, except what the retro-review gate brings in under its own rules or what is already routed to a story.
- **Tracking.** The five original fixes are `sprint-status.yaml` action items, already `in-progress` (the retro-review gate must not pull them in again). They close at the Epic 44 retrospective with the owner's confirmation.

## Technical Decisions

- **The architecture spine binds every story.** Where a story and the spine disagree, the spine wins and the story is amended. AD-9, AD-14, AD-15, AD-19, AD-30 and AD-34 carry this epic's amendments.
- **Compile check (44.4, as built).** A compile counts as succeeded only when two Atelier reads confirm every class: an `action/query` over the class dictionary (a compiled row, no compile-error flag) and `docnames` (IRIS's `upd` flag). Exported from `@iris-mcp/shared` as `verifyCompiled`/`compileAndVerify`, and used by bootstrap (every writing branch, and the `current` start), the CI seed (`scripts/ci-seed-throwaway.mjs`), the live doc helpers' `compileDocs`, and the bootstrap-guard seed. No consumer reads console text. A failed compile stops the privileged steps. A failed class seeded in an armed suite now fails that suite loudly. The `current`-start check's 3 extra startup requests are sanctioned in the Frozen goldens ledger's `startup` section (`S-44.4-current-check`). The fake listener answers the check.
- **Bootstrap discipline.** A change to a bootstrapped class regenerates the embed in the same story and records `BOOTSTRAP_VERSION` from → to (`1.1.0+3.3e97060f5bc4`; 44.4 left it unchanged). A new class joins both rosters. The IPM tree is regenerated only by the release's version step. 44.4 moves the version only if an IRIS-side class changes.
- **Live-gate conventions (44.5).** Gates are armed only by `IRIS_REQUIRE_LIVE`; the unarmed opt-in early return is correct and goes on an allowlist. In an armed run every guard return or conditional-only assertion becomes either a hard assertion (a missing precondition fails; a create test that tolerates `isError` asserts success when armed) or a `ctx.skip()` whose reason the suite's `allowedSkips` in `scripts/lib/ci-checks.mjs` names. Never a silent return.
- **Inventory and regression check (44.5).** The inventory is mechanical and exhaustive as of a named date, over every file an armed CI suite runs (`buildLiveSuites()`: `integration-*`, `prepublish-*`, `process-gates`, `launcher-live`, `bootstrap-guard*`), including the live-gate files under `packages/iris-mcp-all`. The new check runs in the default suite and as a CI gates-job step, is proven red by re-adding `if (!created.production) return;` to `interop.integration.test.ts` on the gates-job path, and the Story 42.3 step-equality self-test lists the new step.
- **DocDB in CI (44.5).** `create` now registers the `Security.DocDBs` record (44.1), so `DOCDB_REASON` was narrowed to the one remaining precondition: the enabled service. Decide whether CI runs the DocDB lifecycle (needs `%Service_DocDB` enabled) or keeps it allowlisted (the Epic 35 F5 gate needs it disabled). The `DOCDB_SKIPS` names stay unchanged. DocDB indexes every property it creates, so a lifecycle `index` step targets a property not created before.
- **Configuration channels (AD-9, 44.6 as built).** The `default` profile and each `IRIS_PROFILES` entry can take a password from the keychain / `IRIS_CREDENTIAL_HELPER` chain, opted into by `IRIS_CREDENTIAL_NAME`: `default` looks up the entry it names; each profile entry without a `password` looks up its own name. An explicit `IRIS_PASSWORD` still wins. Unset, empty or blank leaves behaviour byte-identical. A launcher-provided definition never carries a secret, and names a stored credential only for a Server Manager server defined in user (or default) settings alone; any workspace, folder or language-specific definition of that name, or a failed inspection, yields an empty provided env (DW-749). Keychain proofs use a fake keychain under a scratch HOME, never the real one.
- **As built, for reference.** 44.1: a thin `ExecuteMCPv2.REST.Security` route registers/repairs the record via IRIS's own create, with additive `registered`/`created` outputs. 44.2: `vscode` targets `~/.copilot/mcp-config.json` (or `$COPILOT_HOME`) and project `.mcp.json` (`mcpServers`, `${VAR}`, no `inputs`); the shared `.mcp.json` is refuse-only, one owner per entry, ownership recorded per file. 44.3: one shared confirmation helper binds a scope digest (state `v: 2`), re-asks once, then refuses with `CONFIRMATION_SCOPE_CHANGED`.
- **Tool-text changes.** A description or schema change is a sanctioned backward-compat change through the Frozen goldens ledger (`fixtures/sdk-golden-sanctioned-changes.json`), regenerates the tools-list snapshot, and is named in `CHANGELOG.md`. A new refusal code is sanctioned and joins the shared refusal catalog (UPPER_SNAKE_CASE).
- **Shared IRIS instance.** Never stop it, never toggle a service on it, never break a bootstrapped class on it (the `%ALL` mapping sends `ExecuteMCPv2` to HSCUSTOM). Broken-compile and DocDB-lifecycle proofs run on a throwaway via `scripts/throwaway-iris.mjs`. Writes go only to disposable `ExecuteMCPv2.Temp.*` classes and disposable DocDB names (no underscore), removed afterwards.
- **IRIS-side unit tests.** Compare the reported `total` with the expected number of `Test*` methods.

## Cross-Story Dependencies

- **Status.** 44.1 to 44.6 are done. 44.7, the burn-down, is the last story; the epic closes after it. There will be no VS Code Copilot sitting: the owner has no Copilot subscription (decision #149), so those rows are closed as not run and the release notes say the Copilot paths are verified against source only.
- **44.7 burn-down (decision #150).** Nine ledger entries, each ending terminal (resolved, closed with evidence, or closed by decision; never re-deferred). Each is probed first, and each code fix is proven live on a throwaway or mutation-verified:
  - DocDB tool defects from 44.1's probe: DW-723 (`index` re-creates an existing property), DW-724 (`property` sends no `path`), DW-725 (`manage` description claims property definitions);
  - DW-747: a client-config vscode legacy-entry cleanup dead end under the refuse-only shared `.mcp.json`;
  - the Story 44.4 compile-check root cause in other tools: DW-754 (`iris_doc_compile`), DW-755 (`iris_doc_load`, `iris_env_promote`), DW-756 (`iris_doc_xml_export` with `compile: true`). Reuse `verifyCompiled`;
  - DW-757: `iris_database_manage delete` leaves the database mounted;
  - DW-758: 12 armed tests that assert only that a reply has text.
  A description change is a sanctioned Frozen goldens entry plus a tools-list snapshot regeneration. A bootstrapped-class change regenerates the embed in the same story.
- **As built in 44.5.** `pnpm check:live-guards` refuses a test in an armed file that returns early or asserts only inside an `isError`/`created.` branch; it is syntactic, with documented limits. The CI throwaway job enables `%Service_DocDB` after `prepublish-all` and before `integration-data`, so the DocDB lifecycle runs armed with an empty allowlist. New or changed armed tests must assert their outcome unconditionally.

