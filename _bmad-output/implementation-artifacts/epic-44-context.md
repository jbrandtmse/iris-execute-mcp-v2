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

- **Probe before building.** Each story verifies its API and documentation claims first, and amends the epic text in place (tagged with the decision number) if a claim is wrong. Settled so far: the DocDB API (44.1; versions 2023.1 to 2025.x are a recorded residual risk), VS Code 1.147.0's forwarding semantics from source (44.2), the confirmation anchors and round limits (44.3), and the owner's secret-path rulings (44.6). Still open: the live Copilot-harness behaviour (44.2 and 44.6, the owner's sitting) and the Atelier compile envelope (44.4; an earlier review found a partly failing compile answers HTTP 200 with the failure only in the localized console).
- **No new tool and no new governance key.** Tool counts stay unchanged. `GOVERNANCE_BASELINE` stays frozen at `1e62c5ad5bf7`/141, checked with `:check` only. A story that needs a new tool, action or key stops and amends the epic first.
- **Back-compat.** Each story names the behaviour that must not move and pins it with an assertion that fails on drift (`toEqual` against a pre-story capture).
- **Live proof.** Endpoint-backed stories drive the live route, including one destructive-path refusal. Fixes are proven live or mutation-verified.
- **Pinning gates.** Each story's gate runs in the default suite, is proven red on the path it actually guards, and names that path.
- **Epic-done.** No cross-cutting capstone (the fixes are independent). Done when the default suite is green and one armed CI run of the wave-branch tip is green, with 44.5's guard-return check in the gates job and no skip outside the allowlist. 44.5 records the run URL.
- **Release.** One release, at the end of the epic, approved by the Lead, shipped before 2027-02-01. It carries at least `@iris-mcp/client-config` (44.2), `@iris-mcp/shared` (44.6) and the launcher vsix (44.6, attached to the GitHub Release by hand; no new release path). No story publishes anything.
- **Out of scope:** the remote/HTTP transport; store publishing, the GitHub-release job and the plugin directory; any other ledger item, except what the retro-review gate brings in under its own rules.
- **Tracking.** The five original fixes are `sprint-status.yaml` action items, already `in-progress` (the retro-review gate must not pull them in again). They close at the Epic 44 retrospective with the owner's confirmation.

## Technical Decisions

- **The architecture spine binds every story.** Where a story and the spine disagree, the spine wins and the story is amended. AD-9, AD-14, AD-15, AD-19, AD-30 and AD-34 carry this epic's amendments.
- **IRIS-side handlers (44.1).** Thin: validate, switch namespace with save/restore (never `New $NAMESPACE`; the catch block restores first), delegate to system classes, return raw data. `Security.*` calls run in `%SYS`. Real IRIS error text goes through `SanitizeError`. No privilege pre-checks. New routes are additive-only, proven by a pin.
- **DocDB registration (44.1), as probed.**
  - `create` creates the database and registers its `Security.DocDBs` record in one call, and repairs a database that exists without one. A failed registration reports the real IRIS text and says whether the database was created. Additive output fields `registered` and `created`; append-only description change `S-44.1-docdb-manage-text`.
  - The handler joins `ExecuteMCPv2.REST.Security`: no class added, rosters unchanged, embed regenerated.
  - `Ens.Setting.Report.base` passes a lowercase `resource` key that `Security.DocDBs` ignores; not a model to copy.
  - `drop` needs no change. A database created by `1.1.0` or earlier answers #822 even to `drop` until `create` repairs it. `translateDocDbAccessDenied` names the missing record when the service is enabled; its disabled-service branch is unchanged.
  - DocDB indexes every property it creates, so a lifecycle test's `index` step targets a property not created before (#5805 otherwise).
- **Bootstrap discipline.** A change to a bootstrapped class regenerates the embed in the same story and records `BOOTSTRAP_VERSION` from → to (`1.1.0+2.244fe8623c76` at the wave start). A new class joins both rosters. The IPM tree is regenerated only by the release's version step.
- **Compile oracle (44.4).** A compile counts as succeeded only when a check that reads no localized text confirms every embedded class compiled; HTTP 200 from `action/compile` is not success on its own. Candidates: the envelope fields (if they carry the failure), a class-dictionary query through `action/query`, or an up-to-date check in a `Setup` method (which triggers the version bump).
- **Confirmation binding (44.3), as accepted.**
  - The fix lives in the one shared helper (`ToolContext.confirm`, via `confirmOnWire` in `server-base.ts`); handlers never compare state. The signed, single-use `requestState` (HMAC, per-process key, 600 s TTL) adds a digest of the scope binding the dialog showed and moves to `v: 2`. The deciding round resolves the scope again; a different digest asks again with a new state and nonce.
  - **Bound: one re-ask.** A scope that changes again ends with the new refusal `CONFIRMATION_SCOPE_CHANGED` (sanctioned `S-44.3-scope-changed-refusal`), audited `denied` with `confirmation: "accepted"`. Round limits observed: the SDK client's default of 10 on the 2026-07-28 era; the server shim's cap of 8 handler re-entries on 2025-11-25.
  - **Per-gate bindings.** Promote and `regenerateStorage` bind their full drop lists (their dialog texts truncate at 10 items / 600 characters). `resendFiltered` binds status, `from`, a caller-supplied `to` and the cap, never the live match count or a defaulted `to` (IRIS sets it to the current second). Purge, clean and resend bind their whole scope text.
  - **Audit.** A multi-round confirmation is one logical call with one entry. A deciding round whose handler refuses before `confirm` must leave no pending ask, so no second `unanswered` entry (a second defect this story fixes).
  - No tool description changes, so the Frozen goldens and tools-list snapshot are untouched. An accepted `resendFiltered` costs one extra read-only preview per round; its fail-closed preview stays.
  - Six gates: audit purge, env promote execute, production clean with `killAppData`, message resend, message `resendFiltered`, doc edit `regenerateStorage`.
- **client-config (44.2).**
  - Every write follows the protocol: validate, back up, edit, re-parse, restore on failure, preview the diff. Only owned entries are written; foreign content is preserved byte for byte, proven on non-canonical fixtures (compact, 4-space, CRLF, comments, BOM).
  - New `vscode` targets: user `~/.copilot/mcp-config.json` (or `$COPILOT_HOME/mcp-config.json`), project `.mcp.json`, root key `mcpServers`, `${VAR}` expansion, no `inputs`, no `envFile`, no `${env:…}`. No secret is written as a literal by default. The other 14 adapters stay byte-identical.
  - VS Code 1.147.0 forwards less than its docs say: a profile `mcp.json` entry with any unresolved variable (`${env:…}` included) is not forwarded, so today's entries already miss Copilot sessions.
  - **Shared `.mcp.json`, refuse-only (owner's option B).** Only the Claude Code and VS Code project scopes share the file; no other adapter or scope enters the rule, from any directory. Each entry has at most one owner and nothing is adopted. The owner is the client with a manager record for that file, else the one holding a stash of it, else Claude Code for a canonical name; VS Code never owns through a path-less record or none. The non-owner's `apply` (an identical entry included), `disable`, `enable`, `remove` and `restore` of an existing entry are refused (exit 1), name the owner and the file, and write nothing. Creating an absent entry, or putting a stash back into an absent entry, makes that client the owner. Configuring both clients for one project means picking one (owner-accepted).
  - **Ownership is per file.** Every ownership and stash record carries the resolved config path (additive optional field; old state files still parse), and counts only for the file it names. `detect`, `status` and `doctor` show the file under both clients without counting it twice.
- **Launcher provider (44.6), owner rulings.**
  - **Secret path.** `@iris-mcp/shared` lets the `default` profile and each `IRIS_PROFILES` entry take its password from the existing keychain / `IRIS_CREDENTIAL_HELPER` chain, opted into by a new variable naming the keychain entry. Unset, configuration and error texts are byte-identical (mechanical proof). The user stores the password once with `iris-mcp-credentials set <name>`. Sanctioned AD-9/AD-15 change.
  - **No secret in a provided definition, ever.** VS Code persists provided definitions (workspace storage and up to 8 `agentPlugins` copies), so there is no literal-password opt-in. The definition carries the non-secret `IRIS_*` settings the resolver sets today plus that variable.
  - **Env allowlist.** VS Code drops `null` env values, so the `env.ts` allowlist is enforced under the Copilot harness by empty-string overrides wherever the server treats `""` as unset; the rest is a residual risk documented in the extension README.
  - `combineProfiles` is Local-only in this story, and documented so.
  - Under the Local harness the resolver still runs exactly as today. Every fake of a VS Code API returns a shape the real API can return.
  - **Proof.** The keychain path is proven red on a fresh server process reading a fake keychain under a scratch HOME, never the real keychain.
  - The extension is outside the pnpm workspace; its version follows the `@iris-mcp/*` fixed group through `pnpm run version`, so the shared changeset carries it (no extension changeset).
- **Tool-text changes.** A description or schema change is a sanctioned backward-compat change: it goes through the Frozen goldens ledger (`fixtures/sdk-golden-sanctioned-changes.json`), regenerates the tools-list snapshot, and is named in `CHANGELOG.md`. A new refusal code is also sanctioned and joins the shared refusal catalog (UPPER_SNAKE_CASE).
- **Live-gate conventions (44.5).** Gates are armed only by `IRIS_REQUIRE_LIVE`; the unarmed opt-in early return is correct and goes on the allowlist. In an armed run, a missing precondition is a hard assertion or a `ctx.skip()` whose reason the suite's `allowedSkips` in `scripts/lib/ci-checks.mjs` names. Never a silent return.
- **Shared IRIS instance.** Never stop it, never toggle a service on it, never break a bootstrapped class on it (the `%ALL` mapping sends `ExecuteMCPv2` to HSCUSTOM). DocDB lifecycle and broken-compile proofs run on a throwaway via `scripts/throwaway-iris.mjs`; the DocDB lifecycle runs on the shared instance only if `%Service_DocDB` is already enabled. Writes go only to disposable `ExecuteMCPv2.Temp.*` classes and disposable DocDB names (no underscore), removed afterwards.
- **IRIS-side unit tests.** Compare the reported `total` with the expected number of `Test*` methods.

## UX & Interaction Patterns

- **Confirmation dialog (44.3).** An accept proceeds; a decline or cancel ends the call with `CONFIRMATION_DECLINED` and changes nothing. A changed scope re-asks once showing the new scope. On an unchanged scope, the dialog message, the result and the audit entry stay byte-identical. A client without elicitation keeps today's `confirm: true` contract, byte-identical.
- **VS Code extension (44.2, 44.6).** The MCP Clients view and every VS Code-specific text name the new targets. The extension runs the CLI through `npx -y -p @iris-mcp/client-config@1`, so the npm release carries the adapter change. Settings, commands and status bar are unchanged. The README's Copilot-harness section and credential-mode table say what a Copilot session gets and how the password reaches the server (the keychain entry, never a literal).
- **client-config refusals (44.2).** A refused shared-file write names the owning client and the file; a disable or remove warns that the other client reads the same file.

## Cross-Story Dependencies

- **Planned order:** 44.1 → 44.2 → 44.6 → 44.3 → 44.4 → 44.5. 44.1 first (high-priority user-facing defect); 44.2 second (external deadline, most rework risk); 44.6 placed after 44.2 so one owner VS Code sitting covers both; 44.3 and 44.4 independent of each other.
- **As run:** while 44.2 and 44.6 waited on owner holds, 44.3 was built ahead of 44.6; 44.6 builds after 44.3, interleaved with 44.2's rework.
- **44.2 → 44.6.** 44.6 fixes the provider gap 44.2's probe found (servers arrive without what `resolveMcpServerDefinition` adds). It no longer reuses any 44.2 opt-in: the secret path is the keychain chain in `@iris-mcp/shared`.
- **Owner sitting.** The 44.2 re-certification (a consenting VS Code 1.146+ Copilot-harness user, runbook D-6) also covers 44.6's probe rows and its provider-check row (AC 44.6.5), run on a build carrying both stories. Without the sitting, the rows are marked human-only with the date.
- **44.1 → 44.5.** 44.1 narrows `DOCDB_REASON` in `scripts/lib/ci-checks.mjs`. 44.5 then decides whether CI runs the DocDB lifecycle (needs `%Service_DocDB` enabled) or keeps it allowlisted (the Epic 35 F5 gate needs it disabled).
- **44.4 → 44.5.** 44.4 moves the CI seed's `compileProblems` check (`scripts/ci-seed-throwaway.mjs`) and the live doc helpers off English console lines, or records a residual Rule #13 risk. 44.5 hardens the armed suites both stories touch.
- **44.5 last.** Its armed CI run of the wave tip is the epic-done evidence.
