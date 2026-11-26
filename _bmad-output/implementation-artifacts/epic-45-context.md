# Epic 45 Context: Security Boundaries

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make the safety settings mean what the documentation says, and make the documentation say where the real boundary is. This responds to an external user's security report (GitHub issue #1). SQL honors SQL privileges, a read-only connection never installs anything on IRIS, the IRIS side can be removed cleanly, `block` also turns off the raw-read and code-execution tools, and the README and `SECURITY.md` state the trust model. Two burn-down stories then close the epic's deferred-work ledger. One release, `1.3.0` (minor), ships at epic end.

## Stories

- Story 45.1: SQL Statements Honor SQL Privileges
- Story 45.2: Auto-Install Setting, Off Under Read-Only
- Story 45.3: Careful Uninstall of the IRIS Side
- Story 45.4: Block Turns Off Raw-Read and Code-Execution Tools
- Story 45.5: What the Safety Settings Protect
- Story 45.6: Epic 45 Burn-down, IRIS Side
- Story 45.7: Epic 45 Burn-down, TypeScript and Docs

## Requirements & Constraints

- **SQL privileges:** the custom SQL route prepares with privilege checking on, with no off-switch. Prepare runs before every refusal check, so an account without a grant gets IRIS's privilege error (through `SanitizeError`) instead of `SQL_READ_ONLY`, `countOnly` or cap refusals. Atelier's own `action/query` still prepares with checking off; out of scope, documented.
- **Automatic install:** `IRIS_AUTO_INSTALL` and a per-profile `autoInstall` (never inherited from `default`, never via the governance file). On by default; `IRIS_GOVERNANCE_PRESET=read-only` forces it off, and an explicit "on" with read-only (or a malformed value) fails startup. Install off means read only: no upload, compile or `Setup` write. On `missing`/`stale`/`unconfigured`, custom-REST calls get a stable not-installed refusal; Atelier-only tools keep working.
- **Uninstall:** the documented terminal one-liner `Do ##class(ExecuteMCPv2.Setup).Uninstall()` (needs `%Admin_Manage`; never an SQL procedure, tool or CLI). It removes `%ALL` and `^UnitTestRoot` only when the install record says the install created/set them (and `%ALL` holds nothing else, `^UnitTestRoot` is unchanged); with no record it leaves both and prints the manual commands.
- **`block`:** 12 keys declared once as `DATA_POLICY_BLOCK_KEYS` in `@iris-mcp/shared` seed disabled; an explicit governance `true` re-enables one. One startup `[WARN]` per server names covered tools still enabled under `redact`/`block`, pointing at the README section "What the safety settings protect".
- **No new tool and no new governance key.** Tool counts, presets and `GOVERNANCE_BASELINE` (`1e62c5ad5bf7`/141, `:check` only) unchanged. `Setup`'s `SqlProc` set stays exactly five.
- **Back-compat:** with no new setting and the policy not `block`, every request/response is byte-identical apart from the warning line and the privilege refusal. Each behavior change is a named sanctioned change in `CHANGELOG.md` and a changeset; goldens change only via `fixtures/sdk-golden-sanctioned-changes.json`, never recaptured.
- **Proof:** probe first (local `irislib/`/`irissys/`, then a throwaway). Each gate proven red on the path it guards; live or mutation proof for every resolved fix. Uninstalls, user/role/grant changes and `%ALL` changes run only on a throwaway (`scripts/throwaway-iris.mjs`), never the shared instance.
- **Burn-down (45.6, 45.7):** each ledger entry ends resolved, closed with evidence or closed by decision (no re-deferral), mirrored into the ledger and tallied mechanically. The lead smoke includes a least-privilege leg. Where behavior moves, the README "What the safety settings protect" section changes in the same story. DW-719/720/722 are owner items, out of scope.
- **45.7 scope:** DW-770 (install-off profile treats a hash-equal marker as current, whatever semver says; Rule #59 one-byte mutation proof), DW-767 (startup bootstrap target vs `IRIS_PROFILES` default entry; probe), DW-784 (`iris_sql_analyze` stats/running literals under `block`: join the block set or close with evidence), DW-788 (compile check must not use the filtered `docnames` list, which is empty for an account without SQL privileges), DW-790 (bootstrap must read and report the `%Status` row from `Setup_Configure`/`Setup_ConfigureMapping`; live refusal pin plus mutation), DW-791 (align TS least-privilege texts), DW-792 (probe whether a failed install leaves the namespace table broken after a rolled-back `%ALL` create), plus the `SECURITY.md` "Supported versions" and tone rewording with its doc-claims pins.
- **DW-792 binding:** the R10 guard is the first statement of `Configure` and `ConfigureMapping`, so a refusal never leaves a half-created `%ALL`; pin by source and a live leg (namespace list and switch succeed after a refusal). If a failed install can break the namespace table, fix it here: `Setup` runs `ActivateAll` on the failure path (moves `BOOTSTRAP_VERSION`) or the failure report names the exact recovery command, whichever the probe supports, with live proof; otherwise close with evidence.

## Technical Decisions

- **Governance cascade:** `env.profile ?? env.global ?? file.profile ?? file.global ?? inheritedDisable ?? dataPolicySeed ?? presetSeed ?? defaultSeed`. A seeded disable is not inherited. A denial is `GOVERNANCE_DISABLED` with `configSource: "dataPolicy"`, `dataPolicyApplied: "block"`, never `presetApplied`. Visibility is never a safety control.
- **Gateway refusal:** the not-installed refusal lives in the one gateway, keyed on the `/api/executemcp/v2` prefix per profile; no per-tool flag. `iris_server_profiles` reports effective `autoInstall` and its source additively.
- **Install record:** global `^ExecuteMCPv2.InstallRecord` per namespace where a step ran. `Config.Namespaces.Delete("%ALL")` deletes all mappings and never refuses, so guard before calling it.
- **`Setup` since 45.6:** `Configure`/`ConfigureMapping` refuse inside a transaction during a web request (`$TLEVEL>0` and `$IsObject($Get(%request))`), so a SELECT through `iris_sql_query` cannot run them; the bootstrap (Atelier, `$TLEVEL=0`), IPM and a terminal are unaffected. `IsConfigured` falls back to the CSP application lookup when `%SYS` cannot be read. No bootstrapped class names an `Ens`/`EnsLib`/`HS` type at compile time. Database routes read and write `resource`/`readOnly`/`globalJournalState` through `SYS.Database`.
- **Compile check:** a compile counts only when a check that reads no localized text confirms every class compiled (dictionary query joined to `CompiledClass`, plus `docnames` `upd`); an HTTP 200 is not success.
- **Bootstrap discipline:** a bootstrapped-class change regenerates the embed in the same story and records `BOOTSTRAP_VERSION` from → to; a new class joins both rosters. The IPM tree (and `gen:ipm:check`) moves only at the release version step.
- **Trust model:** governance, presets, confirmations, audit log, data policy and SQL safety settings run in the MCP process and guard the agent. The audit log records MCP tool calls only. `%Development` runs ObjectScript, so database resources bound the data and SQL grants bound the SQL tools. Remaining residual: a direct call (e.g. Atelier `action/query`) by an account whose privileges allow it. Getting past a control through the suite's tools is a vulnerability; using the account directly is not.

## Cross-Story Dependencies

- Order 45.1 → 45.7. 45.2 precedes 45.3 (uninstall docs rely on `IRIS_AUTO_INSTALL=false`). 45.6 precedes 45.7 because DW-773's outcome shapes what 45.7 documents.
- 45.1, 45.3 and 45.6 moved `BOOTSTRAP_VERSION`; after upgrade a read-only-only deployment finds a `stale` side until one normal start or IPM install (DW-770 narrows this).
- The epic-done capstone `packages/iris-mcp-all/src/__tests__/epic45-capstone-gate.test.ts` (default suite, each point proven red, plus one armed CI run on a throwaway) must stay green; its doc-rot guard derives the README covered-tool list from `DATA_POLICY_BLOCK_KEYS`, so a DW-784 key change moves both together.
