---
title: 'Story 43.1: Framework Migration to SDK v2'
type: 'refactor'
created: '2026-10-20'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
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
  - **Given** the story's commit, **when** a reviewer reads `.changeset/` and `CHANGELOG.md`, **then** they name the SDK move, and they name DW-579 and DW-617 as the only behavior changes.

## Spec Change Log

- 2026-10-20 (lead spec gate): D1–D3 were taken as recommended (wave-8 decisions #1–#3).
  - `epics.md`: AC 43.1.3 (43 files, "no assertion line changed", diff guard) and AC 43.1.4 (where the SDK-client suites live) are amended.
  - The spine was amended and its lint passed: AD-32 (the exact 2.3.1 pin, framework-owned handlers, validation inside the audited path) and AD-15's sanctioned list (DW-617, plus DW-579's additive audit entry).
  - Seam for 43.2: the framework-owned handlers must also serve the `2026-07-28` era.

## Review Triage Log

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

## Auto Run Result

Status: ready-for-dev
Blocking condition: none

The plan stage halted after planning, as the invocation directed. Three orchestrator decisions (D1–D3) are recorded under Design Notes for the spec gate, and the plan follows each recommendation.
