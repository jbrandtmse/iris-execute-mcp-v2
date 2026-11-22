# Epic 44 Context: Correctness & Safety Fixes

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Fix five defects that shipped in `1.1.0` and were found by Epic 42's reviews. Each fix is proven on the path it guards (Rule #59). After this epic, a DocDB database created through the suite can be used by every other DocDB tool. VS Code users keep a working MCP setup after VS Code removes the Local harness in February 2027. A human confirmation counts only for the scope its dialog showed. Bootstrap's `compiled` tells the truth about partial compile failures. An armed integration run can no longer report "passed" for a test that tested nothing. The work is strictly fix-forward: no new tool, no MVP change, and nothing rolled back.

## Stories

- Story 44.1: DocDB Create Registers the Database
- Story 44.2: VS Code Copilot MCP Configuration Targets
- Story 44.3: Confirmation Bound to the Scope Shown
- Story 44.4: Bootstrap Compile Result Accuracy
- Story 44.5: Integration Suites Cannot Pass Without Testing

## Requirements & Constraints

- **Probe before building.** Each story verifies its API and documentation claims first, and amends the epic text in place if a claim is wrong. Three claims are known to be unverified or contradicted:
  - the DocDB registration API (`$$Create^%SYS.DOCDB`: signature, privilege, `%SYS` requirement, whether REST DELETE removes the record, the version range);
  - VS Code's Copilot-harness file semantics (the Windows path, the workspace `.mcp.json` gate, which file wins on a name conflict, forwarding of extension-provided definitions);
  - the Atelier compile envelope. An earlier review found that a partly failing compile answers HTTP 200 with the failure only in the localized console.
- **No new tool and no new governance key.** Tool counts stay unchanged. `GOVERNANCE_BASELINE` stays frozen at `1e62c5ad5bf7`/141, and is checked with `:check` only. A story that needs a new tool, action or key stops and amends the epic first.
- **Back-compat.** Each story names the behavior that must not move, and pins it with an assertion that fails on drift (`toEqual` against a pre-story capture).
- **Live proof.** Endpoint-backed stories drive the live route, including one destructive-path refusal. Fixes are proven live or mutation-verified.
- **Pinning gates.** Each story's gate runs in the default suite, is proven red on the path it actually guards, and names that path in its verification.
- **Epic-done.** There is no cross-cutting capstone, because the five fixes are independent. The epic is done when the default suite is green and one armed CI run of the wave-branch tip is green, with 44.5's guard-return check in the gates job and no skip outside the allowlist. Story 44.5 records the run URL.
- **Release.** There is one release, at the end of the epic. It must ship before 2027-02-01, it carries at least `@iris-mcp/client-config`, and the Lead approves it. No story publishes anything.
- **Out of scope:** the remote/HTTP transport; store publishing, the GitHub-release job and the plugin directory; any other ledger item, except what the 44.0 gate brings in under its own rules.
- **Tracking.** The five fixes are tracked as `sprint-status.yaml` action items, not ledger entries. They are already `in-progress`, so the 44.0 gate must not pull them in again. They close at the Epic 44 retrospective, with the owner's confirmation.

## Technical Decisions

- **The architecture spine binds every story.** Where a story and the spine disagree, the spine wins and the story is amended. The spine's AD-14, AD-30 and AD-34 already carry this epic's amendments.
- **IRIS-side handlers (44.1).**
  - Handlers are thin: validate the input, switch namespace, delegate to system classes, and return raw data. Judgment lives in TypeScript.
  - New routes are additive-only within the major version, proven by a pin.
  - Namespace switching uses save/restore with a local variable, never `New $NAMESPACE`, and the catch block restores the namespace first.
  - `Security.*` calls run in `%SYS`.
  - Real IRIS error text passes through `SanitizeError`, never a generic "Failed to X".
  - Authorization belongs to IRIS: no privilege pre-checks and no role escalation.
- **Bootstrap discipline.**
  - A change to a bootstrapped class regenerates the embed in the same story and records `BOOTSTRAP_VERSION` from → to. It is `1.1.0+2.244fe8623c76` at the wave start.
  - A new class joins both rosters: `gen-bootstrap.mjs` and `bootstrap.test.ts`.
  - The IPM tree is regenerated only by the release's version step.
  - A compile counts as succeeded only when a check that reads no localized text confirms that every embedded class compiled. An HTTP 200 from `action/compile` is not success on its own (44.4).
  - The candidate oracles are the envelope fields (if they carry the failure), a class-dictionary query through `action/query`, or an up-to-date check in a `Setup` method. The last one changes a bootstrapped class, so the version bump applies.
