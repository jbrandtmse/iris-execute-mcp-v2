# Epic 43 Context: MCP SDK v2 Migration

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->
<!-- Recompiled 2026-10-20 after Story 43.2 (done; commits c245998..b6211ce on branch epic43). Facts verified in source and in the installed node_modules on that date. -->

## Goal

Move the suite onto the MCP TypeScript SDK v2 before Epic 42 publishes `1.0.0`, so the first public release is built on the SDK's stable line and not on v1's maintenance line (v1 stops at spec `2025-11-25` and gets fixes until about 2027-01-27). Two stories are done:
- 43.1: the framework runs on `@modelcontextprotocol/server` 2.3.1, and the 2025-11-25 wire matches the frozen v1 goldens byte for byte.
- 43.2: the same stdio process also serves revision `2026-07-28`, which Claude Code, our primary client, now negotiates by default.

What remains:
- 43.3: the existing `confirm: true` gates also ask the human through elicitation when the client can.
- 43.4: docs, live smokes and the capstone.

## Stories

- Story 43.1: Framework Migration to SDK v2 (done)
- Story 43.2: Serve MCP Revision 2026-07-28 (done)
- Story 43.3: Human Confirmation Through Elicitation (next)
- Story 43.4: SDK v2 Docs, Smokes and Capstone

## Requirements & Constraints

