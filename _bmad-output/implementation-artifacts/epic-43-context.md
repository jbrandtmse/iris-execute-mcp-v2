# Epic 43 Context: MCP SDK v2 Migration

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->
<!-- Recompiled 2026-10-20 after Story 43.1 (done, commit b24ff6c on branch epic43). Facts verified in source and in the installed node_modules on that date. -->

## Goal

Move the suite onto the MCP TypeScript SDK v2 before Epic 42 publishes `1.0.0`, so the first public release is built on the SDK's stable line and not on v1's maintenance line. v1 covers specs up to `2025-11-25` only and gets fixes until about 2027-01-27. Story 43.1 is done: the framework runs on `@modelcontextprotocol/server` 2.3.1, v1 is gone, and the 2025-11-25 wire matches frozen v1 goldens byte for byte. What remains:
- the same stdio process also serves revision `2026-07-28`, which Claude Code (our primary client) negotiates by default, so the modern path becomes the main path (43.2);
- the existing `confirm: true` gates also ask the human through elicitation when the client can (43.3);
- docs, live smokes and the capstone (43.4).

## Stories

- Story 43.1: Framework Migration to SDK v2 (done)
- Story 43.2: Serve MCP Revision 2026-07-28 (next)
- Story 43.3: Human Confirmation Through Elicitation
- Story 43.4: SDK v2 Docs, Smokes and Capstone

## Requirements & Constraints

