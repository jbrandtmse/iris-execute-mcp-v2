---
title: 'Story 43.2: Serve MCP Revision 2026-07-28'
type: 'feature'
created: '2026-10-20'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-43-context.md'
warnings:
  - oversized
deferred:
  - summary: 'client-config dispositions `pi` as excluded-not-mcp-capable, but pi has had MCP support since 0.99.0 (2026-09-29): stdio and streamable HTTP, configured in `~/.pi/agent/mcp.json` and `.pi/mcp.json`. Its npm package is now `@earendil-works/pi-coding-agent`.'
    evidence: 'Plan-stage web research, 2026-10-20: the earendil-works/pi CHANGELOG 0.99.0 says "Added codemode, tool search, and MCP support as built-in extensions"; docs/mcp.md says "Pi connects to Model Context Protocol servers over stdio or streamable HTTP". Its client speaks only 2025-11-25.'
    location: 'packages/client-config/src/adapters.ts:579-585'
    severity: 'med'
  - summary: 'The client-config `windsurf` adapter may write a config that the current product ignores. Windsurf is now Devin Desktop, Cascade was removed in v3.9.19 (2026-09-08), and the docs say `mcp_config.json` "applies to the legacy Cascade agent only".'
    evidence: 'Plan-stage web research, 2026-10-20 (docs.devin.ai/desktop/changelog). Not verified against a running install.'
    location: 'packages/client-config/src/adapters.ts:286-313'
    severity: 'med'
  - summary: 'The client-config `goose` docsUrl points at a moved project. The repo is now aaif-goose/goose and the docs are at goose-docs.ai.'
    evidence: 'Plan-stage web research, 2026-10-20 (the aaif-goose/goose tags v1.54.0 and v1.55.0).'
    location: 'packages/client-config/src/adapters.ts:480'
    severity: 'low'
  - summary: 'A client on the TS SDK v2 `auto` or `{pin}` negotiation spawns a short-lived probe process from the same command for every connect. Claude Code is one such client: its v2 runtime has negotiated stdio by default since 2.1.292. That probe process runs the server''s whole startup once more (health check, Atelier version negotiation, bootstrap probe, and an audit sessionStart line when IRIS_AUDIT_LOG is set). This predates 43.2: against the 43.1 build the probe gets -32601 and the client falls back. The client docs should say so.'
    evidence: 'Plan-stage probe, 2026-10-20: the SDK client in auto and pin modes started 2 server processes (distinct pids), each with one factory call. Client index.d.mts:1803-1941 documents the sibling probe.'
    location: 'README and client docs (Story 43.4, AC 43.4.3)'
    severity: 'low'
---

<intent-contract>

## Intent

**Problem:** Every server speaks only the 2025-11-25 era. Claude Code, our primary client, has negotiated revision 2026-07-28 with stdio servers by default since 2.1.292 (2026-10-06), and against today's servers its probe gets `-32601` and falls back. Story 43.1 left `serveStdio` unused, so its framework-owned handlers are proven on one era only.

**Approach:** `McpServerBase.start()` serves stdio through the SDK's `serveStdio(factory, { legacy: "serve", transport })`. The factory hands out SDK instances made by one builder from framework state. The owned handlers stay unchanged, because the SDK's 2026-07-28 encoder adds every field the revision mandates. Then pin it:
- a cross-era test proves that every surface is the frozen 2025 golden plus a named list of mandated fields;
- a chokepoint test drives every AD-3 gate on both eras, including attempts to smuggle values through `_meta`;
- the client negotiation status is recorded for client-config's 16 ids.

## Boundaries & Constraints

