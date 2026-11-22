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

## Requirements & Constraints

- **Probe before building.** Each story verifies its API and documentation claims first, and amends the epic text in place if a claim is wrong. Settled so far: the DocDB API (44.1; versions 2023.1 to 2025.x are a recorded residual risk) and VS Code 1.147.0's forwarding semantics from source (44.2). Still open:
  - the live Copilot-harness behaviour (44.2): the Windows user-file path, whether the workspace `.mcp.json` is read with `chat.mcp.workspaceRootConfig.enabled` off, which file wins on a name conflict;
  - where a provided definition can carry settings and the password outside `resolveMcpServerDefinition`, and whether the provider learns which harness asked (44.6);
  - the Atelier compile envelope (44.4). An earlier review found that a partly failing compile answers HTTP 200 with the failure only in the localized console.
- **No new tool and no new governance key.** Tool counts stay unchanged. `GOVERNANCE_BASELINE` stays frozen at `1e62c5ad5bf7`/141, and is checked with `:check` only. A story that needs a new tool, action or key stops and amends the epic first.
- **Back-compat.** Each story names the behavior that must not move, and pins it with an assertion that fails on drift (`toEqual` against a pre-story capture).
- **Live proof.** Endpoint-backed stories drive the live route, including one destructive-path refusal. Fixes are proven live or mutation-verified.
- **Pinning gates.** Each story's gate runs in the default suite, is proven red on the path it actually guards, and names that path in its verification.
- **Epic-done.** There is no cross-cutting capstone, because the fixes are independent. The epic is done when the default suite is green and one armed CI run of the wave-branch tip is green, with 44.5's guard-return check in the gates job and no skip outside the allowlist. Story 44.5 records the run URL.
- **Release.** There is one release, at the end of the epic. It must ship before 2027-02-01 and the Lead approves it. It carries at least `@iris-mcp/client-config` (44.2, a `patch` changeset) and the launcher vsix (44.6), which is attached to the GitHub Release by hand, with no new release path. No story publishes anything.
- **Out of scope:** the remote/HTTP transport; store publishing, the GitHub-release job and the plugin directory; any other ledger item, except what the retro-review gate brings in under its own rules.
- **Tracking.** The five original fixes are tracked as `sprint-status.yaml` action items, not ledger entries. They are already `in-progress`, so the retro-review gate must not pull them in again. They close at the Epic 44 retrospective, with the owner's confirmation.

## Technical Decisions

- **The architecture spine binds every story.** Where a story and the spine disagree, the spine wins and the story is amended. AD-14, AD-15, AD-30 and AD-34 already carry this epic's amendments.
- **IRIS-side handlers (44.1).** Thin: validate, switch namespace with save/restore (never `New $NAMESPACE`; the catch block restores first), delegate to system classes, return raw data. `Security.*` calls run in `%SYS`. Real IRIS error text passes through `SanitizeError`. No privilege pre-checks and no role escalation. New routes are additive-only, proven by a pin.
- **DocDB registration (44.1), as probed.**
  - `create` creates the database and registers its `Security.DocDBs` record in one call, and repairs a database that exists without one. A failed registration reports the real IRIS text and says whether the database was created. The output gains additive fields `registered` and `created`; the description change is append-only, sanctioned as `S-44.1-docdb-manage-text`.
  - The handler joins `ExecuteMCPv2.REST.Security`: no class is added, so the rosters do not change, but the embed is regenerated.
  - `Ens.Setting.Report.base` passes a lowercase `resource` key that `Security.DocDBs` ignores. It is not a model to copy.
  - `drop` needs no change. A database created by `1.1.0` or earlier answers #822 even to `drop` until `create` repairs it. `translateDocDbAccessDenied` names the missing record when the service is enabled; its disabled-service branch is unchanged.
  - DocDB indexes every property it creates, so a lifecycle test's `index` step targets a property not created before (#5805 otherwise).
- **Bootstrap discipline.** A change to a bootstrapped class regenerates the embed in the same story and records `BOOTSTRAP_VERSION` from → to (`1.1.0+2.244fe8623c76` at the wave start). A new class joins both rosters. The IPM tree is regenerated only by the release's version step.
- **Compile oracle (44.4).** A compile counts as succeeded only when a check that reads no localized text confirms every embedded class compiled; an HTTP 200 from `action/compile` is not success on its own. Candidates: the envelope fields (if they carry the failure), a class-dictionary query through `action/query`, or an up-to-date check in a `Setup` method (which triggers the version bump).
- **Confirmation binding (44.3).** The fix lives in the one shared helper (`ToolContext.confirm`); handlers never compare state. The signed, single-use `requestState` (HMAC, per-process key, 600 s TTL) adds a digest of the scope the dialog showed and moves from `v: 1` to `v: 2`. The deciding round resolves the scope again; a different digest asks again with a new state and nonce. Re-asks are bounded, so a scope that keeps changing ends in a refusal (10 client rounds were observed). The promote's planned Storage drops are always inside the digest. A multi-round confirmation stays one logical call with one audit entry. Six gates: audit purge, env promote execute, production clean with `killAppData`, message resend, message `resendFiltered`, doc edit `regenerateStorage`.
- **client-config (44.2).**
  - Every write follows the protocol: validate, back up, edit, re-parse, restore on failure, preview the diff. Only owned entries are written; foreign content is preserved byte for byte, proven on non-canonical fixtures (compact, 4-space, CRLF, comments, BOM).
  - New `vscode` targets: user `~/.copilot/mcp-config.json` (or `$COPILOT_HOME/mcp-config.json`), project `.mcp.json`, root key `mcpServers`, `${VAR}` expansion, no `inputs`, no `envFile`, no `${env:…}`. No secret is written as a literal by default. The other 14 adapters stay byte-identical.
  - VS Code 1.147.0 forwards less than its docs say: a profile `mcp.json` entry with any unresolved variable (`${env:…}` included) is not forwarded, so today's entries already miss Copilot sessions.
  - **Shared `.mcp.json`** (with the `claude-code` adapter). Entries are owned per server name. A client updates an entry as before only when it alone owns it (for the pre-sharing writer, an unrecorded canonical entry also counts). Otherwise an entry equal as a JSON value is adopted without a write, and any other entry under that name is a conflict that refuses the write. A disable or remove warns that the other client reads the same file. `detect`, `status` and `doctor` show the file under both clients without counting it twice.
  - **Ownership is per file.** Every ownership and stash record carries the resolved config path (additive optional field; old state files still parse). A peer's record counts only when it names the same file; a path-less record never does. A client's own records and stashes belong to their file: a stash is enabled only into that file, and after a project folder moves, `apply` re-establishes ownership. An adoption never takes ownership away: adopting an entry Claude Code owns in that file without a record for it records Claude Code for the file too; an adopting `enable` records the enabler.
