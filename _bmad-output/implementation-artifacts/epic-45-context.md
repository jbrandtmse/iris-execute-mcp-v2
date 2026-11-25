# Epic 45 Context: Security Boundaries

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make the safety settings mean what the documentation says, and make the documentation say where the real boundary is. The epic answers GitHub issue #1, an external user's security review that the Planner verified against `1.2.0`. After it:

- SQL sent through the suite honors the account's SQL grants.
- A read-only connection never installs or repairs anything on IRIS, and any operator can turn the automatic install off.
- The IRIS side can be removed cleanly without touching shared pieces the install did not create.
- The `block` data policy also turns off the raw-read and code-execution tools.
- The docs state plainly that the safety settings guard the agent, and that the IRIS account's privileges are the boundary.

## Stories

- Story 45.1: SQL Statements Honor SQL Privileges
- Story 45.2: Auto-Install Setting, Off Under Read-Only
- Story 45.3: Careful Uninstall of the IRIS Side
- Story 45.4: Block Turns Off Raw-Read and Code-Execution Tools
- Story 45.5: What the Safety Settings Protect

## Requirements & Constraints

- **Probe first.** Every IRIS claim marked "probe" in a story is unverified at planning time. Check it in `irislib/`/`irissys/`, then on a throwaway (`scripts/throwaway-iris.mjs`, digest-pinned image, host port 52792, always removed afterwards). Amend the epic text in place if a claim is wrong.
- **No new tool and no new governance key.** Tool counts, presets and `GOVERNANCE_BASELINE` (frozen `1e62c5ad5bf7`/141, `:check` only) stay unchanged. If a story finds it needs a new tool, it stops and amends the epic first.
- **Sanctioned behavior changes** (AD-15, each named in `CHANGELOG.md` with its story):
  - `S-45.1-sql-privileges`;
  - `S-45.2-read-only-no-install`;
  - `S-45.3-careful-uninstall` (`Setup.Uninstall`, not a REST route);
  - `S-45.4-block-raw-tools`.
- **Back-compat.** With no new setting used and the data policy not `block`, every request and response is byte-identical. The only exceptions are the new 45.4 startup warning and the 45.1 refusal for an account without a grant. Pin both with assertions that fail on drift.
- **Live proof.** Endpoint-backed stories drive the live route, including one destructive-path refusal. Each gate is proven red on the path it guards.
- **Shared IRIS instance (localhost:52773).** Never stop or modify it. No uninstall, user or role change, SQL grant or `%ALL` change there; those proofs run on throwaways only.
- **Owner rulings (2026-11-24/25):**
  - One release, `1.3.0` (minor), at epic end. No story publishes, and each story adds its changeset per convention.
  - C-2: a read-only-only instance refuses after a class-changing release until it is upgraded once. The README, the refusal message, the CHANGELOG and the release notes say so.
  - C-3: `SECURITY.md` keeps bypassing a control through the servers' tools in scope, and puts direct use of the IRIS account out of scope.
  - C-4: the IPM-owned stale warning stays as it is.
  - The 45.3 uninstall form and the 45.4 `block` extra-tools list are decided at their spec gates.
- **Optional evidence.** The reporter's probe cases on issue #1, if shared. They are never a dependency.

## Technical Decisions

- **The spine binds every story.** AD-6, AD-8, AD-9, AD-14, AD-15, AD-19, AD-25, AD-26 and AD-31 carry the epic's amendments, applied with the proposal. Where a story and the spine disagree, the spine wins.
- **45.1.** `ExecuteMCPv2.REST.Sql.Perform` prepares with `checkPriv` on, with no off-switch. A privilege failure surfaces IRIS's SQLCODE and message through `SanitizeError`. The only caller is `packages/iris-dev-mcp/src/tools/sql.ts`; re-enumerate it. Atelier's own `action/query` prepares with privilege checking off; that is IRIS's API, so it is probed and documented, not changed. One ordering change: an ungranted non-SELECT on a read-only path now answers the privilege error instead of `SQL_READ_ONLY`.
- **45.2.** New `IRIS_AUTO_INSTALL` (true/false, case-insensitive; a malformed value fails startup). It is on by default, forced off under `IRIS_GOVERNANCE_PRESET=read-only`, and per-profile `autoInstall` is never inherited (AD-9).
  - An explicit `true` together with the read-only preset fails startup, naming both settings.
  - With the install off there is no write on connect on any probe branch. `missing`, `stale` and `unconfigured` mark the custom REST service unavailable for that profile. A new refusal code (for example `IRIS_SIDE_NOT_INSTALLED`) is returned in the one gateway, keyed on the `/api/executemcp/v2` prefix, and Atelier-only tools keep working.
  - `iris_server_profiles` gains additive `autoInstall` and source fields.
  - IPM-owned installs behave as today.