**Epic-wide**
- **Byte-identical 2025-11-25 era (Rule #19, AD-15).** Every 43.1 golden and pin keeps passing with its fixture and assertion lines unchanged. The only exceptions are changes on the AD-15 sanctioned list, each named in `CHANGELOG.md`. The 43.3 dialog is on that list.
- **SDK confinement (AD-2, AD-32).** Only `server-base.ts` and `sdk-wire-compat.ts` import the SDK, and only `@modelcontextprotocol/server` and `/stdio`. Two guard tests pin this: `story-43-1-sdk-confinement` and `-qa-pack-confinement`.
- **Fixed for the whole epic:**
  - no ObjectScript change, and `BOOTSTRAP_VERSION` stays `d51856f74d6a`. The IRIS-side `confirm` checks stay as they are.
  - 115 tools (33/27/25/22/8);
  - the governance baseline stays at 141 keys, `1e62c5ad5bf7`;
  - stdio only (AD-23).
- **Out of scope:** Tasks, MCP Apps, `subscriptions/listen`, sampling, roots, URL-mode elicitation, an operator "require a human" setting (a recorded candidate), and any new tool.
- **Closed port.** Every spawned server gets `IRIS_HOST=127.0.0.1 IRIS_PORT=1` or a fake listener. Launcher runs also set `IRIS_TEST_HOST=127.0.0.1 IRIS_TEST_PORT=1`.
- **No new env read without a roster update.** `startup-env-roster.test.ts` fails on any unlisted environment read.
- **Run order.** Branch `epic43`, which merges into `feature/feature-wave-8-published-install`. Epic 42 publishes nothing until Epic 43 lands. Status: 43.1 and 43.2 are `done`; 43.3 and 43.4 are `backlog`.

**43.3: Human confirmation through elicitation (next)**
- **AC 43.3.1. Gate inventory.** It is exhaustive as of a named date (Rule #56) and gives each gate a verdict. Review asks what is missing. The table under Technical Decisions is the 2026-10-20 grep.
- **AC 43.3.2. One shared helper in `@iris-mcp/shared`.** Handlers never call the SDK.
  - **When the client declares form elicitation:** the helper returns an `inputRequired` elicitation whose message names the action, the target and the scope (item, window, match count).
    - An accept proceeds.
    - A decline or cancel ends the call with `CONFIRMATION_DECLINED`, changes nothing, and is NEVER asked again.
  - **Otherwise:** today's `confirm: true` contract applies unchanged.
  - **Read the capability by era.** Choose the source with `getNegotiatedProtocolVersion()`:
    - modern: `ctx.mcpReq.envelope["io.modelcontextprotocol/clientCapabilities"]`;
    - legacy: the capabilities declared at `initialize`.
    
    On a legacy-pinned connection the envelope is ALSO filled from a request's reserved `_meta` keys. Reading it there would let a 2025 client claim, through `_meta`, a capability it never declared (43.2 QA probe).
- **AC 43.3.3. Existing checks first.**
  - `confirm: true` stays required, and so does `dryRun: false` where it applies.
  - Bounds, dry run, governance and AD-17 all run first. The dialog is an ADDITIONAL gate, never a replacement.
  - The dialog is a sanctioned AD-15 change and goes in `CHANGELOG.md`.
- **AC 43.3.4. Binding.** The confirmation is bound to the exact arguments, for example by a hash of the normalized arguments, and the helper asks again if they differ. Any `requestState` is integrity-protected (HMAC or AEAD) and verified, because it comes back as untrusted client input.
- **AC 43.3.5. Tests.** Both eras, through the real SDK client over `serveStdio`:
  - accept, decline and cancel;
  - the fallback when the client has no capability;
  - arguments that change between rounds;
  - a v1.29-era client.

  Also a live Claude Code check: the dialog appears, accept executes, decline refuses, and how headless `claude -p` behaves. The repo has no evidence yet on `claude -p`.
- **AC 43.3.6. No catalogue change, plus docs.**
  - No new governance key, tool or annotation change; tool counts stay the same.
  - Each gated tool's description and the README say that elicitation-capable clients ask the human.
  - The docs cover the fallback, and the Claude Code `Elicitation` hook (auto-answering is the user's choice).
- **Ledger items routed to 43.3** (in `epics.md`):
  - **DW-637.** `pnpm audit` cannot see the ajv 8.18.0, ajv-formats and fast-uri 3.1.0 bundled in the server dist (`ajvProvider-*.mjs`). They make up the default JSON-schema validator that elicitation uses. Check the advisories against those versions before the dialog ships, record the verdict, and supply a validator if one applies.
  - **DW-642.** A cancelled call gets no answer, but the owned handlers get no abort signal, so the IRIS call still runs and is audited `ok`. Forward `ctx`, and with it the abort signal, to the HTTP call. Pin that a cancelled call never reaches IRIS or is not audited `ok`.
  - **DW-649 (flake).** `sdk-wire-compat.test.ts` failed 1 of 55 once. The likely cause is the `removeTools`/`addTools` rows (`:538-568`), which count `list_changed` after a fixed 50 ms sleep. Replace each sleep with a deterministic barrier: await the notification, or make a round trip before counting.

**43.4: Docs, smokes and capstone**
- **AC 43.4.1. Live smokes** from the built dist in a fresh Node process:
  - each server through Claude Code plus one other certified client;
  - one call per era (Claude Code on `auto`, and once with `MCP_PROTOCOL_NEGOTIATION=legacy`);
  - one confirmation round trip per era.
- **AC 43.4.2. The capstone**, in the default suite. Through the real SDK client on both eras: listing, a read call, a governance denial, a validation error, and one accepted and one declined confirmation. It must be proven red by breaking the era negotiation or the decline handling, naming the path broken.
- **AC 43.4.3. Docs.**
  - The README and client docs: the supported revisions and the confirmation behavior.
  - `CHANGELOG.md` and a changeset.
  - The spine's Stack rows, AD-32 and AD-34.
  - The PRD compliance line, `prd.md:88` (FR161 and FR162).
- **Ledger items routed to 43.4:**
  - **DW-639.** Decide how the frozen `sdk-wire-golden.json`, and `sdk-handler-golden.json` with it, retire once the catalogue legitimately changes.
  - **DW-641.** An SDK v2 client on `auto` or `pin` spawns a probe process that runs the whole startup again. Document it, and check in the smoke that the process exits cleanly. Claude Code 2.1.296 did NOT do this in the 43.2 live check (below).
  - **DW-646.** `resources/list` lists `iris-governance://default` twice on both eras. Decide it together with DW-639: a sanctioned dedupe, or keep it.

**Binding project rules**
- **#10:** explicit options and pinned negotiation modes in tests.
- **#19:** mechanical back-compat pins, plus a diff guard on pre-existing test files.
- **#21 and #59:** one GENUINE capstone in the default suite, proven red on the path it guards.
- **#26:** smoke a decline and assert nothing changed.
- **#36:** the goldens are never edited or recaptured.
- **#45:** cross-package tests live in `iris-mcp-all`.
- **#46:** one call that omits optional fields.
- **#54:** every elicitation fake returns only shapes the 2.3.1 `.d.mts` or a probe shows are possible.
- **#56:** the inventory is exhaustive as of a date.
- **DW-627:** any live leg runs only with `IRIS_REQUIRE_LIVE=1` and all five `IRIS_*` set, with a zero-request guard. The reference is `story-41-8-qa-accept-language-live-gate.test.ts`.

## Technical Decisions

**Spine**
- **AD-32, as amended by wave-8 decisions #7–#10.**
  - The framework owns `tools/list`, `tools/call`, `prompts/get` and `resources/read` through the public `setRequestHandler`.
  - The same process serves `2026-07-28` through `serveStdio(factory)`. The code passes `legacy: "serve"` explicitly; the spine text says "the default".
  - **#7.** The cross-era pin ignores exactly six things:
    - `resultType`;
    - `ttlMs`/`cacheScope` on the six cacheable methods;
    - `_meta["io.modelcontextprotocol/serverInfo"]`;
    - `tools[].execution`;
    - `server/discover` in place of `initialize`;
    - the JSON-RPC `id`.

    The first three are SDK-added and also pinned by value (`"complete"`; `0` and `"private"`; the golden `serverInfo`).
  - **#8.** The first factory call returns the construction instance, and a later call builds a fresh one.
  - **#9.** The lead runs a live Claude Code check on both legs.
  - **#10.** One stderr INFO line per factory call names the era, with no new env var.
  - Per-request `_meta` never bypasses AD-3.
- **AD-34 (lands in 43.3).**
  - **Binds:** `iris_audit_manage:purge`, `iris_env_promote:execute`, `iris_production_control:clean`+`killAppData`, `iris_message_resend` execute, `iris_doc_edit:regenerateStorage`, any future gate, and the one shared helper.
  - **Order:** the existing checks run first, then the dialog.
  - **Ask:** form elicitation, through multi-round-trip on the modern era and the SDK shim on legacy. The message names the action, the target and the scope.
  - **Outcomes:** accept proceeds; decline or cancel gives `CONFIRMATION_DECLINED` and is never re-asked; a client that cannot elicit gets today's contract.
  - **Binding:** the confirmation is bound to the arguments, and `requestState` is integrity-protected.
  - **Hooks:** an auto-answering hook is documented as the user's choice.
- **AD-3.** `handleToolCall` runs the wire validation (on the wire path), then `server` → profile, `action`, the governance gate (a denial is a structured `isError`), the per-profile context, and the handler, all inside the audit wrapper.
- **AD-19:** one audit entry per call.
- **AD-17:** bulk writes are capped and default to dry run; execute needs `confirm: true` (for `clean`, only `killAppData`); a refusal changes nothing.

**Framework after 43.2 (`packages/shared/src/server-base.ts`)**
- **The private builder `buildMcpServer()` (802–839).** It is the only place SDK registration happens. Each call:
  - creates the `McpServer` with today's options (capabilities, `instructions`, the debounced `list_changed`);
  - registers every tool in `this.tools`, then the governance resources, then the prompts;
  - installs the owned handlers last;
  - refreshes `sdkTools`.

  `registerTool`, `registerGovernanceResource` and `registerPrompt` only record framework state. `addTools` (2182) also registers each new tool on the current instance. Any new `ServerOptions` go into this builder's options, because `McpServerOptions = ServerOptions & …`: for example `requestState.verify`, `inputRequired` and `jsonSchemaValidator`.
- **The factory `serverFactory` (847–859, typed `McpServerFactory`).** Each call logs `Serving MCP protocol revision 2026-07-28 (server/discover)` or `Serving the 2025-era MCP handshake (initialize)`. The first call returns the construction instance (`constructionInstanceHandedOut`). A later call, on the probe-discard path, builds a fresh instance and makes it current, so `get server()` (2808) returns it.
- **`start()` step 5 (2572–2580).** It runs `assertNotServing()`, then `this.servingHandle = serveStdio(this.serverFactory, { legacy: "serve", transport: new StdioServerTransport() })`, then logs `Connected via stdio transport`. A `start()` while serving throws a re-entry error before it contacts IRIS.
- **`stop()` (2611–2623).** It closes the serving handle, or the current instance if `start()` never ran, then awaits the audit `shutdown()`.
- **How a handler is called today (the 43.3 seam).**
  - `installWireHandlers(server)` (869–879) passes only `request.params`, with no `ctx`: `setRequestHandler("tools/call", (request) => this.callToolFromWire(request.params))` (874).
  - `callToolFromWire` (900–917) does the not-found check, then `handleToolCall(tool, params.arguments, "wire")` (1513), then `checkWireOutput`.
  - `dispatchToolCall` (1562) builds `ToolContext` with `buildToolContext` (331) and calls `tool.handler(validatedArgs, ctx)` (1883). It then REBUILDS the result as `{content, isError, structuredContent}`, so a handler-returned `resultType: "input_required"`, `inputRequests` or `requestState` would be dropped.
  - `ToolContext` (`tool-types.ts:265`) has no abort signal. The `IrisHttpClient` `RequestOptions` hold only `headers` and `timeout`, and each request makes its own `AbortController` (`http-client.ts:179`).
  - Each modern round is a fresh `tools/call`, and the legacy shim re-enters the owned handler in-process each round. So every round passes through `handleToolCall` and its audit wrapper. How that squares with one entry per call (AD-19) is a 43.3 decision.
- **Refusals.**
  - `refusals.ts` holds `REFUSAL_CODES`, ten codes today, each value equal to its key. `CONFIRMATION_DECLINED` is not there yet. New codes are added only to this catalog, which its catalog test checks.
  - `refusalResult(code, text, fields)` (`:63`) returns `{content: [text], structuredContent: {code, ...fields}, isError: true}`. It is exported from `index.ts:48`.
  - Users include the governance denial (`server-base.ts:1751`), `storage-guard.ts:90`, and the dev tools `sql.ts`, `doc.ts`, `doc-edit.ts` and `test-coverage.ts`. An outcome of `denied` in the audit is derived from `GOVERNANCE_DISABLED` only (`server-base.ts:2103`).

**Installed SDK 2.3.1 for 43.3 (read from `node_modules/.pnpm/@modelcontextprotocol+server@2.3.1/node_modules/@modelcontextprotocol/server/dist/`)**
- **The builder and its readers.** The package index (`index.d.mts:809`) exports `inputRequired`, `acceptedContent`, `inputResponse`, `isInputRequiredResult`, `createRequestStateCodec`, `InputRequiredResult`, `ElicitResult`, `MissingRequiredClientCapabilityError`, `McpRequestContext` and `ServerContext`.
  - `inputRequired({inputRequests, requestState})` is implemented in `src-Cqbh3MYc.mjs:5615`, and `inputRequired.elicit({message, requestedSchema})` at `:5650`. The builder sets `resultType: "input_required"`, which is what `isInputRequiredResult` checks (`:4530`).
  - The types are in `createMcpHandler-D4NN8WsG.d.mts:1409–1486`.
  - **A fix for the probe's trap:** `acceptedContent` (`:1497`, `:1510`) returns `undefined` for "missing", "declined" and "cancelled" alike. `inputResponse(responses, key)` (`:1542`) returns `{kind: 'missing'}` or `{kind: 'elicit', action: 'accept' | 'decline' | 'cancel', content?}` (`:1519`), so a decline can be told apart from "not yet asked".
- **The modern seam (`mcp-DIH4cS6P.mjs`).**
  - `_wrapHandler` (1141–1170) routes the owned `tools/call` through `_invokeInputRequiredCapableHandler` (1201–1238). That function first verifies any echoed `requestState`, then calls the handler. An input-required return is passed to the client only after checking that the envelope's declared capabilities cover each embedded request; a missing one gives `-32021 MissingRequiredClientCapabilityError`. That is the probe's "unconditional elicit errors" trap.
  - Only `tools/call`, `prompts/get` and `resources/read` may return input-required (`INPUT_REQUIRED_CAPABLE_METHODS`, 951).
  - `_inputRequestCapabilityView` (1260) reads the envelope on a modern instance and the `initialize` state on a legacy one. The era is instance state (`_servedModernEra`); nothing re-checks it per request.
- **Form capability.** A form request requires `elicitation.form`, and a bare `elicitation: {}` counts as form (`requiredClientCapabilitiesForInputRequest` at `src-Cqbh3MYc.mjs:512`, `missingClientCapabilities` at `:543`). Neither function is exported.
- **The legacy shim (`LegacyInputRequiredShim`, `mcp-DIH4cS6P.mjs:798–957`).** It is on by default.
  - On 2025-era connections it sends real `elicitation/create` requests, then re-enters the handler in-process with `ctx.mcpReq.inputResponses` and the echoed `requestState` (verified through the same hook).
  - It checks the capabilities declared at `initialize`. A missing one gives an `isError` result on `tools/call` (`legacyShimFailure`, 847).
  - Its knobs are `ServerOptions.inputRequired` `{maxRounds: 8, roundTimeoutMs: 600000, legacyShim: true}` (`d.mts:2872`).
  - The v2 client's own retry limit is 10 rounds (client `src-WCy6ifGf.mjs:5137`).
  - The deprecated `ctx.mcpReq.elicitInput` throws on the modern era.
- **`requestState`.**
  - `ServerOptions.requestState.verify(state, ctx)` (`d.mts:2897–2931`) runs before the handler on every round. A throw answers `-32602 "Invalid or expired requestState"`. Its resolved value is what `ctx.mcpReq.requestState<T>()` returns.
  - With no hook, `requestState<T>()` returns the raw, attacker-controlled string.
  - `createRequestStateCodec({key, ttlSeconds?, bind?})` (`index.d.mts:358–460`, `index.mjs:1723`) is HMAC-SHA256, signed but not encrypted:
    - the key is at least 32 bytes;
    - the TTL defaults to 600 s;
    - `bind(ctx)` ties the state to a context value;
    - its doc says a per-process random key works only when one process serves every round, which holds over stdio.
- **The request `ctx`.** `BaseContext.mcpReq` (`d.mts:2111`) carries:
  - `id` and `method`;
  - `_meta`, with the reserved keys lifted out;
  - `envelope` (`Partial<RequestMetaEnvelope>`);
  - `inputResponses` and `droppedInputResponseKeys`;
  - `requestState()`;
  - `signal: AbortSignal`;
  - `send` and `notify`.

  `ServerContext` (2219) adds `log`, `elicitInput` and `requestSampling`. On the SDK instance:
  - `getNegotiatedProtocolVersion()` (`d.mts:3096`) is deprecated but works: on a modern instance it reports `2026-07-28`, and on legacy the version negotiated at `initialize`.
  - `getClientCapabilities()` (3074) holds the `initialize` capabilities on legacy, and is `undefined` on modern stdio, where only the HTTP handler seeds it (43.2 QA).
- **The validator (DW-637).** `ServerOptions.jsonSchemaValidator` defaults to `DefaultJsonSchemaValidator` from `/_shims` (`mcp-DIH4cS6P.mjs:1044`). It validates accepted legacy elicitation content (1528).

**Confirmation gates (re-verified 2026-10-20 with `grep -rnE "\bconfirm\b" packages/*/src`, excluding tests and dist)**

| Gate | Where the `confirm: true` check lives |
|---|---|
| `iris_audit_manage:purge` | TS `iris-admin-mcp/src/tools/audit.ts:298` (field `:135`; it sends `body.confirm = true` at `:379`), plus IRIS defense in depth at `REST/Security.cls:2953` |
| `iris_env_promote:execute` | TS only: Gate 1 at `iris-dev-mcp/src/tools/env-promote.ts:994` (field `:1426`) |
| `iris_production_control:clean`+`killAppData` | TS passes it through (`production.ts:203`, field `:147`); the check is IRIS-side at `REST/Interop.cls:369` |
| `iris_message_resend:resendFiltered` | TS passes `dryRun`/`confirm` through (`message-resend.ts:588–589`, fields `:425` and `:432`); the check is IRIS-side at `REST/MessageResend.cls:589–592` |

- **The only `confirm: z` fields** in the five server packages are these four.
- **Hits that are not MCP gates:**
  - client-config's typed `--confirm-secret`/`confirm` (`synthesize.ts:69`, `:220`; `cli/clients.ts`) is a CLI;
  - two prompts tell the agent to get the user's explicit approval before `confirm` (`promoteEnvironmentChange.ts:101`, `resendFailedMessages.ts:71`).
- **Candidates for "what is missing":**
  - `iris_message_resend:resend` takes no `confirm`;
  - `iris_doc_edit:regenerateStorage` has none either (`doc-edit.ts:472–494`, a default-disabled write);
  - `iris_mapping_manage`'s `force` (`mapping.ts:70`) overrides a safety guard.

  AD-34 and FR162 still list `resend` and `regenerateStorage`.
- **An open design question.** For `clean`+`killAppData` and `resendFiltered`, the check, the caps and the match count are computed IRIS-side in the same POST that executes. Asking the human after the checks, naming the match count, needs a decision.

**Test assets to reuse (never edit the goldens)**
- **The 43.1 goldens.**
  - `sdk-wire-golden.json`: 112 rows, the v1 capture, with sessions `main`, `newer-era` and dev's `core-preset`.
  - `sdk-handler-golden.json`: 22 `tools/call` rows against `scripts/lib/fake-iris-listener.mjs`.
  - Their tests are `story-43-1-sdk-wire-golden` and `-qa-handler-golden`.
- **The raw driver, `scripts/lib/sdk-wire-golden-core.mjs`.**
  - From 43.1: `openRawWire` (255), `handshake` (357) and `inheritedGoldenEnv` (687).
  - From 43.2: `MODERN_ERA`, `modernEnvelope` (481), `withEnvelope`, `discoverHandshake` (508), `rawWithIdZero`, `MANDATED_MODERN_FIELDS` (441, the #7 list as data), `withoutMandatedFields`, `withoutExecution`, `mandatedFieldProblems`, `runModernGoldenSession` and `runProbeDiscardSession`.
  - 43.4 should reuse these raw helpers, not the client-level strip.
- **SDK client.** `connectSdkClient` and `openWireSession` (`process-gate-helpers.ts:293` and `:334`) take `versionNegotiation` (default `{mode: "legacy"}`, sent explicitly) and expose `getProtocolEra` and `getDiscoverResult`. They have no option yet for client capabilities or an `elicitation/create` handler, which 43.3 needs.
- **In-memory harness.** `sdk-wire-compat.test.ts` mocks `/stdio` by spreading `importOriginal()` (25), so the real `serveStdio` runs over a fake transport. `boot()` (216) takes `versionNegotiation`. The rows are in `describe("Story 43.2: both eras over serveStdio")` (668).
- **The 43.2 pins in the default suite, `packages/iris-mcp-all/src/__tests__/`:**
  - `story-43-2-cross-era-pin` (107 tests: (a)–(g) on five servers);
  - `-chokepoint-both-eras` (18 tests: seven calls per era over two fake IRIS profiles, including `_meta` smuggling of `server`, `namespace`, `profile`, `governance`, `visible` and `clientCapabilities`).
- **QA's files.**
  - `story-43-2-qa-hand-wire.ts` is a helper, not a test. It is a hand driver that uses neither the SDK client nor the core driver: `startHandWire`, `handEnv`, `startRig` (two fake listeners plus an audit file, with `interpose` for a proxy), `MINIMAL_META`/`EXAMPLE_META`, the `*_KEY` constants, `modernCall`, `withoutModernFields`, `eraLines` and `MODERN_ERA_LINE`/`LEGACY_ERA_LINE`. It keeps every stdout line, as an independent oracle (Rule #36).
  - The QA tests that use it: `-qa-revision-oracle` (50), `-qa-mixed-eras` (9), `-qa-concurrency-cancel` (8, with a holding proxy and an `untilReplied` barrier; it is DW-642's starting point), `-qa-meta-smuggling` (5) and `-qa-era-log-line` (27).

**Live check (decision #9, lead, 2026-10-20): PASS on both legs**
- **Setup:** Claude Code `2.1.296`, a closed-port iris-dev behind a wire tap, two haiku `claude -p` legs (USD 0.0070 in all).
- **`auto` leg:**
  - The first line in is `server/discover` with `2026-07-28`, and no `initialize` follows.
  - `tools/list` returns 33 tools with `resultType`, `ttlMs` 0, `cacheScope` `private` and the `_meta` serverInfo.
  - `iris_server_profiles` succeeds.
  - stderr has the modern era line.
  - Claude Code probed on the SAME connection: `server/discover` (id `server-discover-probe-1`), `subscriptions/listen`, a second `server/discover`, then the lists and the call. One tap file, no probe process.
- **`legacy` leg (`MCP_PROTOCOL_NEGOTIATION=legacy`):** `initialize` `2025-11-25`, no `resultType`, the same 33 tools, the call succeeds, and stderr has the legacy era line.

**Known limits (43.2 review dispositions; for the record)**
- **DW-643 (wontfix):** a pinned modern connection does not re-check each request's `protocolVersion`.
- **DW-644 (by design):** an unknown tool is an in-band `isError` on both eras.
- **DW-645 (wontfix):** an enveloped `initialize` gets `-32601` without `data.supported`.
- **DW-646:** routed to 43.4.
- **DW-647 (wontfix):** junk stdin lines are dropped silently.
- **DW-648 (by design):** after a legacy `initialize`, enveloped requests are served as 2025.
- **SDK-owned, in the CHANGELOG:** modern `ping` answers `-32601`, and `list_changed` reaches only `subscriptions/listen` subscribers.

**Probe (2026-10-15; `research/mcp-sdk-v2-stdio-probe-2026-10-15.md`)**
- One `inputRequired.elicit()` handler confirmed in one round on a pinned v2 client, an `auto` client, a `legacy` client and the v1.29.0 client. On legacy the shim sent a real `elicitation/create`.
- **Trap 1:** without the capability, the modern era gave a `ProtocolError` and the legacy era an `isError`. Every gate needs a fallback.
- **Trap 2:** re-asking whenever `acceptedContent()` returns `undefined` looped on decline until the client's 10-round limit. A decline must end the call.
- Claude Code shows a form dialog that an `Elicitation` hook can auto-answer. It moves calls that run past 2 minutes to the background, and aborts a silent stdio call after 30 minutes.

## UX & Interaction Patterns

- **The dialog.** Form-mode elicitation, whose message names the action, the target and the scope (item, window, match count).
- **Outcomes.** One accept proceeds. A decline or cancel ends the call with `CONFIRMATION_DECLINED`, changes nothing, and never re-prompts.
- **Re-asking.** Only when the retried arguments differ from the confirmed ones.
- **Clients that cannot elicit** see exactly today's `confirm: true` behavior and errors.
- **Docs.** The tool descriptions and the README say that elicitation-capable clients ask the human, and that a Claude Code `Elicitation` hook can auto-answer, which is the user's choice. Record how headless `claude -p` behaves.

## Cross-Story Dependencies

- **43.3 builds on 43.2.** It needs the `serveStdio` path, with its factory-built instances (any new `ServerOptions` go in `buildMcpServer`), and it threads `ctx` from the owned `tools/call` into `handleToolCall` and the handler. DW-642's abort signal uses the same thread.
- **43.4 depends on all three.** Its capstone and smokes cover both eras plus one confirmation each way. They reuse 43.2's raw helpers, `connectSdkClient` modes, QA's hand-wire and the live-check procedure, extended with 43.3's elicitation-capable client.
- **DW-639 and DW-646 are 43.4's.** Until then no story edits or recaptures either golden.
- **Epic 42.** It cannot publish `1.0.0` until Epic 43 lands. Story 42.1 owns the Node 22 floor (v2 needs Node 20 or later), and 42.2 owns DW-627's live-gate fix.