**Epic-wide**
- **Byte-identical 2025-11-25 era (Rule #19, AD-15).** `tools/list`, `prompts/list`, the resources capability, error envelopes, governance denials and the `instructions` string stay byte-identical on that era, apart from the sanctioned 43.1 changes listed below. Each surface has a pin that fails on drift. The SDK stays inside `@iris-mcp/shared` (AD-2/AD-3).
- **Streamable HTTP stays rejected (AD-23).**
- **No bootstrap move.** No ObjectScript change, `BOOTSTRAP_VERSION` does not move, and `bootstrap-classes.ts` stays out of the diff. The IRIS-side `confirm` checks stay exactly as they are.
- **Out of scope:**
  - the Tasks extension (AD-16's `running` result plus `iris_test_status` covers long runs);
  - MCP Apps;
  - `subscriptions/listen` as a feature;
  - sampling, roots and URL-mode elicitation;
  - an operator setting that requires a human (a recorded candidate);
  - any new tool.
- **Run order.** The epic runs after Epic 41 and before Epic 42. It runs on branch `epic43`, which is merged into `feature/feature-wave-8-published-install`. Nothing publishes before Epic 43 lands. Status: `43-1-framework-migration-to-sdk-v2` is done; `43-2-…`, `43-3-…` and `43-4-…` are `backlog`.
- **Closed port.** Every `@iris-mcp/all` run uses `IRIS_HOST=127.0.0.1 IRIS_PORT=1`. Every launcher run also sets `IRIS_TEST_HOST=127.0.0.1 IRIS_TEST_PORT=1`, because the launcher tests otherwise reach the shared IRIS by default.

**43.1: delivered (the base 43.2 builds on)**
- **Pins.**
  - `@modelcontextprotocol/server` `2.3.1` is the only runtime SDK dependency, exact, in `packages/shared/package.json:43`.
  - `@modelcontextprotocol/client` `2.3.1` is an exact devDependency of shared (`:56`), dev (`:34`) and iris-mcp-all (`:19`).
  - `core` 2.3.1 comes in transitively.
  - The pnpm store holds only `client`, `core` and `server` at 2.3.1. No manifest, lockfile entry or store directory names `@modelcontextprotocol/sdk`.
  - The pins are guarded by `story-43-1-sdk-confinement.test.ts` (manifests, lockfile, source imports) and `story-43-1-qa-pack-confinement.test.ts` (what `npm pack` would publish).
- **Amended ACs (wave-8 decision #3, in `epics.md`).**
  - **AC 43.1.3:** the 43 `stageDefaultStartup` files pass with no assertion line changed, proven by a diff guard. "Unmodified" could not hold, because v2 wraps every handler and calls `ctx.mcpReq.requestState()`.
  - **AC 43.1.4:** the SDK-client suites live in dev, iris-mcp-all and the extension; shared has none.
  - A grep now finds 44 files that call `stageDefaultStartup(`: the 43 plus the new `sdk-wire-compat.test.ts`.
- **DW-579 (resolved).** `handleToolCall` (`server-base.ts:1400`) runs the wire validation (`checkWireInput` against `z.object(extended.shape)`) inside the audit wrapper when its source is `"wire"`.
  - A schema-invalid call writes one entry: `outcome` `error`, `error` set to the wire text, and `paramKeys` holding the raw top-level keys minus `server`. It never writes `params`, even with `IRIS_AUDIT_LOG_PARAMS=true`.
  - Unknown and hidden tools stay unaudited.
  - A refine on the whole object passes the wire check and is applied by `dispatchToolCall`, as on v1.
- **DW-617 (resolved).** `prompts/get` treats an omitted `arguments` as `{}`. The four all-optional prompts render, and the seven golden rows equal their `{}` rows, both on the raw wire and through `getPrompt({ name })`.
- **Sanctioned AD-15 changes (decisions #4 and #6; #5 withdrew the member-order exception).** All five are named in `CHANGELOG.md` (`[Pre-release — 2026-10-20] — Story 43.1`) and in `.changeset/story-43-1-sdk-v2-migration.md`:
  - DW-617;
  - DW-579's additive audit entry;
  - `addTools` sends one `list_changed` per call;
  - a malformed `tools/call` gets `-32602 Invalid tools/call request: …`;
  - a `tools/call` with a `task` parameter runs as a plain call.

  The last two are pinned byte for byte by `story-43-1-sanctioned-wire-changes.test.ts` (the raw driver, all five built servers).
- **Gates held.**
  - 115 tools (33/27/25/22/8).
  - Governance baseline: 141 keys, `1e62c5ad5bf7`.
  - `tools-list-snapshot.json` untouched. It still records `sdkVersion` 1.29.0; `installedVersion` now reads the server package.
  - `pnpm audit --prod`: 71 advisories over 206 dependencies became 18 over 120, and GHSA-6qxp-vccf-f47h is gone.
- **Ledger.**
  - DW-638 is resolved: the lead's armed smoke of the seven live-only v2-client files passed.
  - DW-640 is dropped (invalid premise).
  - DW-637 goes to 43.3 and DW-639 to 43.4 (bullets below).

**43.2: Serve 2026-07-28 (next)**
- **AC 43.2.1.**
  - `McpServerBase` serves through `serveStdio(factory)` from `@modelcontextprotocol/server/stdio`, passing `legacy: 'serve'` explicitly (Rule #10). The factory builds the `McpServer` and registers every tool, prompt and resource, and runs once per process.
  - Record which of client-config's 16 adapters negotiate `2026-07-28` today, and how `MCP_PROTOCOL_NEGOTIATION=legacy` forces Claude Code back to the old path.
- **AC 43.2.2.** A v2 client pinned to `2026-07-28` uses `server/discover` and calls tools. A 2025 client is unaffected, which 43.1's goldens prove.
- **AC 43.2.2a (cross-era equivalence pin).**
  - These must be logically identical on both eras: `tools/list` (names, schemas, annotations, order), prompts list and get, resources, `instructions`, a governance denial, a validation error and an `isError` result.
  - The pin may ignore only fields the revision mandates, and must name each one.
- **AC 43.2.3.** Per-request `_meta` never weakens AD-3. `server` and namespace resolution, governance, visibility and audit behave identically on both eras, and a test drives each gate on each era.
- **Lead seam note (43.1 Spec Change Log; decision #1).** The framework-owned `tools/list`, `tools/call`, `prompts/get` and `resources/read` handlers must also serve the `2026-07-28` era.
- **What 43.1's scope seam assigns to 43.2:**
  - moving `McpServer` construction, registration and owned-handler installation into the factory;
  - the owned handlers' modern-era output (`server/discover`, `resultType`, `ttlMs`, `cacheScope`);
  - the cross-era pin, reusing `scripts/lib/sdk-wire-golden-core.mjs` and the frozen fixture;
  - the per-request `_meta` work under AD-3;
  - the record of the 16 adapters;
  - the non-legacy client modes.
- **The 16 adapters.** `packages/client-config/src/adapters.ts` holds 16 ids: 13 `CLIENT_ADAPTERS` plus 3 `CLIENT_DISPOSITIONS` (`pi` is excluded as not MCP-capable; `jetbrains-junie` and `kilo-code` are roadmap). Story 41.6 read "16 adapters" the same way.
  - The repo records negotiation evidence for Claude Code only: per the probe, which cites code.claude.com/docs/en/mcp fetched 2026-10-15, it negotiates `2026-07-28` with stdio servers that offer it, and `MCP_PROTOCOL_NEGOTIATION=legacy` forces the old path.
  - No repo code reads `MCP_PROTOCOL_NEGOTIATION`.

**43.3: Elicitation confirmation**
- **AC 43.3.1.** An exhaustive gate inventory as of a named date (Rule #56), with a verdict for each gate; review asks what is missing. The gate table below was re-verified 2026-10-20.
- **AC 43.3.2.** One shared helper in `@iris-mcp/shared` does the asking; handlers never call the SDK.
  - **When the client declares form elicitation:** the helper returns an `inputRequired` elicitation whose message names the action, the target and the scope (item, window, match count). An accept proceeds. A decline or cancel ends the call with `CONFIRMATION_DECLINED`, changes nothing, and NEVER asks again.
  - **Otherwise:** today's `confirm: true` contract applies unchanged.
  - Probe how to read the client's capability per request on each era.
- **AC 43.3.3.**
  - `confirm: true` (and `dryRun: false` where it applies) stays required.
  - Every existing check (bounds, dry run, governance, AD-17) runs first. The dialog is an ADDITIONAL gate, never a replacement.
  - It is a sanctioned AD-15 change and goes in `CHANGELOG.md`.
- **AC 43.3.4.** The confirmation is bound to the exact arguments, for example by a hash of the normalized arguments, and the helper asks again if they differ. Any `requestState` is integrity-protected (HMAC or AEAD) and verified, because it comes back as untrusted client input.
- **AC 43.3.5.** Tests on both eras through the real SDK client over `serveStdio` cover accept, decline, cancel, the no-capability fallback, arguments that change between rounds, and a v1.29-era client. A live Claude Code check records that the dialog appears, that accept executes and decline refuses, and how headless `claude -p` behaves.
- **AC 43.3.6.**
  - No new governance key, tool or annotation change, and tool counts stay the same.
  - Each gated tool's description and the README say that elicitation-capable clients ask the human.
  - The docs cover the Claude Code `Elicitation` hook (auto-answering is the user's choice) and the fallback.
- **DW-637 (routed to 43.3).** `pnpm audit` cannot see the ajv 8.18.0, ajv-formats and fast-uri 3.1.0 bundled into the server dist (`ajvProvider-*.mjs`). They load as the default JSON-schema validator, which only elicitation uses. Before the dialog ships, check the published advisories against those exact versions, record the verdict, and supply a validator if one applies.
- **43.1's seam.** 43.3 owns threading the request `ctx` from the owned `tools/call` to the helper. Today `callToolFromWire` does not forward `ctx`.

**43.4: Docs, smokes and capstone**
- **AC 43.4.1.** Live smokes from the built dist in a fresh Node process:
  - each server through Claude Code plus one other certified client;
  - one call per era (Claude Code on its default `auto`, and once with `MCP_PROTOCOL_NEGOTIATION=legacy`);
  - one confirmation round trip per era.
- **AC 43.4.2 (capstone, default suite).** One test drives a server through the real SDK client on both eras: listing, a read call, a governance denial, a validation error, and a confirmation accepted once and declined once. It must be proven RED by breaking the era negotiation or the decline handling, naming the path broken.
- **AC 43.4.3.** Update:
  - the README and the client docs (supported revisions and confirmation behavior);
  - `CHANGELOG.md` and a changeset;
  - the spine's Stack rows, AD-32 and AD-34;
  - the PRD's MCP compliance line (`prd.md:88`). FR161 and FR162 are the requirements.
- **DW-639 (routed to 43.4).** `sdk-wire-golden.json` embeds the whole tool catalogue and the governance policy map, and its header test forbids a v2 recapture, so any legitimate catalogue change turns the default suite red. Decide how it retires: compare only what a migration can change, or hand the `tools/list` rows to the tools-list snapshot. `sdk-handler-golden.json` retires with it. 43.2 reuses both unchanged.

**Binding project rules**
- **#10:** pass `legacy: 'serve'` explicitly, and pin protocol versions and client `versionNegotiation` modes in tests.
- **#19:** mechanical back-compat pins.
- **#21:** one GENUINE capstone in the default suite, never a `*.integration.test.ts` suffix.
- **#22:** smoke the rebuilt dist in a fresh Node process. A stale `tsconfig.tsbuildinfo` can make `tsc` emit nothing, so delete it if `dist` does not refresh.
- **#26:** smoke at least one decline and assert nothing changed.
- **#31 and #53:** no tool count or preset row moves.
- **#36:** the goldens are never edited or recaptured.
- **#45:** cross-package checks live in `iris-mcp-all`.
- **#46:** use a real SDK `Client` against the dist, with one call that omits optional fields entirely.
- **#54:** every elicitation or era fake returns only shapes the installed 2.3.1 `.d.mts` or a probe shows the SDK can return.
- **#56:** the gate inventory and the adapter negotiation list are each exhaustive as of a date.
- **#59:** every gate and the capstone are proven red on the path they guard.
- **DW-627 (owned by 42.2; binds any new live gate here).** Live legs run only with `IRIS_REQUIRE_LIVE=1` and all five `IRIS_*` set, and a guard test proves zero requests when unarmed. The reference shape is `story-41-8-qa-accept-language-live-gate.test.ts`.

## Technical Decisions

**Architecture spine (as amended by wave-8 decisions #1–#6)**
- **AD-32 (SDK and protocol revisions).**
  - The SDK is used only inside `@iris-mcp/shared`. Two source files import it, `server-base.ts` and `sdk-wire-compat.ts`, and a guard test pins that boundary.
  - The v2 packages are pinned exactly, starting at 2.3.1, and v1 is removed.
  - The framework owns `tools/list`, `tools/call`, `prompts/get` and `resources/read`, installed through the public `setRequestHandler` from framework state, so the 2025-11-25 wire stays byte-identical.
  - Tool-input validation runs inside the audited path.
  - The same process serves `2026-07-28` through `serveStdio(factory)` with `legacy: 'serve'` (Story 43.2). A cross-era pin proves the logical content is identical on both eras.
  - Per-request `_meta` never bypasses AD-3.
  - The "v1 floor `>=1.31.0` until Epic 43" line is now moot.
- **AD-15.**
  - The Story 43.1 sanctioned list holds the five changes above, and records that result member order is NOT a change (v1 already re-encoded results in schema order).
  - The elicitation dialog (AD-34, Story 43.3) is on the list.
  - Every change is named in `CHANGELOG.md` with its story.
- **AD-3.** `handleToolCall` runs, in order: Zod validation; `server` → profile; `action`; the governance gate (a denial is a structured `isError` result); the per-profile context; the handler. The audit interceptor wraps all of it. On the wire path, step 1 is the wire validation. `server` is injected at registration and stripped before the handler, and handlers see only `ToolContext`.
- **AD-34.**
  - It binds `iris_audit_manage:purge`, `iris_env_promote:execute`, `iris_production_control:clean`+`killAppData`, `iris_message_resend` execute, `iris_doc_edit:regenerateStorage`, any future gate, and the shared helper.
  - The existing checks run first.
  - Accept proceeds. Decline or cancel gives `CONFIRMATION_DECLINED` and never re-asks.
  - A client that cannot elicit gets today's contract.
  - The confirmation is bound to the arguments, and `requestState` is integrity-protected.
  - A hook that auto-answers is documented as the user's choice.
- **The other ADs.**
  - **AD-2:** shared never imports a leaf package.
  - **AD-16:** a `running` result plus a companion tool, which is why Tasks is out.
  - **AD-17:** bulk writes are capped and default to dry run, and execute needs `confirm: true` (for `clean`, only `killAppData`). A refusal changes nothing.
  - **AD-19:** one JSONL audit entry per call, `outcome` in {`ok`,`error`,`denied`}, and the writer never fails or delays a call.
  - **AD-23:** stdio only.
- **Stack rows.**
  - v2 `server`, `client` and `core`: 2.3.1.
  - The v1 row reads "removed in Epic 43".
  - MCP specification: 2025-11-25 served, 2026-07-28 current (Story 43.2).
  - zod 4.3.6.
  - Node: the v2 `engines` field requires `>=20`, while the root still says `>=18`. Story 42.1 owns the floor (22). The host runs 26.8.1.

**Framework today (`packages/shared/src`, verified 2026-10-20)**
- **Construction.** The constructor (`server-base.ts:603`) builds `new McpServer(...)` (604–627) with:
  - `capabilities: {tools: {listChanged: true}, resources: {listChanged: true}}`;
  - `instructions: SERVER_DISCOVERY_INSTRUCTIONS`;
  - `debouncedNotificationMethods: ["notifications/tools/list_changed"]`.

  It then registers the visible tools, the discovery tool, the governance resource and the prompts. The `prompts` capability appears only when `registerPrompt` runs, which is why iris-data answers `prompts/*` with `-32601`. It calls `installWireHandlers()` last (780).
- **Owned handlers.** `installWireHandlers()` (791–801) calls `this.mcpServer.server.setRequestHandler` for:
  - `tools/list`, built from `this.tools` through `listedToolOf` (804–814) and `listedTool`;
  - `tools/call`, through `callToolFromWire` (822–839). A name that is missing or hidden gives an in-band `MCP error -32602: Tool <name> not found`, unaudited. Output-schema parity comes from `checkWireOutput`.
  - `resources/read`, through `readResourceFromWire` (868–880);
  - `prompts/get`, through `getPromptFromWire` (845–862), installed only when a prompt is registered.

  `initialize`, `prompts/list` and `resources/list`/`templates/list` stay SDK-served.
- **`sdk-wire-compat.ts` (143 lines).** It holds the pure parts of the 2025 contract:
  - `v1ProtocolErrorText` and `protocolError` (the `MCP error <code>: ` prefix);
  - `toolErrorResult`, `wireInputSchema`, `checkWireInput` and `checkWireOutput`;
  - `listedTool`: `z.toJSONSchema(…, {target: "draft-7", io})`, with `execution: {taskSupport: "forbidden"}`.
- **Connect.** `start()` (2217) creates the audit logger (2327), runs the health check (2355) and bootstrap (2409), then calls `new StdioServerTransport()` and `this.mcpServer.connect(…)` (2454–2455).
  - `serveStdio` is NOT used yet, and only the 2025-11-25 era is served: an `initialize` that asks for `2026-07-28` negotiates 2025-11-25 (golden `newer-era` rows).
  - `stop()` (2475) calls `this.mcpServer.close()`.
  - `get server()` (2662) returns the constructor-built instance.
- **No reads of request metadata.** Source reads no `_meta`, no `ctx.mcpReq`, and neither `getClientCapabilities` nor `getClientVersion`. The owned handlers read only `params.name`, `params.arguments` and `params.uri`.

**43.1 test and oracle assets (reuse; never edit the goldens)**
- **The wire golden.** `packages/iris-mcp-all/src/__tests__/fixtures/sdk-wire-golden.json`:
  - 112 rows, captured 2026-10-20 from the v1 1.29.0 build at baseline `39fd0ea`, closed-port env;
  - per server, sessions `main` (2025-11-25) and `newer-era` (an `initialize` asking `2026-07-28`, no `_meta`), plus dev's `core-preset` (`IRIS_TOOLS_PRESET=core`).

  Test: `story-43-1-sdk-wire-golden.test.ts`. The raw line is compared with `toBe`; a v2 `Client` view is compared with `toEqual`; `serverInfo.version` is masked to the manifest version; the DW-617 rows are compared with their `{}` rows. The test fails, never skips, on a stale dist or a missing client.

  Capture: `scripts/capture-sdk-wire-golden.mjs` (it refuses to overwrite without `--force`, and takes `--dist-root`).
- **The handler golden.** `fixtures/sdk-handler-golden.json`: 22 `tools/call` rows against the fake IRIS (`scripts/lib/fake-iris-listener.mjs`), including handler results, the requests made to IRIS, and audit entries.

  Test: `story-43-1-qa-handler-golden.test.ts`. Capture: `scripts/capture-sdk-handler-golden.mjs`, through `scripts/lib/sdk-handler-golden-core.mjs`. Both capture CLIs share `scripts/lib/golden-capture-cli.mjs`.
- **The raw driver.** It lives in `scripts/lib/sdk-wire-golden-core.mjs`:
  - `openRawWire` (251) is an SDK-free newline-delimited JSON-RPC driver over stdio, with `request`, `requestFrame`, `notify`, `stderr`, `endInput`, `exit` and `close`;
  - `handshake` (348) sends `initialize` and then `notifications/initialized`;
  - `runGoldenSession` (371) and `goldenSessions` (186) run the fixture's sessions;
  - `inheritedGoldenEnv` (437) strips `IRIS_*` and `MCP_TRANSPORT`;
  - the constants are `CLOSED_PORT_ENV`, `WIRE_ERA`, `NEWER_ERA_REQUEST` and `GOLDEN_PACKAGES`.

  It is pinned by `story-43-1-raw-wire-driver.test.ts`.
- **The SDK client.** `connectSdkClient` (`process-gate-helpers.ts:283–315`) spawns the dist and connects `new Client(…, {versionNegotiation: {mode: "legacy"}})` over `StdioClientTransport`; legacy is fixed in its type. `openWireSession` (322–337) wraps it, including `request(method, params)` for raw sends. `resolveSdkEsmDir` (25–37) finds the `@modelcontextprotocol+client@` store directory.
- **Other pins 43.2 must keep green:**
  - `story-43-1-qa-stdio-lifecycle` (each server exits 0 within 3 s of stdin closing);
  - `story-43-1-schema-invalid-audit` and `-qa-dw579-process`;
  - `story-43-1-sanctioned-wire-changes`;
  - shared `sdk-wire-compat.test.ts`, an in-memory v2 `Client` through the real `start()`;
  - `story-41-2` `WIRE_GOLDEN`;
  - `pnpm gen:tools-list-snapshot:check`.

**Installed SDK 2.3.1, for 43.2 (paths under `node_modules/.pnpm/@modelcontextprotocol+server@2.3.1/node_modules/@modelcontextprotocol/server/dist/`, read 2026-10-20)**
- **`serveStdio`.**
  - Declared in `stdio.d.mts` with `ServeStdioOptions`: `legacy?: 'serve' | 'reject'` (default `serve`), `transport?` (bring your own; the default is a new `StdioServerTransport`), `onerror?`, and `maxSubscriptions?` (1024).
  - Implemented at `stdio.mjs:285–582`.
  - It returns a `StdioServerHandle { close() }` synchronously, owns the transport, starts it, and calls `product.connect(channel)` itself.
- **Era decision.** `classifyOpeningMessage` (`stdio.mjs:235–268`) classifies the opening message:
  - an `initialize` without a valid modern `_meta` envelope claim is legacy. So the golden `newer-era` `initialize` stays legacy, and `Server._oninitialize` answers the first entry of the legacy list, `2025-11-25`;
  - a message with no claim is legacy;
  - a claim of `2026-07-28` is modern (`SUPPORTED_MODERN_PROTOCOL_VERSIONS`, `src-Cqbh3MYc.mjs:574`);
  - a bad envelope gets `-32602`;
  - an unsupported revision gets `UnsupportedProtocolVersionError`.

  For a modern instance, `connectInstance` (399–414) calls `setNegotiatedProtocolVersion` and `installModernOnlyHandlers`.
- **Factory.** The type is `McpServerFactory = (ctx: {era: 'legacy' | 'modern', authInfo?, requestInfo?}) => McpServer | Server | Promise<…>` (`createMcpHandler-D4NN8WsG.d.mts:3886–3903`). It is documented as returning a fresh instance per connection "or one discarded `server/discover` probe".
  - **Tension with AC 43.2.1's "once per process":** a `server/discover` opening builds a modern probe instance. A later legacy opening closes it and calls the factory again (`stdio.mjs:505–527`).
  - `Server.connect` rejects an instance that is already connected.
- **`server/discover`.** `installModernOnlyHandlers` (`mcp-DIH4cS6P.mjs:978`) calls `installDiscoverHandler` (1006–1010), which installs `Server._ondiscover` (1359). Its result holds `supportedVersions`, `capabilities` and `instructions`.
- **Modern encoding (`rev2026Codec`, `src-Cqbh3MYc.mjs:4040`).** `encodeResult` (4143) applies, in order:
  - `enforceDeletedFields` (4015), which strips `execution` from every `tools/list` entry and `tasks` from capabilities;
  - `stampResultType` (3774), which adds `resultType: "complete"`;
  - `fillCacheFields` (3797), which fills `ttlMs` and `cacheScope` (defaults 0 and `"private"`) on the closed list at 3464: `tools/list`, `prompts/list`, `resources/list`, `resources/templates/list`, `resources/read` and `server/discover`;
  - `stampServerInfoMeta` (3832), which adds `_meta["io.modelcontextprotocol/serverInfo"]` to every result.

  `Server._wrapHandler` (`mcp-DIH4cS6P.mjs:1141–1170`) wraps the owned handlers too. It validates the `tools/call` request and result with the era's codec.

  These are the candidate revision-mandated fields for AC 43.2.2a. Which ones the pin names is the story's decision.
- **Per-request `_meta`.** The protocol layer lifts the reserved envelope keys (protocol version, client info, client capabilities, log level) off the request before dispatch, and exposes them as `ctx.mcpReq.envelope`; handlers never see them in `params` (`createMcpHandler-D4NN8WsG.d.mts:1005–1014`).
  - A modern client attaches the envelope automatically, and user-supplied `_meta` keys take precedence over it.
  - Correcting the probe: `getClientCapabilities` and `getClientVersion` are deprecated in 2.3.1, and on modern instances they are backfilled per request from the envelope (`d.mts:3072–3082`). `_inputRequestCapabilityView` (`mcp-DIH4cS6P.mjs:1260`) reads the envelope on the modern era and the `initialize` state on the legacy era. 43.3 needs this.
- **Notifications on the modern era.** An outbound `list_changed` reaches only the `subscriptions/listen` subscriptions that the entry serves itself. With no subscription it is dropped (`StdioListenRouter.routeOutbound`).
- **Client modes.** In the client package, `index.d.mts:1803–1941` defines `versionNegotiation.mode` as `'legacy'` (the default), `'auto'`, or `{ pin: '2026-07-28' }`.
  - `auto` on the base `StdioClientTransport` probes on a short-lived sibling process spawned from the same command. That is one extra server spawn per connect, which runs our whole `start()`, with its stderr discarded.
  - A pinned client has no fallback.
- **43.2 harness facts.**
  - `sdk-wire-compat.test.ts:19–31` mocks `@modelcontextprotocol/server/stdio` with only `StdioServerTransport`.
  - In-process tests reach the constructor-built instance through `get server()`: `_registeredTools` in 61 files, and `_requestHandlers` in 30, including `scripts/lib/measure-tools-payload-core.mjs:19`.

**Probe (2026-10-15; `research/mcp-sdk-v2-stdio-probe-2026-10-15.md`)**
- **Setup.** `server` and `client` 2.3.1, the same version as the pin, with zod 4.3.6, installed with `--ignore-scripts`, on Node v26.8.1 (macOS).
- **Dual era.** One `serveStdio` process served four clients, and all four saw identical `tools/list` and `instructions`:
  - a v2 client pinned to `2026-07-28`;
  - a v2 client on `auto` (it negotiated modern);
  - a v2 client on `legacy` (2025-11-25);
  - the repo's v1.29.0 client.

  A plain `McpServer` on a `StdioServerTransport` speaks only the 2025 era, and `legacy: 'reject'` refuses 2025 clients.
- **Elicitation.** One `inputRequired.elicit()` handler confirmed in 1 round on all four clients. On legacy, the SDK shim sends a real `elicitation/create`. With no capability, the modern era gave a `ProtocolError` and the legacy era an `isError` result.
- **Traps.**
  - `acceptedContent()` returns `undefined` both for "not yet asked" and for "declined". Re-asking on `undefined` loops until `maxRounds` (10).
  - A client that cannot elicit gets an error, so every gate needs a fallback.
- **Claude Code.** It shows a form-elicitation dialog, which an `Elicitation` hook can auto-answer. It moves a call that runs past 2 minutes to the background, and aborts a silent stdio call after 30 minutes.

**Confirmation gates (re-verified 2026-10-20; `grep -rnE "^\s+confirm: z" packages/*/src`)**

| Gate | Where the `confirm: true` check lives |
|---|---|
| `iris_audit_manage:purge` | TS `iris-admin-mcp/src/tools/audit.ts:298` (field :135), plus IRIS defense in depth at `REST/Security.cls:2953` |
| `iris_env_promote:execute` | TS only, `iris-dev-mcp/src/tools/env-promote.ts:994` (field :1426) |
| `iris_production_control:clean`+`killAppData` | TS passes it through (`production.ts:203`, field :147); the check is IRIS-side at `REST/Interop.cls:369` |
| `iris_message_resend:resendFiltered` | TS passes `dryRun`/`confirm` through (`message-resend.ts:588–589`, field :432); the check is IRIS-side at `REST/MessageResend.cls:588–592` |

- `iris_message_resend:resend` takes no `confirm`, and `iris_doc_edit:regenerateStorage` has no `confirm` (`doc-edit.ts:472–495`). Both are default-disabled governed writes that AD-34 and FR162 still list.
- Epics 38–41 added no gate.
- The match count and caps of `resendFiltered`, and the `killAppData` check, are computed IRIS-side in the same POST that executes. Asking the human "after the checks, naming the match count" needs a design decision.

## UX & Interaction Patterns

- **The dialog.** Form-mode elicitation, whose message names the action, the target and the scope (item, window, match count).
- **Outcomes.** One accept proceeds. A decline or cancel ends the call with `CONFIRMATION_DECLINED`, changes nothing, and never re-prompts.
- **Re-asking.** Only when the retried arguments differ from the confirmed ones.
- **Clients that cannot elicit** see exactly today's `confirm: true` behavior and errors.
- **Docs.** Descriptions and the README say elicitation-capable clients ask the human, and that a Claude Code `Elicitation` hook can auto-answer, which is the user's choice. Headless `claude -p` behavior is recorded.

## Cross-Story Dependencies

- **Story order.** 43.1 is done. 43.2 (the factory and both eras) comes before 43.3, whose modern-era multi-round trip and per-request capability read need 43.2's `serveStdio` path and the owned `tools/call` passing `ctx` on. 43.4 depends on all three: its capstone and smokes cover both eras plus a confirmation.
- **Shared assets.** 43.2's cross-era pin and 43.4's capstone reuse the 43.1 raw driver, `connectSdkClient` (extended past legacy mode) and the frozen goldens. DW-639's retirement decision belongs to 43.4, so 43.2 must not recapture or edit either golden.
- **Epic 42.**
  - It cannot publish `1.0.0` until Epic 43 lands.
  - Story 42.1 owns the Node 22 floor, which lands after this epic; v2 needs Node 20 or later.
  - DW-627's opt-in live-gate fix is 42.2's, but any new live gate here must already follow that shape.