**Always:**
- **The 2025-11-25 era stays byte-identical (Rule #19, AD-15).** Every 43.1 golden and pin passes with its fixture and assertion lines unchanged. Only two pre-existing files under a test tree may change, and neither loses or changes an existing assertion line:
  - `sdk-wire-compat.test.ts`: the `vi.mock` plumbing (spread `importOriginal()`), `boot()`'s option, and new rows in a new `describe` block;
  - the helper `process-gate-helpers.ts`: an additive option.
- **SDK confinement (AD-2, AD-32).** Only `server-base.ts` and `sdk-wire-compat.ts` import the SDK, and only from `@modelcontextprotocol/server` and `@modelcontextprotocol/server/stdio`. No dependency, manifest or lockfile changes, because `serveStdio` ships in the pinned 2.3.1.
- **Explicit options (Rule #10).** `legacy: "serve"` and the transport (`new StdioServerTransport()`) are both passed explicitly.
- **No `_meta` reads (AD-3, AD-32).** Neither framework nor handler code reads per-request `_meta`. The owned handlers read only `params.name`, `params.arguments` and `params.uri`.
- **No new environment variable and no new env read.** `startup-env-roster.test.ts` fails on any.
- **Closed port only (DW-627).** Every spawned server gets `inheritedGoldenEnv(process.env)` plus `IRIS_HOST=127.0.0.1` and a closed or fake-listener port. Launcher runs also set `IRIS_TEST_HOST=127.0.0.1 IRIS_TEST_PORT=1`. No live gate is added.
- **The goldens are read-only.** `sdk-wire-golden.json` and `sdk-handler-golden.json` are read, never edited or recaptured (Rule #36). Their retirement (DW-639) belongs to 43.4.
- **Minimal docs ship with this story (Rule #43).** They are listed in task 7.

**Never:**
- **No ObjectScript change.** `bootstrap-classes.ts` and `BOOTSTRAP_VERSION` (`d51856f74d6a`) stay out of the diff.
- **No catalogue change.** No tool, action, governance key, preset row, annotation, prompt or refusal code changes: 115 tools (33/27/25/22/8), baseline 141 keys, `1e62c5ad5bf7`.
- **Nothing that belongs to 43.3:** elicitation, `inputRequired`, any read of client capabilities, and `ctx` forwarding from `callToolFromWire`.
- **Nothing that belongs to 43.4:** the capstone, the per-client docs table, the spine Stack rows and the PRD line.
- **No other protocol features.** No cache hints, no `subscriptions/listen` work, no Tasks, no `legacy: "reject"`, and no HTTP (AD-23).
- **No SDK internals in source.** No source read or write of SDK private members, and no patching under `node_modules`.
- **No `claude` runs in the implement, QA or review stages.** The lead runs the live check at smoke.
- **No release steps.** No `engines` change, no `changeset version`, no publish.

## I/O & Edge-Case Matrix

Terms used in this table:
- **Modern:** a request whose `params._meta` carries `io.modelcontextprotocol/protocolVersion: "2026-07-28"` and `io.modelcontextprotocol/clientCapabilities`.
- **Mandated fields:** the decision #7 list.

Every row runs on all five built servers against a closed port, unless the row names a server.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| 2025 client | `initialize` asking 2025-11-25, or asking 2026-07-28 with no envelope | One legacy instance (one factory call, `legacy`). Every 43.1 golden row is byte-identical. | none |
| Modern discover | Opening `server/discover` with the envelope | One factory call (`modern`). `supportedVersions: ["2026-07-28"]`. `capabilities` equals the golden `initialize` capabilities. `instructions` is byte-identical. `resultType: "complete"`, `ttlMs: 0`, `cacheScope: "private"`. `_meta["io.modelcontextprotocol/serverInfo"]` equals the golden `serverInfo`. No top-level `serverInfo`. | none |
| Modern surfaces | Each golden `main` exchange (dev also `core-preset`), with the envelope | The golden line (the DW-617 rows use their `{}` row), with `execution` removed from every tool entry and the mandated fields added. Every other member, and member order, is identical. | JSON-RPC error frames are byte-identical apart from `id` |
| Probe discard | `server/discover`, then on the same connection `initialize` (asking 2025-11-25, and separately asking 2026-07-28) | Two factory calls. The second instance answers the golden `main/initialize` (or `newer-era/initialize`) row and every `main` exchange, byte for byte. | none |
| Envelope missing | A request without `_meta` on a modern-pinned connection | The SDK's `-32602` "Request is missing the required _meta envelope …" | JSON-RPC |
| Legacy on modern | `initialize` on a modern-pinned connection | The SDK's `-32022` "Unsupported protocol version: 2025-11-25" | JSON-RPC |
| `_meta` smuggling | `tools/call` whose `_meta` carries `server`, `namespace`, `profile`, `governance`, `IRIS_GOVERNANCE`, `visible` and an override of `clientCapabilities`, on each era | Identical to the same call without them: the same response, profile, namespace, denial, not-found result and audit entry | in-band |
| AD-3 gates (dev, two fake IRIS profiles) | The seven chokepoint calls (Design Notes) | Legacy and modern are identical apart from the mandated fields: the listener reached, the namespace in the request path, the normalized audit entry, and the result | in-band |
| Stdin EOF | Modern session after one call; stdin closed | Exit code 0, no signal, within 3 s | none |
| Stop | `stop()` after `start()`; `stop()` on a server that was never started | After `start()`: closes the serving handle (the pinned instance and the transport), then flushes audit as today. Never started: closes the instance built at construction. Neither throws. | none |
| Re-entry | `start()` while already serving | Throws an error naming the re-entry, and attaches nothing further to stdin | startup error |
| Era log | Each factory call | One `[INFO]` stderr line that names the era (decision #10) | none |
| In-process reach-in | `server.server._registeredTools` or `_requestHandlers` on a server that was never connected | The instance built at construction, unchanged | in-band |

</intent-contract>

## Code Map

**Framework.** `packages/shared/src/server-base.ts`, with line numbers at HEAD `fb61d1a`:
- **Imports, 15–23.**
  - Add `serveStdio` and the `StdioServerHandle` type from `@modelcontextprotocol/server/stdio`, next to `StdioServerTransport`.
  - Add the `McpRequestContext` type from `@modelcontextprotocol/server`. The package index exports both it and `McpServerFactory`.
- **Fields.**
  - 372: `private readonly mcpServer` becomes the mutable current instance. Add a flag for "handed out" and a `StdioServerHandle | undefined`.
  - 393: `sdkTools` holds the `RegisteredTool` handles of the current instance.
  - 395: `promptEntries` and 397: `resourceReaders` keep what the builder needs to re-register: name, title, description, `argsSchema`, and resource metadata.
- **Constructor.**
  - `new McpServer(...)` at 603–626 (capabilities, `instructions`, `debouncedNotificationMethods`) becomes the builder's construction step, with the same values.
  - Registration order, 708–775: visible tools, the discovery tool (731), the rebuilds, the governance resource (756), then prompts (773–775).
  - 780: `installWireHandlers()`.
- **Owned handlers.**
  - `installWireHandlers` (791–801) installs on `this.mcpServer.server`. It should instead take the instance to install on.
  - `callToolFromWire` (822–839), `getPromptFromWire` (845–862) and `readResourceFromWire` (868–880) stay unchanged.
- **SDK registration sites.**
  - `registerGovernanceResource` (1089–1155): the SDK `registerResource` calls are at 1093 and 1140, and the readers are pushed after each.
  - `registerPrompt` (1177–1263): the SDK `registerPrompt` calls are at 1217 (no arguments) and 1252 (with arguments).
  - `registerTool` (1281–1321): framework state at 1282–1293, the SDK `registerTool` at 1295–1320.
- **Dynamic tools.**
  - `addTools` (2069–2105): `sendToolListChanged` at 2097.
  - `removeTools` (2111–2155): `sdkTools.get(name)?.remove()`, then `sendToolListChanged` at 2147.
- **Lifecycle.**
  - `start()` (2217–2457): step 5, at 2453–2456, does `new StdioServerTransport()` then `this.mcpServer.connect`.
  - `stop()`: 2475–2480.
  - `get server()`: 2662.
- `packages/shared/src/sdk-wire-compat.ts` stays unchanged.

**SDK 2.3.1 (read-only).** All paths are under `node_modules/.pnpm/@modelcontextprotocol+server@2.3.1/node_modules/@modelcontextprotocol/server/dist/`.
- **`stdio.d.mts`:** `ServeStdioOptions` and `StdioServerHandle`.
- **`stdio.mjs`:**
  - 235–268: `classifyOpeningMessage`.
  - 285–582: `serveStdio`.
  - 399–414: `connectInstance` calls `factory({ era })`. For a modern instance it also calls `setNegotiatedProtocolVersion` and `installModernOnlyHandlers`.
  - 416–426: `discardProbeInstance`.
  - 505–527: a legacy opening after a probe makes the second factory call.
  - 430–433: a legacy `initialize` on a modern-pinned connection is rejected.
- **`src-Cqbh3MYc.mjs`:**
  - 4013: the required envelope keys.
  - 4015: `enforceDeletedFields` strips `tools[].execution` and `capabilities.tasks`.
  - 3774: `stampResultType`.
  - 3797: `fillCacheFields`. The six cacheable methods are listed at 3464–3471; the defaults are 0 and `"private"`.
  - 3832: `stampServerInfoMeta`.
  - 4142: `encodeResult`.
  - 4146: `checkInboundEnvelope`.
- **`mcp-DIH4cS6P.mjs`:**
  - 978: `installModernOnlyHandlers`.
  - 1058: `connect` rejects an instance that is already connected.
  - 1141–1170: `_wrapHandler`, which applies the era codec to the owned `tools/call`.
  - 1359: `_ondiscover`.
- **`createMcpHandler-D4NN8WsG.d.mts`, 3876–3903:** `McpRequestContext` and `McpServerFactory`.
- **The client, `client/dist/index.d.mts`:**
  - 1803–1941: `versionNegotiation`. `legacy` is the default. `auto` and `{ pin }` probe on a sibling process when used on the base `StdioClientTransport`.
  - 2375–2395: `getNegotiatedProtocolVersion`, `getProtocolEra` and `getDiscoverResult`.

**Harness to reuse:**
- **`packages/shared/src/__tests__/sdk-wire-compat.test.ts`:**
  - 19–31: the `vi.mock` of `/stdio`, an in-memory pair.
  - 207–227: `boot()`, which hard-codes `versionNegotiation: { mode: "legacy" }`.
  - 245–250: `callRequest`.
- **`scripts/lib/sdk-wire-golden-core.mjs`:**
  - constants `WIRE_ERA` (29), `NEWER_ERA_REQUEST` (32) and `CLOSED_PORT_ENV` (38);
  - `goldenSessions` (186);
  - `openRawWire` (251); its `requestFrame` sends exactly the members it is given;
  - `handshake` (348), `runGoldenSession` (371), `packageVersion` (403) and `inheritedGoldenEnv` (437).
- **`packages/iris-mcp-all/src/__tests__/story-43-1-sdk-wire-golden.test.ts`:** how rows are keyed, the `serverInfo.version` mask, the DW-617 rows, and failing rather than skipping on a stale dist.
- **`packages/iris-mcp-all/src/__tests__/process-gate-helpers.ts`:** `SdkClient` (224–241; it already has `getNegotiatedProtocolVersion`), `WireSessionOptions` (265–276), `connectSdkClient` (283–315, fixed to legacy) and `openWireSession` (322–337). 38 files use them.
- **The fake IRIS:** `scripts/lib/fake-iris-listener.mjs` `startFakeIris({ bootstrapVersion })`, and `scripts/lib/sdk-handler-golden-core.mjs` `readBootstrapVersion`, `normalizeAuditEntry` and `runHandlerSession`, which together are the 43.1 QA pattern.
- **`packages/shared/src/profiles.ts`:** the `IRIS_PROFILES` shape for a second profile.

**Kept green unmodified:**
- The `story-43-1-` files: `sdk-wire-golden`, `sanctioned-wire-changes`, `raw-wire-driver`, `qa-stdio-lifecycle`, `qa-handler-golden`, `qa-dw579-process`, `schema-invalid-audit`, `sdk-confinement`, `qa-pack-confinement` and `sdk-client-resolution`.
- `story-41-2-qa-prompts-stdio-wire` (`WIRE_GOLDEN`), `story-41-5-qa-dist-consumer`, and the 38-6 and 39-6 SDK-wire files.
- `tools-list-snapshot`, with `pnpm gen:tools-list-snapshot:check`.
- `startup-env-roster`.
- The 44 `stageDefaultStartup` files.

**Docs:**
- `README.md:884` says "MCP protocol (spec v2025-11-25)", which becomes false.
- `packages/shared/README.md:162` names only the 2025-11-25 client.
- `CHANGELOG.md` top entry: `## [Pre-release — <date>] — Story 43.2: …`. Changesets go in `.changeset/`; `story-43-1-sdk-v2-migration.md` is the format.

## Tasks & Acceptance

**Execution:**
1. `packages/shared/src/server-base.ts`: one builder, the factory, and `serveStdio`. Rationale: AD-32. One builder makes every instance complete by construction (decision #8), and the explicit options follow Rule #10 and serve the in-memory mock.
   - **The builder** is private. It:
     - creates the `McpServer` with today's options;
     - registers every tool in `this.tools` in insertion order, then both governance resources, then every prompt in registration order;
     - installs the owned handlers last;
     - refreshes `sdkTools`.

     It is the only place SDK registration happens. `registerTool`, `registerGovernanceResource` and `registerPrompt` record framework state only. The constructor ends with `this.mcpServer = <builder>()` in place of `installWireHandlers()`. `addTools` also registers each added tool on the current instance.
   - **The factory** is typed `McpServerFactory`. Its first call returns the instance built at construction. Any later call builds a fresh instance and makes it current, so `get server()` returns it. Every call writes one INFO line naming the era.
   - **`start()` step 5** keeps the handle from `serveStdio(factory, { legacy: "serve", transport: new StdioServerTransport() })`, then logs today's `Connected via stdio transport` line. A `start()` while a handle is open throws before it touches stdin.
   - **`stop()`** closes the handle if there is one, otherwise the current instance, then flushes audit as today.
   - **Doc comments** state the contract only (Rule 14).
2. `packages/shared/src/__tests__/sdk-wire-compat.test.ts`: the plumbing, plus a new `describe("Story 43.2: both eras over serveStdio")`. Rationale: the in-process half of the matrix.
   - **The mock** returns `{ ...(await importOriginal()), StdioServerTransport: Fake }`. No existing assertion line changes.
   - **`boot()`** takes an optional `versionNegotiation`.
   - **New rows:**
     - A `{ pin: "2026-07-28" }` client: `getProtocolEra() === "modern"`; `listTools` equals the legacy view once the mandated fields are removed; a denial; a schema-invalid call.
     - The probe-discard path, sent raw through `linked.clientHalf` (`server/discover`, then `initialize`): two factory calls; `server.server` is a new instance whose `tools/list` handler returns the same entries.
     - The era line once per factory call (a logger spy).
     - `stop()` closes the handle; `stop()` on a server that was never started does not throw.
     - A second `start()` throws.
   - **The header comment** covers both stories.
3. `scripts/lib/sdk-wire-golden-core.mjs`: additive exports. Existing exports keep their behavior, so `story-43-1-raw-wire-driver` stays green. Rationale: one source for the modern driver and for the decision #7 list, which 43.4 reuses.
   - `MODERN_ERA` (`"2026-07-28"`);
   - `modernEnvelope(clientName)`;
   - `withEnvelope(params, envelope)`;
   - `discoverHandshake(wire, clientName)`;
   - `MANDATED_MODERN_FIELDS`, the decision #7 list as data;
   - the pure functions `withoutMandatedFields(method, message)` and `withoutExecution(message)`.
4. `packages/iris-mcp-all/src/__tests__/process-gate-helpers.ts`: `WireSessionOptions.versionNegotiation?`, default `{ mode: "legacy" }` sent explicitly. `connectSdkClient` passes it. `SdkClient` gains `getProtocolEra` and `getDiscoverResult`. Existing callers do not change.
5. NEW `packages/iris-mcp-all/src/__tests__/story-43-2-cross-era-pin.test.ts`, in the default suite. It fails, never skips, on a stale dist or a missing client. It covers AC 43.2.2 and AC 43.2.2a, per server and for dev's `core-preset`:
   - **(a)** A raw modern session against the frozen golden, byte for byte, after applying `withoutMandatedFields` to the live line and `withoutExecution` to the golden, with `id` substituted.
   - **(b)** The values of the mandated fields.
   - **(c)** `server/discover` against the golden `initialize`.
   - **(d)** The probe-discard sessions against the golden `main` and `newer-era` rows, byte for byte.
   - **(e)** SDK clients on `{ pin: "2026-07-28" }` and on `auto`, against `legacy`. Compare, with `toEqual` after removing `_meta`, `ttlMs` and `cacheScope` (and legacy's `execution`):
     - the era accessors;
     - `getInstructions`, `getServerCapabilities` and `getServerVersion`;
     - `listTools`;
     - `callTool` for profiles, an unknown tool, a schema-invalid call, a denial where the server has one, and the closed read;
     - `listPrompts`, and `getPrompt({ name })` with no `arguments` key (Rule #46);
     - `listResources`, `listResourceTemplates` and `readResource`.
   - **(f)** The error codes for a missing envelope and for a legacy `initialize` on a modern connection.
   - **(g)** The stdin-EOF exit on the modern era.
6. NEW `packages/iris-mcp-all/src/__tests__/story-43-2-chokepoint-both-eras.test.ts`, in the default suite. It covers AC 43.2.3.
   - **Setup:** two fake IRIS listeners, and the dev dist with `IRIS_PROFILES` (`default` → A, `other` → B) and `IRIS_AUDIT_LOG` in an OS temp dir.
   - **Run:** the seven calls, once on a legacy session and once on a modern one.
   - **Per call:** the response (with the mandated fields removed), the listener and request path reached, and the normalized audit entry are equal across eras and equal to the expected literal. Each smuggling call equals its plain twin.
   - **Reuse:** the fake listener and the handler-golden helpers.
7. The docs (Rule #43). AD-29 means a `patch` changeset and no publish.
   - **`README.md:884`:** one stdio process serves 2025-11-25 and 2026-07-28. Claude Code (2.1.292 and later) negotiates 2026-07-28 by default. `MCP_PROTOCOL_NEGOTIATION=legacy`, set in Claude Code's own environment (not in the server's `env`), keeps the 2025-11-25 handshake. Other clients are unaffected.
   - **`packages/shared/README.md:162`:** name `serveStdio` and both eras.
   - **`CHANGELOG.md`:**
     - **Added:** the 2026-07-28 era on stdio. The 2025-11-25 wire is unchanged. Claude Code's switch.
     - **Known limits**, all SDK-owned: on the modern era `ping` answers `-32601`; `list_changed` reaches only `subscriptions/listen` subscribers; `auto` and `pin` clients on the SDK's stdio transport spawn a probe process.
   - **`.changeset/story-43-2-serve-2026-07-28.md`:** `patch` for `@iris-mcp/shared` and the five servers.

**Acceptance Criteria:**
- **AC 43.2.1 (serving).**
  - **Given** a built server, **when** it starts, **then** `start()` serves stdio through `serveStdio`, with `legacy: "serve"` and the transport passed explicitly.
  - Every instance the factory returns comes from the one builder, carrying every visible tool, both governance resources, every prompt and the owned handlers.
  - The factory runs once per process, except on the probe-discard path (decision #8). The era line makes each call observable.
- **AC 43.2.1 (record).** **Given** the client negotiation record in Design Notes (16 ids, as of 2026-10-20, sources cited, unconfirmed rows marked `unverified`), **when** a reviewer asks what is missing, **then** every id in `CLIENT_ADAPTERS` and `CLIENT_DISPOSITIONS` has a row, and `README.md` names Claude Code's default and `MCP_PROTOCOL_NEGOTIATION=legacy`.
- **AC 43.2.2.**
  - **Given** each built server, **when** a v2 client pinned to 2026-07-28 connects over stdio, and also one on `auto`, **then** it negotiates the modern era (`getProtocolEra() === "modern"`, with a discover result), and its calls succeed or refuse exactly as on 2025-11-25.
  - Every 43.1 pin in the Code Map passes with its fixture and assertion lines unchanged.
- **AC 43.2.2a.** **Given** the frozen golden, **when** its exchanges run on the modern era, **then**:
  - each response equals its golden row byte for byte once the decision #7 fields are removed;
  - those fields carry their pinned values;
  - `instructions` and `capabilities` are equal across `initialize` and `server/discover`.
- **AC 43.2.3.** **Given** two fake IRIS profiles, **when** the seven chokepoint calls run on each era, **then** `server` and namespace resolution, the governance gate, visibility and the audit entry are identical across eras, and no `_meta` key changes any of them.
- **Integration (Rule 1).** **Given** the five server packages, which consume `McpServerBase.start()`, **when** the cross-era pin spawns each built entry point, **then** each one serves both eras from one process.
- **Back-compat (Rule #19).**
  - **Given** the finished story, **when** `git diff <baseline_revision>` runs over `packages/*/src/__tests__` and `extensions/iris-mcp-launcher/src/__tests__`, **then** the only pre-existing files that change are these two, and no existing assertion line changes:
    - `sdk-wire-compat.test.ts`: the mock plumbing, `boot()`'s option and the new `describe` block;
    - `process-gate-helpers.ts`: the additive `versionNegotiation` option and the two accessor types.
  - Both goldens are byte-unchanged.
- **Release bookkeeping (AD-29, AD-15).** **Given** the story's commit, **when** a reviewer reads `CHANGELOG.md` and the changeset, **then** they name the modern era (additive), the unchanged 2025 wire and Claude Code's switch. No AD-15 sanction is needed, because no 2025-era byte changes.

## Spec Change Log

- 2026-10-20 (lead spec gate): D7–D10 were taken as recommended (wave-8 decisions #7–#10). AC 43.2.1's "once per process" is amended in `epics.md` per #8. Spine AD-32 now carries the pin's six ignored fields, the factory rule and the era log line; the lint passed. The four plan-stage `deferred:` items are harvested at dev complete: three as occurrences of DW-626 (`pi`, `windsurf`, `goose`), and the probe-process docs item to 43.4. The lead runs the D9 live check at smoke.

## Review Triage Log

## Design Notes

**Governing architecture:**
- **AD-32:** `serveStdio(factory)` with `legacy: 'serve'`, the cross-era pin, and per-request `_meta` that never bypasses AD-3.
- **AD-3:** the chokepoint order is unchanged. The owned `tools/call` still enters `handleToolCall` as `"wire"` on both eras.
- **AD-15:** the 2025 era is byte-identical, and nothing new is sanctioned.
- **AD-2:** the SDK stays in shared, and the cross-package tests live in `iris-mcp-all`.
- **AD-19:** one audit entry per call, the same on both eras.
- **AD-23:** stdio only.
- **AD-29:** a `patch` changeset, and no publish.
- **AD-7:** visibility is identical on both eras, because `tools/list` is built from `this.tools`.
- **AD-10:** the framework surfaces are registered once per instance, by the builder.

**Plan-stage probe record (2026-10-20).** The probes ran in an rsync copy of the repo under the scratchpad, which has since been deleted. The copy was patched with the task 1 design (builder, factory, `serveStdio` with an explicit transport) and the task 2 mock plumbing, then shared and the five servers were built. No IRIS was contacted.

*Seam answer 1: on 2.3.1, does `serveStdio` with the owned `setRequestHandler` handlers serve `server/discover` and the modern `tools/call`?* Yes, on all five servers.

*Seam answer 2: who adds `resultType`, `ttlMs`/`cacheScope` and the `_meta` identity?* The SDK's encode seam (`encodeResult`). The handlers need no era-specific code.

*Seam answer 3: does the 2025 era stay byte-identical to the 43.1 goldens?* Yes:
- **Package suites:** shared 82 files / 2113 tests; dev 68 / 1356 (+307 skipped); admin 35 / 490; interop 30 / 672; ops 20 / 350; data 9 / 163.
- **43.1 pins:** golden 232/232, sanctioned 35, raw driver 3, lifecycle 5, handler golden 72, dw579 27, schema-invalid 1, confinement 35.
- **Other pins:** 41-2 35, 41-5 28, 38-6 10, 39-6 13, snapshot 28. All 44 `stageDefaultStartup` files pass. The snapshot and baseline checks are OK.
- **Two exceptions, neither caused by `serveStdio`:**
  - `startup-env-roster` failed only on the probe's own diagnostic env read. That is why the rule above forbids any new env read.
  - Ten files that need the client-config dist did not run in the copy. A read-only stand-in for `qa-pack-confinement` passed: shared's packed SDK imports are exactly `server` and `server/stdio`.

*Modern era*, 101 exchanges over 6 sessions:
- **Added fields:**
  - `resultType: "complete"` on every result;
  - `ttlMs: 0` and `cacheScope: "private"` on exactly the cacheable methods;
  - `_meta["io.modelcontextprotocol/serverInfo"]`, equal to `initialize`'s `serverInfo`, on every result.
- **Removed:** `execution`, from all 130 tool entries.
- **Unchanged:**
  - The 22 error frames are byte-identical.
  - No row differs in anything else.
  - With those fields removed, every line re-serializes to the golden bytes, member order included. The added fields come at the end of `result`.
- **`server/discover` against `initialize`:** `capabilities` is identical (same order, nothing stripped), and `instructions` is byte-identical. `protocolVersion` and the top-level `serverInfo` are absent.

*SDK client view:*
- `auto` and pin both negotiate 2026-07-28.
- `getServerVersion`, `getServerCapabilities` and `getInstructions` are identical across modes.
- Results come back with `_meta`, `ttlMs` and `cacheScope` placed first and `resultType` stripped, so a `toEqual` comparison must remove those three fields.

*Factory calls:* one per process in every mode (raw legacy, raw modern, a modern opening without `server/discover`, and the SDK in legacy, auto and pin). Auto and pin spawn 2 processes, one call each. The only case with two calls in one process is a raw `server/discover` followed by `initialize`. There, the rebuilt instance served the `initialize` line, all 92 `main` rows and the 7 DW-617 rows byte for byte on all five servers. The probe did not try `initialize` asking 2026-07-28 after a discard (matrix row Probe discard, second part).

*Edge cases.* These lines are SDK-owned; the test pins them by code only:
- missing envelope: `-32602`;
- legacy `initialize` on a modern connection: `-32022`;
- malformed envelope: `-32602`;
- modern `ping`: `-32601`;
- an opening `server/discover` without an envelope: `-32601`, and it pins legacy;
- a pinned connection does not re-check each request's claimed version.

*Chokepoint (calls 1–7 below):* the two eras were identical in the listener reached, the request path, the normalized audit entry and the result. No `_meta` key had an effect.

*Lifecycle:* a modern session exits with code 0, 7 ms after stdin EOF.

**D7. Orchestrator decision needed: which fields the cross-era pin ignores (AC 43.2.2a).** Recommended: exactly the list below, each pinned by value elsewhere. Everything else is compared byte for byte.

| # | Field | Revision text (2026-07-28) | Pinned value |
|---|---|---|---|
| 1 | `resultType` on every result | "The `result` **MUST** include a `resultType` field" (`/specification/2026-07-28/basic/index#resulttype`) | `"complete"` |
| 2 | `ttlMs`, `cacheScope` on `server/discover`, `tools/list`, `prompts/list`, `resources/list`, `resources/templates/list`, `resources/read` | "Servers MUST include caching hints on results with `resultType: "complete"` returned by" those six methods (`/server/utilities/caching`) | `0`, `"private"`: the SDK defaults, with no cache hints configured |
| 3 | `_meta["io.modelcontextprotocol/serverInfo"]` on every result | "Servers **SHOULD** include … in every result's `_meta`" (`/basic/index#_meta`; spec PR #3002) | equal to the 2025 `initialize` `serverInfo`, with the version masked to the manifest version |
| 4 | `tools[].execution`, absent on modern | Changelog item 6: "Move experimental tasks out of the core protocol and into an official extension (`io.modelcontextprotocol/tasks`)". The 2026-07-28 `schema.ts` `Tool` has no `execution` | absent on modern; `{"taskSupport":"forbidden"}` on legacy |
| 5 | `initialize` relocated to `server/discover` | Changelog item 2 removes the `initialize` handshake. "Servers **MUST** implement" `server/discover` (`/server/discover`) | `supportedVersions` = `["2026-07-28"]` in place of `protocolVersion`. `capabilities` and `instructions` are compared across the relocation. `serverInfo` is compared through field 3 |
| 6 | The JSON-RPC `id` | Framing, not content | substituted |

- **Evidence.** The probe's 101 rows have no other difference. The SDK fills these fields itself. Claude Code 2.1.302 fixed "MCP servers showing no tools, or every tool call failing, when the server negotiates protocol version 2026-07-28 but omits `resultType`, `ttlMs` or `cacheScope`", which is why fields 1–3 are pinned by value and not just ignored.
- **Lead action under Rule 20.** Name this list in AD-32's Rule, or add a "Cross-era comparison" Conventions row, so that 43.3 and 43.4 compare the eras the same way.

**D8. Orchestrator decision needed: the factory semantics, and the wording of AC 43.2.1's "the factory runs once per process".**
- **Recommended:**
  - One builder. The first factory call returns the instance built at construction, so every in-process user of `server` (61 files read `_registeredTools`, 30 read `_requestHandlers`) is unaffected. Later calls build fresh instances.
  - Amend the AC (apply and report): "… the factory runs once per process, except on the SDK's probe-discard path (a `server/discover` opening followed by a legacy `initialize` on the same connection). There it runs a second time and builds a fresh, fully registered instance, which serves the 2025-11-25 era byte-identically."
- **Evidence:** `stdio.mjs:505–527`, and the probe's factory table and probe-discard byte check.
- **Rejected: reusing the discarded instance.** That instance is modern-marked: `setNegotiatedProtocolVersion` has run, `server/discover` is installed, and 2026-07-28 is in its supported list. A reused instance could then negotiate 2026-07-28 on a legacy `initialize`. The `newer-era` probe-discard row pins this.
- **Lead action under Rule 20:** AD-32's Rule gains this sentence.

**D9. Orchestrator decision needed: the primary-client live check and its failure path.**
- **Recommended:** the lead runs the procedure below at smoke. A failed `auto` leg takes the failed-smoke path (rework). The story never ships with `legacy: "reject"`, with the modern era switched off, or with a docs-only workaround.
- **Evidence:** Claude Code 2.1.292 negotiates 2026-07-28 with stdio servers by default, and the 2.1.302 fix above shows the modern path fails hard when a field is missing.

**D10. Orchestrator decision needed: one stderr INFO line per factory call, naming the era.**
- **Recommended:** yes. The lines are `Serving MCP protocol revision 2026-07-28 (server/discover)` and `Serving the 2025-era MCP handshake (initialize)`. No environment variable.
- **Evidence:** today nothing tells an operator which path a client took, and Claude Code's path changes silently when 43.2 lands. The live check and 43.4's capstone can read the line. It is not a wire field, so AD-15 does not apply.
- **Alternative:** no line, relying on the wire tap only.

**Client negotiation record (AC 43.2.1; exhaustive for client-config's 16 ids as of 2026-10-20; Rule #56).**
- **Source of the id list:** `packages/client-config/src/adapters.ts` (13 `CLIENT_ADAPTERS` and 3 `CLIENT_DISPOSITIONS`).
- **Method:** web research the same day.
- **Background:** the TS SDK v1.x line (latest 1.32.1) and the Python SDK v1.x line both stop at `LATEST_PROTOCOL_VERSION = "2025-11-25"`.

| id | Negotiates 2026-07-28 over stdio today? | Evidence | Source |
|---|---|---|---|
| claude-code | **Yes, by default** | 2.1.292: "Changed local (stdio) MCP server connections to negotiate protocol version 2026-07-28 by default … `MCP_PROTOCOL_NEGOTIATION=legacy` opts out" | code.claude.com/docs/en/changelog (2026-10-06); /docs/en/mcp#mcp-client-runtimes |
| claude-desktop | unverified | No revision is named in the changelog from v1.15962.0 to v2.42304.2 (2026-10-19); the launch post says "being rolled out across Claude products" | claude.com/docs/cowork/changelog; claude.com/resources/articles/bringing-mcp-2026-07-28-to-claude |
| cursor | unverified (stdio) | A forum reply says the client "currently speaks the 2025-11-25 revision", for remote servers; the responder's staff status is unconfirmed, and the docs are silent | forum.cursor.com/t/…/172536 (2026-09-21) |
| vscode | No (2025 era) | `LATEST_PROTOCOL_VERSION = "2025-11-25"`; sends `initialize`; issue #329848 (open) | github.com/microsoft/vscode main |
| cline | No | `@modelcontextprotocol/sdk` `^1.25.1` / `^1.29.0` | cline/cline main |
| roo-code | No | `@modelcontextprotocol/sdk` `1.12.0` | RooCodeInc/Roo-Code main |
| windsurf | Vendor says yes; default and stdio unverified | Devin Desktop v3.10.67: "Added support for connecting to MCP servers on protocol revision 2026-07-28" | docs.devin.ai/desktop/changelog (2026-10-12) |
| codex | Opt-in, under development | feature `mcp_2026_07_28`, `Stage::UnderDevelopment`, `default_enabled: false` | openai/codex main `codex-rs/features/src/lib.rs` |
| gemini | No | `@modelcontextprotocol/sdk` `1.23.0` | google-gemini/gemini-cli main |
| zed | No | its own client, `LATEST_PROTOCOL_VERSION: "2025-11-25"` | zed-industries/zed main |
| goose | **Yes, by default (v1.54.0 and later)** | `ClientLifecycleMode::Auto { preferred_versions: [V_2026_07_28, V_2025_11_25] }` | aaif-goose/goose v1.55.0 (2026-10-16) |
| kimi | No | `fastmcp==3.2.4`, which needs `mcp<2.0` | MoonshotAI/kimi-cli main |
| kimi-code | No | `@modelcontextprotocol/sdk` `^1.29.0` | MoonshotAI/kimi-code main |
| pi (disposition: excluded) | No (2025 era) | It has had MCP since 0.99.0 and its client is 2025-11-25 only. The disposition is stale (deferred) | earendil-works/pi CHANGELOG (2026-09-29) |
| jetbrains-junie (roadmap) | unverified | The docs name no revision; closed source | junie.jetbrains.com |
| kilo-code (roadmap) | No | `@modelcontextprotocol/sdk` `1.31.0` | Kilo-Org/kilocode main |

**Claude Code's switch.** code.claude.com/docs/en/env-vars says: "Set `auto` to probe HTTP, claude.ai connector, and stdio servers, or `legacy` to probe none. … Requires Claude Code v2.1.221 or later". The values are `auto` and `legacy`. Unset, it follows the runtime defaults, which today probe stdio. It is an environment variable of Claude Code itself, set in the shell or in `settings.json` `env`, not in a server's `env`. Claude Code's docs do not say how it probes stdio. Its v2 runtime is built on TS SDK v2, whose `auto` mode probes on a sibling process, and changelog 2.1.238 removed a same-connection probe.

**Lead live check (D9; at smoke, never in the implement stage).** Use a scratch project `<S>` under the lead's scratchpad, and record `claude --version` (2.1.292 or later).

1. **The wire tap.** Write `<S>/tap.mjs` with the file tools. Its contract: `node tap.mjs <logDir> <entry>` spawns `process.execPath <entry>` with piped stdio and the inherited environment. It appends `{"pid","dir":"in"|"out"|"err","line"}` per line to `<logDir>/tap-<pid>.jsonl`, forwards all three streams, ends the child's stdin when its own stdin ends, and exits with the child's code.
2. **`<S>/mcp.json`.** One server, `iris-dev`: `command: node`, `args: ["<S>/tap.mjs", "<S>/wire-<leg>", "<repo>/packages/iris-dev-mcp/dist/index.js"]`, `env: {IRIS_HOST: "127.0.0.1", IRIS_PORT: "1", IRIS_USERNAME: "qa", IRIS_PASSWORD: "qa", IRIS_NAMESPACE: "HSCUSTOM"}`. This is a closed port, so there is no IRIS contact. The dist is built from the story's tree.
3. **Each leg,** from `<S>/proj`: `perl -e 'alarm 300; exec @ARGV' -- env -u CLAUDECODE [MCP_PROTOCOL_NEGOTIATION=legacy] claude -p --model haiku --max-budget-usd 1 --strict-mcp-config --mcp-config ../mcp.json --setting-sources project --allowedTools mcp__iris-dev__iris_server_profiles --disallowedTools Read,Write,Edit,Bash --output-format stream-json --verbose "Call the iris_server_profiles tool of the iris-dev server once, then reply DONE." > ../<leg>.jsonl`. The `auto` leg leaves `MCP_PROTOCOL_NEGOTIATION` unset; the `legacy` leg sets it.
4. **The oracle, `auto` leg.**
   - The tap files hold a session whose first `in` line is `server/discover`, with `_meta["io.modelcontextprotocol/protocolVersion"]` `"2026-07-28"`.
   - That session's `tools/list` answer has 33 tools plus `resultType`, `ttlMs`, `cacheScope` and `_meta` serverInfo.
   - Its `tools/call iris_server_profiles` carries the envelope and is answered without `isError`.
   - Its `err` lines hold the modern era line.
   - No `in` line in it is `initialize`.
   - Record the number of tap files (2 expected: the probe process and the session).
5. **The oracle, `legacy` leg.**
   - No tap file holds `server/discover`.
   - The session's first `in` line is `initialize`.
   - Its answers carry no `resultType`.
   - The same call succeeds, and the legacy era line is present.
6. **Both legs.**
   - The stream-json `init` lists `iris-dev` as connected, along with the tool.
   - The result is `success`, with `total_cost_usd` at most 1 (recorded).
   - The stderr shows the closed-port health-check line.
7. **Teardown:** delete `<S>`.
8. **If Claude Code connects differently** (for example, a discover and an `initialize` on one connection), record it. The leg still passes if the session negotiates its era and the calls succeed.

**The seven chokepoint calls (AC 43.2.3).** Each is sent once per era. On modern, the `_meta` keys merge into the envelope.
1. `iris_doc_get {name: "Demo.Sample.cls"}`: reaches A at `/api/atelier/v8/HSCUSTOM/doc/…`. Audit: `default`, HSCUSTOM, `ok`, `[name]`.
2. The same call, with `_meta` holding `server: "other"`, `namespace: "%SYS"`, `profile: "other"` and `io.modelcontextprotocol/clientCapabilities: {elicitation: {}}`: identical to call 1.
3. `{name, server: "other", namespace: "USER"}`: reaches B at `/v8/USER/…`. Audit: `other`, USER, `ok`, `[name, namespace]`.
4. `server: "nope"`: the unknown-profile `isError` result, and no requests.
5. `iris_env_promote {action: "execute", source: "A", target: "B"}`, with `_meta` holding `governance` and `IRIS_GOVERNANCE` enabling it: `GOVERNANCE_DISABLED`, audit `denied`, no requests.
6. `iris_doc_get {name: 12345}`: the schema-invalid `isError` result, with the DW-579 audit entry.
7. Under `IRIS_TOOLS_PRESET=core`, in its own process per era: `tools/list` returns the 15 `core` tools, and `iris_doc_delete` with `_meta {visible: true}` gives `Tool iris_doc_delete not found`, with no audit entry.

**Scope seam (Rule #52).**
- **43.2 delivers:** the builder, the factory and `serveStdio`; `stop()` and the re-entry guard; the era line; the modern helpers in the raw driver; `connectSdkClient` modes; the cross-era pin and the chokepoint test; minimal docs; the client record; and the live-check procedure.
- **43.3 owns:**
  - the confirmation helper;
  - reading the client's capability per request (`ctx.mcpReq.envelope` on modern, the `initialize` state on legacy);
  - forwarding `ctx` from `callToolFromWire`, which 43.2 leaves unforwarded;
  - `inputRequired`;
  - DW-637.
- **43.4 owns:** the capstone (both eras plus a confirmation, reusing task 3's helpers and `MANDATED_MODERN_FIELDS`); the smokes; the per-client docs table built from this record; the spine Stack rows, AD-32 and AD-34; the PRD line; and DW-639.

**Rules 1 and 2.**
- **Consumed-by:**
  - **43.3:** its helper runs on whichever instance the factory built, and reads the envelope the SDK lifts.
  - **43.4:** its capstone reuses `discoverHandshake`, `withoutMandatedFields`, the `connectSdkClient` modes and the live-check procedure.
- **Consumes:** 43.1's owned handlers, raw driver, frozen goldens, fake listener and handler-golden core; SDK 2.3.1 `serveStdio`.
- **Extend, don't copy:**
  - The modern helpers extend `sdk-wire-golden-core.mjs`; there is no second driver.
  - `connectSdkClient` gains an option instead of a second connector.
  - The in-memory rows extend `boot()` and the existing mock; there is no second mock file.
  - The chokepoint test reuses `startFakeIris` and `normalizeAuditEntry`.
  - The builder replaces the interleaved SDK calls, so registration has one path.

**Ledger inbox (Rule 17):** none was routed to this story.

**AC interpretations (apply and report):**
- "with the default `legacy: 'serve'`": the value is passed explicitly (Rule #10), which changes nothing observable.
- "`_meta` identity": `_meta["io.modelcontextprotocol/serverInfo"]`.
- "resources": `resources/list`, `resources/templates/list` and `resources/read`, including their error rows.
- "Each gate on each era": the seven calls above.
- "Once per process": see D8.

**Risks for the implementer:**
- **Ordering in the builder.** Keep the SDK registration order (tools, resources, prompts) and install the owned handlers last. The SDK lazily installs its own handlers on the first registration, and the owned ones must replace them.
- **Options.** Keep `debouncedNotificationMethods` in the builder's options; 43.1's `list_changed` rows depend on it.
- **Throw timing.** SDK registration throws, such as a duplicate prompt name, now fire from the builder at the end of the constructor. `prompts-guardrails` must stay green.
- **`sdkTools`** must hold the current instance's handles, or `removeTools` removes from a discarded instance.
- **SDK client comparisons** need the three fields removed first (see the probe record).
- **Stale builds.** A stale `tsconfig.tsbuildinfo` can make `tsc` emit nothing. Delete it if `dist` does not refresh.
- **Hooks.** `pnpm gen:governance-baseline:check`'s `pre` hook builds shared.
- **README wording.** `story-41-7-doc-claims` may pin README wording near line 884. Run it.

**Mutations (Rule 19).** Apply each, observe red, revert, and record a `mutation:` line under `## Verification`.

| Mutation (on the built dist unless noted) | Must go red | AC |
|---|---|---|
| `start()` connects a plain `StdioServerTransport` (no `serveStdio`) | the cross-era modern rows (discover answers `-32601`) | 43.2.1, 43.2.2 |
| `legacy: "reject"` | the 43.1 golden and the cross-era legacy-side rows | 43.2.2 (a 2025 client is unaffected) |
| the factory returns the same instance on every call | the probe-discard rows (if it stays green, record why and use "the builder skips prompts" instead) | 43.2.1, D8 |
| the owned `tools/list` reverses tool order when `params._meta` is present | the modern `tools-list` rows; the 43.1 golden stays green | 43.2.2a |
| the owned `tools/list` returns `ttlMs: 5` | the mandated-value row | 43.2.2a, D7 |
| `callToolFromWire` takes `server` from `params._meta` | chokepoint call 2 | 43.2.3 |
| the governance gate is skipped when `params._meta` is present | chokepoint call 5 (modern) | 43.2.3 |
| the era line is dropped (src) | its `sdk-wire-compat` row | D10 |

## Verification

**Commands.** All run from `/Users/jbrandt/git/iris-execute-mcp-v2`, in the foreground with `timeout: 600000`. `CP` stands for `IRIS_HOST=127.0.0.1 IRIS_PORT=1`. `<B>` stands for the `baseline_revision` that the implement stage records in the frontmatter (the HEAD it starts from).
- **(loop) Builds.** `pnpm --filter @iris-mcp/shared build`, then `@iris-mcp/dev`, `/admin`, `/interop`, `/ops` and `/data`, one per call. Expected: exit 0.
- **(loop) Shared.** `pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/sdk-wire-compat.test.ts src/__tests__/server-base.test.ts src/__tests__/prompts-guardrails.test.ts`. Expected: pass.
- **(loop) Wire pins.** `CP pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-43-2-cross-era-pin.test.ts src/__tests__/story-43-2-chokepoint-both-eras.test.ts src/__tests__/story-43-1-sdk-wire-golden.test.ts src/__tests__/story-43-1-sanctioned-wire-changes.test.ts src/__tests__/story-43-1-raw-wire-driver.test.ts src/__tests__/story-43-1-qa-stdio-lifecycle.test.ts src/__tests__/story-43-1-qa-handler-golden.test.ts src/__tests__/startup-env-roster.test.ts`. Expected: pass, with no skip in the `story-43-*` files.
- **(loop) Diff guard.** `git diff <B> -U0 -- packages/*/src/__tests__ extensions/iris-mcp-launcher/src/__tests__ packages/iris-mcp-all/src/__tests__/fixtures`, filtered for changed `expect(` and `assert` lines in pre-existing files. Expected: the only pre-existing files that change are `sdk-wire-compat.test.ts` (the mock, `boot()` and the new block, with no removed or changed assertion line) and `process-gate-helpers.ts` (additive), and the fixtures are unchanged.
- **(once) Package suites.** `pnpm --filter <pkg> test`, then `type-check`, then `lint`, for shared, dev, admin, interop, ops, data and client-config, one per call. Expected: green.
- **(once) iris-mcp-all sweep.** `cd packages/iris-mcp-all && CP pnpm exec vitest run $(ls src/__tests__/*.test.ts | awk 'NR%3==0')`, then `NR%3==1`, then `NR%3==2`. Expected: green, with the live gates skipped.
- **(once) Launcher.** `IRIS_TEST_HOST=127.0.0.1 IRIS_TEST_PORT=1 CP npm --prefix extensions/iris-mcp-launcher test`. Expected: the failures equal the DW-532 set exactly.
- **(once) Gates.** `pnpm gen:governance-baseline:check` (141 keys, `1e62c5ad5bf7`), `pnpm gen:tools-list-snapshot:check`, `pnpm validate:prompts`, `pnpm gen:skills:check` and `pnpm gen:pack:check`. Expected: OK and unchanged.
- **(once) Diff checks.** `git diff --name-only <B>` lists no `bootstrap-classes.ts`, no `package.json` and no `pnpm-lock.yaml`.
- **(once) Shuffled runs.** The added and changed tests, with `--sequence.shuffle` at seeds 11 and 22. Expected: green.

**Shared surfaces:**
- the `get server()` instance (61 files read `_registeredTools`, 30 read `_requestHandlers`);
- `start()`'s stdio wiring (the one mock, in `sdk-wire-compat.test.ts`);
- `WireSessionOptions` and `connectSdkClient` (38 files);
- the exports of `sdk-wire-golden-core.mjs`;
- stderr startup lines (one new INFO line per factory call, read by `story-43-1-qa-dw579-process`, `story-43-1-qa-stdio-lifecycle` and the epic-37 gates);
- `README.md:884`.

Every test added or changed passes on a fresh environment, in either order. No IRIS instance is touched, and no `ExecuteMCPv2.Temp.*` fixture is used.

**Manual checks:**
- `git status --short` shows nothing under `irislib/`, `irissys/` or `extensions/iris-mcp-launcher/package-lock.json`.

## Auto Run Result

Status: ready-for-dev
Blocking condition: none

**Planning pass (2026-10-20).** The story is planned and halted after planning, as instructed.
- **Probes.** They ran in a scratch copy, since deleted, with no IRIS contact.
  - On 2.3.1, `serveStdio(factory)` with the owned handlers serves both eras.
  - The SDK adds every field the revision mandates.
  - Every 2025-era suite and 43.1 golden stays green.
  - The AD-3 gates behave identically on both eras.
- **Orchestrator decisions for the lead:** D7 (the ignored-field list for the cross-era pin), D8 (factory semantics, and amended wording for AC 43.2.1's "once per process"), D9 (the live check and its failure path), and D10 (the era log line).
- **Rule 20 actions for the lead:** D7 and D8 also need lines in the spine.
- **Ledger inbox:** none.
- **Deferred items (4):** for the lead's harvest.
