# Epic 43 Context: MCP SDK v2 Migration

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Move the suite onto the MCP TypeScript SDK v2 (`@modelcontextprotocol/server`, `client`, `core`) before Epic 42 publishes `1.0.0`, so the first public release is built on the SDK's stable line rather than v1's maintenance line. v1 covers specs only up to `2025-11-25` and gets fixes until about 2027-01-27. On the 2025-11-25 revision, every server stays byte-identical for today's clients. The same stdio process also serves revision `2026-07-28`, which Claude Code (our primary client) already negotiates by default, so the modern path becomes the main path. The one multi-round-trip feature adopted is this: the existing `confirm: true` gates also ask the human through elicitation when the client can.

## Stories

- Story 43.1: Framework Migration to SDK v2
- Story 43.2: Serve MCP Revision 2026-07-28
- Story 43.3: Human Confirmation Through Elicitation
- Story 43.4: SDK v2 Docs, Smokes and Capstone

## Requirements & Constraints

**Epic-wide**
- **Byte-identical 2025-11-25 era (Rule #19, AD-15).** These stay byte-identical on that era: `tools/list`, `prompts/list`, the resources capability, error envelopes, governance denials and the `instructions` string. Each one has a pin that fails on drift. The SDK stays confined to `@iris-mcp/shared` (AD-2/AD-3).
- **Streamable HTTP stays rejected (AD-23).** The stateless revision's HTTP benefits are out of scope.
- **No bootstrap move.** There is no ObjectScript change, `BOOTSTRAP_VERSION` does not move, and `bootstrap-classes.ts` must be absent from the diff. So the IRIS-side `confirm` checks stay exactly as they are.
- **Out of scope:**
  - the Tasks extension (AD-16's `running` + `iris_test_status` already covers long runs);
  - MCP Apps;
  - `subscriptions/listen`;
  - sampling, roots and URL-mode elicitation;
  - an operator setting that requires a human (a recorded candidate);
  - any new tool.
- **Run order.** The epic runs after Epic 41 and before Epic 42, on `feature/feature-wave-8-published-install`. Nothing publishes before Epic 43 lands. The status keys are `43-1-framework-migration-to-sdk-v2`, `43-2-serve-mcp-revision-2026-07-28`, `43-3-human-confirmation-through-elicitation` and `43-4-sdk-v2-docs-smokes-and-capstone`, all `backlog`.

**43.1 — Framework migration**
- **AC 43.1.1 (probe first).** Record three things:
  - an import inventory, exhaustive as of a named date, with source and tests listed separately;
  - what `npx @modelcontextprotocol/codemod v1-to-v2` rewrites (run in a scratch copy) and what stays manual;
  - the v2 API for each symbol `server-base.ts` uses: `McpError`→`ProtocolError`, `ErrorCode`→`ProtocolErrorCode`, the stdio subpath, `registerResource` metadata and prompt registration. Pin the installed v2 version.
- **AC 43.1.2.** Migrate `@iris-mcp/shared` and remove `@modelcontextprotocol/sdk` from every `package.json` that does not need it. The default stays the 2025-11-25 era.
- **AC 43.1.3 (back-compat pins).** Each pin is captured BEFORE the migration through the real client path, then compared after with `toEqual`:
  - `tools/list` (names, schemas, annotations);
  - `prompts/list` and `prompts/get`;
  - the resources capability;
  - `instructions`;
  - a governance denial;
  - an unknown-tool error;
  - a Zod validation error.

  The `stageDefaultStartup` test files must pass unmodified.
- **AC 43.1.4.** The SDK-client suites move to `@modelcontextprotocol/client` with their assertions unchanged.
- **AC 43.1.5 (gates).**
  - build, test, lint and type-check pass;
  - `pnpm gen:governance-baseline:check` passes;
  - tool counts are unchanged;
  - `bootstrap-classes.ts` is not in the diff;
  - `pnpm audit` on production dependencies is recorded (v1's HTTP-stack advisories are expected to drop).
- **DW-579 (med; owned by 43.1; orchestrator decision #33, 2026-10-17).**
  - The problem: a `tools/call` that the SDK rejects as schema-invalid never reaches `handleToolCall`, so it is never audited. The evidence is `server-base.ts:1178`, and the 39.3 live gate's audit row (`story-39-3-body-search-live-gate.test.ts:1120`) sees only the valid call.
  - Required: the v2 call path writes exactly ONE audit entry for a schema-invalid call, with outcome `error` and no argument values.
- **DW-617 (med; owned by 43.1; routed by the 41.2 CR on 2026-10-19).**
  - The problem: a `prompts/get` that omits `arguments` is refused with -32602 for every all-optional prompt (`audit-security-posture`, `recover-stuck-production`, `check-system-health`, `run-external-backup`). CR 25.1-6 had closed this as an SDK v1 limitation.
  - Required: on v2 such a request renders. Pin it inside AC 43.1.3 with a real SDK client that omits `arguments` entirely (Rule #46).

**43.2 — Serve 2026-07-28**
- **AC 43.2.1.**
  - `McpServerBase` serves through `serveStdio(factory)` from `@modelcontextprotocol/server/stdio` with `legacy: 'serve'`. The factory builds the `McpServer` and registers every tool, prompt and resource. It runs once per process, because stdio has one connection per process.
  - Record which of client-config's 16 adapters negotiate `2026-07-28` today, and how `MCP_PROTOCOL_NEGOTIATION=legacy` forces Claude Code back to the old path.
- **AC 43.2.2.** A v2 client pinned to `2026-07-28` uses `server/discover` and calls tools. A 2025 client is unaffected, which 43.1's pins prove.
- **AC 43.2.2a (cross-era equivalence pin).**
  - These must be logically identical on both eras: `tools/list` (names, schemas, annotations, order), prompts list/get, resources, `instructions`, a governance denial, a validation error and an `isError` result.
  - The pin may ignore only revision-mandated fields (for example `resultType`, `ttlMs`/`cacheScope`, `_meta` identity), and must name each one.
- **AC 43.2.3.** Per-request `_meta` never weakens AD-3. Profile and namespace resolution, governance, visibility and audit behave identically on both eras, and a test drives each gate on each era.

**43.3 — Elicitation confirmation**
- **AC 43.3.1.** Make an exhaustive gate inventory as of a named date (Rule #56), with a verdict for each gate. Review asks what is missing. See the gate table below for the verified state.
- **AC 43.3.2.** One shared helper in `@iris-mcp/shared` does the asking, and handlers never call the SDK.
  - **When the client declares form elicitation:** the helper returns an `inputRequired` elicitation whose message names the action, the target and the scope (item, window, match count).
    - An accept proceeds.
    - A decline or cancel ends the call with `CONFIRMATION_DECLINED`, changes nothing and NEVER asks again.
  - **When the client does not declare it:** today's `confirm: true` contract applies unchanged.
  - Probe how to read the client's capability per request on each era. On modern connections the capabilities travel in the request envelope.
- **AC 43.3.3.**
  - `confirm: true` (and `dryRun: false` where it applies) stays required.
  - Every existing check (bounds, dry run, governance, AD-17) runs first. The dialog is an ADDITIONAL gate, never a replacement.
  - It is a sanctioned AD-15 behavior change, and it goes in `CHANGELOG.md`.
- **AC 43.3.4.** The confirmation is bound to the exact arguments shown, for example by a hash of the normalized arguments. If they differ on the retry, the helper asks again. Any `requestState` is integrity-protected (HMAC or AEAD) and verified, because it is untrusted client input.
- **AC 43.3.5.** Tests run on both eras through the real SDK client over `serveStdio`, covering accept, decline, cancel, the no-capability fallback, arguments that change between rounds, and a v1.29-era client. A live Claude Code check records that the dialog appears, that accept executes and decline refuses, and how headless `claude -p` behaves.
- **AC 43.3.6.**
  - No new governance key, tool or annotation change, and tool counts stay the same.
  - Each gated tool's description and the README say that elicitation-capable clients ask the human.
  - The docs cover the Claude Code `Elicitation` hook (auto-answering is the user's choice) and the fallback.

**43.4 — Docs, smokes and capstone**
- **AC 43.4.1.** Live smokes run from the built dist in a fresh Node process:
  - each server through Claude Code plus one other certified client;
  - one call per era (Claude Code on its default `auto`, and once with `MCP_PROTOCOL_NEGOTIATION=legacy`);
  - one confirmation round trip per era.
- **AC 43.4.2 (capstone, default suite).**
  - One test drives a server through the real SDK client on both eras. It covers listing, a read call, a governance denial, a validation error, and a confirmation that is accepted once and declined once.
  - It must be proven RED by breaking either the era negotiation or the decline handling, naming the path broken.
- **AC 43.4.3.** Update:
  - the README and the client docs (supported revisions and confirmation behavior);
  - `CHANGELOG.md` and a changeset;
  - the spine's Stack rows, AD-32 and AD-34;
  - the PRD's MCP compliance line (`prd.md:88`). FR161 and FR162 are the requirements.

**Binding project rules**
- **#10:** send defaults explicitly. Pass `legacy: 'serve'` and pin protocol versions in tests rather than relying on SDK defaults.
- **#19:** mechanical back-compat pins.
- **#21:** one GENUINE capstone in the default suite, never a `*.integration.test.ts` suffix.
- **#22:** smoke the rebuilt dist in a fresh Node process.
- **#26:** smoke at least one destructive-path REFUSAL (a decline) and assert nothing changed.
- **#28:** keys still need `mutates`, but there are no new keys here.
- **#31:** a framework surface is in no package array. Tool counts must not move.
- **#45:** cross-package checks live in `iris-mcp-all`.
- **#46:** use a real SDK `Client` against the dist, with one call that OMITS optional fields entirely (DW-617's `getPrompt({name})`).
- **#53:** no new tool, so no preset rows change.
- **#54:** every elicitation fake must return shapes the real v2 SDK can return. Pin fakes to the installed `.d.mts` or a probe. Examples: `acceptedContent()` gives `undefined` for both "not asked" and "declined", and a non-eliciting client errors.
- **#56:** the import inventory, the gate inventory and the 16-adapter negotiation list are each EXHAUSTIVE as of a date.
- **#59:** every gate and the capstone are proven red on the path they guard.
- **DW-627** (owned by 42.2, but it binds any new live gate here): live legs run only with `IRIS_REQUIRE_LIVE=1` and all five `IRIS_*` set, and a guard test proves zero requests when unarmed. The reference shape is `packages/iris-mcp-all/src/__tests__/story-41-8-qa-accept-language-live-gate.test.ts`.

## Technical Decisions

**Architecture spine**
- **AD-32 (SDK and protocol revisions).**
  - The SDK is used only inside `@iris-mcp/shared`.
  - From Epic 43 the framework is on v2 and v1 is removed.
  - The 2025-11-25 era is byte-identical. The same process serves `2026-07-28` through `serveStdio(factory)` with `legacy: 'serve'`.
  - A cross-era pin proves the logical content is identical on both eras.
  - Per-request `_meta` never bypasses AD-3.
  - Note: AD-32 states a v1 floor of `>=1.31.0` until Epic 43, but the manifests declare `^1.29.0` and the lockfile holds 1.29.0. This is moot once v1 is removed.
- **AD-34 (confirmation through elicitation).**
  - It binds `iris_audit_manage:purge`, `iris_env_promote:execute`, `iris_production_control:clean`+`killAppData`, `iris_message_resend` execute, `iris_doc_edit:regenerateStorage`, any future gate, and the shared helper.
  - The existing checks run first, and the dialog is additional.
  - Accept proceeds. Decline or cancel gives `CONFIRMATION_DECLINED` and never re-asks.
  - A client that cannot elicit gets today's contract.
  - The confirmation is bound to the arguments, and `requestState` is integrity-protected.
  - A hook that auto-answers is documented as the user's choice.
- **AD-2.** Servers depend on shared. Shared never imports a leaf package. Cross-package checks live in `iris-mcp-all` or `scripts/` over the built dist.
- **AD-3.** `McpServerBase.handleToolCall` runs these steps in order, with the audit interceptor wrapping all of them:
  1. Zod validation;
  2. `server`→profile;
  3. `action`;
  4. the governance gate (a denial is a structured `isError` result);
  5. the per-profile context;
  6. the handler.

  The `server` parameter is injected at registration and stripped before the handler runs. Handlers see only `ToolContext`.
- **AD-15.** The elicitation dialog on existing gates is on the sanctioned-change list.
- **AD-16.** The `running` result plus a companion tool covers long jobs, which is why Tasks is out.
- **AD-17.** Bulk writes are refused when over their cap and default to dry run, and execute requires `confirm: true`. For `clean`, only `killAppData` needs `confirm`. Any refusal changes nothing.
- **AD-19.** One JSONL audit entry per call from the chokepoint, with `outcome` in {`ok`,`error`,`denied`}. The writer never fails or delays a call.
- **AD-23.** Only `stdio`. Any other value is rejected in `resolveTransport` with exit 1 before any IRIS traffic.
- **Stack rows.**
  - `@modelcontextprotocol/sdk` (v1, removed in Epic 43): 1.29.0 (`npx` consumers resolve 1.32.1).
  - v2 server, client and core: 2.3.1 (the latest on 2026-10-05; 43.1 pins it).
  - MCP specification: 2025-11-25 served today, 2026-07-28 is current.
  - zod 4.3.6.
  - The Node floor of 22 is Story 42.1's.
- **Deferred.** The SDK `extra` argument (progress, cancellation) stays unconsumed by handlers.

**Probe evidence (2026-10-15)**
- **Setup.** `@modelcontextprotocol/server` and `client` 2.3.1 with zod 4.3.6, installed `--ignore-scripts` in a scratch folder, on Node v26.8.1 (macOS).
- **Dual era.** One `serveStdio` process served four clients, and all four saw identical `tools/list` and `instructions`:
  - a v2 client pinned to `2026-07-28`;
  - a v2 client on `auto` (it negotiated `2026-07-28`);
  - a v2 client on `legacy` (`2025-11-25`);
  - the repo's v1.29.0 client.

  A hand-built `McpServer` on a plain `StdioServerTransport` speaks only the 2025 era. `legacy: 'reject'` would refuse 2025-era clients.
- **Elicitation.** One `inputRequired.elicit()` handler worked on both eras.
  - Accept confirmed in 1 round on the pinned, `auto`, `legacy` and v1.29 clients.
  - On `legacy`, the SDK shim sends a real `elicitation/create`.
  - With no elicitation capability, the modern era gave a `ProtocolError` and the legacy era gave an `isError` result.
- **Trap 1.** `acceptedContent()` returns `undefined` both for "not yet asked" and for "declined". A handler that re-asks on `undefined` loops until the client's `inputRequired.maxRounds` (10).
- **Trap 2.** A client that cannot elicit gets an error, so every gate needs a fallback.
- **Other facts.**
  - The framework never reads client identity: `getClientVersion` and `getClientCapabilities` are unused, re-verified 2026-10-19. These return `undefined` on modern connections, which matters for 43.3's per-request capability read.
  - Claude Code shows a form-elicitation dialog, and an `Elicitation` hook can auto-answer it.
  - Claude Code moves a tool call that runs past 2 minutes to the background, and aborts a stdio call that sends nothing for 30 minutes.

**Code footprint (verified 2026-10-19, branch `epic43`)**
- **`packages/shared/src/server-base.ts` (2531 lines).**
  - **Imports, lines 15–22:**
    - `McpServer` and `ResourceTemplate` from `sdk/server/mcp.js`;
    - `StdioServerTransport` from `sdk/server/stdio.js`;
    - the types `CallToolResult`, `ReadResourceResult` and `GetPromptResult`, plus `McpError` and `ErrorCode`, from `sdk/types.js`.
  - **Constructor (lines 559–578).** It calls `new McpServer({name, version}, {capabilities: {tools: {listChanged: true}, resources: {listChanged: true}}, instructions: SERVER_DISCOVERY_INSTRUCTIONS})`. The string is built in `server-discovery.ts:62`.
    - The `prompts` capability appears ONLY because the SDK's `registerPrompt` adds it. That is why iris-data-mcp, which has no prompts, answers `prompts/*` with MethodNotFound.
    - Registration order: visible tools (660–664), then the discovery tool (683), then `registerGovernanceResource()` (708), then prompts (725–727).
  - **Resources (935–995).** Two `registerResource` calls: the static `iris-governance://default`, and a `ResourceTemplate` with a `list` callback for each profile. `buildGovernancePolicyResult` throws `McpError(InvalidParams)` at 864 and 869.
  - **Prompts (`registerPrompt`, 1029–1145).**
    - A render failure throws `McpError(InternalError)` (1051).
    - A no-argument prompt registers with no `argsSchema` (1070–1076).
    - Otherwise it registers a raw Zod shape with `.describe()` outermost (1079–1101, then 1131). The CR 25.1-6 comment at 1103–1130 is DW-617's root cause: v1 runs `safeParseAsync(z.object(shape), undefined)`.
  - **Tools (`registerTool`, 1156–1197).**
    - `withServerParam` builds the extended schema, which is stored in `extendedSchemas`.
    - It passes `.shape` as `inputSchema`, plus `outputSchema` and the four annotations.
    - The callback is `this.handleToolCall(tool, args)`.
  - **Call path.**
    - `handleToolCall` (1272) is the audit wrapper around `dispatchToolCall` (1309).
    - Our own `extendedSchema.safeParse` (1339) produces `Invalid arguments: <path>: <msg>`, but only after the SDK's own validation has passed.
    - Today the wire validation error is the SDK's: `validateToolInput` throws, and the v1 `mcp.js` CallTool handler turns it into an `isError` result `MCP error -32602: Input validation error: Invalid arguments for tool <name>: …`. An unknown or hidden tool gives `MCP error -32602: Tool <name> not found`. The SDK also validates `outputSchema`.
    - **Tension:** AC 43.1.3 pins this text byte-for-byte, while DW-579 moves validation into the chokepoint. The fix must reproduce the text or take a sanctioned change.
  - **Other uses.**
    - `sendToolListChanged()` at 1947 and 1998.
    - `removeTools` deletes from the private `_registeredTools` (1972).
    - `start()` calls `new StdioServerTransport()` and `connect` at 2305–2306.
    - `stop()` calls `close()` at 2327.
    - The public `get server(): McpServer` is at 2513.
- **Other SDK references.**
  - 52 code files under `packages/`, `extensions/` and `scripts/` name `@modelcontextprotocol/sdk`, and there are 8 static `from` import lines. Command: `grep -rl "@modelcontextprotocol/sdk" packages extensions scripts --include='*.ts' --include='*.mjs' --exclude-dir=node_modules --exclude-dir=dist`.
  - **Source:** `server-base.ts` only. In addition, `scripts/lib/tools-list-snapshot-core.mjs:146/204` reads `packages/shared/node_modules/@modelcontextprotocol/sdk/package.json` by name, and `scripts/lib/measure-tools-payload-core.mjs:18` (`fetchAllTools`) reaches `server.server.server._requestHandlers`.
  - **Tests with static imports:**
    - `shared/.../prompts-guardrails.test.ts` (`McpError`, `ErrorCode`, `LATEST_PROTOCOL_VERSION`);
    - `shared/.../governance-resource-coverage.test.ts` (`McpError`, `ErrorCode`);
    - `iris-dev-mcp/.../doc-type-description.test.ts` (`Client`, `InMemoryTransport`).
  - **Tests resolving the SDK by pnpm-store path** (dynamic import, keyed on the `@modelcontextprotocol+sdk@` prefix):
    - 45 `iris-mcp-all` tests, through `resolveSdkEsmDir` in `process-gate-helpers.ts:25`;
    - 2 extension tests (`governanceUiRoundTrip`, `localSpawnIntegration`), each with its own copy of the resolver.

    All of these break when v1 leaves the store.
  - **Private-internal reach-ins.** 70 test files touch `_registeredTools`, `_requestHandlers` or `server.server.server`: 59 touch `_registeredTools` and 27 touch `_requestHandlers`. So does the shared `callTool` helper (`test-helpers.ts:42–46`, which calls `server.server._registeredTools[name].callback/handler`).
- **Manifests.**
  - `@modelcontextprotocol/sdk ^1.29.0` is declared by `packages/shared` (runtime) and by all five server packages, which do not import it.
  - It is not declared by `iris-mcp-all` or the extension.
  - Installed: only `@modelcontextprotocol+sdk@1.29.0_zod@4.3.6`. No v2 package is installed yet.
  - The root `engines.node` is still `>=18.0.0`, but SDK v2 needs Node 20 or later.
- **In-memory pairs.** These use `InMemoryTransport.createLinkedPair()`:
  - `iris-dev-mcp/.../doc-type-description.test.ts`;
  - `iris-mcp-all/.../story-38-6-qa-edit-prompt-sdk-wire.test.ts`;
  - `iris-mcp-all/.../story-39-6-qa-forensics-prompts-sdk-wire.test.ts`.

  No shared test uses an SDK `Client`, despite the epic text. Shared tests drive handlers through the internal reach-ins. The extension tests use stdio, not in-memory pairs.
- **Stdio wire harness.**
  - `process-gate-helpers.ts:265` (`openWireSession`) dynamically imports `client/index.js` and `client/stdio.js` from the resolved ESM directory. It spawns `node <dist entry>` and offers `call`, `callOn`, `raw`, `listTools`, `listPrompts`, `getPrompt` and `close`. 37 tests use it (or `withWireSession`/`openAuditedSession`).
  - `story-41-2-qa-prompts-stdio-wire.test.ts:280` `WIRE_GOLDEN` holds the `sha256(JSON.stringify(...))` of each package's `listPrompts().prompts` and of every full `getPrompt` result. It was captured at `26dc8b2` on SDK 1.29.0, so any added field breaks it.
  - Line 241 of that test already allows either a render or a clean InvalidParams when `arguments` is omitted.
- **Tools-list snapshot.**
  - `packages/iris-mcp-all/src/__tests__/fixtures/tools-list-snapshot.json` is generated (`pnpm gen:tools-list-snapshot[:check]`, `--force` to regenerate).
  - It holds `entryCount` 115 across 5 servers under preset `full`, and pins the title, description, inputSchema, annotations and outputSchema.
  - It was captured 2026-10-18 with `sdkVersion` 1.29.0 and zod 4.3.6.
  - The comparison is one-directional over `servers` only.
- **Governance baseline.** `packages/shared/src/governance-baseline.ts` is FROZEN at 141 keys, hash `1e62c5ad5bf7`. Verify it only with `pnpm gen:governance-baseline:check`, never the bare generator.
- **`stageDefaultStartup` tests.**
  - The helper is at `packages/shared/src/__tests__/test-helpers.ts:26`.
  - **43** test files call it today: shared 14, admin 9, interop 9, dev 7, ops 4. Command: `grep -rlE "stageDefaultStartup\(" packages --include='*.test.ts' --exclude-dir=node_modules --exclude-dir=dist`.
  - The AC's figure of 38 is the count as of 2026-10-15. Five files were added on 10-16 and 10-17.
  - 38 of the 43 also reach the SDK internals directly. To keep them unmodified, either the private shapes must survive v2 or the shared helpers must absorb the change.
- **Confirmation gates.** Only these four tools declare a `confirm: z` field (`grep -rnE "^\s+confirm: z" packages/*/src`):

| Gate | Where the `confirm: true` check lives |
|---|---|
| `iris_audit_manage:purge` | TS `iris-admin-mcp/src/tools/audit.ts:298` (field :135), plus IRIS defense in depth at `REST/Security.cls:2953` |
| `iris_env_promote:execute` | TS only, `iris-dev-mcp/src/tools/env-promote.ts:994` (Gate 1 of `executeAction`; field :1426) |
| `iris_production_control:clean`+`killAppData` | TS passes it through (`production.ts:203`, field :147); the check is IRIS-side at `REST/Interop.cls:369` |
| `iris_message_resend:resendFiltered` | TS passes `dryRun`/`confirm` through (`message-resend.ts:588–589`, field :432); the check is IRIS-side at `REST/MessageResend.cls:588–592` |

  Inventory findings for AC 43.3.1:
  - `iris_message_resend:resend` takes NO `confirm`. Only governance's default-disable gates it.
  - `iris_doc_edit:regenerateStorage` has NO `confirm` parameter. It is a default-disabled governed write (`doc-edit.ts:472–495`). AD-34 and FR162 still list both.
  - Epics 38–41 added no gate.
  - The caps and the match count for `resendFiltered`, and the `killAppData` check, are computed IRIS-side in the same POST that executes. Asking the human "after the checks, naming the match count" therefore needs a design decision.

## UX & Interaction Patterns

- **The dialog.** It is form-mode elicitation. Its message names the action, the target and the scope (for example the item, the window and the match count).
- **Outcomes.** One accept proceeds. A decline or cancel ends the call with a refusal (`CONFIRMATION_DECLINED`), changes nothing, and never re-prompts.
- **Re-asking.** The helper asks again only when the retried arguments differ from the confirmed ones.
- **Clients that cannot elicit** see exactly today's `confirm: true` behavior and its errors.
- **Docs.** The descriptions and README tell users that elicitation-capable clients ask the human. A Claude Code `Elicitation` hook can auto-answer, which is the user's choice. The behavior of headless `claude -p` gets recorded.

## Cross-Story Dependencies

- **Story order.** 43.1 (v2 packages, migrated test harnesses, pre-migration pins) comes before 43.2 (the `serveStdio` factory and both eras). 43.2 comes before 43.3, whose modern-era multi-round-trip and per-request capability read need 43.2. 43.4 depends on all three, and its capstone and smokes exercise both eras plus a confirmation.
- **Pins are captured once.** The 43.1 back-compat pins must be captured on v1 BEFORE any migration edit. 43.2's cross-era pin and 43.4's capstone reuse those surfaces.
- **Epic 42.**
  - It cannot publish `1.0.0` until Epic 43 lands.
  - Its Story 42.1 owns the Node 22 floor, which lands after this epic. SDK v2 needs Node 20 or later while the root `engines` field still says `>=18`.
  - DW-627's opt-in live-gate fix belongs to 42.2, but any new live gate written here must already follow the opt-in shape.