- **Launcher provider (44.6).** The provided definition carries the non-secret `IRIS_*` connection settings the resolver sets today, plus a named secret path. No literal secret goes into a provided definition without the same typed-confirmation opt-in as 44.2's `explicit` mode. The `env.ts` env allowlist still holds. Under the Local harness the resolver still runs exactly as today. Every fake of a VS Code API returns a shape the real API can return.
- **Tool-text changes.** A description or schema change is a sanctioned backward-compat change: it goes through the Frozen goldens ledger (`fixtures/sdk-golden-sanctioned-changes.json`), regenerates the tools-list snapshot, and is named in `CHANGELOG.md`. A new refusal code is also sanctioned and joins the shared refusal catalog (UPPER_SNAKE_CASE).
- **Live-gate conventions (44.5).** Gates are armed only by `IRIS_REQUIRE_LIVE`; the unarmed opt-in early return is correct and goes on the allowlist. In an armed run, a missing precondition is a hard assertion or a `ctx.skip()` whose reason the suite's `allowedSkips` in `scripts/lib/ci-checks.mjs` names. Never a silent return.
- **Shared IRIS instance.** Never stop it, never toggle a service on it, never break a bootstrapped class on it (the `%ALL` mapping sends `ExecuteMCPv2` to HSCUSTOM). DocDB lifecycle and broken-compile proofs run on a throwaway started through `scripts/throwaway-iris.mjs`; the DocDB lifecycle runs on the shared instance only if `%Service_DocDB` is already enabled. Writes go only to disposable `ExecuteMCPv2.Temp.*` classes and disposable DocDB names (no underscore), removed afterwards.
- **IRIS-side unit tests.** Compare the reported `total` with the expected number of `Test*` methods.

## UX & Interaction Patterns

- **Confirmation dialog (44.3).** An accept proceeds; a decline or cancel ends the call with `CONFIRMATION_DECLINED` and changes nothing. On an unchanged scope, the dialog message, the result and the audit entry stay byte-identical. A client without elicitation keeps today's `confirm: true` contract, byte-identical.
- **VS Code extension (44.2, 44.6).** The MCP Clients view and every VS Code-specific text name the new targets. The extension runs the CLI through `npx -y -p @iris-mcp/client-config@1`, so the npm release carries the adapter change. The extension's settings, commands and status bar are unchanged; its README Copilot-harness section and credential-mode table say what a Copilot session gets and how the password reaches the server.

## Cross-Story Dependencies

- **Order:** 44.1 → 44.2 → 44.6 → 44.3 → 44.4 → 44.5.
  - 44.1 first: the high-priority, user-facing defect.
  - 44.2 second: it has an external deadline and is the story most likely to need rework.
  - 44.6 right after 44.2, so the owner's single VS Code re-test sitting covers both.
  - 44.3 and 44.4 are independent of each other.
- **44.2 → 44.6.** 44.6 fixes the provider gap 44.2's probe found (servers arrive without what `resolveMcpServerDefinition` adds) and reuses 44.2's `explicit`-mode opt-in.
- **Owner sitting.** The 44.2 re-certification (a consenting VS Code 1.146+ Copilot-harness user) gains a 44.6 provider-check row, run on a build carrying both stories. Without the sitting, the rows are marked human-only with the date. It pairs with the deferred VS Code Copilot dialog check (`epic-43-decision-sheet-item-1-…`).
- **44.1 → 44.5.** 44.1 narrows `DOCDB_REASON` in `scripts/lib/ci-checks.mjs`. 44.5 then decides whether CI runs the DocDB lifecycle (needs `%Service_DocDB` enabled) or keeps it allowlisted (the Epic 35 F5 gate needs the service disabled).
- **44.4 → 44.5.** 44.4 moves the CI seed's `compileProblems` check (`scripts/ci-seed-throwaway.mjs`) and the live doc helpers off English console lines, or records a residual Rule #13 risk. 44.5 hardens the armed suites both stories touch.
- **44.5 last.** Its armed CI run of the wave tip is the epic-done evidence.
