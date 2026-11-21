# Epic 43 Context: MCP SDK v2 Migration

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->
<!-- Recompiled 2026-10-20 after Story 43.3 (done; commits 9521312..687ddb1 on branch epic43), for Story 43.4. Facts verified in source on that date; line numbers are at 687ddb1. -->

## Goal

Move the suite onto the MCP TypeScript SDK v2 before Epic 42 publishes `1.0.0`, so the first public release is built on the SDK's stable line and not on v1's maintenance line (v1 stops at spec `2025-11-25`, fixes until about 2027-01-27). Three stories are done:
- 43.1: the framework runs on `@modelcontextprotocol/server` 2.3.1, and the 2025-11-25 wire matches the frozen v1 goldens byte for byte.
- 43.2: the same stdio process also serves revision `2026-07-28`, which Claude Code negotiates by default.
- 43.3: six destructive gates also ask the person through form elicitation when the client can, and a cancelled call now aborts its IRIS request.

What remains is 43.4: the gated-tool descriptions and the golden retirement they force, the live smokes, the epic capstone, and the docs and records.

## Stories

- Story 43.1: Framework Migration to SDK v2 (done)
- Story 43.2: Serve MCP Revision 2026-07-28 (done)
- Story 43.3: Human Confirmation Through Elicitation (done)
- Story 43.4: SDK v2 Docs, Smokes and Capstone (next; `backlog`)

## Requirements & Constraints

