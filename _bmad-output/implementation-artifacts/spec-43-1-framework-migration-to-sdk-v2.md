---
title: 'Story 43.1: Framework Migration to SDK v2'
type: 'refactor'
created: '2026-10-20'
status: 'done'
baseline_revision: '39fd0ea525fdfd5545249f610361ecd6f667bedd'
baseline_commit: '39fd0ea525fdfd5545249f610361ecd6f667bedd'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings:
  - oversized
deferred:
  - summary: 'The two launcher SDK-client tests reach the shared IRIS by default: they read IRIS_TEST_HOST / IRIS_TEST_PORT (default localhost:52773, HSCUSTOM) and ignore the closed-port IRIS_HOST / IRIS_PORT that DW-627 relies on. This is an occurrence of the DW-627 root cause, not a new one.'
    evidence: 'Plan-stage probe, 2026-10-20: a scratch-copy run of the launcher suite with only IRIS_HOST=127.0.0.1 IRIS_PORT=1 set made real read traffic to localhost:52773. That traffic was a GET /api/atelier/, a spawned iris-dev-mcp health check, version negotiation and bootstrap probe, and iris_server_info / iris_server_profiles calls. The deployed bootstrap version read back d51856f74d6a, which equals BOOTSTRAP_VERSION at HEAD, so the probe found current and deployed nothing. The defaults are at governanceUiRoundTrip.test.ts:64-68 and localSpawnIntegration.test.ts:57-61.'
    location: 'extensions/iris-mcp-launcher/src/__tests__/governanceUiRoundTrip.test.ts:64-68; extensions/iris-mcp-launcher/src/__tests__/localSpawnIntegration.test.ts:57-61'
    severity: 'med'
  - summary: 'pnpm audit cannot see code bundled into @modelcontextprotocol/server 2.3.1: its dist bundles ajv 8.18.0, ajv-formats and fast-uri 3.1.0 (the same fast-uri behind 9 of the v1 advisories). They load as the default JSON-schema validator and are used only for elicitation.'
    evidence: 'Plan-stage scratch spike, 2026-10-20: the after-migration audit dropped fast-uri from the tree, but the server dist still contains the bundled copy. Story 43.3 is the first user of elicitation, and so of that validator.'
    location: '@modelcontextprotocol/server@2.3.1 dist (ajvProvider-*.mjs)'
    severity: 'low'
  - summary: >-
      The v2-client code in the five iris-mcp-all local-copy gates and in the two launcher integration tests has never run against a server, because every one of them skips unless IRIS is reachable.
    evidence: |-
      Review pass, verification-gap layer (unverified). The shared constructor shape (new Client with versionNegotiation legacy, StdioClientTransport) is exercised by the golden through connectSdkClient, but a v2 option or result-shape mismatch in a call site the helper does not use would stay hidden until an armed run. Settled by an armed run of epic37-default-outage-gate, host-guard-process-gate, server-manager-process-gate, server-manager-precedence-gate, governance-file-process-gate, localSpawnIntegration and governanceUiRoundTrip against a live instance; this story may not run them.
    location: >-
      packages/iris-mcp-all/src/__tests__/epic37-default-outage-gate.test.ts; host-guard-process-gate.test.ts; server-manager-process-gate.test.ts; server-manager-precedence-gate.test.ts; governance-file-process-gate.test.ts; extensions/iris-mcp-launcher/src/__tests__/localSpawnIntegration.test.ts; governanceUiRoundTrip.test.ts
    severity: medium (unverified)
  - summary: >-
      The golden's tools-list and call:server-profiles lines embed the whole tool catalogue and the governance policy map, so any later tool, action or description change turns the default suite red, and the golden's header test forbids recapturing it from v2.
    evidence: |-
      Review pass (edge-case and verification-gap layers). The golden is the frozen v1 oracle by design (Rule #36, never regenerated), and Stories 43.2 and 43.4 reuse it. How it retires or updates once the catalogue legitimately changes (for example, comparing only the parts a migration can change, or retiring the tools-list rows to the tools-list snapshot) is a decision those stories own; it is not made here.
    location: >-
      packages/iris-mcp-all/src/__tests__/fixtures/sdk-wire-golden.json; packages/iris-mcp-all/src/__tests__/story-43-1-sdk-wire-golden.test.ts
    severity: low
  - summary: >-
      A tools/call result that carries both isError and structuredContent is written as content, structuredContent, isError on the SDK v2 wire, where the v1 wire wrote content, isError, structuredContent; the lead has to sanction this as an AD-15 exception or fix it.
    evidence: |-
      Review pass (verification-gap and intent-alignment layers; implement stage finding 2). Probed on the in-memory transport: the owned handler returns the v1 order and the SDK Server re-encodes the result in its result schema order; no public SDK option keeps the dispatch order. The JSON value is identical. The class is the handler results of the 14 refusalResult call sites and any handler that sets isError with structuredContent; the golden cannot reach it because a handler needs a live IRIS instance, and the governance denial is built in schema order already. The CHANGELOG records it under Known limits and the changeset names it. The spec's Risks section directed recording it, so it was not pinned as an accepted exception.
    location: >-
      packages/shared/src/server-base.ts (dispatchToolCall result assembly); packages/shared/src/__tests__/sdk-wire-compat.test.ts ("a result that carries isError and structuredContent")
    severity: low
---

<intent-contract>

## Intent

**Problem:** The suite runs on MCP SDK v1 (`@modelcontextprotocol/sdk` 1.29.0). That line is in maintenance, and 53 of today's 71 `pnpm audit --prod` advisories come through it. Epic 42 must not publish `1.0.0` on it. Two v1 behaviors are also wrong:
- a schema-invalid `tools/call` is rejected before the audited chokepoint, so no audit entry is written (DW-579);
- a `prompts/get` that omits `arguments` is refused for prompts whose arguments are all optional (DW-617).

**Approach:**
- Move `@iris-mcp/shared` onto `@modelcontextprotocol/server` 2.3.1, move the tests onto `@modelcontextprotocol/client` 2.3.1, and remove v1 everywhere.
- Keep every 2025-11-25-era wire response byte-identical. Where v2's output differs, the framework owns the handler: `tools/list`, `tools/call`, `prompts/get` and `resources/read`.
- Prove it against goldens captured from the v1 build before any migration edit.
- Fix DW-579 and DW-617 inside that owned path.

## Boundaries & Constraints

**Always:**
- **One era.** 2025-11-25 is the only era served. `start()` connects a plain `StdioServerTransport` from `@modelcontextprotocol/server/stdio`.
- **Goldens.** Every golden row is byte-identical on the raw response line, apart from the DW-617 rows.
- **SDK confinement.** Only `packages/shared/src` source imports the SDK (AD-2, AD-32), and handlers see only `ToolContext`.
- **Dependencies.**
  - Add them with `pnpm add --save-exact`, at version 2.3.1, and commit the lockfile.
  - No install scripts.
  - zod stays at 4.3.6, as a single copy.
  - No unrelated upgrades.
- **Closed port.** Every `@iris-mcp/all` run uses `IRIS_HOST=127.0.0.1 IRIS_PORT=1`. Every launcher run also sets `IRIS_TEST_HOST=127.0.0.1 IRIS_TEST_PORT=1`.
- **Capture order.** The goldens are captured from the v1 build at the implement baseline BEFORE any source or manifest edit (Rule #36). They are never edited by hand.

**Never:**
- No ObjectScript change. `bootstrap-classes.ts` and `BOOTSTRAP_VERSION` stay out of the diff.
- No new tool, governance key, preset row or annotation change.
- No `serveStdio`, no 2026-07-28 serving, no `server/discover` and no elicitation. Those belong to 43.2 and 43.3.
- No new source read of SDK private fields. Owned handlers are installed through the public `Server.setRequestHandler` and read framework state.
- No `engines` change (Story 42.1), no `changeset version`, no publish.
- No IRIS traffic.
- No regeneration of the governance baseline or of `tools-list-snapshot.json`.

## I/O & Edge-Case Matrix

Every row runs on the 2025-11-25 era against a closed port, on all five servers unless a row names one. "v1 bytes" means byte-identical to the golden row.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Initialize | `initialize` with `protocolVersion` 2025-11-25, and separately with 2026-07-28 | v1 bytes: negotiates 2025-11-25. `capabilities` include `prompts` only on the four prompt servers. Same `instructions` and `serverInfo`. | none |
| Tool list | `tools/list` | v1 bytes. Each entry is `name, title, description, inputSchema, annotations, execution` in that order, plus `outputSchema` when one is declared. `inputSchema` is `z.toJSONSchema(z.object(extended.shape), {target:"draft-7", io:"input"})`. `execution` is `{"taskSupport":"forbidden"}`. Hidden tools are absent. 115 tools: 33/27/25/22/8. | none |
| Unknown or hidden tool | `no_such_tool`, or a non-core dev tool under `IRIS_TOOLS_PRESET=core` | `isError` result `MCP error -32602: Tool <name> not found`. No audit entry, as on v1. | in-band |
| Schema-invalid call | wrong type; enum mismatch; field-level refine (`iris_test_coverage` `target`) | `isError` `MCP error -32602: Input validation error: Invalid arguments for tool <name>: <ZodError.message>`, validated against `z.object(extended.shape)`. Neither governance nor the handler runs. One audit entry (DW-579, D2). | in-band |
| Object-level refine | `iris_production_control` `{action:"start"}` with no `name` (refine at `production.ts:158`) | v1 bytes. v1's SDK rebuilt `z.object(shape)`, which drops object-level refines. The rebuild must stay exact so this row keeps v1's text. | in-band |
| Omitted tool args | `tools/call` with no `arguments` key, including `iris_server_profiles` | v1 bytes: the schema-invalid text for `undefined`. Audited like the schema-invalid row. | in-band |
| Valid calls | `iris_server_profiles {}`; a default-disabled write (governance denial); a closed-port read | v1 bytes. The handler receives v1's parsed args. The audit entry equals v1's, with `paramKeys` taken from the parsed args. | in-band |
| Prompt list | `prompts/list` | v1 bytes (SDK-served). iris-data answers `-32601`. | JSON-RPC |
| Prompt get | `prompts/get` with arguments, or with `{}` | v1 bytes. Invalid arguments give `-32602` `MCP error -32602: Invalid arguments for prompt <name>: <ZodError.message>`. | JSON-RPC |
| DW-617 | `prompts/get` with the `arguments` key omitted | Identical to the same prompt's `arguments: {}` response. The four all-optional prompts render; prompts with required arguments get the `{}` error. | JSON-RPC |
| Prompt errors | unknown prompt; a `build` that throws | `-32602` `MCP error -32602: Prompt <name> not found`; `-32603` `MCP error -32603: Prompt '<name>' failed to render: <msg>`. | JSON-RPC |
| Resources | `resources/list`, `resources/templates/list`, `read iris-governance://default` | v1 bytes | none |
| Resource errors | `read iris-governance://<unknown profile>`; a URI that matches no resource | v1 bytes: `-32602` with the `MCP error -32602: ` prefix kept. The no-match case reads `Resource <uri> not found`. | JSON-RPC |
| DW-579 audit | schema-invalid call, with `IRIS_AUDIT_LOG` and `IRIS_AUDIT_LOG_PARAMS=true` | Exactly one entry. `outcome` is `error`; `error` is the schema-invalid text; `paramKeys` lists the raw top-level keys minus `server`; there is NO `params` key. The existing derivations fill profile, namespace and action. A valid call's entry is unchanged. | never fails the call |
| In-process reach-in | a test calls `_registeredTools[name].handler(args)` | today's `handleToolCall` path, with `dispatchToolCall`'s own `Invalid arguments: …` text unchanged | in-band |

</intent-contract>

## Code Map

**Framework (`packages/shared/src/`):**
- `server-base.ts`:
  - **Imports:** lines 15–22.
  - **`new McpServer`:** lines 559–578.
  - **Registration order:** visible tools (660–664), then the discovery tool (683), then `registerGovernanceResource()` (708), then prompts (725–727). Install the owned handlers after the prompts.
  - **Protocol-error throws:** `buildGovernancePolicyResult` at 864 and 869; the render throw at 1051.
  - **`registerGovernanceResource`:** lines 935–995.
  - **`registerPrompt`:** lines 1029–1145. Delete the CR 25.1-6 comment at 1103–1130.
  - **`registerTool`:** lines 1156–1197. Pass `extendedInputSchema` itself, not `.shape`.
  - **`handleToolCall`:** line 1272, the audit wrapper.
  - **`dispatchToolCall`:** line 1309. Its own `safeParse` (1339) and its text (1357) stay.
  - **Audit:** `recordAuditEntry` at 1672; the `derive*` helpers at 1778–1852.
  - **Dynamic tools:** `addTools` at 1947; `removeTools` with its `_registeredTools` delete at 1960–2000.
  - **Lifecycle:** `start()` at 2305; `stop()` at 2327; `get server()` at 2513.
- `sdk-wire-compat.ts` (new): pure helpers that server-base uses:
  - the v1 tool-list entry;
  - the v1 protocol-error text (`MCP error <code>: <msg>`);
  - the wire validation.
- `__tests__/test-helpers.ts:42-46`: `callTool`, which uses `entry.callback ?? entry.handler`. That still works on v2.

**v1 reference.** Read it before removing v1, and quote the formats into code comments only as contracts. It lives at `node_modules/.pnpm/@modelcontextprotocol+sdk@1.29.0_zod@4.3.6/node_modules/@modelcontextprotocol/sdk/dist/esm/server/`:
- `mcp.js` ListTools, lines 67–99 (key order);
- CallTool, lines 100–141, including "not found" at 104;
- `validateToolInput`, lines 169–180;
- `validateToolOutput`, lines 185–207;
- `prompts/get`, lines 420–440;
- `resources/read`, lines 376–393;
- `zod-json-schema-compat.js` (`draft-7`, `io`);
- `zod-compat.js:127` `getParseErrorMessage`, which returns `ZodError.message`.

**Manifests:**
- `packages/shared/package.json:43`: change `sdk ^1.29.0` to `@modelcontextprotocol/server` 2.3.1, and add devDependency `@modelcontextprotocol/client` 2.3.1.
- Remove `sdk` from admin `:31`, data `:31`, dev `:31` (dev gains client devDep 2.3.1), interop `:30` and ops `:30`.
- `packages/iris-mcp-all/package.json`: client devDep 2.3.1.

**Tests that change** (assertions untouched, except where named):
- **Static v1 imports:**
  - `packages/shared/src/__tests__/prompts-guardrails.test.ts:37`, plus the class identity `toBeInstanceOf(McpError)` and `name: "McpError"`, which become `ProtocolError`;
  - `packages/shared/src/__tests__/governance-resource-coverage.test.ts:40`;
  - `packages/iris-dev-mcp/src/__tests__/doc-type-description.test.ts:21-22`.
- **v1-shaped `extra` passed to `_requestHandlers` for `tools/call`, `prompts/get` or `resources/read`.** These crash on v2, so they add `mcpReq: { requestState: () => undefined }`:
  - shared `governance-classification:114`, `governance-file:750`, `governance-preset:160`, `governance-preset-cross-surface:132`, `governance-resource:154`, `server-discovery.e2e:143`, `tool-visibility-surfacing:145`;
  - dev `doc-get-range-framework:47`;
  - interop `control-governance-e2e:110`;
  - check the other 20 `_requestHandlers` users (inventory below) and fix any that call those three methods. This includes `packages/shared/src/__tests__/prompts.test.ts` (`callRequest`, line 99), whose rows at 337–343 also invert under DW-617.
- **SDK-client harness:**
  - `packages/iris-mcp-all/src/__tests__/process-gate-helpers.ts`: `resolveSdkEsmDir` at :25–36 and `openWireSession` at :265–306;
  - the local resolver copies at `epic37-default-outage-gate:98`, `server-manager-precedence-gate:107`, `governance-file-process-gate:122`, `server-manager-process-gate:64` and `host-guard-process-gate:75`;
  - the own `client/index.js` / `inMemory.js` joins in `story-38-6-qa-edit-prompt-sdk-wire.test.ts:110,113` and `story-39-6-qa-forensics-prompts-sdk-wire.test.ts`;
  - the launcher at `localSpawnIntegration.test.ts:94-120,216-221` and `governanceUiRoundTrip.test.ts:83-100,219-224`.
- **DW-617 rows that invert:**
  - `story-41-5-qa-dist-consumer.test.ts:211-218,269-275`;
  - `packages/shared/src/__tests__/prompts.test.ts:337-343`.
- **The 39.3 live gate** at `story-39-3-body-search-live-gate.test.ts:1098`. Its comment is now false. Add the assertion on the invalid call's entry. The gate runs armed only.

**Kept green unmodified:**
- `story-41-2-qa-prompts-stdio-wire.test.ts:280-313` `WIRE_GOLDEN`;
- `fixtures/tools-list-snapshot.json` through `pnpm gen:tools-list-snapshot:check`.

**Kept green with no assertion line changed:** the 43 `stageDefaultStartup` files. Only the 10 files named under D3 carry plumbing edits.

**Scripts:**
- `scripts/lib/tools-list-snapshot-core.mjs:146,204` `installedVersion`: change it to `@modelcontextprotocol/server`;
- `scripts/lib/measure-tools-payload-core.mjs:17-27` `callRequest`: add `mcpReq` to its ctx.

**Siblings:**
- `story-41-5-qa-dist-consumer.test.ts:75` `openRawWire` is the raw stdio driver to generalize;
- `openAuditedSession` at `process-gate-helpers.ts:773-790` serves the DW-579 wire test.

**Docs:**
- `CHANGELOG.md`: there is no Unreleased section, so the top entry follows the `## [Pre-release — <date>] — Story 43.1: …` convention;
- `.changeset/` (fixed group `@iris-mcp/*`);
- `packages/shared/README.md:29,160,164`: update it only where it names v1 APIs.

## Tasks & Acceptance

**Execution:**
1. **Raw driver (new).** `scripts/lib/sdk-wire-golden-core.mjs` holds the SDK-free newline-delimited JSON-RPC stdio driver (it generalizes `openRawWire`) and the exchange list.
   - The list covers every matrix row except the audit rows. Per-server tool picks:

     | | dev | admin | interop | ops | data |
     |---|---|---|---|---|---|
     | type / enum | `iris_doc_get` | `iris_namespace_manage` | `iris_production_manage` | `iris_database_action` / `iris_alerts_manage` | `iris_docdb_document` / `iris_docdb_manage` |
     | denial | `iris_env_promote:execute` | `iris_resource_manage:grant` | `iris_production_item:add` | `iris_process_manage:terminate` | none |
     | closed-port read | `iris_doc_list` | `iris_namespace_list` | `iris_production_status` | `iris_metrics_system` | `iris_docdb_find` |

   - The script and the test both use this one implementation (AD-2).
2. **Capture script (new).** `scripts/capture-sdk-wire-golden.mjs` spawns each built dist with the closed-port env and writes `packages/iris-mcp-all/src/__tests__/fixtures/sdk-wire-golden.json`. It records:
   - every response line verbatim;
   - `capturedAt`, `baselineRevision`, `sdkPackage`, `sdkVersion`, `zodVersion` and `node`.

   It refuses to overwrite the fixture without `--force`.
3. **Capture first.** On the clean v1 tree, before any other edit:
   - build shared and the five servers, one `pnpm --filter <pkg> build` per call;
   - run `node scripts/capture-sdk-wire-golden.mjs`;
   - record the `pnpm audit --prod --json` totals in `## Verification`.
4. **Client devDep.** In `packages/iris-mcp-all/package.json` and the lockfile, run `pnpm add -D --save-exact --filter @iris-mcp/all @modelcontextprotocol/client@2.3.1`.
5. **Golden pin test (new, default suite).** `packages/iris-mcp-all/src/__tests__/story-43-1-sdk-wire-golden.test.ts`. Per server, it replays the fixture two ways:
   - **Raw driver:** `toBe` on each response line.
   - **v2 client:** `new Client(info, { versionNegotiation: { mode: "legacy" } })` (Rule #10) over `StdioClientTransport`. Results must `toEqual` the golden `result`, and errors must match its `code` and `message`.

   The DW-617 rows compare against the same prompt's `{}` row, and `client.getPrompt({ name })` is sent with NO `arguments` key (Rule #46). The test also asserts that the fixture's labels equal the core's list, and it fails, rather than skips, on a stale dist.
   - **Run it green on the v1 build now.** That proves the harness and the golden.
6. **Manifests.** Use `pnpm remove` / `pnpm add --save-exact` per the Code Map; `@modelcontextprotocol/core` stays transitive. Then confirm that `ls node_modules/.pnpm | grep '^@modelcontextprotocol+sdk@'` is empty. `pnpm remove` can leave an orphan; if it does, reinstall from a clean `node_modules`.
7. **Framework.** `packages/shared/src/server-base.ts` and the new `sdk-wire-compat.ts`:
   - **Imports:** move them to `@modelcontextprotocol/server` and `/stdio`. `McpError` / `ErrorCode` become `ProtocolError` / `ProtocolErrorCode`.
   - **Registration:** tools register `extendedInputSchema` (a zod object), and prompts register `argsSchema: z.object(argsShape)`.
   - **Errors:** every framework-thrown protocol error goes through the v1-text helper.
   - **Owned handlers:** install them with `this.mcpServer.server.setRequestHandler` after the prompts loop. Install `prompts/get` only when at least one prompt is registered.
     - `tools/list`, built from `this.tools` in insertion order.
     - `tools/call`:
       - Look the tool up in `this.tools`; a miss gives the not-found row.
       - Don't forward `ctx`.
       - For a declared `outputSchema`, keep v1's output-validation parity, which v1 states at `mcp.js:185-207`.
     - `prompts/get`, using `arguments ?? {}`.
     - `resources/read`. Match the template through the registered `ResourceTemplate`'s `uriTemplate`.
   - **Wire validation:** the owned `tools/call` enters through a wire entry point. Inside the same audit wrapper that `handleToolCall` uses, it runs the wire validation first, which replaces what v1's SDK did before the chokepoint:
     - It validates against `z.object(extended.shape)`, the exact v1 rebuild.
     - On success, `dispatchToolCall` receives the parsed args, and the audit entry derives from them, as v1's SDK-parsed args did.
     - On failure, it returns the schema-invalid row's text and writes the D2 entry.

     The SDK-registered callback stays `(args) => this.handleToolCall(tool, args)`, unchanged. In-process tests reach it through `_registeredTools[name].handler`, and it keeps `dispatchToolCall`'s `Invalid arguments: …` text (last matrix row). No wire request reaches it, because the owned `tools/call` replaces the SDK's handler.
   - **`removeTools`** still sends exactly one `notifications/tools/list_changed` per call that removes a tool.
8. **Shared unit test (new).** `packages/shared/src/__tests__/sdk-wire-compat.test.ts` drives a fixture `McpServerBase` with a v2 `Client` over `InMemoryTransport.createLinkedPair()`. It covers:
   - each matrix row;
   - an `outputSchema` fixture tool;
   - the render throw;
   - a single `list_changed` on `removeTools`;
   - the D2 entry under `IRIS_AUDIT_LOG_PARAMS=true`.
9. **Test plumbing.** For the files listed in the Code Map, add the `mcpReq` ctx, swap the import specifiers, and change the class identity (`ProtocolError`). No other assertion line changes.
10. **Wire harness.** In `process-gate-helpers.ts`:
    - Point the resolver at the v2 client's ESM `dist`. It is found by the store prefix `@modelcontextprotocol+client@`.
    - `openWireSession` imports `index.mjs` and `stdio.mjs`, and passes `{ versionNegotiation: { mode: "legacy" } }`.
    - The five local resolver copies import the exported resolver instead (Rule 2).
    - `story-38-6` and `story-39-6` import `Client` and `InMemoryTransport` from the client's `index.mjs`.
    - The skip texts name `@modelcontextprotocol/client`.
11. **Resolution test (new).** `packages/iris-mcp-all/src/__tests__/story-43-1-sdk-client-resolution.test.ts`:
    - the resolver finds a directory;
    - `index.mjs` exports `Client` and `InMemoryTransport`;
    - `stdio.mjs` exports `StdioClientTransport`;
    - it goes red, not skipped, when the client is absent (Rule #59).
12. **Launcher.** Retarget the same way in the two launcher test files, keeping the local copies: the extension is outside the workspace and can't import iris-mcp-all test code. Add `extensions/iris-mcp-launcher/src/__tests__/sdkClientResolution.test.ts`, as in task 11. Don't change the launcher's `package.json` or `package-lock.json`.
13. **Dev test.** `packages/iris-dev-mcp/src/__tests__/doc-type-description.test.ts` imports `Client` and `InMemoryTransport` from `@modelcontextprotocol/client`.
14. **Scripts.** Apply the two script changes in the Code Map. The snapshot fixture stays untouched.
15. **DW-617.** Flip the rows that pinned the refusal: an omitted `arguments` now renders exactly as `{}` does (`BASELINE_BODY_SHA256`), and so does `prompts.test.ts:337-343`. `story-41-5` switches to the shared raw driver (Rule 2).
16. **DW-579.**
    - New test `packages/iris-mcp-all/src/__tests__/story-43-1-schema-invalid-audit.test.ts`. It runs the dev dist through `openAuditedSession` against the closed port, sending one schema-invalid call and one valid call.
    - The 39.3 live gate: its comment states that both calls are audited, and it asserts the invalid call's entry (`outcome` `error`, no `params`).
17. **Docs.**
    - `CHANGELOG.md`:
      - **Changed:** the framework runs on SDK v2 2.3.1, v1 is removed, and the 2025-11-25 wire is unchanged.
      - **Fixed:** DW-579 and DW-617.
    - `.changeset/story-43-1-sdk-v2-migration.md`: `patch` for the changed packages.
    - `packages/shared/README.md`: update it where it names v1 APIs.

**Acceptance Criteria:**
- **AC 43.1.1.**
  - **Given** the Probe Record in Design Notes, **when** the implement stage installs the packages, **then** the lockfile resolves `server`, `client` and `core` at exactly 2.3.1, adds no install script, and the inventory grep finds no code or manifest hit.
- **AC 43.1.2.**
  - **Given** the migrated tree, **when** a server is initialized with 2025-11-25 or with 2026-07-28, **then** it negotiates 2025-11-25.
  - No `package.json` lists `@modelcontextprotocol/sdk`, no `@modelcontextprotocol+sdk@` store directory remains, and only `packages/shared/src` source imports `@modelcontextprotocol/server`.
- **AC 43.1.3.**
  - **Given** the golden captured from the v1 build before the migration, **when** the pin test runs against the v2 builds of all five servers, **then** every raw line is byte-identical and the v2 client's view `toEqual`s the golden. The DW-617 rows are the only exception; they equal their `{}` row.
  - `WIRE_GOLDEN` and `pnpm gen:tools-list-snapshot:check` pass, with their fixtures untouched.
- **AC 43.1.3, stageDefaultStartup clause (amended, D3).**
  - **Given** the 43 `stageDefaultStartup` files (`grep -rlE "stageDefaultStartup\(" packages --include='*.test.ts' --exclude-dir=node_modules --exclude-dir=dist`), **when** they run after the migration, **then** all pass.
  - `git diff <baseline_revision>` over them changes no assertion line, only the enumerated plumbing in 10 files.
- **AC 43.1.4.**
  - **Given** the SDK-client suites, **when** they run on the closed port, **then** they load `@modelcontextprotocol/client` and no assertion line has changed. The suites are:
    - dev, in-memory (1);
    - iris-mcp-all, in-memory (2);
    - iris-mcp-all, stdio through `openWireSession` (37) and the 5 local-copy gates;
    - launcher (2).
  - The two resolution tests are green.
  - The launcher suite's failures equal the DW-532 baseline set exactly: `clientsEngine` 2, `governanceEngine` 2 and `clientsActivationFlow` 33-3-3 (which may pass), plus the unloadable `constants` and `credentials` files.
- **AC 43.1.5.**
  - **Given** the migrated tree, **when** each package's build, test, lint and type-check run, along with `pnpm gen:governance-baseline:check`, **then** all are green, and the baseline check reports 141 keys and `1e62c5ad5bf7`.
  - Tool counts stay 115 (33/27/25/22/8).
  - `git diff --name-only <baseline_revision>` lists no `bootstrap-classes.ts`.
  - The after `pnpm audit --prod` is recorded next to the before.
- **DW-579.**
  - **Given** a server with `IRIS_AUDIT_LOG` and `IRIS_AUDIT_LOG_PARAMS=true`, **when** a real client sends a schema-invalid `tools/call`, **then** exactly one entry is written, matching the DW-579 audit row.
  - A valid call's entry keeps v1's shape.
- **DW-617.**
  - **Given** a real v2 `Client`, **when** it calls `getPrompt({ name })` with no `arguments` key for `audit-security-posture`, `recover-stuck-production`, `check-system-health` and `run-external-backup`, **then** each renders exactly as with `arguments: {}`.
- **Integration (Rule 1).**
  - **Given** each built server, the consumer of the shared framework, **when** the real v2 client lists, gets and calls over stdio, **then** it receives the golden responses. This is the AC 43.1.3 pin, named here as the integration AC.
- **Release bookkeeping (AD-29, AD-15).**
  - **Given** the story's commit, **when** a reviewer reads `.changeset/` and `CHANGELOG.md`, **then** they name the SDK move and every behavior change: DW-579, DW-617 and the three AD-15 sanctions of wave-8 decisions #4 and #6 (the single `addTools` notification, the malformed `tools/call` `-32602`, and the `task`-param plain call). [Amended by the lead 2026-10-20 after decision #6.]

### Review Findings

Code review 2026-10-20 (`bmad-code-review`, full mode, four layers, frozen diff `39fd0ea` plus the working tree and the untracked QA files). Every finding carries severity, fix-risk, footprint and spec-status (Rule 15); every patch is applied and green, with its `mutation:` line under `## Verification`.

- [x] [Review][Patch] HIGH: the CHANGELOG and the changeset named DW-579 and DW-617 as the only behavior changes, omitting the three AD-15 sanctions (the `addTools` single `list_changed`, decision #4; the malformed `tools/call` `-32602` and the `task`-param plain call, decision #6). That breaks AD-15's "named in `CHANGELOG.md` with that story" (Rule 6) [CHANGELOG.md:9; .changeset/story-43-1-sdk-v2-migration.md:15]. Fix-risk low (docs); in-story; spec-clear. Fixed: the headline names all five, Changed gains three bullets, and the changeset names them.
- [x] [Review][Patch] MED: the member-order change that decision #5 withdrew was still stated as fact in the CHANGELOG headline and Known limits, the changeset, the comment at `sdk-wire-compat.test.ts:419-421`, Finding 2 and residual risk 1 [CHANGELOG.md:10,82; .changeset/story-43-1-sdk-v2-migration.md:17; packages/shared/src/__tests__/sdk-wire-compat.test.ts:419]. Fix-risk low; in-story; spec-clear (lead item 1). Fixed: the Known-limits bullet and the changeset paragraph are removed. The compat row stays, because it pins every member and value; its comment now says the wire order is the SDK schema order, as on v1, pinned by the handler golden, and its title says what it pins.
- [x] [Review][Patch] MED: nothing pinned the two decision-#6 responses [packages/iris-mcp-all/src/__tests__/story-43-1-sanctioned-wire-changes.test.ts]. Fix-risk low (new test plus an additive `requestFrame` on the shared driver; `request` sends the same frame as before); in-story; spec-clear (lead item 2). Fixed: new default-suite test, 35 rows on the five built servers, with each response line pinned byte for byte. The six malformed shapes are pinned as the SDK's `-32602` frame. The `task` call is pinned as the plain call's line, which the v1 golden's `call:server-profiles` row pins.
- [x] [Review][Patch] MED: the handler golden pinned the audit `sessionStart` `version` 0.0.2 with no mask, so the first `changeset version` would turn 10 tests red. That is the coupling EC1 had already fixed for the wire golden [scripts/lib/sdk-handler-golden-core.mjs:99; story-43-1-qa-handler-golden.test.ts:149,161]. Fix-risk low; in-story; spec-clear. Fixed: `withSessionVersion` plus a `sessionVersion` option on `diffHandlerSession`, compared against `packageVersion(root, pkg)`, which both goldens now share.
- [x] [Review][Patch] MED: the launcher's `sdkClientResolution.test.ts` checked a third copy of the resolver, not the two copies the integration tests run, so a broken copy would skip silently (Rule #59, Rule 2) [extensions/iris-mcp-launcher/src/__tests__/sdkClientResolution.test.ts:19]. Fix-risk low; in-story; spec-clear (task 12 forbids importing iris-mcp-all code, not a helper inside the extension). Fixed: one `src/__tests__/sdkClientStore.ts`, which `tsconfig.build.json` excludes, imported by all three files.
- [x] [Review][Patch] MED: `capture-sdk-handler-golden.mjs` was a near-copy of `capture-sdk-wire-golden.mjs` with no stated reason (argument parsing, refusal, stale check, header assembly), and `installedVersion` existed three times (Rule 2) [scripts/capture-sdk-handler-golden.mjs; scripts/capture-sdk-wire-golden.mjs:49-120]. Fix-risk low; in-story; spec-clear. Fixed: `scripts/lib/golden-capture-cli.mjs` holds the shared command line, and `installedVersion` is exported once from `tools-list-snapshot-core.mjs`. The wire capture also gains `--dist-root`. Verified: captures from both refactored scripts are byte-identical to the pre-refactor scripts' output (apart from `capturedAt`); `--dist-root .` gives the same result; the refusals (fixture exists, `--dist-root` missing, bad flag) exit 2; both fixtures keep their checksums.
- [x] [Review][Patch] MED: the stdio-lifecycle window (10 s) was longer than the fake listener's 5 s keep-alive timeout, so a process held open by its connection would still pass [packages/iris-mcp-all/src/__tests__/story-43-1-qa-stdio-lifecycle.test.ts:29]. Fix-risk low; in-story; spec-clear. Fixed: the window is now 3 s.
- [x] [Review][Patch] MED: the raw-driver "after exit" row slept 200 ms and matched `/exited/`, which the exit-before-answer path also produces (Rule 19: it acts before the system signals) [packages/iris-mcp-all/src/__tests__/story-43-1-raw-wire-driver.test.ts:73]. Fix-risk low; in-story. Fixed: it awaits `wire.exit()` and matches the `ended`-guard message exactly.
- [x] [Review][Patch] MED: the omitted-`arguments` audit row read the file as soon as one entry existed, so it could not see a duplicate entry [packages/shared/src/__tests__/sdk-wire-compat.test.ts:613]. Fix-risk low; in-story. Fixed: a valid marker call follows the omitted call, and the marker is the second entry.
- [x] [Review][Patch] LOW: the README's "Refused calls are recorded too" (and the CHANGELOG Fixed bullet) covered every input-schema failure. A failure of a refinement on the whole object (for example `iris_production_control` `start` with no `name`) passes the wire check and is audited as a normal call, as on v1 [README.md:788]. Fixed: both now say field checks, and both name the cross-field case.
- [x] [Review][Patch] LOW: the CHANGELOG's `### Added` list left out the QA files [CHANGELOG.md:52]. Fixed: both goldens, the fake listener, the four QA tests, the decision-#6 test and the shared helpers are listed.
- [x] [Review][Patch] LOW: the v2 packages' `engines.node >=20`, against the root's "18 or later", was not recorded [CHANGELOG.md Known limits]. Fixed: a Known-limits line naming Story 42.1 (no `engines` change).
- [x] [Review][Patch] LOW: the wire golden's provenance was checked through its header only [story-43-1-sdk-wire-golden.test.ts:136]. Fixed: a content row checks that the seven omitted-`arguments` rows hold v1's `-32602` refusal and differ from their `{}` rows, which a capture of any later build cannot satisfy.
- [x] [Review][Patch] LOW: the pack-confinement roster left out the published `@iris-mcp/client-config` (Rule #56) [story-43-1-qa-pack-confinement.test.ts:25]. Fixed: it is added, giving 32 rows that cover every package under `packages/`.
- [x] [Review][Patch] LOW: the "initialize pin (AC 43.1.2)" mutation changed `instructions`, which does not touch negotiation (Rule 19, stale line) [spec `## Verification`]. Fixed: a negotiation mutation line for AC 43.1.2, and the old line now names the rows it pins.
- [x] [Review][Patch] LOW: AC 43.1.3's "`gen:tools-list-snapshot:check` passes" clause had no `mutation:` line (Rule 19) [spec `## Verification`]. Fixed: a mutation line. The D3 "no assertion line changed" clause is a diff guard, not a test; review re-ran it and recorded the result. The "no `+sdk@` store directory" clause follows from the lockfile rows of the confinement guard.
- [x] [Review][Defer] LOW: QA's `sdk-handler-golden.json` is a second frozen v1 oracle (handler texts, startup requests, `BOOTSTRAP_VERSION`) with no retirement owner [fixtures/sdk-handler-golden.json] — deferred: occurrence on DW-639 (routed to 43-4), the same retirement decision as the wire golden.
- [x] [Review][Defer] LOW: the launcher `type-check` is not green on this host, as the spec expected, with no disposition [extensions/iris-mcp-launcher] — deferred: occurrence on DW-532 (routed to 42-7), which has the same root cause (11 errors, all missing `vscode`/servermanager modules; none in a 43.1 file).

**Rejected** (11 rows in 10 entries; the last item is the spine part of rows AA10 and BH2, whose other parts are patched above):
- `low` BH7: the client view of the `newer-era` session repeats `main/initialize`, because the legacy client always asks for 2025-11-25. The raw row is the pin; the negotiation mutation turned exactly the five raw `newer-era` rows red. Non-legacy client modes belong to 43.2.
- `low` EC2: the dw579-process "strings" variant makes some schema-valid calls (fields that accept a string through `anyOf`). Every assertion on the invalid calls still holds, the "some call is refused" row still holds, and the valid calls only make the stderr check stricter.
- `low` EC3: a handshake that fails before the `try` in `auditedSession` / 41-5 `openRawSession` leaks the child. That happens only on an already-red path, and the child exits on stdin EOF when the worker ends (pinned by the lifecycle test). The fix adds guards.
- `low` EC4: `route()` throwing inside the fake listener's `end` callback is theoretical. The inputs are fixed and the servers encode names.
- `low` EC5: a partial audit line read during a write is unlikely for one small append, and the fix adds a guard.
- `low` EC6: the driver hangs if `spawn` emits `error` without `exit`. That is theoretical, because `process.execPath` always exists.
- `low` VG-O4: `expect(initialized.message.error).toBeUndefined()` in 41-5 cannot fail after `handshake` throws. It is a redundant pre-existing line, kept under the no-assertion-line-changed constraint, and the throw is the guard.
- `low` VG-O5 / AA9: the v2 `Client`s outside `connectSdkClient` do not pass `versionNegotiation: legacy`. The pinned 2.3.1 default is `legacy` (Probe Record), so there is no observable difference, and client modes belong to 43.2.
- `low` AA5: the release-bookkeeping AC still says "the only behavior changes". The fix edits the AC; decision #6 supersedes it, and the lead owns the amendment (Spec Change Log, 2026-10-20 code review).
- `low` AA6: the `initialize` version mask is not written into AC 43.1.3. The fix edits the AC; the mask is recorded in the triage log (EC1) and the CHANGELOG.
- `low` AA10a / BH2 (spine): AD-32 says "one source file imports it" (there are two: `server-base.ts`, `sdk-wire-compat.ts`), and AD-15's "Story 43.1 (wave-8 decisions #1 and #2)" header sits over items from #4 to #6. The spine is the lead's, mid-edit (Rule 20), and these are handed to the lead.

## Spec Change Log

- 2026-10-20 (lead spec gate): D1–D3 were taken as recommended (wave-8 decisions #1–#3).
  - `epics.md`: AC 43.1.3 (43 files, "no assertion line changed", diff guard) and AC 43.1.4 (where the SDK-client suites live) are amended.
  - The spine was amended and its lint passed: AD-32 (the exact 2.3.1 pin, framework-owned handlers, validation inside the audited path) and AD-15's sanctioned list (DW-617, plus DW-579's additive audit entry).
  - Seam for 43.2: the framework-owned handlers must also serve the `2026-07-28` era.
- 2026-10-20 (code review, on the lead's instruction; wave-8 decisions #5 and #6):
  - Decision #5 withdraws the member-order exception of decision #4. The v1 wire already wrote `content, structuredContent, isError`. Finding 2 below and residual risk 1 of the Auto Run Result are corrected, and so are the CHANGELOG, the changeset and the compat-test comment. Frontmatter `deferred:` entry 5, harvested as DW-640, rests on the same false premise; the lead closed DW-640 `dropped`. The frontmatter is build-auto's record and is left as written.
  - Decision #6 sanctions two wire answers: a malformed `tools/call` gets `-32602 Invalid tools/call request: …`, and a `tools/call` with a `task` parameter is served as a plain call. Both are pinned by `story-43-1-sanctioned-wire-changes.test.ts` and named in the CHANGELOG "Changed" list.
  - Decisions #4 and #6 add three behavior changes to the two that the Release-bookkeeping AC names as "the only behavior changes". The CHANGELOG and changeset now name all five. The AC text itself is left for the lead to amend.

## Review Triage Log

### 2026-10-20 — Review pass
- verdicts: 36 findings — high 0, medium 3, low 31, false 1, maybe-false 1
- findings:
  - `[low]` `[reject]` BH1: the root manifest and README still say Node `>=18` while the v2 packages need `>=20` — the intent excludes it ("No `engines` change (Story 42.1)"), Design Notes already assign the floor to 42.1, and nothing is published here.
  - `[low]` `[patch]` BH2: `installedSdk` read only the v2 server manifest, so the capture script could not reproduce the committed v1 header on the oracle tree — verified; it now tries the v1 package, then the v2 server package, and fails if neither is installed; pinned by the `installedSdk` rows of `story-43-1-sdk-confinement.test.ts` (mutation: installedSdk).
  - `[low]` `[reject]` BH3: a schema-invalid call writes caller-chosen key names, and raw `server` and `namespace` strings, with no cap — D2 and the DW-579 matrix row specify raw key names, and the profile and namespace derivations are the existing ones for every call, valid ones included; a cap would change specified behavior (by-design).
  - `[low]` `[patch]` BH4: the root README's Compliance & Auditability section does not say that refused calls are recorded — added the paragraph "Refused calls are recorded too".
  - `[low]` `[patch]` BH5: the CHANGELOG claim that `addTools` sends one `list_changed` has no test — added the `sdk-wire-compat.test.ts` row "one call that adds tools sends exactly one list_changed" (mutation: addTools notification pin, 3 received for 1).
  - `[low]` `[patch]` BH6: the CHANGELOG headline and the changeset say every byte is unchanged while Known limits names the member order — both reworded to name the limit; the drift itself is VG3.
  - `[low]` `[reject]` BH7: `tools/call` with `arguments` omitted is still refused while DW-617 fixed prompts — by-design: the matrix row "Omitted tool args" fixes v1's text and the golden pins it.
  - `[low]` `[reject]` BH8: the `"callback"` source of `handleToolCall` is unreachable on the wire, and a caller that omits `source` would skip the wire check — by-design: the last matrix row and Task 7 keep the SDK-registered callback as the in-process path, and that path validates in `dispatchToolCall` (step 1), so nothing is skipped.
  - `[low]` `[patch]` BH9: comments and a test title still call the unknown-tool path "the SDK's own" — reworded in `server-base.ts`, `tool-visibility.test.ts` and `tool-visibility.e2e.test.ts` (comments and one title, no assertion line).
  - `[low]` `[patch]` BH10: the raw driver resolves any numeric-id frame, leaves an unparseable line uncaught and ignores stdin errors — it now resolves only frames without a `method`, and rejects the pending requests on a non-JSON line and on a stdin error; the exit-before-stdout part did not reproduce (a 400 KB response written just before the exit resolved under `exit` in three runs), so `exit` stays; pinned by `story-43-1-raw-wire-driver.test.ts` (mutation: raw driver).
  - `[medium]` `[patch]` EC1: the golden's `initialize` lines pin `serverInfo.version` 0.0.2, so the first `changeset version` turns the `initialize` rows red on all five servers — they now compare the package manifest's version and every other byte as captured (mutation: golden version mask).
  - `[low]` `[defer]` EC2: the golden's `tools-list` and `call:server-profiles` lines embed the whole catalogue and policy map, so a later tool or description change reddens them and the header test forbids a v2 recapture — the golden is the frozen v1 oracle by design; how it retires or updates belongs to 43.2 (which reuses it) and 43.4 (the capstone); deferred entry 4.
  - `[false]` `[reject]` EC3: `resources/read` with an unparseable URI surfaces a raw TypeError — the built dev server answers `-32603 "Invalid URL"` (probed on the wire), the path v1 took as well (an unguarded `new URL` in its handler); not a matrix row, no behavior change.
  - `[low]` `[reject]` EC4: `registerTool` overwrites the framework maps before the SDK rejects a duplicate name — `addTools` has no production caller, a duplicate is a programming error that throws, and the constructor path fails fast; no user-reachable failure.
  - `[low]` `[reject]` EC5: unbounded caller text in a schema-invalid audit entry — same finding as BH3.
  - `[low]` `[patch]` EC6: the raw driver fails on a stray line, a server-initiated request and a stdin error — same finding and same patch as BH10.
  - `[low]` `[patch]` EC7: the CHANGELOG headline contradicts Known limits — same as BH6.
  - `[low]` `[patch]` EC8: the snapshot-CLI test changed three assertion lines, not two — the CHANGELOG and this section now say three.
  - `[low]` `[reject]` EC9: the 41-5 skill-field leak guard on the omitted-arguments refusal was removed — it guarded a refusal that no longer exists (DW-617); the refusal of a prompt with a required argument is still pinned byte for byte by the golden's prompts-get rows and carries no skill text.
  - `[medium]` `[patch]` VG1: the golden pin breaks on the next version bump or catalogue change — the version part is EC1 (patched), the catalogue part is EC2 (deferred).
  - `[medium]` `[patch]` VG2: AC 43.1.1 and the second bullet of AC 43.1.2 (no v1 in any manifest, only shared imports the server package, exact pins, the lockfile) rested on one-time greps with no pinning test — added `story-43-1-sdk-confinement.test.ts` (35 rows, default suite); four mutations (a v1 dependency in dev, a server import in dev source, a range in shared's pin, `requiresBuild` on the lockfile entry) each went red on its own row (mutation: confinement guard).
  - `[low]` `[defer]` VG3: a handler result with both `isError` and `structuredContent` goes out as `content, structuredContent, isError` where v1 sent `content, isError, structuredContent`, and no test pins either order — real, but the SDK's public surface cannot keep v1's order (probed: the owned handler returns the v1 order and the SDK re-encodes it), the spec's Risks directs recording it, the JSON value is the same, and pinning v2's order would encode an exception the spec has not sanctioned; the lead decides (deferred entry 5).
  - `[maybe-false]` `[defer]` VG4: the v2-client code in the five local-copy gates and the two launcher integration tests has not run, because they skip on the closed port — an armed run of those seven files against a live instance would settle it, which this story must not run; the shared constructor shape is exercised by the golden (deferred entry 3, medium if true, unverified).
  - `[low]` `[patch]` VG5: AC 43.1.1, AC 43.1.2 (second bullet), AC 43.1.5 and the release-bookkeeping AC have no `mutation:` line — the first two are pinned by VG2 now, with mutation lines; AC 43.1.5's evidence is the build, test, lint and type-check commands, and the release-bookkeeping AC is read by a reviewer, so neither has a test-shaped pin to mutate.
  - `[low]` `[reject]` VG6: the client-view `prompts-list` row for iris-data compares with `{prompts: []}` that the v2 client fabricates — disclosed in the test; the raw `-32601` row is the pin and the client never sends that request.
  - `[low]` `[patch]` VG7: the changeset and the CHANGELOG overclaim byte identity — same as BH6.
  - `[low]` `[reject]` VG8: the committed `tools-list-snapshot.json` still records `sdkVersion` 1.29.0 — by-design: the spec keeps the fixture untouched, `sdkVersion` records the capture, and the 115 entries equal the live ones (`gen:tools-list-snapshot:check` OK).
  - `[low]` `[patch]` VG9: `installedSdk` hard-codes the server package — same as BH2.
  - `[low]` `[patch]` VG10: the `addTools` single-notification claim has no test — same as BH5.
  - `[low]` `[reject]` VG11: the `removeTools` count tests wait a fixed 50 ms — the debounced notification leaves in the same tick as the call, no later producer exists, and removing the debounce turned both counts red (3 received).
  - `[low]` `[patch]` VG12: the `catch` in `callToolFromWire` has no test — added the `sdk-wire-compat.test.ts` row "a failure of the dispatch itself is the in-band error result" (mutation: dispatch-failure containment).
  - `[low]` `[defer]` IA1: result member order is the one place where the bytes the intent names and the bytes the SDK emits differ — same as VG3.
  - `[low]` `[patch]` IA2: some matrix rows have no raw-line golden (a prompt build that throws, audit entries beyond dev, the omitted-arguments audit, a v1 oracle for a valid call's entry) — the omitted-arguments audit row is now pinned (mutation: omitted-arguments audit); the others cannot be captured on a built server (no built prompt throws, a valid call needs IRIS) or are the unchanged code path covered by the existing audit tests.
  - `[low]` `[reject]` IA3: golden coverage is chosen per server — by-design: the spec's pick table fixes the rows.
  - `[low]` `[reject]` IA4: about 40 in-process tests call the owned handler and bypass the SDK codec — by-design (D3 plumbing); the encoded wire is pinned by the golden on the five built servers.
  - `[low]` `[patch]` IA5: provenance notes — the `installedSdk` header mismatch is patched (BH2); the 41-5 target port 9 is pre-existing and also closed; the lockfile adds only the expected packages, which the confinement guard's lockfile rows pin.

## Design Notes

**Governing architecture:**
- **AD-32:** v2 and nothing else.
- **AD-2:** SDK confinement. The cross-package pins live in `iris-mcp-all`; the script and the test share one core.
- **AD-3:** wire validation is now step 1 inside the audited chokepoint, on the wire entry point. The in-process callback path runs `dispatchToolCall`'s own step 1, as it does today.
- **AD-15:** byte-identical, with the sanctioned exceptions listed in D1.
- **AD-19:** one entry per call; no PHI or values in a refusal.
- **AD-23:** stdio only.
- **AD-29:** a patch changeset; no publish.
- **AD-7 and AD-10:** the owned `tools/list` comes from `this.tools`, so hidden tools stay absent. Framework surfaces are registered once.
- **AD-5 and AD-14:** the governance baseline is unchanged, and the bootstrap does not move.
- **Stack rows:** v2 at 2.3.1; zod 4.3.6; the Node floor belongs to 42.1. The v2 engines require `>=20`, the root still says `>=18`, and this host runs 26.8.1.

**D1. Orchestrator decision needed: how the 2025-11-25 era stays byte-identical on v2.** Recommended: **(A) framework-owned `tools/list`, `tools/call`, `prompts/get` and `resources/read`**, installed through the public `setRequestHandler` from framework state.

The scratch spike (codemod only, then v1 vs v2 on the wire, all 5 servers) measured these differences:
- **`tools/list`, 115 of 115 tools:**
  - `$schema` changes from draft-07 to `https://json-schema.org/draft/2020-12/schema`;
  - `type` moves ahead of `$schema`;
  - `execution` is dropped.
- **Validation text:** v1's prefix and JSON issue list become `name: Invalid input: …`.
- **Unknown tool:** an `isError` result becomes a JSON-RPC `-32602` error, `Tool X not found`.
- **Omitted tool `arguments`:** the call now runs.
- **Prefix:** every `ProtocolError` drops `MCP error <code>: `, including the prompt and resource errors.

These were byte-identical: `initialize`, `prompts/list`, the resource lists, the default read, a denial, an `isError` read, and `iris_server_profiles {}`.

How A was proven: a `tools/list` override restored byte identity on all 5 servers, and a `tools/call` override restored every dev `tools/call` row. The prompt and resource error rows were not run in the spike; the pin settles them.

Option (B) sanctions that diff instead. It needs README updates (`README.md:670,680` describe the hidden-tool error) and changes what today's clients see on every tool.

A follows AC 43.1.3, AD-15 and AD-32 at a cost of about 150 lines in `@iris-mcp/shared`.

Under A:
- the only intended wire change is DW-617: an omitted `arguments` behaves like `{}` on `prompts/get`;
- `tools/call` keeps v1's refusal of an omitted `arguments`, which is now audited.

**Lead action under Rule 20:** add DW-617 to AD-15's sanctioned list, and DW-579's new audit entry as an additive audit behavior.

**D2. Orchestrator decision needed: what a schema-invalid call's audit entry holds (DW-579).** Recommended:
- one entry, with `outcome` `error` and `error` set to the wire text;
- `paramKeys` lists the raw top-level keys minus `server`;
- `params` is never written, even with `IRIS_AUDIT_LOG_PARAMS=true`;
- profile, namespace and action come from the existing derivations. A non-string value falls back to `default`, the profile's namespace, or `null`, and an action is kept only if it is in its enum;
- unknown and hidden tools stay unaudited, as on v1, so hidden names are never disclosed.

Evidence:
- zod 4.3.6's default messages name types and expected values, never the received value;
- the two tool refines use constant messages (`test-coverage.ts:88`, `production.ts:165`);
- with `params` written, the spike logged `params: {"name":12345}`, which is a value.

Rejected alternative: dropping profile and namespace too. Every entry carries them today.

**D3. Orchestrator decision needed: the AC 43.1.3 "pass unmodified" clause is unreachable as worded.** Recommended amendment (apply and report): "the 43 files pass with no assertion line changed". The count was 38 and is now 43, measured with the grep above. The 38 counted the local copies; five files that use the shared helper were added on 10-16 and 10-17.

Why "unmodified" is unreachable:
- v2's `Server._wrapHandler` wraps every handler for `tools/call`, `prompts/get` and `resources/read`, the framework-owned ones included, and calls `ctx.mcpReq.requestState()`. This was verified in the 2.3.1 `mcp-*.mjs`.
- Nine files pass a v1-shaped `extra` and crash: the spike showed 9 files and 25 tests red.
- One file imports v1's `McpError`.

The rejected alternative defaults `ctx.mcpReq` by re-wrapping the SDK's private `_requestHandlers` entries in production code.

**Probe Record (AC 43.1.1; probes run 2026-10-20 in OS-temp scratch copies, since deleted):**
- **Versions (`npm view`).** `server`, `client`, `core` and `codemod` ship in lockstep:
  - 2.0.0 on 07-27, 2.1.0 on 09-23, 2.2.0 on 09-28, 2.3.0 on 10-02 and **2.3.1 on 2026-10-05**, the latest. 2.3.1 is 15 days old and is the pin; nothing newer exists.
  - `engines` is `node >=20`. There are no peer dependencies. zod `^4.2.0` is a direct dependency and dedupes to 4.3.6.
  - npm provenance: SLSA v1 attestations (`https://slsa.dev/provenance/v1`) on all four.
  - `server` depends on `core` 2.3.1. `client` adds `jose`, `cross-spawn`, `eventsource`, `eventsource-parser` and `pkce-challenge`.
  - `npm query` finds no install scripts.
  - 2.3.0 is the release that validates `prompts/get` as `args ?? {}`, and that makes `connect()` reject a second connection.
- **Lockfile delta (spike).**
  - +4: `server`, `client` and `core` 2.3.1, and `eventsource-parser` 3.1.1.
  - −75: v1, plus the `express` 5 and `hono` stacks, `ajv` 8.18.0, `fast-uri` 3.1.0, `zod-to-json-schema`, `cors` and others.
- **Audit.** Before: 71 advisories (4 critical, 18 high, 46 moderate, 3 low) over 206 deps, 53 of them through v1. Spike after: 18 (3 critical, 7 high, 8 moderate) over 120 deps.
  - Removed include GHSA-6qxp-vccf-f47h (the SDK) and GHSA-jqcg-44mw-7w3h (proxy-addr).
  - Nothing was added. What remains is the vitest 2.1.9 chain, through a peer dependency, plus `smol-toml`.
- **API map (v1 → v2):**
  - `McpServer`, `ResourceTemplate`, `ProtocolError` / `ProtocolErrorCode`, `UriTemplate`, `InMemoryTransport`, `LATEST_PROTOCOL_VERSION` (`"2025-11-25"`) and the result types come from `@modelcontextprotocol/server`.
  - `StdioServerTransport` comes from `@modelcontextprotocol/server/stdio`.
  - `Client` (with the `versionNegotiation` option, default `'legacy'`) and `InMemoryTransport` come from `@modelcontextprotocol/client`.
  - `StdioClientTransport` comes from `@modelcontextprotocol/client/stdio`.
  - The packages export `index.mjs` and `stdio.mjs`.
  - `registerTool` takes a `StandardSchemaWithJSON`; the raw shape is deprecated.
  - `registerResource` has the same two forms as v1.
  - `RegisteredTool.remove()` is public.
  - `ProtocolError` does not prefix its message.
- **Internals.**
  - `_registeredTools` is still a plain object, and `entry.handler` is the user callback.
  - `server._requestHandlers` is still a `Map`.
  - `getCapabilities()` and `_instructions` exist.
  - `_registeredPrompts` entries have a `handler` and no `callback`.
  - There are no `#private` fields.
- **Codemod.** Invocation: `npx -y @modelcontextprotocol/codemod@2.3.1 v1-to-v2 <dir>`. It has **no `--yes` flag**; the options are `-d`, `-t`, `-v`, `--ignore` and `--list`.
  - **Rewrites:** imports, and `McpError` / `ErrorCode` to `ProtocolError` / `ProtocolErrorCode`.
  - **Flags:** the raw-shape `inputSchema` / `argsSchema`, and the `extra` mocks.
  - **Left manual:** the package manifests; the store-scan resolvers and the dynamic-import path joins; the `_registeredTools` delete; the `name: "McpError"` string; the snapshot `installedVersion`.
  - `server-base.ts` compiled on v2 after the codemod alone.
- **Import inventory (exhaustive as of 2026-10-20).** Command: `grep -rnE "@modelcontextprotocol(/|\+)sdk" packages extensions scripts --include='*.ts' --include='*.mts' --include='*.mjs' --include='*.js' --include='*.json' --include='*.md' --exclude-dir=node_modules --exclude-dir=dist`, which finds 78 lines in 59 files.
  - **Source:** 1 file, `server-base.ts:15-22` (one comment at :1109).
  - **Manifests:** 6.
  - **Scripts:** 1 (`tools-list-snapshot-core.mjs:204`).
  - **Tests:** 51 files.
    - Static imports: 3.
    - Store-scan resolvers: 8, one exported plus 7 local copies, 2 of them in the launcher.
    - Dynamic loads through a resolver: 10 files.
    - Users of the shared resolver: 40 (37 through `openWireSession` / `withWireSession` / `openAuditedSession`, 2 that join paths themselves, 1 skip-only).
  - **Root files and docs:** 0.
  - **Private reach-ins:** `_registeredTools` in 61 files; `_requestHandlers` in 29 (16 shared, 5 prompts tests, 6 other dev/interop/all, and 2 scripts); `getCapabilities()` in 7; `_instructions` in 1.
- **zod.** The repo is already on 4.3.6. v2 uses Standard JSON Schema `jsonSchema[io]({target:"draft-2020-12"})` and does not strip `$schema`. v1 called `z4mini.toJSONSchema(schema,{target:"draft-7",io})` with no post-processing. Under owned `tools/list`, `z.toJSONSchema(…, {target:"draft-7", io:"input"})` gives v1's bytes, proven on all 5 servers. Prompt arguments are byte-identical with the repo's `.optional().describe()` order.
- **Baselines (spike, on v1).** The 43 `stageDefaultStartup` files: 430 of 430 pass. The launcher: 401 of 406 pass, 5 fail, and 2 files can't load, which equals DW-532.

**Scope seam (Rule #52).**
- **43.1 delivers:** the v2 packages; the four owned handlers, installed in the constructor path; DW-579 and DW-617; the golden, the driver and the pins; and the migrated harnesses.
- **43.2 owns:**
  - moving `McpServer` construction, registration and owned-handler installation into the `serveStdio(factory)` factory (`legacy: 'serve'`);
  - the owned handlers' modern-era output (`server/discover`, `resultType`, `ttlMs`, `cacheScope`);
  - the cross-era pin, which reuses `sdk-wire-golden-core.mjs` and the fixture;
  - the per-request `_meta` work under AD-3;
  - the record of the 16 adapters;
  - the non-legacy client modes.
- **43.3 owns:** threading the request `ctx` from the owned `tools/call` to the confirmation helper, plus the bundled-validator note.
- **43.4 owns:** the capstone, the smokes, the README and client docs, and the AD-32 and AD-34 Stack rows.

**Rules 1 and 2.**
- **Consumed by:**
  - **43.2:** the factory reuses the owned handlers; the cross-era pin reuses the driver and the golden.
  - **43.3:** the owned `tools/call` is the seam for `ctx`.
  - **43.4:** the capstone reuses the driver.
- **Consumes:** `@modelcontextprotocol/server` and `client` 2.3.1 (external).
- **Extend, don't copy:**
  - The raw driver generalizes `openRawWire`; 41-5 adopts it.
  - The five iris-mcp-all resolver copies collapse onto the exported one.
  - The two launcher copies stay separate, and the reason is recorded in task 12.
  - `tools-list-snapshot-core` reads the owned `tools/list` through the handler, so it is a consumer, not a copy.

**Ledger inbox (Rule 17):**
- **DW-579:** addressed by the schema-invalid, omitted-arguments and DW-579 audit rows; the DW-579 AC; and tasks 7, 8 and 16.
- **DW-617:** addressed by the DW-617 row, the DW-617 AC, and tasks 5 and 15.

**AC interpretations (apply and report):**
- The 38 becomes 43 (D3).
- AC 43.1.4 assumes that shared has in-memory SDK-client suites, but it has none. The migrated client suites are in dev (1), iris-mcp-all (2 in-memory, 37 + 5 stdio) and the launcher (2). Shared gains the v2 client in its new compat test.
- "a Zod validation error" is pinned in four forms: type, enum, field-level refine and object-level refine.

**Risks for the implementer:**
- **`maxToolInputElements` (2.3.0).** Confirm that only McpServer's own `tools/call` enforces it, which the owned handler bypasses. If `Server` enforces it, add a large-array row.
- **Result key order.** `Server._wrapHandler("tools/call")` re-encodes results through the era codec, so key order follows the result schema. The golden rows matched. Success results need IRIS and are covered only logically, by the armed live gates; record any key-order drift.
- **Override timing.** The overrides must come after the SDK's lazy install. `addTools` does not reinstall it (spike).
- **Stale builds.** A stale `tsconfig.tsbuildinfo` can make `tsc` emit nothing, so delete it if `dist` does not refresh.
- **Single zod copy.** Run `pnpm why zod` and confirm one 4.3.6.
- **Unconnected codec.** On a server that was never connected, the v2 `tools/call` wrapper picks its codec from `_negotiatedProtocolVersion`, which is unset. The spike did not run the `mcpReq` plumbing. Confirm that the 2025 codec applies to in-process `_requestHandlers` calls. Any further ctx field those tests need is plumbing too and changes no assertion line (D3).

**Mutations to apply, observe red and record (Rule 19):**

| Mutation | Must go red | AC |
|---|---|---|
| Owned `tools/list` uses `target:"draft-2020-12"` | the five `tools/list` golden rows | AC 43.1.3 |
| Drop `MCP error -32602: ` from not-found | the unknown and hidden rows | AC 43.1.3 |
| Wire validation against `extendedSchema` instead of `z.object(extended.shape)` | the interop object-refine row | AC 43.1.3 |
| Write `params` for a schema-invalid call | `story-43-1-schema-invalid-audit` | DW-579 |
| Drop `?? {}` in `prompts/get` | the DW-617 golden rows and 41-5 | DW-617 |
| Resolver returns `undefined` | both resolution tests (red, not skipped) | AC 43.1.4 |
| Revert one file's `mcpReq` plumbing | that file | D3 clause |
| Change `instructions` | the `initialize` rows | AC 43.1.2 |

## Verification

**Commands.** All run from `/Users/jbrandt/git/iris-execute-mcp-v2`, in the foreground with `timeout: 600000`. `<B>` stands for `baseline_revision`, and `CP` stands for `IRIS_HOST=127.0.0.1 IRIS_PORT=1`.
- **(loop) Builds.** `pnpm --filter @iris-mcp/shared build`, then `@iris-mcp/dev`, `/admin`, `/interop`, `/ops`, `/data`, one per call. Expected: exit 0. Run them after every `src/` change and before any dist-driven test.
- **(loop) Shared tests.** `pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/sdk-wire-compat.test.ts src/__tests__/prompts-guardrails.test.ts src/__tests__/prompts.test.ts src/__tests__/governance-resource-coverage.test.ts src/__tests__/server-base.test.ts`. Expected: all pass.
- **(loop) iris-mcp-all wire tests.** `CP pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-43-1-sdk-wire-golden.test.ts src/__tests__/story-43-1-schema-invalid-audit.test.ts src/__tests__/story-43-1-sdk-client-resolution.test.ts src/__tests__/story-41-5-qa-dist-consumer.test.ts src/__tests__/story-41-2-qa-prompts-stdio-wire.test.ts src/__tests__/story-38-6-qa-edit-prompt-sdk-wire.test.ts src/__tests__/story-39-6-qa-forensics-prompts-sdk-wire.test.ts src/__tests__/tools-list-snapshot.test.ts`. Expected: all pass, with no skip in the `story-43-1-*` files.
- **(loop) Snapshot check.** `pnpm gen:tools-list-snapshot:check`. Expected: OK against the untouched fixture.
- **(loop) stageDefaultStartup files.** Per package: `cd packages/<dir> && pnpm exec vitest run $(grep -rlE "stageDefaultStartup\(" src --include='*.test.ts')` for shared (14), iris-dev-mcp (7), iris-admin-mcp (9), iris-interop-mcp (9) and iris-ops-mcp (4), one call each. Expected: all pass.
- **(loop) Dev in-memory test.** `pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/doc-type-description.test.ts src/__tests__/doc-get-range-framework.test.ts`. Expected: pass.
- **(loop) Launcher SDK files.** `IRIS_TEST_HOST=127.0.0.1 IRIS_TEST_PORT=1 CP npm --prefix extensions/iris-mcp-launcher test -- src/__tests__/sdkClientResolution.test.ts src/__tests__/governanceUiRoundTrip.test.ts src/__tests__/localSpawnIntegration.test.ts`. Expected: the resolution test passes, and the other two skip only for reachability; the reason names reachability, not the SDK.
- **(loop) Assertion-diff guard.** Run `git diff <B> -U0` over `packages/*/src/__tests__` and `extensions/iris-mcp-launcher/src/__tests__`, excluding the new files, and filter it with `grep -E '^[-+][^-+]' | grep -E 'expect\(|\.to[A-Z]\w*\(|assert'`. Expected: only the enumerated lines: the 41-5 DW-617 rows, `prompts.test.ts:337-343`, the 39.3 gate, and the `ProtocolError` class identity. Record the per-file `expect(` counts before and after.
- **(once) Package suites.** `pnpm --filter <pkg> test`, then `type-check`, then `lint`, for shared, dev, admin, interop, ops, data and client-config, one per call. Expected: green.
- **(once) iris-mcp-all sweep.** `cd packages/iris-mcp-all && CP pnpm exec vitest run $(ls src/__tests__/*.test.ts | awk 'NR%3==0')`, then `NR%3==1`, then `NR%3==2`. Expected: green; the live gates skip.
- **(once) Launcher suite.** `IRIS_TEST_HOST=127.0.0.1 IRIS_TEST_PORT=1 CP npm --prefix extensions/iris-mcp-launcher test`, then `npm --prefix extensions/iris-mcp-launcher run type-check`. Expected: the failures equal the DW-532 set exactly, and type-check is green.
- **(once) Gates.**
  - `pnpm gen:governance-baseline:check`: 141 keys, `1e62c5ad5bf7`.
  - `pnpm validate:prompts`, `pnpm gen:skills:check` and `pnpm gen:pack:check`: unchanged.
- **(once) Audit.** `pnpm audit --prod --json`. Record the totals next to the before. Expected: GHSA-6qxp-vccf-f47h is gone and nothing is added.
- **(once) Diff and inventory checks.** Expected: 0, 0 and no code or manifest hit.
  - `git diff --name-only <B> | grep -c bootstrap-classes.ts`
  - `ls node_modules/.pnpm | grep -c '^@modelcontextprotocol+sdk@'`
  - the inventory grep from the Probe Record
- **(once) Shuffled runs.** The added and changed tests, with `--sequence.shuffle` at seeds 11 and 22. Expected: green.

**Shared surfaces:**
- the `package.json` dependency sets and the lockfile;
- the resolver contract (`resolveSdkEsmDir`, `WireSessionOptions.sdkEsmDir`), used by 40 files;
- the in-process `extra` shape for `_requestHandlers`;
- the `ProtocolError` class identity;
- the new `sdk-wire-golden.json`;
- the DW-617 rows in 41-5 and in `prompts.test.ts`;
- the audit entry count in the 39.3 gate;
- the source path of `tools-list-snapshot` `sdkVersion`.

Every test added or changed passes on a fresh environment, in either order. No IRIS instance is touched, and no `ExecuteMCPv2.Temp.*` fixture is needed. Spawned servers get only the closed-port env.

**Manual checks:**
- `git status --short` shows no change under `irislib/`, `irissys/` or `extensions/iris-mcp-launcher/package-lock.json`.

**Implement-stage run record** (`<B>` = `39fd0ea525fdfd5545249f610361ecd6f667bedd`; Darwin, Node 26.8.1, pnpm 9.15.0; every IRIS-reaching run on `IRIS_HOST=127.0.0.1 IRIS_PORT=1`, every launcher run also on `IRIS_TEST_HOST=127.0.0.1 IRIS_TEST_PORT=1`).

- **Capture (task 3, Rule #36).** The checkout had touched every `src/` mtime, so the six dists were stale; `dist/` and `tsconfig.tsbuildinfo` were deleted and shared and the five servers rebuilt on the v1 tree, one per call. `node scripts/capture-sdk-wire-golden.mjs` wrote `sdk-wire-golden.json` (112 rows; `sdkPackage` v1 `sdk`, `sdkVersion` 1.29.0, `zodVersion` 4.3.6, `baselineRevision` `<B>`). Two captures of that 116-row list, the second to a scratch path, matched row for row (0 differences). The first fixture was then deleted and the golden recaptured from the same unchanged v1 build, before any source or manifest edit, to drop four `prompts/get` rows that sent a non-string argument (the SDK's wire schema answers those with `-32603`; they are outside the matrix). The golden was never edited.
- **Pin test on v1 (task 5).** `story-43-1-sdk-wire-golden.test.ts` on the v1 build: 217 of 231 pass; the 14 reds are exactly the 7 omitted-`arguments` DW-617 rows, each in its raw and its v2-client view. On the v2 builds: 231 of 231.
- **Audit (`pnpm audit --prod --json`).** Before (v1): 71 advisories (4 critical, 18 high, 46 moderate, 3 low) over 206 dependencies, GHSA-6qxp-vccf-f47h present. After: 18 advisories (3 critical, 7 high, 8 moderate, 0 low) over 120 dependencies, GHSA-6qxp-vccf-f47h absent; the modules left are `@vitest/mocker`, `esbuild`, `nanoid`, `postcss`, `smol-toml`, `source-map-js`, `tinypool`, `vite` and `vitest`, so nothing was added.
- **Manifests and lockfile (AC 43.1.1).** `server`, `client` and `core` resolve at 2.3.1; `eventsource-parser` 3.1.1 is the one other package added; the lockfile has no `requiresBuild`; `pnpm -r why zod` shows the single copy 4.3.6. `pnpm remove` left the v1 store directory behind and `pnpm prune` removed it (`ls node_modules/.pnpm | grep -c '^@modelcontextprotocol+sdk@'` is 0). Incidental lockfile metadata: pnpm added a `deprecated:` line to the existing `eslint@9.39.4` entry.
- **(loop) Builds.** shared, dev, admin, interop, ops, data: each exit 0. **(loop) Shared tests** (the five named files plus the rest of the package): `pnpm --filter @iris-mcp/shared test` 82 files, 2110 tests green. **(loop) iris-mcp-all wire tests** (the eight named files plus `story-39-6-qa-snapshot-cli.test.ts`): green. **(loop) Snapshot check:** OK, 115 of 115 entries, fixture untouched. **(loop) stageDefaultStartup files:** the 43 files are inside the package suites below (shared 82 files, dev 68, admin 35, interop 30, ops 20), all green. **(loop) Dev in-memory:** green. **(loop) Launcher SDK files:** the resolution test passes, and the two integration files skip with `IRIS is not reachable at http://127.0.0.1:1`, naming reachability.
- **(once) Package suites.** shared 82 files / 2110 tests, dev 68 / 1356 (+307 skipped), admin 35 / 490, interop 30 / 672, ops 20 / 350, data 9 / 163, client-config 37 / 1008: all green, and `type-check` is clean for all seven; `lint` has 0 errors (shared has the one existing warning, an unused eslint-disable in `cli/governance.ts`). **(once) iris-mcp-all sweep:** the three slices, 44 + 45 + 44 files, green (live gates skipped). **(once) Launcher suite:** 5 failed tests and 2 unloadable files, equal to the DW-532 set exactly (`clientsEngine` 2, `governanceEngine` 2, `clientsActivationFlow` 33-3-3, and `constants` and `credentials`). **Launcher `type-check` is not green on this host:** every error is a missing module (`vscode`, `@intersystems-community/intersystems-servermanager`) or an implicit-any that follows from it, because the extension's own `node_modules` is empty here (the cause of DW-532); no error is in a file this story changed.
- **(once) Gates.** `pnpm gen:governance-baseline:check`: 141 frozen keys, 212 live, OK (the hash `1e62c5ad5bf7` is pinned by the shared suite, which is green); `validate:prompts`, `gen:skills:check` and `gen:pack:check` OK and unchanged. **(once) Diff and inventory:** `bootstrap-classes.ts` in the diff 0; `@modelcontextprotocol+sdk@` store directories 0; the inventory grep has one hit at this stage, the `"sdkPackage"` header of `sdk-wire-golden.json` (data that records the v1 oracle), and no code or manifest hit (the review pass adds two string hits, see the Review-pass record). **(once) Shuffled runs:** the added and changed tests of shared, iris-mcp-all, dev and the launcher at seeds 11 and 22: green.
- **(loop) Assertion-diff guard.** Per-file `expect(` counts that moved: `story-39-3-body-search-live-gate` 150 to 154, `story-39-6-qa-snapshot-cli` 74 to 75, `story-41-5-qa-dist-consumer` 34 to 31, `shared/prompts.test.ts` 34 to 35; the other 73 changed test files are equal. The assertion lines that changed are the enumerated ones (the 41-5 DW-617 rows, `prompts.test.ts` DW-617, the 39.3 gate, the `ProtocolError` class identity in `prompts-guardrails` and `governance-resource-coverage`) and, not enumerated, the three `sdkVersion` lines of `story-39-6-qa-snapshot-cli.test.ts` (finding 1 below).
- **D3 clause.** The stageDefaultStartup files edited are 10: the nine named under D3 and `governance-resource-coverage.test.ts` (the `McpError` import). `server-discovery.test.ts` was plumbed first and reverted, because it calls only `resources/list`.

mutation: tools/list pin (AC 43.1.3) - in `sdk-wire-compat.ts` the input schema `target` changed from `draft-7` to `draft-2020-12`, shared rebuilt - red: the `tools-list` rows of the golden, 12 tests (dev main and dev core-preset, admin, interop, ops, data; raw line and client view each) - reverted (sha256 identical, rebuilt, green).
mutation: unknown and hidden tool text (AC 43.1.3) - the `MCP error -32602: ` prefix dropped from the not-found result in `callToolFromWire` - red: the `call:unknown-tool` rows of all five servers and dev's `call:hidden-tool`, 12 tests - reverted (sha256 identical, rebuilt, green).
mutation: object-level refine (AC 43.1.3) - `wireInputSchema` returned the extended schema instead of `z.object(extended.shape)` - red: the interop `call:invalid-object-refine` row (raw and client) and the compat test "a refinement on the whole object is applied by the dispatch" - reverted (sha256 identical, rebuilt, green).
mutation: DW-579 audit pin - `recordAuditEntry` wrote `params` and `dataPolicy` for a schema-invalid call (`if (!schemaInvalid || schemaInvalid)`) - red: `story-43-1-schema-invalid-audit.test.ts` ("no params, with IRIS_AUDIT_LOG_PARAMS=true") on the built dev server, and two tests of the audit group in `sdk-wire-compat.test.ts` - reverted (sha256 identical, rebuilt, green). The assertion added to the armed-only 39.3 gate cannot be run without an instance; the same behavior is pinned on the default suite by the test above.
mutation: DW-617 pin - `params.arguments ?? {}` became `params.arguments` in `getPromptFromWire` - red: the 14 DW-617 rows of the golden (7 rows, raw and client), 6 tests of `story-41-5-qa-dist-consumer.test.ts` (admin, interop and ops, SDK row and raw-frame row), the DW-617 test of `shared/prompts.test.ts` and two tests of `sdk-wire-compat.test.ts` - reverted (sha256 identical, rebuilt, green).
mutation: capabilities pin (AC 43.1.3, and the changed 41-2 data-server row) - a prompt was registered on every server - red: the `initialize` and `prompts-list` rows of all five servers, `prompts-get:absent`, and `story-41-2-qa-prompts-stdio-wire.test.ts` (including "iris-data-mcp registers no prompt: prompts/list and prompts/get are MethodNotFound") - reverted (sha256 identical, rebuilt, green).
mutation: initialize pin (the `initialize` rows, AC 43.1.3; for AC 43.1.2's negotiation see the code-review record below) - `instructions` changed to `SERVER_DISCOVERY_INSTRUCTIONS + " "` - red: the `initialize` rows of all five servers in every session, 22 tests - reverted (sha256 identical, rebuilt, green).
mutation: resolver pin (AC 43.1.4) - the store prefix in `resolveSdkEsmDir` (iris-mcp-all) and in the launcher test's own copy changed to `@modelcontextprotocol+clientZZ@` - red, not skipped: both tests of `story-43-1-sdk-client-resolution.test.ts` and both tests of the launcher's `sdkClientResolution.test.ts` - reverted (sha256 identical).
mutation: D3 clause - the `mcpReq: { requestState: () => undefined }` line removed from the `callRequest` stub of `governance-resource.test.ts` - red: that file, `TypeError: Cannot read properties of undefined (reading 'requestState')` - reverted (sha256 identical).
mutation: list_changed pin - `debouncedNotificationMethods` removed from the server options - red: `sdk-wire-compat.test.ts` "one call that removes tools sends exactly one list_changed" (3 received for 2 tools removed) - reverted (sha256 identical, green).
mutation: output-schema parity - the `checkWireOutput` result ignored in `callToolFromWire` - red: the two tests of `sdk-wire-compat.test.ts` that refuse structured content the schema rejects and a result without structured content - reverted (sha256 identical, green).
mutation: snapshot `sdkVersion` lines - `captureToolsList` recorded the `zod` version as `sdkVersion` - red: the two changed tests of `story-39-6-qa-snapshot-cli.test.ts` ("expected '4.3.6' to be '2.3.1'") - reverted (sha256 identical).

**Review-pass record (2026-10-20).** The four review layers filed 36 findings (triage log). Patches made by the build agent, each with its mutation line below: the golden's `initialize` rows compare the package manifest's version; `story-43-1-sdk-confinement.test.ts` (new, AC 43.1.1 and AC 43.1.2 second bullet); `story-43-1-raw-wire-driver.test.ts` (new) with a hardened `openRawWire`; `installedSdk` resolves the v1 SDK or the v2 server package; three rows in `sdk-wire-compat.test.ts` (`addTools` notification count, a failing dispatch, the omitted-arguments audit entry); a README paragraph on refused calls; the CHANGELOG and changeset wording; five stale comments and one test title. After the last patch the dists of shared and the five servers were rebuilt (dev from a deleted `dist/` and `tsconfig.tsbuildinfo`, because `tsc` emitted nothing for unchanged content) and the `(loop)` and `(once)` commands were run again: shared 82 files / 2113 tests, dev 68 / 1356 (+307 skipped), admin 35 / 490, interop 30 / 672, ops 20 / 350, data 9 / 163, client-config 37 / 1008, all green with type-check clean and 0 lint errors; the iris-mcp-all sweep 45 + 45 + 45 files green; the launcher suite 5 failed tests and 2 unloadable files (the DW-532 set exactly); the launcher type-check errors are all `vscode` or servermanager modules missing from the extension's empty `node_modules`, in no file this story changed; `gen:governance-baseline:check` OK (141 frozen keys), `validate:prompts`, `gen:skills:check`, `gen:pack:check` OK; `gen:tools-list-snapshot:check` OK (115 of 115, fixture untouched); `pnpm audit --prod` 18 advisories over 120 dependencies, GHSA-6qxp-vccf-f47h absent, 9 modules (the same list as the implement stage); `bootstrap-classes.ts` in the diff 0; `@modelcontextprotocol+sdk@` store directories 0; the shuffled runs at seeds 11 and 22 green. The inventory grep now has three hits besides the golden header: the v1 package name as a string in `story-43-1-sdk-confinement.test.ts` (`V1_SDK`, the package the guard forbids) and in `sdk-wire-golden-core.mjs` (`SDK_PACKAGES`, the lookup of the oracle tree); none imports or depends on it.

mutation: addTools notification pin (review finding BH5) - `debouncedNotificationMethods` removed from the server options - red: `sdk-wire-compat.test.ts` "one call that adds tools sends exactly one list_changed" (3 received for 1) and the removeTools row - reverted (sha256 identical).
mutation: dispatch-failure containment (review finding VG12) - the `catch` of `callToolFromWire` rethrew - red: `sdk-wire-compat.test.ts` "a failure of the dispatch itself is the in-band error result" (the client call rejected with "dispatch exploded") - reverted (sha256 identical).
mutation: omitted-arguments audit (review finding IA2, matrix row "Omitted tool args") - `handleToolCall` skipped the audit entry when `rawArgs` is `undefined` - red: `sdk-wire-compat.test.ts` "a call with arguments omitted entirely writes the same single entry" (timed out waiting for the entry) - reverted (sha256 identical).
mutation: golden version mask (review finding EC1) - the dev manifest version bumped to 0.0.3 and `withManifestVersion` made the identity - red: the 6 `initialize` rows of iris-dev-mcp (3 sessions, raw and client view); with the mask restored and the bump kept the 50 dev rows are green - both reverted (sha256 identical).
mutation: installedSdk (review finding BH2) - the v1 package removed from `SDK_PACKAGES` - red: `story-43-1-sdk-confinement.test.ts` "finds the v1 SDK on the oracle tree the golden was captured from" - reverted (sha256 identical).
mutation: confinement guard (AC 43.1.1, AC 43.1.2 second bullet) - four at once: the v1 package added to `packages/iris-dev-mcp/package.json`, a `@modelcontextprotocol/server` import added to `packages/iris-dev-mcp/src/index.ts`, shared's server pin changed to `^2.3.1`, `requiresBuild: true` added to the server entry of `pnpm-lock.yaml` - red, one row each: "packages/iris-dev-mcp lists no v1 SDK", "packages/iris-dev-mcp/src has no source that imports an @modelcontextprotocol package", "@iris-mcp/shared depends on the v2 server package at the exact version", "the server package is integrity-pinned and runs no install script" - all four reverted (sha256 identical).
mutation: raw driver (review finding BH10) - three separate mutations of `openRawWire` in `scripts/lib/sdk-wire-golden-core.mjs`: the `message.method === undefined` check dropped, the `JSON.parse` guard removed, and the `ended` guard of `request` disabled - red: `story-43-1-raw-wire-driver.test.ts` "resolves a request with the response line, and not with a request the server sent under the same id", "rejects the pending request, naming the line, when the server writes a stdout line that is not JSON" (plus an unhandled error), and "rejects a request made after the server has exited" - each reverted (file as intended). A fourth change, settling on `close` instead of `exit`, was not pinned: a response of 400 KB written just before the exit resolved under `exit` in three runs, so `exit` stays.

**Findings and deviations for the lead.**
1. **Three assertion lines outside the enumerated set.** With `installedVersion` reading `@modelcontextprotocol/server` (Code Map) and the snapshot fixture untouched (Never), a regenerated snapshot records `sdkVersion` 2.3.1 where the committed file says 1.29.0. `story-39-6-qa-snapshot-cli.test.ts` compared the two, so two tests went red (`expect(written.sdkVersion).toBe(committed.sdkVersion)` and the whole-document `toEqual` that excludes only `capturedAt`). They now compare the written version with the installed package's (`INSTALLED_SDK_VERSION`, read from the manifest): one assertion line rewritten, one added, and the `toEqual` rewritten to exclude `sdkVersion`. The snapshot's 115 entries still equal the live ones.
2. **Member order of a result with both `isError` and `structuredContent`: not a change.** The SDK `Server` encodes a `tools/call` result in its result schema's order, `content, structuredContent, isError`, and so did the v1 SDK server (`sdk/dist/esm/server/index.js:137-143`). The order `dispatchToolCall` builds never reached either wire. QA's handler golden, captured from the v1 build, holds that order for `sql-query:refusal`, `doc-get:metadata-missing` and `denial`, and v2 writes the same bytes (`story-43-1-qa-handler-golden.test.ts`); all 90 such results of the catalogue sweep are byte-identical v1 against v2. The Risks section's "key-order drift" does not exist (wave-8 decision #5). `sdk-wire-compat.test.ts` pins the members and values.
3. **A v2 client skips `prompts/list` for a server that never advertised prompts** (it answers an empty list without sending the request), so the 41-2 data-server row could no longer reach the server's `-32601` through `listPrompts()`. `WireSession` gained `request(method, params)`, which sends the request as given, and that one row (`const listRefusal = ...`) uses it; its assertion line is unchanged. The raw golden rows pin the `-32601` itself.
4. **`maxToolInputElements` (2.3.0).** Read in the 2.3.1 source: only `McpServer`'s own `tools/call` enforces it, the option is unset (no limit), and the owned handler bypasses it; `Server._wrapHandler` does not enforce it, so no large-array row was added.
5. **`removeTools`** uses the `RegisteredTool.remove()` handle that `registerTool` returns, and the server is constructed with `debouncedNotificationMethods: ["notifications/tools/list_changed"]` so one call sends one notification (the SDK also announces each removal and each registration, and the server joins those announcements and the explicit one; `addTools` is joined the same way). Neither method has a production caller.
6. **Files written through the shell.** Two scratch captures of command output were redirected into the scratchpad (`pnpm audit` JSON, a file list) and deleted at once; no source or repository file was written that way. The golden is the sanctioned generated file. In the review pass the diff snapshot was written with `git diff --output` (git's own flag) to the scratchpad, and one scratch checksum list was written with `tee` and deleted at once; every repository edit used the file tools.
7. **No IRIS traffic and no MCP tool call** was made by this stage; the 39.3 gate and every other live gate ran unarmed (skipped).

**QA stage record (2026-10-20).** `<B>` = `39fd0ea525fdfd5545249f610361ecd6f667bedd`; Darwin, Node 26.8.1, pnpm 9.15.0. Every server ran against `127.0.0.1:1` (closed) or against the in-process fake listener below; no IRIS instance and no MCP tool call; the armed gates were not run. The baseline was a `git worktree` of `<B>` under the OS temp dir (`pnpm install --frozen-lockfile --offline`, shared and the five servers built one per call), removed afterwards together with every temp file.

Tests and support files added (QA):
- `packages/iris-mcp-all/src/__tests__/story-43-1-qa-handler-golden.test.ts` (QA, 72 tests): the results of tool HANDLERS, which the wire golden cannot reach. Each built server runs against the fake IRIS (`scripts/lib/fake-iris-listener.mjs`); the response line of 22 `tools/call` rows, the requests the server makes to IRIS and the audit entries (`IRIS_AUDIT_LOG_PARAMS=true`) are compared with `fixtures/sdk-handler-golden.json`, which `scripts/capture-sdk-handler-golden.mjs --dist-root <baseline worktree>` captured from the v1 build (Rule #36). The rows cover a success with `structuredContent`, an `isError` result with and without `structuredContent`, `isError:false` with `structuredContent`, a handler that throws, an HTTP 500 error envelope, a governance denial, numeric and boolean strings that must arrive parsed, and an unknown key that must be dropped. The only sanctioned difference is the DW-579 audit entry of the final schema-invalid call.
- `packages/iris-mcp-all/src/__tests__/story-43-1-qa-dw579-process.test.ts` (QA, 27 tests): DW-579 on the real process of each of the five servers, for every tool each lists (115): the schema-invalid call writes one entry (`outcome` `error`, the client's text, raw key names, no `params`, no `dataPolicy`) with `IRIS_AUDIT_LOG_PARAMS` set and unset; an invented secret sent as an object, as a string in a field of a non-string type, and inside an enum reaches neither the audit file, the response nor stderr; an unknown tool and a hidden tool (`IRIS_TOOLS_PRESET=core`) write no entry while a visible call in the same session does.
- `packages/iris-mcp-all/src/__tests__/story-43-1-qa-pack-confinement.test.ts` (QA, 28 tests): what `npm pack --dry-run --json` would publish of `@iris-mcp/shared`, the five servers and `@iris-mcp/all` (AC 43.1.1, AC 43.1.2): no packed file names `@modelcontextprotocol/sdk`; only shared imports an `@modelcontextprotocol/*` module, and only `server` and `server/stdio`; the one runtime SDK dependency is shared's `server` at exactly 2.3.1; the `client` package is a test-only devDependency, exact, and in no runtime, peer or optional section.
- `packages/iris-mcp-all/src/__tests__/story-43-1-qa-stdio-lifecycle.test.ts` (QA, 5 tests): each built server, after a call that reached the fake IRIS, exits with code 0 and no signal when its client closes stdin.
- Support (QA): `scripts/lib/fake-iris-listener.mjs`, `scripts/lib/sdk-handler-golden-core.mjs`, `scripts/capture-sdk-handler-golden.mjs`, `packages/iris-mcp-all/src/__tests__/fixtures/sdk-handler-golden.json`; `openRawWire` in `scripts/lib/sdk-wire-golden-core.mjs` gained `endInput()` and `exit()` (additive; its test is unchanged and green). The four test files and the fixture are in the default suite: iris-mcp-all slices NR%3 = 0, 1, 2 run 46 + 47 + 46 files green; the four files shuffled at seeds 11 and 22 give 132 of 132.

One-time checks (not in the suite; their scripts lived in the OS temp dir):
1. **A real `@modelcontextprotocol/sdk@1.29.0` CLIENT against the five BUILT v2 servers** (installed with `npm install --ignore-scripts` into an OS temp dir, driven from a script kept in a different dir). It ran 6 sessions (dev `main` and `core-preset`, admin, interop, ops, data) over stdio on the closed port: `initialize`, `tools/list`, `tools/call` (unknown tool, schema-invalid of every pick, omitted `arguments`, `iris_server_profiles`, the governance denial, the closed-port read), `prompts/list`, `prompts/get` with arguments, with `{}` and with `arguments` omitted, `resources/list`, `resources/templates/list` and `resources/read` with both error rows. For each of the 107 exchanges it compared the raw frame the v1 client received and what its typed method returned with the golden row (the DW-617 rows with their `{}` row): 214 checks, 0 failures; the stderr lines equal those of the v1 build. Negative control: the same script against the v1 BASELINE servers fails 11 checks, all of them `prompts-get:omitted:*` (the DW-617 class), so the script can fail. The frames that client sent have the same content as the raw driver's (`initialize` params `{protocolVersion, capabilities:{}, clientInfo}`, `tools/call {name, arguments?}`, `prompts/get {name, arguments?}`). No default-suite form was added: the v1 package may not exist anywhere in the repo (AC 43.1.2, pinned by `story-43-1-sdk-confinement.test.ts`) and cannot be installed without the network, and the golden's raw driver already sends the bytes that client sent, so a replay of recorded client frames would pin nothing new.
2. **v1 against v2, same fake listener** (the baseline worktree's dists and the current dists, one fresh listener per session). (a) The handler golden above: 22 rows, 0 differences. (b) A sweep of the whole catalogue: 115 tools, per tool the arguments `{}`, the required fields, all fields, and per action value both of the last two; once with the default governance and once with every governed key enabled, 1266 calls in all. Response lines identical on 1264, requests made to IRIS identical on 1264, audit entries identical (ignoring `seq`) for every valid call; the 192 schema-invalid calls each have the DW-579 entry in the specified shape on v2 and none on v1. The only differences are `iris_macro_info` (two calls): the handler sends two POSTs in parallel (`intelligence.ts`, `Promise.all`) and reports whichever 404 returns first; three repeated v2 sweeps show the same flip between two runs of ONE build, so it is not a v1/v2 difference. Result kinds on v2: 902 `isError` without `structuredContent`, 90 `isError` with `structuredContent`, 82 successes with `structuredContent`. See finding Q1 for the 90.
3. **DW-579 on the real process.** With `IRIS_AUDIT_LOG_PARAMS` unset, no entry of any call carries `params`; set to `true`, a schema-invalid call's entry carries none. A secret in the invalid field is in neither the audit file nor stderr (LOG_LEVEL DEBUG), and an unknown or hidden tool writes no entry. These are pinned now by `story-43-1-qa-dw579-process.test.ts`. The new assertions of the armed-only 39.3 gate were checked against the real interop process on the closed port for `redact`, `block` and `allow`: `action` `body`, `outcome` `error`, `filters` in `paramKeys`, no `params`, no `dataPolicy`, the marker absent from the line, the audit and stderr.
4. **Packaging.** `npm pack --dry-run` and `pnpm pack` (into an OS temp dir) for shared and dev, and the dry-run list for all seven: no packed file names `@modelcontextprotocol/sdk`; the packed shared manifest has `dependencies["@modelcontextprotocol/server"]` `2.3.1` and `devDependencies["@modelcontextprotocol/client"]` `2.3.1`; `pnpm pack` rewrites dev's `@iris-mcp/shared` from `workspace:*` to `0.0.2`. Now pinned by `story-43-1-qa-pack-confinement.test.ts`.
5. **Probes of requests the golden does not send** (dev server, v1 against v2, same script): `ping`, `tools/list` with a cursor or `_meta`, `tools/call` with `_meta` (progress token, `claudecode/toolUseId`), every `prompts/get` shape, `resources/read` of a bad URI, `resources/subscribe`, `completion/complete`, `logging/setLevel`, an unknown method, `tasks/*`, server-to-client methods, notifications, a batch, a request without `method`, a non-JSON and a truncated line, requests before `initialize`, a double `initialize`, and `initialize` with seven protocol versions: 120 of 127 leaves identical; the 7 are finding Q2 and Q3. Stdin EOF, SIGTERM and SIGINT end the process the same way on both builds (exit 0 within about 10 ms; killed by the signal), and a `notifications/cancelled` for an in-flight call produces no response on both while the next call is served. Stdin EOF is now pinned by `story-43-1-qa-stdio-lifecycle.test.ts`.

mutation: handler results (AC 43.1.3, handler golden) - `dispatchToolCall` stopped copying `structuredContent` for an `isError` result (`&& !result.isError`, in the built `packages/shared/dist/server-base.js`) - red: `sql-query:refusal` byte-identity, "differs from the golden in nothing else" and "writes a result with isError and structuredContent as content, structuredContent, isError" of the dev server; the same mutation leaves `story-43-1-sdk-wire-golden` and `story-43-1-schema-invalid-audit` green (232 of 232), which is the gap this test closes - reverted (sha256 identical).
mutation: valid call's audit entry from the parsed arguments (matrix row "Valid calls") - `handleToolCall` kept the raw arguments for the audit (`args = rawArgs`) - red: the dev audit comparison, "differs from the golden in nothing else" and "hands the handler, and the audit entry, the parsed arguments" - reverted (sha256 identical).
mutation: DW-579 entry (DW-579 AC) - `recordAuditEntry` skipped for a schema-invalid call - red: the audit comparison and the golden comparison of all five servers (10 tests) - reverted (sha256 identical).
mutation: DW-579 no params (DW-579 AC) - `if (!schemaInvalid)` became `if (true)` in `recordAuditEntry` - red: the three audit tests of each of the five servers and the hidden-tool test in `story-43-1-qa-dw579-process`, and the audit and golden comparisons of `story-43-1-qa-handler-golden` (26 tests) - reverted (sha256 identical).
mutation: no value in the refusal (AD-19) - `checkWireInput` appended `JSON.stringify(rawArguments)` to the error text - red: the secret tests of all five servers and the hidden-tool test (11 tests); `story-43-1-schema-invalid-audit` also goes red - reverted (sha256 identical).
mutation: unknown and hidden tool unaudited (matrix row "Unknown or hidden tool") - `callToolFromWire` logged an audit entry for a name that is not registered - red: "an unknown tool writes no entry" and "a hidden tool ... writes no entry" - reverted (sha256 identical).
mutation: exact pin in the published manifest (AC 43.1.2) - `packages/shared/package.json` `@modelcontextprotocol/server` `"2.3.1"` became `"^2.3.1"` - red: "lists an MCP SDK package only as shared's exact 2.3.1 runtime dependency ..." of shared - reverted (`git diff --stat` empty for the file; sha256 identical).
mutation: v1 import in a shipped dist (AC 43.1.1) - `import { Client } from "@modelcontextprotocol/sdk/client/index.js"` added to the built `packages/iris-dev-mcp/dist/index.js` - red: "names the v1 SDK in no packed code" and "imports an MCP SDK module only from shared" of dev; `story-43-1-sdk-confinement` stays green (35 of 35), which is the gap this test closes - reverted (sha256 identical).
mutation: process ends with its client (AC 43.1.3, lifecycle) - `setInterval(() => {}, 1000)` after the connect in the built `server-base.js` - red: `story-43-1-qa-stdio-lifecycle` for all five servers ("still running 10000 ms after its stdin was closed") - reverted (sha256 identical).
mutation: handler golden comparer - `diffHandlerSession` ignored the requests made to IRIS (`false && ...`) - red: "finds a request to IRIS that differs" - reverted (sha256 identical).
mutations_demonstrated=10 (the negative control of check 1 is not counted). Each mutation was applied to the built `dist/` that the test spawns (or to the named manifest or script), reverted with the edit tool, and checked by sha256; `git status --short` and `git diff --stat` show only the QA files afterwards.

**QA findings for the lead (apply, ledger or sanction; nothing was edited for them).**
- **Q1. The member-order exception (wave-8 decision #4, deferred entry 5, Finding 2) rests on a false premise: the v1 wire already wrote `content, structuredContent, isError`.** The v1 SDK server re-parses every `tools/call` result with `CallToolResultSchema` and returns the parsed data (`sdk/dist/esm/server/index.js:137-143`), which is in schema order, so the order `dispatchToolCall` builds (`content, isError, structuredContent`) never reached the v1 wire. Evidence: in the handler golden, captured from the v1 build, `sql-query:refusal` (`isError:true`), `doc-get:metadata-missing` (`isError:false`) and `denial` are `content, structuredContent, isError`, and v2 writes the same bytes; in the sweep all 90 `isError`-with-`structuredContent` results are byte-identical v1 against v2. The spec compared the SDK v2 output with the dispatch's build order and never ran v1. No code change is needed. The statements to correct or retire are the third Story 43.1 bullet of AD-15 in the spine, the CHANGELOG headline and Known limits, the last paragraph of `.changeset/story-43-1-sdk-v2-migration.md`, the comment at `packages/shared/src/__tests__/sdk-wire-compat.test.ts:419-421`, the spec's deferred entry 5 and the Auto Run Result's residual risk 1. `story-43-1-qa-handler-golden.test.ts` ("writes a result with isError and structuredContent as content, structuredContent, isError, as the v1 build did") now pins the real order against the v1 capture.
- **Q2. A malformed `tools/call` request is refused with a different code and text** (low; not a matrix row, not sanctioned). `name` missing or not a string, `arguments` a string, null or array, or no `params`: v1 `-32603` with the bare zod issue list as the message; v2 `-32602` with `Invalid tools/call request: <the same issue list>` (the SDK v2 validates the request before the owned handler). Only a client that breaks the MCP schema reaches it. Left unpinned so that no unsanctioned shape is encoded.
- **Q3. A `tools/call` with a `task` param is served as a plain call** (low). v1 answered `-32603` `Server does not support task creation (required for tools/call)`; v2 runs the call and returns a normal result. A client reaches it only by ignoring the absent `tasks` capability (Rule #54). Left unpinned.
- **Q4. The seven live-only files' v2 client sites (deferred entry 3) remain unverified**; this stage did not arm them.

**Code-review record (2026-10-20).** `<B>` = `39fd0ea525fdfd5545249f610361ecd6f667bedd`; Darwin, Node 26.8.1, pnpm 9.15.0. Every run used `IRIS_HOST=127.0.0.1 IRIS_PORT=1`, with `IRIS_TEST_HOST=127.0.0.1 IRIS_TEST_PORT=1` added for the launcher, or a fake listener on 127.0.0.1. No IRIS instance was contacted, no MCP tool was called, and no armed gate was run. DW-638's seven live-only files are left for the lead's armed smoke.
- **QA's two gaps are closed on the paths they guard (lead item 3).**
  - Dropping `structuredContent` for `isError` results in the built `packages/shared/dist/server-base.js` turns 3 tests of `story-43-1-qa-handler-golden` red (`sql-query:refusal`, "differs from the golden in nothing else", and the member-order row). `story-43-1-sdk-wire-golden` (231) and `story-43-1-schema-invalid-audit` stay green.
  - A v1 `@modelcontextprotocol/sdk` import in the built `packages/iris-dev-mcp/dist/index.js` turns 2 tests of `story-43-1-qa-pack-confinement` red, while `story-43-1-sdk-confinement` stays green (35).
  - Both mutations were reverted and checked by sha256.
- **Diff guard (D3).** 44 files call `stageDefaultStartup(`: the 43 baseline files plus the new `sdk-wire-compat.test.ts`. 10 baseline files changed, the named 10. The only assertion lines that changed in them are the `ProtocolError` class identity lines of `governance-resource-coverage.test.ts`.
- **The three `story-39-6-qa-snapshot-cli` lines (finding 1): sound.** `written.sdkVersion` is pinned to the installed server manifest's version. The whole-document `toEqual` still covers every other member (it excludes `capturedAt` and `sdkVersion`, and `sdkVersion` is asserted separately). The capture is no weaker; the change is a forced consequence of `installedVersion` reading the server package while the fixture stays untouched.
- **Suites after the patches.** iris-mcp-all slices NR%3 = 0, 1 and 2: 46 + 47 + 47 files green (live gates skipped). Shared `sdk-wire-compat.test.ts` 41 of 41, `type-check` clean, `lint` 0 errors (the one existing warning). Launcher: 5 failed tests and 2 unloadable files, exactly the DW-532 set; the three Story 43.1 files pass or skip for reachability; `tsc --noEmit` reports 11 errors, none in a touched file (DW-532 occurrence). The six changed or added iris-mcp-all files, shuffled at seeds 11 and 22, are 379 of 379, and the shared compat file is 41 of 41. `gen:tools-list-snapshot:check` OK (115 entries, fixture untouched); `gen:governance-baseline:check` OK. `bootstrap-classes.ts` is not in the diff, and the pins are exact 2.3.1 with no `requiresBuild`.
- **Lint scope.** `scripts/` and the iris-mcp-all tests are in no package's lint surface (each package runs `eslint src/`). A direct `eslint` over them reports `no-undef` for Node globals and unused rest variables in the committed implement and QA scripts as well, so it is not a gate.

mutation: decision #6, malformed tools/call (AD-15) - in the built `packages/shared/dist/server-base.js` `start()`, `transport.onmessage` wrapped to give a `tools/call` without `params` the params `{ name: "" }` - red: `story-43-1-sanctioned-wire-changes` "a tools/call with no params is refused -32602 'Invalid tools/call request', byte for byte" on all five servers (5 tests) - reverted (sha256 identical).
mutation: decision #6, task parameter (AD-15) - the owned `tools/call` returned the v1 refusal `Server does not support task creation (required for tools/call)` when `request.params.task` is set (built `server-base.js`) - red: "a tools/call that carries task is served as the plain call ..." on all five servers (5 tests) - reverted (sha256 identical).
mutation: handler golden version mask (AC 43.1.3, handler golden) - dev manifest version bumped to 0.0.3: with the mask the 72 tests are green; with `withSessionVersion` made the identity and the bump kept, the dev audit comparison and "differs from the golden in nothing else" are red (2 tests) - both reverted (sha256 identical).
mutation: launcher resolver (AC 43.1.4) - `SDK_CLIENT_STORE_PREFIX` in the shared `extensions/iris-mcp-launcher/src/__tests__/sdkClientStore.ts`, the lookup both launcher integration tests import, changed to `@modelcontextprotocol+sdk@` - red, not skipped: both tests of `sdkClientResolution.test.ts` - reverted (sha256 identical).
mutation: raw driver after exit (story-43-1-raw-wire-driver) - the `ended` guard of `requestFrame` disabled - red: "rejects a request made after the server has exited" (no answer within 10000 ms instead of the guard's message) - reverted (sha256 identical).
mutation: omitted-arguments audit (matrix row "Omitted tool args", DW-579) - `handleToolCall` wrote a second entry for a schema-invalid call with `arguments` omitted (src `server-base.ts`; its mtime restored afterwards so no dist went stale) - red: `sdk-wire-compat.test.ts` "a call with arguments omitted entirely writes the same single entry" (3 entries for 2) - reverted (sha256 identical, mtime restored).
mutation: process ends with its client (stdio lifecycle) - the built `server-base.js` held the event loop for 4.5 s after the transport closed - red with the 3 s window: `story-43-1-qa-stdio-lifecycle` for every server ("still running 3000 ms after its stdin was closed"); a 4.5 s hold is inside the old 10 s window - reverted (sha256 identical).
mutation: pack confinement of client-config (AC 43.1.1) - a v1 import added to the built `packages/client-config/dist/index.js` - red: "names the v1 SDK in no packed code ..." and "imports an MCP SDK module only from shared ..." of client-config - reverted (sha256 identical).
mutation: negotiation (AC 43.1.2, a 2026-07-28 request negotiates 2025-11-25) - `supportedProtocolVersions: ["2025-06-18", "2025-11-25"]` in the McpServer options of the built `server-base.js` - red: the `newer-era/initialize` raw rows of all five servers (5 tests); every `main` row stays green - reverted (sha256 identical).
mutation: snapshot check (AC 43.1.3, `gen:tools-list-snapshot:check`) - the owned `tools/list` input-schema target `draft-7` changed to `draft-2020-12` in the built `packages/shared/dist/sdk-wire-compat.js` - red: `pnpm gen:tools-list-snapshot:check` exits 1 ("A pinned entry changed or vanished") and `tools-list-snapshot.test.ts` has 3 tests red - reverted (sha256 identical; the check is OK again).
mutation: golden provenance (Rule #36) - the content row's logic applied to a capture of the v2 build (`capture-sdk-wire-golden.mjs --out` into an OS temp dir): 7 DW-617 rows, 0 differing from their `{}` rows, so red; on the committed v1 golden, green.

## Auto Run Result

Status: done
Blocking condition: none

**Summary.** The framework runs on the MCP SDK v2 packages and v1 is gone. `@iris-mcp/shared` depends on `@modelcontextprotocol/server` 2.3.1 (exact), the SDK-client tests on `@modelcontextprotocol/client` 2.3.1 (exact devDependencies), and no manifest, lockfile entry or store directory names `@modelcontextprotocol/sdk`. `McpServerBase` serves `tools/list`, `tools/call`, `prompts/get` and `resources/read` itself through the public `setRequestHandler`, so the 2025-11-25 wire matches the golden captured from the v1 build before the first edit: 112 response lines on the five built servers, byte for byte on the raw line and `toEqual` through a real v2 client, except the DW-617 rows, which now equal their `{}` row. DW-579 (a schema-invalid `tools/call` writes one audit entry, no `params`) and DW-617 are fixed inside that owned path. `pnpm audit --prod`: 71 advisories over 206 dependencies before, 18 over 120 after, GHSA-6qxp-vccf-f47h gone, nothing added. `bootstrap-classes.ts`, `BOOTSTRAP_VERSION`, the governance baseline (141 keys), the tools-list snapshot fixture and the launcher's `package.json` and `package-lock.json` are untouched; the suite stays at 115 tools. No IRIS instance was contacted.

**Files changed.**
- Framework: `packages/shared/src/server-base.ts` (v2 imports, owned handlers, wire validation inside the audit wrapper, `removeTools` through `RegisteredTool.remove()` with one debounced `list_changed`); `packages/shared/src/sdk-wire-compat.ts` (new: v1 error text, tool-list entry, wire validation).
- Dependencies: the `package.json` of shared, dev, admin, interop, ops, data and iris-mcp-all, and `pnpm-lock.yaml` (42 insertions and 661 deletions: `server`, `client`, `core` and `eventsource-parser` added, the v1 stack removed; one registry `deprecated:` line on the existing eslint entry).
- Scripts: `scripts/capture-sdk-wire-golden.mjs` and `scripts/lib/sdk-wire-golden-core.mjs` (new: the SDK-free driver, the exchange list, the capture), `scripts/lib/tools-list-snapshot-core.mjs` (reads the server package version), `scripts/lib/measure-tools-payload-core.mjs` (`mcpReq` in its ctx).
- Golden and pins (new): `sdk-wire-golden.json`, `story-43-1-sdk-wire-golden`, `story-43-1-schema-invalid-audit`, `story-43-1-sdk-client-resolution`, `story-43-1-sdk-confinement`, `story-43-1-raw-wire-driver` (iris-mcp-all), `sdk-wire-compat.test.ts` (shared), the launcher's `sdkClientResolution.test.ts`.
- Migrated tests: `process-gate-helpers.ts` and the files that resolve or import the client (the 5 local-copy gates, 38-6, 39-6, 41-2, 41-5, the dev in-memory test, the 2 launcher integration tests); the `mcpReq` ctx in the in-process tests that call `tools/call`, `prompts/get` or `resources/read`; the `ProtocolError` class identity; the DW-617 rows of 41-5 and `prompts.test.ts`; the invalid-call assertion in the armed 39.3 gate; the `sdkVersion` lines of the 39-6 snapshot-CLI test.
- Docs: `CHANGELOG.md`, `.changeset/story-43-1-sdk-v2-migration.md`, `packages/shared/README.md`, the root `README.md` (refused calls are audited).

**Review.** 36 findings from four layers: high 0, medium 3, low 31, false 1, maybe-false 1 (counted from the triage log). Patched: 19 rows (3 medium: the golden's version coupling reported twice, and the missing guard for AC 43.1.1 and AC 43.1.2; 16 low: `installedSdk`, the raw driver hardening, the `addTools` notification row, the dispatch-failure row, the omitted-arguments audit row, the README and CHANGELOG wording, five comments and a title). Deferred: 4 rows (VG3 and IA1 share one root cause) into 3 new `deferred:` entries (the v2-client code in the 7 live-only files, the golden's retirement policy, the member-order exception). Rejected: 13 rows, each with its reason in the triage log (spec-bound rows, a pre-existing behavior, the Node floor that Story 42.1 owns, a false claim about `resources/read`, a driver exit race that did not reproduce).

`followup_review_recommended: true` (two medium entries were patched). The risk it names: the seven live-only gate files that now drive the v2 client (5 local-copy gates and 2 launcher tests) have only run unarmed, so their v2 call sites rest on the shared helper's shape; an armed smoke by the lead settles it.

**Verification.** Every command of `## Verification` ran after the last patch, on `IRIS_HOST=127.0.0.1 IRIS_PORT=1` (and `IRIS_TEST_HOST=127.0.0.1 IRIS_TEST_PORT=1` for the launcher): builds of all six dists; package suites shared 2113 tests, dev 1356, admin 490, interop 672, ops 350, data 163, client-config 1008, all green with type-check clean and 0 lint errors; the iris-mcp-all sweep 135 files green; the 43 `stageDefaultStartup` files green with only the enumerated plumbing; the assertion-diff guard shows only the enumerated lines plus the three `sdkVersion` lines (finding 1); the golden pin 231 of 231 on v2 (217 of 231 on v1, the 14 reds being the DW-617 rows); the launcher suite fails the DW-532 set exactly; `gen:governance-baseline:check` OK (141 keys); `validate:prompts`, `gen:skills:check`, `gen:pack:check`, `gen:tools-list-snapshot:check` OK; shuffled runs at seeds 11 and 22 green. Mutations (Rule 19) are recorded as `mutation:` lines under `## Verification`: 12 from the implement stage and 7 from the review pass, each red on the path it guards and reverted to the same checksum.

**Residual risks and decisions for the lead.**
1. **Member order (deferred entry 5): withdrawn.** v1 already wrote a result with both `isError` and `structuredContent` as `content, structuredContent, isError`, the order v2 writes, so there is no drift (wave-8 decision #5; DW-640 closed `dropped`). QA's handler golden pins those bytes against the v1 capture, and the intent's "byte-identical" holds for this class too.
2. **Launcher type-check is not green on this host.** Every error is a `vscode` or servermanager module missing from the extension's empty `node_modules` (the DW-532 root cause), in no file this story changed; the spec expected green.
3. **Armed live gates were not run.** The 39.3 gate's new invalid-call assertion and the seven live-only files' v2 client sites are unproven until an armed run.
4. **Node floor.** The v2 packages need Node `>=20`; the root manifest and README still say 18 (Story 42.1 owns it).
5. **Inventory grep.** Three string hits remain besides the golden header: the v1 package name in the confinement guard and in the capture core's oracle lookup. None imports or depends on it.