- **45.3.** The install records what it created (the `%ALL` namespace, the package mapping, `^UnitTestRoot` and its value, the deploy namespaces). It records only after each step succeeds and never downgrades "created" to "existed". The record's home must survive the class deletion.
  - The uninstall removes the web app, the mapping, the classes (shadowed copies included), `%ALL` only if the install created it and it is empty, `^UnitTestRoot` only if the install set it and it is unchanged, then the record. It reports what it removed and what it left, and is idempotent.
  - Without a record (a 1.2.0 install) it leaves `%ALL` and `^UnitTestRoot` and prints the manual commands.
  - For an IPM-owned install it removes the configuration only, then points to `zpm uninstall`.
  - The form (a one-liner, a CLI command or a tool) is a probe outcome. A new tool would need an epic amendment.
- **45.4.** The covered set is declared once and checked mechanically across packages (`iris-mcp-all`, Rule #45) against the `tool_support.md` residual rows.
  - The floor: `iris_sql_query`, `iris_sql_execute`, `iris_global_get`, `iris_global_list`, `iris_execute_command`, `iris_execute_classmethod`. Recommended and judgment-call tools are decided at the spec gate.
  - Under the effective `block`, covered keys seed disabled in a new AD-6 cascade layer, above the preset seed and below every explicit layer. Governance, not visibility.
  - An explicit re-enable wins. A seeded disable is not inherited by child keys.
  - A denial is `GOVERNANCE_DISABLED` plus an additive attribution field (for example `dataPolicyApplied`), and `configSource` gains `"dataPolicy"`.
  - One startup `[WARN]` per process names the enabled covered tools under `redact`/`block`.
- **45.5.** Docs only plus the capstone `epic45-capstone-gate.test.ts` in the default suite. It replays issue #1's four points through the real SDK client, and each point is proven red by reverting its story's guard. The IRIS-side halves run in one armed CI run of the wave tip, whose URL is recorded.
- **Bootstrap discipline.** 45.1 (`REST/Sql.cls`) and 45.3 (`Setup.cls`) regenerate the embed in-story and record `BOOTSTRAP_VERSION` from → to. It starts at `1.2.0+5.6cbac260e73f`. A new class joins both rosters. The IPM tree is regenerated only by the release.
- **Process lessons from Epic 44.** Before a story push, run the full `@iris-mcp/all` suite on a closed port (`IRIS_HOST=127.0.0.1 IRIS_PORT=1`). Never push while a gate CI run is in progress. A test reading `.changeset` must skip when it is absent. Credential proofs use a scratch HOME and the fake keyring preload.

## Cross-Story Dependencies

- **Order 45.1 → 45.2 → 45.3 → 45.4 → 45.5.**
  - 45.2 comes before 45.3, because the uninstall docs rely on `IRIS_AUTO_INSTALL=false` to keep a removed instance removed.
  - 45.3 owns the install record; 45.2 needs no record.
  - 45.4 is independent of 45.1–45.3.
  - 45.5 is last: it enriches the earlier stories' minimal docs (each story ships its own variable row, capability line and default state) and assembles the capstone.
- **Out of scope:** blocking `SqlProc`-in-SELECT under read-only (documented instead), filtering SQL and global reads under `redact`, enforcing governance inside IRIS, Atelier's `action/query` privilege mode, a launcher setting for `IRIS_AUTO_INSTALL`, and DW-538, DW-719, DW-720 and DW-722.