**Epic-wide**
- **Byte-identical 2025-11-25 era (Rule #19, AD-15).** Pins keep passing with assertion lines unchanged, except for changes on AD-15's sanctioned list. Each sanctioned change is named in `CHANGELOG.md`. Retiring a golden (DW-639) is a sanctioned change only once the Lead records it.
- **SDK confinement (AD-2, AD-32).**
  - Only `server-base.ts` and `sdk-wire-compat.ts` import the SDK, from `@modelcontextprotocol/server` and `/stdio` only. `confirmation.ts` and the handlers are SDK-free.
  - The guards are `story-43-1-sdk-confinement` and `-qa-pack-confinement`.
  - `@modelcontextprotocol/client` 2.3.1 is a test dependency only (shared, dev, `iris-mcp-all`). `core` is not a direct dependency.
- **Fixed for the whole epic:**
  - no ObjectScript change; `BOOTSTRAP_VERSION` stays `d51856f74d6a`;
  - 115 tools (33/27/25/22/8);
  - the governance baseline stays at 141 keys, `1e62c5ad5bf7`;
  - stdio only (AD-23);
  - no new env read (`startup-env-roster.test.ts`).
- **Out of scope:** Tasks, MCP Apps, `subscriptions/listen`, sampling, roots, URL-mode elicitation, the operator "require a human" setting, and any new tool.
- **Closed port only.** Every spawned server runs on `IRIS_HOST=127.0.0.1` with `IRIS_PORT=1` or a fake listener. Launcher runs also set `IRIS_TEST_HOST`/`IRIS_TEST_PORT`. Never the shared instance.
- **Run order.** Branch `epic43` merges into `feature/feature-wave-8-published-install`. Epic 42 publishes nothing until Epic 43 lands.

**43.4 acceptance criteria**
- **AC 43.4.1: live smokes** from the built dist in a fresh Node process (Rule #22).
  - Each server runs through a real client: Claude Code, plus one other certified client.
  - One call per era: Claude Code on default `auto`, and once with `MCP_PROTOCOL_NEGOTIATION=legacy`.
  - One confirmation round trip per era.
- **AC 43.4.2: the capstone** (Rule #21), in the default suite. One test drives a server through the real SDK client on both eras. It covers listing, a read, a governance denial, a validation error, and one accepted and one declined confirmation. It is proven red (Rule #59) by breaking the era negotiation or the decline handling, naming the path broken; it fails, never skips, on a stale dist.
- **AC 43.4.3: docs and records.**
  - The README and the client docs state the supported revisions and the confirmation behavior.
  - `CHANGELOG.md` and a changeset.
  - The spine's Stack rows, AD-32 and AD-34 (Rule 20).
  - The PRD MCP compliance line.
- **Also routed to 43.4 (`epics.md`):**
  - **Gated-tool descriptions (decision #17).** The descriptions of `iris_audit_manage`, `iris_env_promote`, `iris_production_control`, `iris_message_resend` and `iris_doc_edit` name the elicitation dialog. This lands with DW-639, and the tools-list snapshot is regenerated in the same change.
  - **DW-639.** Decide how `sdk-wire-golden.json` and `sdk-handler-golden.json` retire together: compare only what a migration can change, or hand the `tools/list` rows to the tools-list snapshot.
  - **DW-641.** An SDK v2 client on `auto`/`pin` spawns a probe process that reruns startup. Document the startup cost and the doubled log lines in the client docs, and check in the smoke that the probe exits cleanly. Claude Code 2.1.296 spawned none in the 43.2 live check: it probed on the same connection.
  - **DW-646.** `resources/list` lists `iris-governance://default` twice on both eras. Decide with DW-639: a sanctioned dedupe, or keep it.
  - **DW-653.** The `resend-failed-messages` prompt says an over-cap match and an omitted `dryRun` are refused. In fact a dry run returns the full `matchCount`, and omitting `dryRun` previews. Fix it as a sanctioned AD-15 prompt-text change and regenerate the skill.
- **Not 43.4's:**
  - DW-655, the stale "86 consolidated tools" at `prd.md:86`, belongs to 42.9.
  - DW-637's residual (bump the SDK once a release pins fast-uri ≥ 3.1.8) belongs to 42.1.
  - DW-659 and DW-660 are `wontfix-accepted`.

**Binding project rules**
- **#10:** explicit options and negotiation modes.
- **#19:** mechanical back-compat proofs, plus a diff guard on pre-existing test files.
- **#21 and #59:** one GENUINE capstone in the default suite, proven red on the path it guards.
- **#22:** smoke the dist in a fresh process.
- **#26:** smoke a decline and assert nothing changed.
- **#36:** goldens are never edited or recaptured to match the implementation.
- **#43:** docs ship with the change.
- **#45:** cross-package tests live in `iris-mcp-all`.
- **#46:** one call omits optional fields.
- **#54:** fakes return only shapes the real SDK can.
- **#25:** never run the bare governance-baseline generator.

## Technical Decisions

**Spine, as amended by wave-8 decisions #12–#22**
- **AD-3.** The chokepoint order is unchanged: Zod, then `server` → profile, `action`, the governance gate, the per-profile context, and the handler, all inside the audit wrapper. The handler list gains the optional `ToolContext.confirm`, present only on a wire call (#13).
- **AD-19 (#14, #18).** One entry per LOGICAL call, written by the round that ends it; an asking round writes none.
  - A decline (`CONFIRMATION_DECLINED`) is `denied`. The additive `confirmation` field records `accepted`, `declined`, `cancelled`, `unconfirmed` or `unanswered`.
  - An unanswered dialog is written as `error`/`unanswered` after the 600 s TTL, on connection close, or at a graceful `stop()`. A signal kill writes none (DW-659).
  - A call cancelled before its dialog is shown is audited at once as the cancelled call.
  - A call the client cancels is `error` with `CANCELLED_CALL_TEXT`.
- **AD-34 "As built" (#12, #13, #15, #16).**
  - **The gated set is exactly six:** `iris_audit_manage:purge`, `iris_env_promote:execute`, `iris_production_control:clean` with `killAppData: true`, `iris_message_resend:resendFiltered` (execute), `iris_message_resend:resend`, and `iris_doc_edit:regenerateStorage`. The last two have no `confirm`, so their fallback is governance alone.
  - **The helper** reads capabilities by era (the envelope on modern, `initialize` on legacy, never `_meta`).
  - **Binding:** signed, single-use `requestState`.
  - **Order:** each handler asks right before its first IRIS write, after all its checks.
  - **Spine text still stale for 43.4 to fix:**
    - AD-34's header says "lands in Story 43.3";
    - AD-32 says `serveStdio` uses "the default `legacy: 'serve'`" (the code passes it explicitly, `server-base.ts:2914-2917`);
    - AD-32's "Until Epic 43. The v1 floor is `>=1.31.0`" (`:648`) is obsolete.
- **#21:** `resendFiltered` fails closed (below).
- **#22:** a declined promotion may already have run the first-use bootstrap on its target profile. This is accepted (DW-658).
- **AD-17:** caps and dry run still come first. **AD-32 #7:** the cross-era pin ignores exactly six mandated fields.

**43.3 as built**
- **`packages/shared/src/confirmation.ts` (SDK-free).**
  - `CONFIRMATION_SCHEMA` has one required boolean `confirm`, default `false`.
  - `confirmationMessage` renders five lines: `Confirm: {operation}.`, `Target:`, `Scope:`, `Server: {profile} ({host}:{port})`, and the closing line. `dialogLine` turns control, `\p{Cf}`, line and paragraph separators into a space and cuts at 600 characters.
  - `declaresFormElicitation` counts `{}`, `{form}` and `{form,url}`, but not `{url}` alone.
  - Also: `contentHash` (SHA-256 of key-sorted JSON; `computePlanHash` delegates to it), `ConfirmationNonces`, `classifyConfirmationResponse`, `confirmationDeclinedResult`, `CANCELLED_CALL_TEXT`, `UNANSWERED_CONFIRMATION_TEXT`, and the `CONFIRMATION_PENDING` sentinel.
- **`ToolContext.confirm?(request)`** (`tool-types.ts:354`). It takes `{operation, target, scope: string | () => Promise<string | undefined>}` and returns `{proceed: true} | {proceed: false, result}`. It is set only by `wireToolContext` (`server-base.ts:2056`). The in-process callback and stub contexts never get it.
- **`server-base.ts`.**
  - `buildMcpServer` (890) passes `inputRequired: {legacyShim: true, maxRounds: 8, roundTimeoutMs: 600000}` and installs no SDK `requestState` hook. `server.server.onclose` flushes pending asks.
  - `tools/call` now receives `(request, ctx)` (968). `callToolFromWire` returns an input-required result unchecked.
  - In `handleToolCall` (1620), an input-required round records a pending ask instead of an audit entry.
  - In `dispatchToolCall`, a returned `CONFIRMATION_PENDING` is swapped for the question (2023).
- **The signed, single-use state (`confirmOnWire`, 2123).**
  - It uses a per-process `createRequestStateCodec` (HMAC-SHA256, `randomBytes(32)`, TTL 600 s; 479).
  - The payload is `{v: 1, tool, hash: contentHash({tool, profile, args}), nonce}`.
  - Nonces are remembered 602 s (487), because the codec counts expiry in whole seconds.
  - Decision order:
    1. A valid, unused echoed state with an answer decides, even if the retry dropped the capability.
    2. A client without the capability gets the fallback.
    3. A scope that resolves to `undefined` means proceed.
    4. Otherwise it mints the question.
  - Forged, tampered, replayed, expired or changed-argument state is asked again, with no wire error.
- **The pending-ask map** (`pendingAsks` 489, `sweepPendingAsks` 2205, `flushPendingAsks` 2231). The sweep timer is unref'd, and a swept nonce is marked used. `stop()` (2950) flushes before the audit shutdown.
- **`CONFIRMATION_DECLINED`** is the 11th code in `refusals.ts:37`. Its `structuredContent` is `{code, action, response}`, with `response` one of `decline`, `cancel` or `unconfirmed`. `deriveAuditOutcome` maps it to `denied` (2441).
- **Abort forwarding (DW-642).**
  - `RequestOptions.signal`: an already-aborted signal sends nothing and rejects with `IrisConnectionError` `CANCELLED`, and an in-flight request is aborted (`http-client.ts`).
  - `bindSignal(client, signal)` (535) wraps both `ctx.http` and the clients from `resolveProfileClient`.
  - The CSRF HEAD gets the signal only.
  - A cancelled call logs no `[ERROR]`.
- **The six call sites** (AC 43.3.1; grep `ctx.confirm` outside tests): `audit.ts:381`, `env-promote.ts:1188`, `doc-edit.ts:578`, `production.ts:216`, `message-resend.ts:553` (`resend`) and `:632` (`resendFiltered`).
- **`resendFiltered` fails closed (#21).**
  - On an eliciting client it first sends a read-only preview (`dryRun: true`, no `confirm`). The dialog appears only for 1 ≤ `matchCount` ≤ `maxMessages`.
  - A preview IRIS refuses (`IrisApiError` with `statusCode < 500`; IRIS refuses with HTTP 200) lets the execute go out as before.
  - Any other preview failure is rethrown, and nothing is sent (`message-resend.ts:609-636`).
  - `epics.md`'s DW-657 bullet still says "HTTP 4xx". The code and the spec are right.
- **Known limits.**
  - **DW-659 (`wontfix-accepted`):** no unanswered entry on a SIGTERM/SIGINT with stdin open.
  - **DW-660 (`wontfix-accepted`):** the fake listener refuses purge, clean and `resendFiltered` with HTTP 400 where IRIS uses 200, so the pinned refusal texts read "IRIS returned HTTP 400". A fix would recapture 43.3's baseline literals.
  - **Others:**
    - an accepted dialog can still be refused by an IRIS-side check;
    - the deciding round re-runs the handler's checks on both eras;
    - with `to` omitted, the dialog's window end is the preview's;
    - the promotion's `Server:` line names the calling profile.

**Live checks (lead, Claude Code `2.1.296`, closed-port fake listener)**
- **43.2 (decision #9): PASS.**
  - On `auto`, the first line is `server/discover` `2026-07-28`, and Claude Code probed on the SAME connection (no probe process).
  - On `legacy`, it sends `initialize` `2025-11-25`. 33 tools on both legs.
- **43.3 (decision #20): PASS, six legs, USD 0.032.**
  - Claude Code declares `elicitation: {form: {}, url: {}}` on BOTH eras.
  - The `Elicitation` hook fires on both eras. Its `message` equals the template, and `requested_schema` equals `CONFIRMATION_SCHEMA`.
  - **Modern accept:** 2 `tools/call` and 1 purge POST, audited `ok`/`accepted`.
  - **Legacy accept:** 1 `tools/call` plus 1 server `elicitation/create`.
  - **Declines (both eras):** 1 hook event (no re-ask), 0 POSTs, audited `denied`/`declined`.
  - **Headless `claude -p`, no hook:** Claude Code CANCELS with no hang (`response: "cancel"`), and `--permission-prompts none` cancels too. README `:678` still calls the no-hook case "not documented"; 43.4 can state the observed behavior.

**Files 43.4 touches (verified paths)**
- **The frozen goldens** (in `packages/iris-mcp-all/src/__tests__/fixtures/`).
  - `sdk-wire-golden.json`: 112 rows, v1 `@modelcontextprotocol/sdk` 1.29.0.
    - The gated descriptions sit in the `tools-list` rows of dev `main` and `core-preset` (`iris_doc_edit`), admin `main` and interop `main`.
    - The duplicate governance URI is in every server's `resources-list`.
  - `sdk-handler-golden.json`: 22 `tools/call` rows plus `bootstrapVersion`.
  - Their tests:
    - `story-43-1-sdk-wire-golden.test.ts`: the raw byte compare is at `:224-235`, and the v2-client compare follows.
    - `story-43-1-qa-handler-golden.test.ts`.
  - **The header tests that forbid recapture:**
    - `story-43-1-sdk-wire-golden.test.ts:134-160`: `sdkPackage` ends in `/sdk`, `sdkVersion` is `1.29.0`, and the 7 DW-617 rows must be v1 `-32602` refusals;
    - `story-43-1-qa-handler-golden.test.ts:84-101`: a v1 capture with no audit entry for the schema-invalid call.
  - The capture scripts (`scripts/capture-sdk-wire-golden.mjs`, `capture-sdk-handler-golden.mjs`) refuse to write with exit 2 without `--force`.
- **The cross-era pin rows that compare descriptions** (`story-43-2-cross-era-pin.test.ts`):
  - (a) `:278-291` compares the modern lines with the golden after `withoutMandatedFields`/`withoutExecution`;
  - (d) `:348-358` compares the probe-discard `main` byte for byte.
  - (a) `:294-303` checks names and key order only. (e) `:413-420` compares eras with each other, so it is unaffected.
- **The tools-list snapshot.**
  - Files: `fixtures/tools-list-snapshot.json`, `tools-list-snapshot.test.ts` and `scripts/lib/tools-list-snapshot-core.mjs`.
  - Check with `pnpm gen:tools-list-snapshot:check`. Regenerate with `pnpm gen:tools-list-snapshot --force`, after rebuilding every package. The bare command refuses with exit 2.
  - Never run `gen:governance-baseline` without `:check`. Descriptions are not baseline keys.
- **The gated descriptions:**
  - `iris-admin-mcp/src/tools/audit.ts:52-68`;
  - `iris-dev-mcp/src/tools/env-promote.ts:1340-1392`;
  - `iris-interop-mcp/src/tools/production.ts:102-118` (`iris_production_control`);
  - `iris-interop-mcp/src/tools/message-resend.ts:347-378`;
  - `iris-dev-mcp/src/tools/doc-edit.ts:446-469`.

  The README payload table's byte figures drift with them. `docs-visibility-roster-sync` pins counts only.
- **The `resend-failed-messages` prompt.**
  - Source: `packages/iris-interop-mcp/src/prompts/resendFailedMessages.ts`. The wrong steps are 3 and 4, at `:70-71`.
  - Generated copies (DO NOT EDIT): `skills/resend-failed-messages/SKILL.md` and `packages/client-config/skills-pack/skills/resend-failed-messages/SKILL.md`. Regenerate with `pnpm gen:skills`, then `pnpm gen:pack`, and check with `:check` and `validate:prompts`.
  - **DW-653's premise is wrong.** Neither golden holds that body text: the wire golden pins only the prompt's `prompts/list` description and arguments, and its `prompts/get` rows are other prompts. The fix does not depend on retiring a golden.
- **`registerGovernanceResource`** is at `server-base.ts:1267-1332`; `epics.md` cites a stale `1166-1215`. The static `default` reader is at `:1271`. The `{profile}` template's `list` (`:1297-1310`) lists `default` again.
- **README.md.**
  - The "Human confirmation (elicitation)" section is `:644-689`. Its hook and headless paragraph is `:678`.
  - The protocol and era paragraph is in Architecture, `:934`.
  - The refusal row is at `:489`.
  - `packages/shared/README.md:168` describes `serveStdio`.
- **The client docs** (`docs/client-config/README.md`, client matrix at `:65`; `docs/client-config/claude-code.md`) have NO protocol-revision, `MCP_PROTOCOL_NEGOTIATION`, probe-process or elicitation text yet.
- **The PRD compliance line** is `_bmad-output/planning-artifacts/prd.md:88` (FR161 is at `:719`, FR162 at `:720`).
- **The spine** is `architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md`.
  - Stack rows: `:720` (v1 sdk 1.29.0, "removed in Epic 43"), `:721` (v2 2.3.1) and `:722` (MCP specification).
  - AD-32 is at `:622-648`, AD-34 at `:658-683`.
- **CHANGELOG and changeset.**
  - Add a new top entry to `CHANGELOG.md`. The format to follow is `.changeset/story-43-3-human-confirmation.md`.
  - **Trap:** `story-43-3-doc-claims.test.ts:153-157` asserts the top CHANGELOG entry is Story 43.3. A 43.4 entry turns it red, so that pre-existing test must change, recorded in the diff guard. Rows `:90-96` pin README sentences in the confirmation section.

**Test assets to reuse**
- **`connectSdkClient` / `openWireSession`** (`process-gate-helpers.ts:317`, `:374`).
  - `versionNegotiation` defaults to an explicit `{mode: "legacy"}`; 43.3 used `{pin: "2026-07-28"}`.
  - `clientCapabilities?` and `onElicitation?` (`:289`, `:294`): the handler is registered only when elicitation is declared, and with `onElicitation` omitted every request is cancelled.
- **The rigs.**
  - `openRig` is in `story-43-3-confirmation-both-eras.test.ts:450`.
  - QA's helpers are `story-43-3-qa-wire.ts` (`ERAS`, `ELICITING`, `TICKED`/`DECLINED`/`DISMISSED`, `GOVERNANCE_ALL`, `openRig`, `connect`, `dialogMessage`) and `story-43-3-qa-gates.ts` (`GATES`).
  - `story-43-2-qa-hand-wire.ts` holds `startHandWire`, `untilLine` and `holdingProxy`.
- **The fake IRIS and audit.** `scripts/lib/fake-iris-listener.mjs` exports `startFakeIris({bootstrapVersion})` and has the gate routes. `scripts/lib/sdk-handler-golden-core.mjs` exports `readBootstrapVersion` and `settledAuditEntries`.
- **The raw driver** is `scripts/lib/sdk-wire-golden-core.mjs`, with `MODERN_ERA`, `modernEnvelope`, `discoverHandshake` and `withoutMandatedFields`.
- **Capstone precedent:** `epic38-`, `epic39-` and `epic40-capstone-gate.test.ts`.
- **Mutation discipline.** A stdio test guards the BUILT dist: mutate, rebuild (delete `tsconfig.tsbuildinfo`), observe red, revert, rebuild.
- **The live-check procedure** is decision #20's: `tap.mjs`, `hook.mjs`, `leg.mjs`, a throwaway `mcp-<leg>.json` enabling only the gated key, and haiku at a USD 1 cap per leg.

**A second certified client on this macOS host (read-only check, 2026-10-20)**
- **Claude Code:** `~/.local/bin/claude` → `versions/2.1.296`; 2.1.281 and 2.1.294 are also present.
- **Certified-live:**
  - VS Code is installed (`/Applications/Visual Studio Code.app`). Its CLI is in the bundle, `Contents/Resources/app/bin/code`, not on PATH.
  - Cline 4.1.24 and 4.1.25 are in `~/.vscode/extensions/saoudrizwan.claude-dev-*`.
  - Both are GUI agents; their certification says "agent-side GUI stays manual". Kimi Code is certified-live with a CLI probe, but it is NOT installed.
- **Fixture-only:** Claude Desktop is installed (`/Applications/Claude.app`).
- **Not found:** `codex`, `gemini`, `cursor-agent`, `cursor`, `goose`, `kimi`, `kimi-code`, `zed`, `windsurf`. `~/.gemini` holds the Antigravity CLI (`~/.local/bin/agy`), which is not in the registry.
- **So no headless second certified client is available.** The second-client leg needs either a manual VS Code/Cline GUI run or a recorded residual risk or Lead decision.

## UX & Interaction Patterns

- **The dialog.** It is form elicitation with one "Confirm" checkbox. Only an accept with the box ticked proceeds. An unticked accept, a decline or a cancel ends the call with `CONFIRMATION_DECLINED` ("... Nothing was changed. Do not repeat this call unless the person asks for it again."), and it is never re-asked.
- **Asking again.** Changed arguments ask again.
- **Clients that cannot elicit** see exactly today's `confirm: true` behavior and bytes.
- **Docs and descriptions say:**
  - elicitation-capable clients ask the person;
  - a Claude Code `Elicitation` hook can auto-answer, which is the user's choice and removes the person;
  - headless `claude -p` with no hook cancels (observed on 2.1.296).
  - The dialog stops the agent, not a compromised client.

## Cross-Story Dependencies

- **43.4 consumes all three stories:**
  - 43.1's goldens and drivers;
  - 43.2's `serveStdio` era paths, cross-era pin and hand-wire;
  - 43.3's elicitation-capable `connectSdkClient`, fake gate routes, audit oracle and live procedure.
- **Goldens.** No story before 43.4 edits or recaptures either golden. DW-639, DW-646 and the description change land together, under an AD-15 sanction.
- **Epic 42.** It cannot publish `1.0.0` until Epic 43 lands.
  - 42.1 owns the Node 22 floor and DW-637's SDK-bump residual.
  - 42.2 owns DW-627's live-gate fix.
  - 42.9 owns DW-655 (`prd.md:86`) and the client re-certification.