- **Confirmation binding (44.3).**
  - The fix lives in the one shared helper (`ToolContext.confirm`). Handlers never compare state.
  - The signed, single-use `requestState` (an HMAC with a per-process key and a 600 s TTL) adds a digest of the scope binding the dialog showed, and moves from `v: 1` to `v: 2`.
  - The deciding round resolves the scope again. A different digest asks again, with a new state and nonce.
  - Re-asks are bounded, so a scope that keeps changing ends in a refusal instead of looping to the client's round limit (10 rounds were observed).
  - The promote's planned Storage drops are always inside the digest.
  - A multi-round confirmation stays one logical call, with one audit entry.
  - There are six gates: audit purge, env promote execute, production clean with `killAppData`, message resend, message `resendFiltered`, and doc edit `regenerateStorage`.
- **client-config (44.2).**
  - Every write follows the protocol: validate, back up, edit, re-parse, restore on failure, and preview the diff.
  - Only owned entries are written, and foreign content is preserved byte for byte, proven on non-canonical fixtures (compact, 4-space, CRLF, comments, BOM).
  - The workspace `.mcp.json` is shared with the `claude-code` adapter. Entries in it are owned per server name, and a byte-identical entry is adopted; any other entry under that name is a conflict. A disable or remove warns that the other client reads the same file. `detect`, `status` and `doctor` show the file under both clients without counting it twice.
  - The new format has no `inputs`, no `envFile` and no `${env:…}`; it uses `${VAR}` expansion. No secret is written as a literal by default.
- **Tool-text changes.** A description or schema change is a sanctioned backward-compat change. It goes through the Frozen goldens ledger (`fixtures/sdk-golden-sanctioned-changes.json`), regenerates the tools-list snapshot, and is named in `CHANGELOG.md`. A new refusal code is also a sanctioned change, and joins the shared refusal catalog (UPPER_SNAKE_CASE).
- **Live-gate conventions (44.5).**
  - Gates are armed only by `IRIS_REQUIRE_LIVE`. The unarmed opt-in early return is correct, and goes on the allowlist.
  - Inside an armed run, a missing precondition is either a hard assertion or a `ctx.skip()` whose reason the suite's `allowedSkips` in `scripts/lib/ci-checks.mjs` names. A silent return is never allowed.
- **Shared IRIS instance.**
  - Never stop it, and never toggle a service on it.
  - Never break a bootstrapped class on it: the `%ALL` mapping sends `ExecuteMCPv2` to HSCUSTOM.
  - DocDB lifecycle and broken-compile proofs run on a throwaway, started only through `scripts/throwaway-iris.mjs`.
  - Writes go only to disposable `ExecuteMCPv2.Temp.*` classes and disposable DocDB names, which the story removes afterwards. DocDB names have no underscore.
- **IRIS-side unit tests.** Compare the reported `total` with the expected number of `Test*` methods.

## UX & Interaction Patterns

- **Confirmation dialog (44.3).** An accept proceeds, and a decline or cancel ends the call with `CONFIRMATION_DECLINED` and changes nothing. On an unchanged scope, the dialog message, the result and the audit entry stay byte-identical. A client that does not declare elicitation keeps today's `confirm: true` contract, byte-identical.
- **VS Code extension (44.2).** The MCP Clients view and every VS Code-specific text name the new targets. The extension runs the CLI through `npx -y -p @iris-mcp/client-config@1`, so an npm release may be enough to reach its users. A new vsix, if one is needed, ships through a manual step outside this epic.

## Cross-Story Dependencies

- **Order:** 44.1 → 44.2 → 44.3 → 44.4 → 44.5.
  - 44.1 goes first: it is the high-priority, user-facing defect.
  - 44.2 goes second: it has an external deadline, and a slip anywhere later in the epic delays its release.
  - 44.3 and 44.4 are independent of each other.
- **44.1 → 44.5.** 44.1 narrows `DOCDB_REASON` in `scripts/lib/ci-checks.mjs` to what is still true. 44.5 then decides whether CI runs the DocDB lifecycle, which needs `%Service_DocDB` enabled, or keeps it allowlisted, because the Epic 35 F5 gate needs the service disabled.
- **44.4 → 44.5.** 44.4 moves the CI seed's `compileProblems` check (`scripts/ci-seed-throwaway.mjs`) and the live doc helpers off English console lines. Any check that stays is recorded as a residual Rule #13 risk. 44.5 hardens the armed suites that both stories touch.
- **44.5 last.** Its armed CI run of the wave tip is the epic-done evidence.
- **Owner sitting.** 44.2's re-certification needs a consenting VS Code 1.146+ Copilot-harness user; without one, the row is marked human-only with the date. The owner may pair it with the deferred VS Code Copilot dialog check (`epic-43-decision-sheet-item-1-…`).
