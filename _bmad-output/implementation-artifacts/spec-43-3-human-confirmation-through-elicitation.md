---
title: 'Story 43.3: Human Confirmation Through Elicitation'
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
  - summary: '`iris_doc_put` with `allowStorageRegeneration: true` drops Storage definitions on a flag the agent sets itself. That is the capability `iris_doc_edit:regenerateStorage` gates, but it sits under the default-enabled `iris_doc_put` and is not in AD-34''s gate list, so 43.3 asks no human for it.'
    evidence: 'Plan-stage inventory, 2026-10-20: the flag at `doc.ts:389`; when it is true, `guardsStorage` is false (`doc.ts:434`), and with `ignoreConflict` the first PUT writes at once (`doc.ts:438-439`), so a confirmation would need an extra GET.'
    location: 'packages/iris-dev-mcp/src/tools/doc.ts:389-439'
    severity: 'med'
  - summary: '`iris_mapping_manage` `force: true` overrides an IRIS-side guard on system-global base mappings on a flag the agent sets. TS cannot tell when the guard applies (`Config.cls:643`, `IsGuardedBaseMapping`), so 43.3 asks no human for it.'
    evidence: 'Plan-stage inventory, 2026-10-20: IRIS refuses without `force` (`Config.cls:643-645`, "Refusing to create a base mapping for system global ... without force=true").'
    location: 'packages/iris-admin-mcp/src/tools/mapping.ts:70'
    severity: 'low'
  - summary: 'The Storage guard covers only `iris_doc_put` and `iris_doc_edit`. `iris_doc_load`, `iris_doc_xml_export` import and `iris_env_promote`''s document writes (`env-promote.ts:869`, `?ignoreConflict=1`) can drop a Storage definition unguarded.'
    evidence: 'Plan-stage inventory, 2026-10-20: `storage-guard.ts` is used only by `doc.ts:451` and `doc-edit.ts:544`.'
    location: 'packages/shared/src/storage-guard.ts'
    severity: 'med'
  - summary: 'The `resend-failed-messages` prompt says an over-cap match is refused and that omitting `dryRun` or `confirm` is refused. A dry run returns the full `matchCount`, and omitting `dryRun` previews. The prompt text is pinned by the frozen 43.1 golden until DW-639 retires it.'
    evidence: 'Plan-stage inventory, 2026-10-20: `resendFailedMessages.ts:70-71` against `MessageResend.cls:586-636` (the cap guard runs only when `dryRun` is false).'
    location: 'packages/iris-interop-mcp/src/prompts/resendFailedMessages.ts:70-71'
    severity: 'low'
  - summary: '`iris_ldap_manage` delete, `iris_x509_manage` delete and `iris_service_manage` enable/disable/set are annotated `destructiveHint: false` although they delete or disable. An annotation change needs AD-15.'
    evidence: 'Plan-stage inventory, 2026-10-20: `ldap.ts:147`, `x509.ts:117`, `service.ts:89`.'
    location: 'packages/iris-admin-mcp/src/tools/ldap.ts:147'
    severity: 'low'
  - summary: 'Audit entries for `%SYS`-scoped tools record the profile''s default namespace (for example `HSCUSTOM`), not `%SYS`.'
    evidence: 'Plan-stage prototype, 2026-10-20: an `iris_audit_manage` entry carried `namespace: "HSCUSTOM"` on a fake listener; pre-existing.'
    location: 'packages/shared/src/server-base.ts deriveAuditNamespace'
    severity: 'low'
  - summary: '`prd.md:86` says "All 86 consolidated tools"; the suite has 115.'
    evidence: 'Plan-stage inventory, 2026-10-20. Story 43.4 owns the PRD compliance line (AC 43.4.3).'
    location: '_bmad-output/planning-artifacts/prd.md:86'
    severity: 'low'
  - summary: 'The HTTP client clears its timeout once the response headers arrive, so a stalled body read is unbounded, and an abort by `destroy()` is reported as a TIMEOUT.'
    evidence: 'Plan-stage read, 2026-10-20: `http-client.ts:243` clears the timer; `:273-283` maps every AbortError to TIMEOUT.'
    location: 'packages/shared/src/http-client.ts:243'
    severity: 'low'
---

<intent-contract>

## Intent

**Problem:** Today's `confirm: true` gates are a parameter the agent sets itself. They catch accidents, but not an agent that decides to proceed. Claude Code, our primary client, supports form elicitation on both eras one stdio process now serves, and nothing asks the person. A cancelled call also still runs its IRIS request and is audited `ok` (DW-642).

**Approach:** One SDK-free confirmation helper in `@iris-mcp/shared`, reached by handlers as an optional `ToolContext.confirm`. When the calling client declares form elicitation, it asks the person after every existing check:
- on the 2026-07-28 era, through an `inputRequired` result;
- on the 2025 era, through the SDK's legacy shim.

The answer is bound to the exact arguments by a signed, single-use `requestState`. A decline or cancel ends the call with the new refusal code `CONFIRMATION_DECLINED`. A client without the capability keeps today's contract byte for byte. The framework also forwards the request `ctx`, and with it the abort signal, down to the HTTP call.

## Boundaries & Constraints

**Always:**
- **The order is fixed (AC 43.3.3, AD-34).** Zod validation, profile resolution, the governance gate and every handler check (bounds, dry run, caps, `confirm: true`, `dryRun: false`, plan gates) run first. The dialog is an additional gate, right before the first IRIS write.
- **Clients without form elicitation are byte-identical (AD-15, Rule #19).** Same requests to IRIS, same result, same audit entry.
  - Every 43.1 golden and 43.2 pin passes with its fixture and assertion lines unchanged.
  - Pre-existing test files change only as Tasks 15–17 list.
- **SDK confinement (AD-2, AD-32).** Only `server-base.ts` and `sdk-wire-compat.ts` import the SDK, and only from `@modelcontextprotocol/server` and `/stdio`. `confirmation.ts` and every handler are SDK-free.
- **Explicit options (Rule #10).** `buildMcpServer` passes `inputRequired: { legacyShim: true, maxRounds: 8, roundTimeoutMs: 600000 }`. The codec TTL is `600` seconds, written out.
- **Capabilities by era.** Read them from `ctx.mcpReq.envelope[CLIENT_CAPABILITIES_META_KEY]` when `instance.server.getNegotiatedProtocolVersion()` is `"2026-07-28"` or later. Otherwise read `instance.server.getClientCapabilities()`. Never read the envelope on a 2025 connection.
- **Integrity.** `requestState` is minted and verified only by the per-process codec (HMAC-SHA256, 32-byte random key). A state that is forged, altered, expired, replayed or bound to other arguments is never honored.
- **Audit.** AD-19 holds: one entry per logical call (decision #14).
- **No new env read or env var.** `startup-env-roster.test.ts` stays green.
- **Closed port only (DW-627).** Every spawned server runs on `127.0.0.1` with a closed or fake-listener port. No live gate is added.
- **Minimal docs ship here (Rule #43).** They are listed in task 18.

**Never:**
- No ObjectScript change. `BOOTSTRAP_VERSION` stays `d51856f74d6a`, and `bootstrap-classes.ts` is out of the diff.
- No new tool, action, governance key, preset row or annotation. No tool description, prompt or `instructions` change (decision #17). Counts stay 110 package tools, 115 advertised (33/27/25/22/8). The baseline stays 141 keys, `1e62c5ad5bf7`.
- No SDK-wide `requestState.verify` hook. It refuses smuggled `requestState` on every `tools/call` with an unaudited `-32602`, and breaks 5 `story-43-2-qa-meta-smuggling` rows (prototype).
- No `ctx.mcpReq.elicitInput`, `fromJsonSchema`, `jsonSchemaValidator` or 3-argument `acceptedContent` in source (decisions #13, #19).
- No dependency, manifest or lockfile change.
- No edit or recapture of either 43.1 golden (Rule #36). Their retirement is DW-639, Story 43.4.
- No log line on the call path. `story-43-2-qa-mixed-eras` pins the stderr lines.
- No `claude` run in the implement, QA or review stages. The lead runs the live check at smoke.
- Nothing 43.4 owns: the capstone, the per-client docs table, the spine Stack rows, the PRD line, DW-639, DW-641, DW-646.

## I/O & Edge-Case Matrix

"Eliciting" means the client declares form elicitation: `elicitation: {}`, `{form: {}}` or `{form: {}, url: {}}`. `{url: {}}` alone does not count. Rows hold on both eras unless the row says otherwise. "Gated call" means a call that reaches `ctx.confirm` (Design Notes, inventory).

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Accept | Eliciting client; gated call; the person ticks Confirm and accepts | One form request: the template message and `CONFIRMATION_SCHEMA`. Then the call runs. IRIS gets exactly one write request; the result equals the no-capability result. One audit entry: `ok`, `confirmation: "accepted"`. Modern: 2 `tools/call` on the wire. Legacy: 1 `tools/call` plus 1 server `elicitation/create`. | none |
| Decline / cancel / unconfirmed | As above; the response is `decline`, `cancel`, or `accept` with `confirm` not `true` | `CONFIRMATION_DECLINED` with `{code, action, response}`, response `decline`, `cancel` or `unconfirmed`. No write request. Never asked again. One entry: `denied`, `denyReason: "CONFIRMATION_DECLINED"`, `confirmation` `declined`, `cancelled` or `unconfirmed`. | in-band refusal |
| Fallback | Client without form elicitation (including v1.29 with `capabilities: {}`) | No dialog. Result, IRIS requests and audit entry byte-identical to the baseline capture (task 0) | today's errors |
| Refused before the dialog | Governance-disabled; `confirm` missing; purge without a bound; `dryRun` not `false`; stale edit; promote gate 1–4 or blank namespace | Today's refusal, byte-identical. No form request reaches the client. | today's errors |
| Smuggled capability (legacy) | A 2025 client that declared no elicitation sends `_meta["io.modelcontextprotocol/clientCapabilities"] = {elicitation: {}}` | Fallback: no dialog, today's contract | none |
| Forged accept | A plain `tools/call` carrying `inputResponses.confirm` = accept with `confirm: true`, and no state or a made-up state (both eras) | Not honored. An eliciting client is asked; a non-eliciting one gets the fallback. | none |
| Arguments changed (modern, raw wire) | Round 2 carries round 1's valid state and an accept, but different `arguments` | Asked again for the new arguments, with a new state. No write. | none |
| Tampered / replayed / expired state (modern) | One byte changed; an already used state; or the TTL of 600 s passed | Asked again. Never runs on that state. No wire error. | none |
| Valid decline, capability dropped (modern) | Round 2 has a valid state and a decline, and its envelope declares no elicitation | `CONFIRMATION_DECLINED`: a valid answer is honored before the capability check | in-band |
| `resendFiltered` preflight | Eliciting; `dryRun: false`, `confirm: true` | First a read-only POST with the same filters and `dryRun: true`, no `confirm`. If `1 <= matchCount <= maxMessages`, the dialog names the count, window and cap. Otherwise no dialog, and the execute POST is sent as today. | a refused preflight: no dialog, execute as today |
| Unanswered dialog | Modern client never retries; legacy shim leg times out, is cancelled or fails | Nothing changes and no audit entry is written (known limit, decision #14) | SDK-owned text |
| Cancelled call (DW-642) | `notifications/cancelled` while the call's IRIS request is in flight | The request is aborted: the listener sees its connection close before the reply. No answer goes out. One entry: `error`, `error` = `CANCELLED_CALL_TEXT`. | none |
| Cancelled before the request | The signal is already aborted when the handler calls IRIS | No request reaches IRIS. The HTTP client rejects with `IrisConnectionError` code `CANCELLED`. | none |
| In-process callback / stub ctx | `registerToolOn` callback, or the owned handler with a hand-made ctx | No `confirm` and no signal binding: exactly today's behavior | none |

</intent-contract>

## Code Map

Line numbers are at HEAD `87bf941`.

**Framework: `packages/shared/src/server-base.ts`**
- **Imports, 15–26.** Add `inputRequired`, `inputResponse`, `isInputRequiredResult`, `createRequestStateCodec` and `CLIENT_CAPABILITIES_META_KEY`, plus the types `InputRequiredResult` and `ServerContext`. All are exported by the package index (`index.d.mts:809`).
- **`ToolCallSource`, 263:** `"callback" | "wire"`.
- **`buildToolContext`, 331–380.** It is positional. Do not add a member here: `resolve-profile-client.test.ts:171-180` pins its exact keys.
- **`buildMcpServer`, 802–839.** It builds `new McpServer({name, version}, {capabilities, instructions, debouncedNotificationMethods})`. The new `inputRequired` option goes here; no `requestState` and no `jsonSchemaValidator`.
- **`installWireHandlers`, 869–879.** `tools/call` is at 874 and takes `(request)` only. The SDK wraps it (`mcp-DIH4cS6P.mjs:1158-1170`), so a `(request, ctx)` callback gets `ServerContext`.
- **`callToolFromWire`, 900–917.** The not-found result, then `handleToolCall(tool, params.arguments, "wire")` at 911, then `checkWireOutput`. `checkWireOutput` (`sdk-wire-compat.ts:83-97`) rejects a result with no `structuredContent` for a tool with an `outputSchema`.
- **`registerToolOn` callback, 1424–1426:** `async (args) => this.handleToolCall(tool, args)`, in-process and test-only.
- **`handleToolCall`, 1513–1550.** `checkWireInput` on the wire path, then `dispatchToolCall`, then `recordAuditEntry` inside a try/catch.
- **`dispatchToolCall`, 1562–1904.**
  - Steps: Zod (1592), strip `server` (1621), `resolveProfile` (1644–1670), the governance gate (1696–1762; `refusalResult(GOVERNANCE_DISABLED, …)` at 1751), the discovery short-circuit (1777–1811), `getOrCreateClient` (1822–1843), `buildToolContext` (1868–1880), handler (1883).
  - The rebuild at 1884–1894 keeps `content`, `isError` and `structuredContent` only.
  - `resolveProfileClient` closure: 1858–1866.
- **`recordAuditEntry`, 1932–1987:** `denyReason` is the result's `structuredContent.code` when the outcome is `denied`.
- **`deriveAuditOutcome`, 2099–2106:** `denied` for `GOVERNANCE_DISABLED` only.
- **`getOrCreateClient`, 2671:** one cached `IrisHttpClient` per profile, shared by concurrent calls (`profiles.ts:712-720`). So a signal must travel per request, never on the client.

**Other shared files**
- **`packages/shared/src/tool-types.ts`:**
  - `ToolContext` 265–344: 7 members, of which `governanceFileConfig?` (343) is the only optional one.
  - `ToolResult` 352–359.
  - `ToolDefinition.handler` 170.
- **`packages/shared/src/http-client.ts`:**
  - `RequestOptions` 19–24 (`headers?`, `timeout?`); verbs 75–114; `ensureCsrfToken` 128–132, which calls `headRequest("/api/atelier/")` with no options.
  - `executeFetch` 170–301: the controller at 179, the timer at 181, `fetch` `signal` at 239, the timer cleared at 243, the 401 retry at 257–260 (reuses `options`), and the abort→TIMEOUT mapping at 273–283. `destroy` is at 496.
- **`packages/shared/src/errors.ts:15-27`:** `IrisConnectionError(code, message, suggestion)`, whose message is `${message}. ${suggestion}.`
- **`packages/shared/src/refusals.ts:15-36`:** 10 codes.
- **`packages/shared/src/audit.ts`:**
  - `AuditOutcome` 132; `AuditEntry` 201–219; `log()` 273–307.
  - `outcome` keeps `ok`/`error`/`denied`.
- **`packages/shared/src/index.ts`:** `refusals` 48–49, tool types 90–100, `IrisHttpClient` and `RequestOptions` 21–22.
- **`packages/shared/src/storage-guard.ts:50`:** `droppedStorageDefinitions(current, proposed): string[]`.

**Sibling to extend (Rule 2):** `packages/iris-dev-mcp/src/tools/env-promote.ts:415-442`. `sortKeysDeep` and `computePlanHash` give SHA-256 over key-sorted JSON. Move the algorithm into shared as `contentHash`; `computePlanHash` stays exported and becomes `return contentHash(diff)`.

**Gate call sites**
- **`packages/iris-admin-mcp/src/tools/audit.ts` (purge).**
  - The `confirm !== true` refusal is at 298–306 and the bounds check at 316–338. The body is built at 370–385 and POSTed at 396 to `/api/executemcp/v2/security/audit` (`BASE_URL` 45, path 224).
  - Filters: `begin`, `end`, `user`, `event`, `source`, `type`.
- **`packages/iris-dev-mcp/src/tools/env-promote.ts` (`executeAction`, 990).**
  - Gates 1–4 run at 994–1149. Profile clients are resolved at 1151–1169; `srcNs`/`targetNs` at 1171–1173; the blank-namespace refusal at 1180–1185. The first write follows at 1187 (`const executed`).
  - `orderedAllowed` (1103) items carry `index`, `domain`, `operation` and `subject`.
- **`packages/iris-dev-mcp/src/tools/doc-edit.ts` (handler, ~500–590).**
  - Steps: `ns` 507, the one GET 518, range 535, stale 538, apply 541, the Storage check for `apply` only 543–546, the unchanged branch 548–570, the PUT with `If-None-Match` 576–580.
  - Uses `isClassDocument`.
- **`packages/iris-interop-mcp/src/tools/production.ts`.**
  - The body is built at 197–203 and POSTed to `/interop/production/control` (205–208).
  - The IRIS check `killAppData && 'confirm` is at `src/ExecuteMCPv2/REST/Interop.cls:368-377` (read-only reference).
- **`packages/iris-interop-mcp/src/tools/message-resend.ts`.**
  - `resend` 542–567 (`headerIds` check 543); `resendFiltered` 569–616 (the body 579–589, the POST 591, the `dryRun === true` branch 597–612).
  - The IRIS guard order is in `MessageResend.cls:584-650`: (e) `dryRun`/`confirm` → COUNT → (d) cap → (f) production running → `TOP maxMessages`.

**SDK 2.3.1 (read-only), under `node_modules/.pnpm/@modelcontextprotocol+server@2.3.1/node_modules/@modelcontextprotocol/server/dist/`**
- **`createMcpHandler-D4NN8WsG.d.mts`:**
  - `BaseContext.mcpReq` 2111–2215: `envelope` 2143, `inputResponses` 2155, `requestState` 2179, `signal` 2183.
  - `ServerOptions.inputRequired` 2872–2891; `requestState` 2931.
  - `getClientCapabilities` 3074; `getNegotiatedProtocolVersion` 3096.
  - The `inputRequired` builder 1422–1486; `inputResponse` 1519–1542; `InputRequiredResult` 706–712.
- **`index.d.mts:358-460`:** `createRequestStateCodec({key, ttlSeconds, bind}) → {mint(payload, ctx?), verify(state, ctx)}`. `verify` throws `malformed`, `mac`, `expired` or `bind`.
- **`mcp-DIH4cS6P.mjs`:**
  - `_invokeInputRequiredCapableHandler` 1190–1235 (the modern capability check, which gives `-32021`).
  - `LegacyInputRequiredShim` 798–957 (with `validateAcceptedContent: false` at 1027–1028).
  - Default validator 1044.

**Test harness to extend (pre-existing; additive only)**
- **`packages/shared/src/__tests__/sdk-wire-compat.test.ts`:**
  - the mock at 25–36; `boot()` at 216–238, whose `Client` options are only `{versionNegotiation}` at 230, registered before `connect` at 235;
  - `startRaw` at 711–740; DW-649's rows at 541–566;
  - the `describe("Story 43.2: …")` block at 668.
- **`packages/iris-mcp-all/src/__tests__/process-gate-helpers.ts`:** `SdkClient` 224–245, `WireSessionOptions` 272–285, `connectSdkClient` 293–328 (the cast is at 299–301 and the `new Client` at 322–325), `openWireSession` 334–350, `openAuditedSession` 817–834. 40 files use them.
- **`packages/iris-mcp-all/src/__tests__/story-43-2-qa-hand-wire.ts`:**
  - `HandWire` 61–80: `send`, `sendRaw`, `request`, `response`, `stdout`, …; `response()` ignores lines with a `method`.
  - Also `startHandWire` 85, `handEnv` 178, `startRig` 212, `modernCall` 298, and `MINIMAL_META`/`EXAMPLE_META` 37/43 (`clientCapabilities: {}`).
- **`packages/iris-mcp-all/src/__tests__/story-43-2-qa-concurrency-cancel.test.ts`:** `holdingProxy` 55–114 (`replied` counts `res` close at 96–98), `untilReplied` 147–153, and the cancel rows 241–302. No row asserts the audit or the IRIS request of a cancelled call.
- **`scripts/lib/fake-iris-listener.mjs`:** `route()` 61–163 is a closed table that answers unknown paths with 404. Only the 43.1/43.2 files use it, and the handler golden calls no write route.
- **`scripts/lib/sdk-handler-golden-core.mjs`:** `readBootstrapVersion` 91, `normalizeAuditEntry` 99, `settledAuditEntries` 116.
- **`packages/shared/src/__tests__/test-helpers.ts:108-136`:** `createMockCtx`.
- **The per-gate unit files**, whose fixtures are local to each file: `iris-admin-mcp/src/__tests__/audit.test.ts`, `iris-dev-mcp/src/__tests__/env-promote-execute.test.ts` (`fourStepDiff` 81), `iris-dev-mcp/src/__tests__/doc-edit.test.ts`, `iris-interop-mcp/src/__tests__/production.test.ts`, `iris-interop-mcp/src/__tests__/message-resend.test.ts`.

**Shared assertions this story moves**
- `packages/shared/src/__tests__/refusals.test.ts:45-58`: the exact sorted key list, which gains one key.
- `story-38-3-qa-doc-claims.test.ts:372-381`: a catalog code appears quoted only in `refusals.ts`, so call sites use `REFUSAL_CODES.CONFIRMATION_DECLINED`.
- `story-38-6-doc-claims.test.ts:103` and `story-40-4-doc-claims.test.ts:205`: README refusal-table rows; a new row is safe.

**Docs**
- `README.md`: the refusal table at 476–488; the gate rows at 578, 593, 606 and 640.
- `packages/shared/README.md:100-102`: the `REFUSAL_CODES` bullets.
- Package READMEs: `packages/iris-admin-mcp/README.md:242`, `packages/iris-dev-mcp/README.md:238`, `:427`, `packages/iris-interop-mcp/README.md:157`, `:302`, `:435`.
- `CHANGELOG.md`: top entry.
- `.changeset/story-43-2-serve-2026-07-28.md`: the format to follow.

## Tasks & Acceptance

**Execution:**
0. **Baseline oracle, first, before any source edit (Rule #36).**
   - Add the fake-listener routes (task 15).
   - Build all packages at the baseline revision.
   - With a scratch script in an OS temp dir, capture the no-capability result of each stdio-tested gate call from the baseline dists. Capture the executing call and the refused call (Design Notes, "Fallback captures").
   - The captured lines become literals in task 13's fallback rows, and the test header cites the capture command and revision.
1. `packages/shared/src/confirmation.ts` (NEW, SDK-free; `node:crypto` only). It holds:
   - `CONFIRMATION_INPUT_KEY = "confirm"`, `CONFIRMATION_SCHEMA`, `CONFIRMATION_STATE_TTL_SECONDS = 600` and `CANCELLED_CALL_TEXT`;
   - `confirmationMessage(request, server)`, which renders the template;
   - `declaresFormElicitation(capabilities)`;
   - `contentHash(value)`;
   - `ConfirmationState` with `isConfirmationState`;
   - `ConfirmationNonces` (single-use, pruned by expiry);
   - `classifyConfirmationResponse(view)`, which maps a `{kind, action, content}` view to `accepted`, `decline`, `cancel`, `unconfirmed` or `missing`;
   - `confirmationDeclinedResult(actionKey, operation, response)`, built on `refusalResult`.

   Exact texts are in Design Notes. Rationale: one helper, testable without the SDK (AD-34, AD-32).
2. `packages/shared/src/tool-types.ts`: add `ConfirmationRequest {operation; target; scope: string | (() => Promise<string | undefined>)}` and `ConfirmationOutcome = {proceed: true} | {proceed: false; result: ToolResult}`, plus the optional `ToolContext.confirm?(request): Promise<ConfirmationOutcome>`. It is optional so `createMockCtx` and the literal contexts still compile.
3. `packages/shared/src/refusals.ts`: add `CONFIRMATION_DECLINED`, with a doc line.
4. `packages/shared/src/audit.ts`: add `AuditEntry.confirmation?` and `AuditEntryInput.confirmation?`, typed `"accepted" | "declined" | "cancelled" | "unconfirmed" | "unanswered"` (`unanswered` per lead decision #14, task 6b). `log()` writes it last, only when it is present. This is additive under AD-19.
5. `packages/shared/src/http-client.ts` (DW-642):
   - `RequestOptions.signal?: AbortSignal`.
   - In `executeFetch`:
     - an already aborted signal throws `IrisConnectionError("CANCELLED", \`Request ${method} ${path} was cancelled by the client\`, "No answer is expected for a cancelled call")` before `fetch`;
     - otherwise one `abort` listener aborts the controller, and it is removed wherever the timer is cleared (headers received or catch);
     - in the catch, an aborted caller signal maps to that CANCELLED error before the TIMEOUT branch.
   - Do not use `AbortSignal.any` (it needs Node 20.3 or later; the root `engines` field is `>=18`).
   - `ensureCsrfToken(options)` passes `options` to its HEAD.
   - Add an exported `bindSignal(client, signal): IrisHttpClient`. It is a Proxy that merges `{signal}` into the options of `get`, `post`, `put`, `delete` and `head`, and delegates every other member bound to the target.
6. `packages/shared/src/server-base.ts`:
   - **Codec and nonces.** Add the per-process fields `confirmationCodec = createRequestStateCodec({key: randomBytes(32), ttlSeconds: 600})` and `confirmationNonces`.
   - **SDK options.** `buildMcpServer` passes the explicit `inputRequired` options.
   - **Context forwarding.** The `tools/call` callback becomes `(request, ctx) => this.callToolFromWire(request.params, {instance, ctx})`. Define `WireCall = {instance, ctx, confirmation?, pending?}`.
   - **`callToolFromWire`.** It returns `isInputRequiredResult(result) ? result : checkWireOutput(...)`.
   - **`handleToolCall(tool, rawArgs, source, wireCall?)`:**
     - an input-required result returns with NO audit entry;
     - if `wireCall.ctx.mcpReq.signal` is aborted, the entry is recorded for the result `toolErrorResult(CANCELLED_CALL_TEXT)`;
     - otherwise it records as today, plus `confirmation`.
   - **`dispatchToolCall(tool, rawArgs, wireCall?)`.** After `buildToolContext`, and only when `wireCall` is present:
     - `ctx.http = bindSignal(ctx.http, signal)` when there is a signal;
     - `resolveProfileClient` results are bound the same way;
     - `ctx.confirm = (request) => this.confirmOnWire(...)`.
     
     After the handler, if the result is `CONFIRMATION_PENDING` and `wireCall.pending` is set, return `wireCall.pending`; this check comes before the rebuild.
   - **`confirmOnWire`.** It follows the Design Notes decision order exactly.
   - **`deriveAuditOutcome`.** `CONFIRMATION_DECLINED` gives `denied`.
   - **`registerToolOn`'s in-process callback** stays `handleToolCall(tool, args)` with no `wireCall`; only its type follows the widened return. That path never gets `confirm` or a bound signal.
   - **Doc comments** state the contract only (Rule 14).
6b. `packages/shared/src/server-base.ts`: the pending-ask map. This is the #14 alternative, taken by the lead at the spec gate so AD-19's one entry per call also covers a dialog nobody answers.
   - **On the asking round,** record `{tool, action, profile, args, start}` under its nonce in a per-process map, and write no entry.
   - **On the deciding round** (accepted, declined, cancelled or unconfirmed), write the one entry and delete the map entry.
   - **When a dialog is never answered.** An unref'd sweep timer, or `stop()` before the audit shutdown, writes every ask still pending after its 600 s TTL as one entry: `outcome: "error"`, `error: "The confirmation dialog was not answered. Nothing was changed."`, `confirmation: "unanswered"`. That covers a modern client that never retries, and a legacy shim leg that times out, is cancelled or fails.
   - **Argument values** are never logged, exactly as for any other entry. `paramKeys` follows the existing rules.
   - **Tests:** fake-timer unit rows for the TTL sweep and for `stop()`. Over real stdio on each era, one row where the dialog is never answered and the process is stopped: exactly one `unanswered` entry, and no IRIS write.

   Missing ctx, `mcpReq`, `signal` or envelope are all normal (the stub contexts).
7. `packages/shared/src/index.ts`: export `contentHash`, plus the types `ConfirmationRequest` and `ConfirmationOutcome`.
8. `packages/iris-admin-mcp/src/tools/audit.ts`: for `purge`, after the bounds check and before the POST, call `ctx.confirm?.(…)` with the purge strings, and return `result` when it does not proceed.
9. `packages/iris-dev-mcp/src/tools/env-promote.ts`:
   - `computePlanHash` delegates to `contentHash`; drop the local `sortKeysDeep` if nothing else uses it. Existing plan-hash tests stay green, unchanged.
   - `executeAction` calls `ctx.confirm?.(…)` after the blank-namespace refusal and before the first write.
10. `packages/iris-dev-mcp/src/tools/doc-edit.ts`: for `action === "regenerateStorage"`, after the unchanged branch and before the PUT, call `ctx.confirm?.(…)`. The scope names `droppedStorageDefinitions(lines, applied.lines)` for a class document, and is "drops no Storage definition" otherwise.
11. `packages/iris-interop-mcp/src/tools/production.ts`: when `action === "clean" && killAppData === true && confirm === true`, call `ctx.confirm?.(…)` before the POST. Any other `clean` call is unchanged, because IRIS still refuses `killAppData` without `confirm`.
12. `packages/iris-interop-mcp/src/tools/message-resend.ts`:
    - **`resend`:** `ctx.confirm?.(…)` after the `headerIds` check.
    - **`resendFiltered`:** when `dryRun === false && confirm === true`, pass `scope` as a function. The function POSTs the preflight: the same body, `dryRun: true`, no `confirm`.
      - It returns the scope string when `1 <= matchCount <= maxMessages`, using the preflight's `matchCount`, `status`, `from`, `to` and `maxMessages`.
      - It returns `undefined` when the preflight throws or the count is outside that range.
    - The execute POST is unchanged.
13. `packages/iris-mcp-all/src/__tests__/story-43-3-confirmation-both-eras.test.ts` (NEW, default suite; fails, never skips, on a stale dist).
    - **Setup.** The built admin, interop and dev dists over real stdio, through `connectSdkClient`, with `versionNegotiation` `{mode: "legacy"}` and `{pin: "2026-07-28"}`. A fake listener and an `IRIS_AUDIT_LOG` in an OS temp dir. `IRIS_GOVERNANCE` enables the gated writes.
    - **Gates:** purge; `clean`+`killAppData`; `resendFiltered`; `resend`; `regenerateStorage`.
    - **Per era and gate:**
      - accept, decline, cancel and unconfirmed: the elicitation request's message and schema, the result, the listener's write requests, and the audit entries;
      - no capability: equal to the task 0 literals;
      - the refused-first rows.
    - **`resendFiltered` extra rows:** over the cap and zero matches.
    - **Integration (Rule 1).** It covers the matrix rows Accept, Decline/cancel/unconfirmed, Fallback, Refused before the dialog, and `resendFiltered` preflight.
14. `packages/iris-mcp-all/src/__tests__/story-43-3-confirmation-raw-wire.test.ts` (NEW, default suite; uses the hand-wire driver against the built admin dist).
    - **v1.29-era client.** Literal lines from Design Notes ("v1.29 oracle"): accept, decline and cancel each send exactly that response line, and `capabilities: {}` gets the fallback.
    - **Legacy:** a smuggled capability, and a forged accept.
    - **Modern raw:** arguments changed, a tampered state, a replayed state, a forged accept with no state, and a valid decline with the capability dropped.
15. Test helpers, all additive:
    - **`scripts/lib/fake-iris-listener.mjs`.** New routes, each reply a function of the request alone (Design Notes). No existing route changes.
    - **`process-gate-helpers.ts`.** `WireSessionOptions` gains `clientCapabilities?` and `onElicitation?`.
      - `connectSdkClient` passes `capabilities` only when given, so every existing session's `initialize` is byte-identical.
      - It registers `client.setRequestHandler("elicitation/create", …)` before `connect` only when elicitation is declared.
      - The cast type gains `setRequestHandler`.
    - **`story-43-2-qa-hand-wire.ts`.** `HandWire` gains `untilLine(predicate, timeoutMs = 10000)`, which resolves with the first stdout line, past or future, that matches.
16. `packages/shared/src/__tests__/sdk-wire-compat.test.ts`:
    - **DW-649.** Each of the three `setTimeout(50)` waits at 541–566 is replaced. The two "exactly one" rows await `nextListChanged()` (a new `Booted` member that resolves on the next notification), then one `client.listTools()` round trip. The "nothing" row does only the round trip. No `expect` line changes.
    - **`boot()`** gains an optional client-options parameter: `capabilities` and an elicitation handler.
    - **A new `describe("Story 43.3: confirmation through elicitation")`.** It uses a test-only write tool that calls `ctx.confirm` and counts its executions. Rows, on both eras in memory:
      - accept, decline, cancel and unconfirmed;
      - fallback; governance first;
      - expired state, on the modern era through `startRaw`, moving `Date` past 600 s between rounds (if the codec's clock cannot be faked, pin expiry by calling the codec directly and record why);
      - replay, through `startRaw`;
      - one audit entry per logical call;
      - the stub ctx;
      - a pre-aborted signal reaches no `fetch`.
17. Unit tests:
    - **NEW `packages/shared/src/__tests__/confirmation.test.ts`:**
      - message rendering, as the exact strings, including scope truncation;
      - `declaresFormElicitation` for `{}`, `{form:{}}`, `{form:{},url:{}}`, `{url:{}}`, undefined and a non-object;
      - `contentHash`: key order is ignored, a value change is detected, and it equals `computePlanHash` on the `fourStepDiff` fixture shape;
      - `classifyConfirmationResponse`, over the full table;
      - nonce single-use and pruning;
      - `confirmationDeclinedResult`, as exact shapes.
    - **NEW `packages/shared/src/__tests__/http-client-signal.test.ts`:**
      - pre-aborted: no `fetch`, error code `CANCELLED`;
      - aborted in flight: the `fetch` signal is aborted, CANCELLED, and the listener is removed;
      - a timeout is still TIMEOUT;
      - `bindSignal` merges options and keeps `namespace`.
    - **`refusals.test.ts`:** the exact list gains `CONFIRMATION_DECLINED`.
    - **Per gate,** a new `describe("Story 43.3: confirmation")` appended to each of the five gate unit files, reusing that file's fixtures. Each covers:
      - `confirm` is called once, with the exact request, after the existing checks;
      - it is not called when an existing check refuses;
      - a declined outcome is returned unchanged, with no write call;
      - `{proceed: true}` writes as today;
      - no `ctx.confirm` writes as today.
    - **`story-43-2-qa-concurrency-cancel.test.ts` (DW-642, additive):**
      - `holdingProxy` counts held connections that close before release, and its `release()` skips a closed response;
      - new rows on both eras: a cancelled held call closes its connection before release, and its audit entry is `{tool: "iris_doc_get", outcome: "error", error: CANCELLED_CALL_TEXT}` (the text as a literal);
      - the header comment states the new contract.
    - **NEW `packages/iris-mcp-all/src/__tests__/story-43-3-validator-unreachable.test.ts` (DW-637 tripwire).** No non-comment line of non-test source under `packages/*/src` and `extensions/*/src` references `elicitInput`, `fromJsonSchema` or `jsonSchemaValidator`, or calls `acceptedContent(` with three arguments (comment handling as in `story-38-3-qa-doc-claims.test.ts:372-381`). A self-check proves the pattern matches each form and ignores the same words in a comment.
18. Docs (Rule #43; AD-29 `patch`):
    - **`README.md`.** A new subsection "Human confirmation (elicitation)" in the governance and safety part. It covers:
      - which six gates ask;
      - the order;
      - the fallback;
      - decline, cancel and unconfirmed giving `CONFIRMATION_DECLINED`, never re-asked;
      - arguments changed means asked again;
      - the Claude Code `Elicitation` hook as the user's choice: an auto-answer removes the person;
      - headless `claude -p`: a hook answers; with `--permission-prompts none` an unanswered dialog is cancelled;
      - the known limits.

      Also a `CONFIRMATION_DECLINED` row in the refusal table, and the audit `confirmation` field with `denied`/`denyReason`.
    - **`packages/shared/README.md`:** the `REFUSAL_CODES.CONFIRMATION_DECLINED` bullet, `ToolContext.confirm` and `RequestOptions.signal`.
    - **Each gate's package README:** one line at the cited rows.
    - **`CHANGELOG.md`:** a top entry for Story 43.3, with Added (AD-15 sanctioned: the dialog, AD-34), Unchanged, Known limits, and Security (DW-637).
    - **NEW `.changeset/story-43-3-human-confirmation.md`:** `patch` for `@iris-mcp/shared` and the five servers.

**Acceptance Criteria:**
- **AC 43.3.1 (inventory).** **Given** the inventory table in Design Notes (exhaustive as of 2026-10-20; 110 package tools), **when** a reviewer asks what is missing, **then**:
  - every tool:action that has a `confirm`, `force`, `killAppData`, `dryRun`, `allowStorageRegeneration`, `ignoreConflict`, `overwrite` or `allowWide` parameter, or `destructiveHint: true`, is covered by a named row or by the grouped row, with a verdict;
  - exactly the six "gate" rows call `ctx.confirm`: `grep -rn "ctx.confirm" packages/iris-*-mcp/src --include=*.ts` outside `__tests__` finds six call sites (purge, execute, regenerateStorage, clean, resend, resendFiltered) and no other.
- **AC 43.3.2 (helper).** **Given** an eliciting client on either era, **when** a gated call passes its checks, **then**:
  - the client receives one form request whose message is the template with the gate's operation, target and scope, and whose schema equals `CONFIRMATION_SCHEMA`;
  - an accept with `confirm: true` runs it;
  - a decline, cancel or unconfirmed accept returns `CONFIRMATION_DECLINED` and is never asked again;
  - a client without form elicitation gets the baseline result byte for byte.
- **AC 43.3.2 (era).** **Given** a 2025 client that declared no elicitation, **when** its request's `_meta` claims `clientCapabilities.elicitation`, **then** no dialog is sent, and the result equals the fallback.
- **AC 43.3.3 (order).** **Given** each "Refused before the dialog" input, **when** it runs on an eliciting client, **then** the client's elicitation handler is never called, and the result is today's, byte-identical.
- **AC 43.3.4 (binding).** **Given** a modern round-2 retry, **when** its state is forged, tampered, expired, already used, or bound to other arguments, **then** the call does not run, and the client is asked again. A valid state with a decline is honored even when the retry drops the capability.
- **AC 43.3.5 (tests).** **Given** tasks 13, 14 and 16, **when** they run in the default suite, **then** accept, decline, cancel, fallback, changed arguments and the v1.29-era client pass on both eras, through the real SDK client over `serveStdio` (and the hand-wire for raw cases).
- **AC 43.3.5 (live).** **Given** the lead's procedure (decision #20), **when** it runs at smoke, **then** the record shows:
  - the dialog was asked (hook event) and the accept executed (one write);
  - the decline refused (no write);
  - what headless `claude -p` does with no hook.
- **AC 43.3.6 (catalogue).** **Given** the finished story, **when** `pnpm gen:governance-baseline:check` and `pnpm gen:tools-list-snapshot:check` run, **then** both report OK and unchanged; tool counts stay 110/115; no description, annotation or key changes.
- **AC 43.3.6 (docs).** **Given** the finished docs, **when** a reader opens `README.md` and each gated tool's package README, **then** they say that clients supporting elicitation ask the person for the six gates, state the fallback (today's contract), state that a Claude Code `Elicitation` hook can auto-answer and that this is the user's choice, and list `CONFIRMATION_DECLINED` in the refusal table.
- **Release bookkeeping (AD-15, AD-29).** **Given** the story's commit, **when** a reviewer reads `CHANGELOG.md` and the changeset, **then**:
  - they name the dialog as the AD-15 sanctioned change for elicitation-capable clients (AD-34), the unchanged fallback, the known limits and the DW-637 verdict;
  - the changeset is `patch` for `@iris-mcp/shared` and the five servers.
- **DW-642.**
  - **Given** a call cancelled while its IRIS request is held, on each era, **when** the cancel arrives, **then** the held connection closes before release, no answer is sent, and the audit entry has `outcome` `error` with `CANCELLED_CALL_TEXT` (never `ok`).
  - **Given** a signal that is already aborted, **when** a handler makes its IRIS request through the bound client, **then** `fetch` is never called and the request rejects with code `CANCELLED`.
- **DW-649.** **Given** the three rows, **when** `sdk-wire-compat.test.ts` runs 25 times in a row, **then** every run is green. The "exactly one" rows go red on a double-notify mutation in every run.
- **DW-637.** **Given** the verdict in Design Notes, **when** the tripwire test runs, **then** it is green, and it goes red when any source file adds an `elicitInput(` call.
- **Integration (Rule 1).** **Given** `iris_audit_manage` in the built admin dist (consumer of `ctx.confirm`), **when** an eliciting SDK client calls `purge` with one bound on each era, **then** the client's handler receives one form request naming the purge and the bound, and the fake IRIS records exactly one purge POST after an accept and none after a decline.
- **Back-compat (Rule #19).** **Given** the finished story, **when** `git diff <baseline_revision>` runs over `packages/*/src/__tests__`, `packages/iris-mcp-all/src/__tests__` (and `fixtures/`), `extensions/iris-mcp-launcher/src/__tests__` and `scripts/lib`, **then**:
  - the only pre-existing files that change are the eleven named in tasks 15–17;
  - the only removed or changed assertion line is `refusals.test.ts`'s key list;
  - DW-649's rows lose only their sleep lines;
  - both goldens and every fixture JSON are byte-unchanged.

## Spec Change Log

- 2026-10-20 (lead spec gate): decisions #12, #13, #15–#18 and #20 were taken as recommended.
  - **#14:** the lead took the ALTERNATIVE (the pending-ask map, so an unanswered dialog gets its one `error`/`unanswered` entry). This adds task 6b and the `unanswered` value in task 4.
  - **#19:** the verdict and tripwire stay in this story, as planned. The residual (bump the SDK when a release pins fast-uri ≥ 3.1.8) routes DW-637 to 42.1 at the lead's adjudication, not as `wontfix-accepted`.
  - **`epics.md`:** AC 43.3.6 is amended (the descriptions move to 43.4, per #17), a matching bullet is added under 43.4, and a DW-637 bullet under 42.1.
  - **Spine:** AD-3 (`confirm` in the handler list), AD-19 (logical calls, the unanswered dialog, decline as `denied`, cancel as `error`) and AD-34 ("As built": the six gates, the helper, binding, order).

## Review Triage Log

## Design Notes

**Governing architecture (Rule 6):**
- **AD-34** governs: one helper, the order, form elicitation through `inputRequired` (modern) and the SDK shim (legacy), outcomes, binding, hooks.
- **AD-32:** SDK confinement, `serveStdio`, and `_meta` never bypassing AD-3.
- **AD-15:** the dialog is sanctioned, and clients without elicitation stay byte-identical.
- **AD-17:** caps and dry run stay first.
- **AD-3:** the chokepoint order is unchanged. The new `ToolContext.confirm` member needs a Rule-20 amendment to AD-3's "What handlers may use" list.
- **AD-19:** one entry per logical call; a decline is `denied`; the `confirmation` field is additive.
- **AD-2:** the cross-package tests live in `iris-mcp-all`.
- **AD-4:** no new key; `mutates` is unchanged.
- **AD-7:** visibility is unchanged.
- **AD-23:** stdio only.
- **AD-29:** `patch`.
- **Conventions:** Refusals (one catalog code, `isError`, changes nothing), Error text, Logging.

**Plan-stage evidence (2026-10-20).** No IRIS was contacted, the repo was not written, and every temp dir was deleted.
- **SDK probe.** A standalone toy server on the installed 2.3.1, mirroring `installWireHandlers` (`setRequestHandler`, `serveStdio`), was driven by the v2 client in pin, auto and legacy modes and by `@modelcontextprotocol/sdk@1.29.0`, installed `--ignore-scripts` in a temp dir.
- **Prototype.** An rsync copy of the repo, patched with tasks 1–8 on `iris_audit_manage` purge, was built and driven by the v2 client against a fake listener.
- **Research.** OSV, the GitHub Advisory DB and the npm bulk API; MCP spec 2026-07-28 and 2025-11-25 at spec commit `3f6e5e17e2`; Claude Code docs and changelog through 2.1.304 (2026-10-19).

**Findings that shape the design:**
- **What crosses the wire.**
  - Modern accept: 2 `tools/call`. Round 1 returns `{resultType: "input_required", inputRequests: {confirm: {method: "elicitation/create", params: {message, requestedSchema, mode: "form"}}}, requestState}`; the retry adds `inputResponses` and the byte-exact `requestState`.
  - Legacy accept: 1 `tools/call`, plus a server `elicitation/create` and its response. The handler runs twice in-process with the same id.
  - Decline and cancel also come back on both eras: as a modern retry, or as the shim's re-entry.
- **Response shapes.** `inputResponse(r, "confirm")` gives `{kind: "elicit", action: "accept", content}`, `{kind: "elicit", action: "decline"}`, `{kind: "elicit", action: "cancel"}`, or `{kind: "missing"}` on round 1.
- **Capability sources.**
  - Modern: the envelope carries exactly what the client declared.
  - Legacy: `getClientCapabilities()` gives the `initialize` capabilities. The envelope is filled from any smuggled `_meta` keys; the shim ignores it.
  - `getNegotiatedProtocolVersion()` is `"2026-07-28"` on modern and `"2025-11-25"` on legacy. `ctx` does not expose the server, so the handler closes over the instance.
- **No capability.** Modern gives `-32021` "Cannot request input 'confirm' (elicitation/create): the request's client capabilities do not declare the required capability". Legacy gives isError text from the shim. So the helper checks the capability itself.
- **Forgery.** A 2025 `tools/call` whose `params` carry `inputResponses` and `requestState` gets them in `ctx` on the FIRST invocation. A toy without state checks accepted with no dialog. With the codec, forgery was refused.
- **The codec.** It is signed, not encrypted, stateless and replayable (a replay was accepted). `bind(ctx)` cannot see params, so the arguments hash goes in the payload and a nonce registry makes the state single-use. A tampered state through the SDK hook gives `-32602 "Invalid or expired requestState"`. That is why the hook is not installed and `verify` is called in the helper.
- **Round limits.** Re-asking forever ends in the client's `INPUT_REQUIRED_ROUNDS_EXCEEDED` after 10 rounds (modern) and the shim's isError after 8 rounds (legacy).
- **Validation.** No server-side content validation runs on either path (the shim passes `validateAcceptedContent: false`), so the helper interprets `content.confirm` itself. ajv is imported eagerly, but its engines are built lazily, only on `getValidator`.
- **Abort.** `ctx.mcpReq.signal` fires within about 3 ms of `notifications/cancelled` on both eras. The prototype's forwarded signal closed the held socket at about 306 ms (the old code ran to 2005 ms and audited `ok`).
- **Audit.** With today's per-round recording, an accepted call writes 2 entries (a false `ok` for the asking round). Skipping input-required rounds gives exactly 1 on both eras.
- **Prototype outcomes.** Accept, decline, cancel, fallback, governance and confirm-missing all held both eras. The shared suite was 2126/2127; the only failure was the `refusals.test.ts` key list. The admin suite was 490/490, and all 668 `story-43*` tests were green once the SDK-wide verify hook was removed.

**Orchestrator decisions (wave 8, numbered from #12).** The plan is built around each recommendation.

- **Orchestrator decision needed #12: the gate inventory and the gated set (AC 43.3.1, Rule #56).** Recommended: gate exactly six:
  - `iris_audit_manage:purge`;
  - `iris_env_promote:execute`;
  - `iris_production_control:clean` with `killAppData: true`;
  - `iris_message_resend:resendFiltered` execute;
  - `iris_message_resend:resend`;
  - `iris_doc_edit:regenerateStorage`.

  The last two have no `confirm` parameter today. They are gated because AD-34's Binds and FR162 (`prd.md:720`) name them, and their fallback is today's contract: governance only. Evidence: the inventory below. Lead actions:
  - AD-15's sanction reads "existing confirmation gates"; this decision reads it as "the AD-34 gate set";
  - record that `iris_doc_put` `allowStorageRegeneration` and `iris_mapping_manage` `force` are candidates (frontmatter `deferred:`).

  Alternative: gate only the four `confirm` gates, and record `resend` and `regenerateStorage` as AD-34/FR162 amendments.

  Inventory, exhaustive as of 2026-10-20. Source: the five `tools/index.ts` (dev 32, admin 26, interop 24, ops 21, data 7 = 110, plus `iris_server_profiles` in each = 115), a grep for `confirm|force|killAppData|dryRun|allowStorageRegeneration|ignoreConflict|overwrite|allowWide`, and every `destructiveHint: true` tool (36: dev 6, admin 12, interop 8, ops 6, data 4).

  | tool:action | Parameter | Verdict | Reason |
  |---|---|---|---|
  | `iris_audit_manage:purge` | `confirm` + a bound | **gate** | TS check `audit.ts:298`; IRIS `Security.cls:2953` |
  | `iris_env_promote:execute` | `confirm` (Gate 1) | **gate** | TS only, `env-promote.ts:994` |
  | `iris_production_control:clean` + `killAppData` | `confirm` | **gate** | IRIS-only check, `Interop.cls:368-377`; TS replicates its precondition |
  | `iris_message_resend:resendFiltered` (execute) | `dryRun:false` + `confirm` | **gate** | IRIS-only check, `MessageResend.cls:592` |
  | `iris_message_resend:resend` | none | **gate** (#12) | AD-34 and FR162; IRIS checks IDs and the production at execute |
  | `iris_doc_edit:regenerateStorage` | none (default-disabled) | **gate** (#12) | AD-34 and FR162; the scope names the dropped Storage |
  | `iris_doc_put` + `allowStorageRegeneration` | the flag | not gated: candidate | not in AD-34; needs an extra GET (`deferred:`) |
  | `iris_mapping_manage:create` + `force` | `force` | not gated: candidate | IRIS decides when the guard applies (`deferred:`) |
  | `iris_production_control:clean` without `killAppData` | none | not a gate | `defaultEnabled` recovery action; transient state only |
  | `iris_production_control:stop/restart` `force` | `force` | not a gate | force-stop on timeout, not a guard override |
  | `iris_sql_execute` | `readOnly`, `maxRowsAffected` | not a gate | caps, not intent (AD-25) |
  | `iris_doc_export` `overwrite`, `iris_doc_put`/`doc_load` `ignoreConflict`, `iris_env_diff` `allowWide` | flags | not a gate | local-disk or version-check overrides, or a read |
  | the grouped row: every remaining `destructiveHint: true` tool:action (of the 36 destructive tools, all except those named above; for example `iris_doc_delete`, `iris_global_kill`, `iris_database_manage:delete`, `iris_namespace_manage:delete`, `iris_user_manage:delete`, `iris_backup_manage:freeze`, `iris_database_action:*`, `iris_docdb_manage:drop`, `iris_process_manage:terminate`) | none | not a gate | no agent-set confirmation exists; protected by governance. An operator "require a human" setting is the recorded out-of-scope candidate |
  | client-config `--confirm-secret`, `--yes`, `--yes-i-mean-it` | CLI flags | out of scope | not MCP tools |

  **What is missing (Rule #56).** The two candidates above. Also, three admin tools annotated non-destructive (`deferred:`), and the Storage guard gaps (`deferred:`).

- **Orchestrator decision needed #13: the helper's contract (AC 43.3.2).** Recommended: the template, schema, outcomes and mechanism below.
  - **Message template** (`confirmationMessage`):
    ```
    Confirm: {operation}.
    Target: {target}
    Scope: {scope}
    Server: {profile} ({host}:{port})
    Tick Confirm and accept to run it now. Decline or cancel to change nothing.
    ```
    - `scope` is cut to 600 characters, then `...` is appended.
    - `profile`, `host` and `port` are the call's resolved profile and its `config`.
    - `operation` never carries a caller value; it is also the refusal text.
  - **`CONFIRMATION_SCHEMA`:** `{"type":"object","properties":{"confirm":{"type":"boolean","title":"Confirm","description":"Tick to confirm this change.","default":false}},"required":["confirm"]}`. Only `content.confirm === true` with `action: "accept"` proceeds.
  - **Per-gate strings:**

    | Gate | operation | target | scope |
    |---|---|---|---|
    | purge | `permanently delete audit-log records` | `the IRIS audit log` | `records matching ` + the supplied non-empty filters as `name=value`, in the order begin, end, user, event, source, type, joined by `, ` |
    | execute | `promote changes to another server` | `server '{target}', namespace {targetNs}` | `{N} step(s) from server '{source}': ` + the first 10 as `#{index} {domain} {operation} {subject}`, joined by `; `, + `; and {N-10} more` when N > 10 |
    | clean + killAppData | `clean the production and wipe its persistent business state` | `namespace {ns}` + `, production {name}` when `name` is given | `all Ens.AppData business state: HL7 sequence numbers, file and FTP done-file tables, batch and control-number state; already-processed data can be ingested again` |
    | resendFiltered | `resend the messages that match a filter` | `item {item}, namespace {ns}` | `{matchCount} message(s) match now (status {status}, from {from} to {to}); IRIS counts again when it runs and resends at most {maxMessages}` (preflight values) |
    | resend | `resend messages by header ID` | `namespace {ns}` | `{N} header ID(s): ` + the first 20 joined by `, ` + ` and {N-20} more` when N > 20, + `; each goes to the head of its queue` when `headOfQueue` is set |
    | regenerateStorage | `save a document without the Storage guard` | `document {name}, namespace {ns}` | `{E} edit(s); drops Storage definition(s): {names joined by ", "}`, or `{E} edit(s); drops no Storage definition` |

  - **Refusal (`confirmationDeclinedResult`).** It is `refusalResult(CONFIRMATION_DECLINED, text, {action: <the call's action key from deriveAuditAction>, response})`. The texts:
    - decline: `The person declined the confirmation for: {operation}. Nothing was changed. Do not repeat this call unless the person asks for it again.`
    - cancel: `The person dismissed the confirmation dialog for: {operation}. Nothing was changed. Do not repeat this call unless the person asks for it again.`
    - unconfirmed: `The person accepted the confirmation dialog for: {operation} without ticking Confirm. Nothing was changed. Do not repeat this call unless the person asks for it again.`
  - **Decision order in `confirmOnWire`:**
    1. Read the raw `requestState()`. Verify it with the codec (any throw means no state). It is valid when it is a `ConfirmationState` with `v === 1`, the same tool, the same `hash`, and an unused nonce. `hash = contentHash({tool, profile, args})`, over the validated arguments including `server`.
    2. If it is valid and `inputResponse(inputResponses, "confirm").kind === "elicit"`, consume the nonce and classify the response:
       - `accepted` (action `accept` and `content.confirm === true`): set `wireCall.confirmation = "accepted"` and return `{proceed: true}`;
       - otherwise: set `wireCall.confirmation` to `declined` (decline), `cancelled` (cancel) or `unconfirmed` (accept without `confirm: true`), and return `{proceed: false, result: confirmationDeclinedResult(actionKey, operation, response)}`.
    3. If the era's capabilities do not declare form elicitation, return `{proceed: true}` (the fallback).
    4. Resolve `scope`. If a scope function returns `undefined`, return `{proceed: true}`.
    5. Otherwise mint `{v: 1, tool, hash, nonce: randomUUID()}`, set `wireCall.pending = inputRequired({inputRequests: {confirm: inputRequired.elicit({message, requestedSchema: CONFIRMATION_SCHEMA})}, requestState})`, and return `{proceed: false, result: CONFIRMATION_PENDING}`.
  - **The same code serves both eras.** On legacy the SDK shim turns `pending` into a real `elicitation/create` and re-enters. On modern the client retries.
  - **Rejected: `ctx.mcpReq.elicitInput` inline on legacy** (the prototype's suggestion: 1 run, every legacy outcome audited). It is deprecated, it contradicts AD-34's Rule ("the SDK's shim on the legacy era") and AC 43.3.2 ("returns an `inputRequired` elicitation"), and it routes content through the bundled ajv (DW-637).
  - **Rejected: an empty-properties schema.** Simpler, but an accept with no content would proceed. The tick makes the confirmation deliberate and mirrors `confirm: true`.
  - **Lead action under Rule 20:** AD-3's "What handlers may use" list gains the optional `confirm`, and AD-34's Rule names the helper (`ToolContext.confirm`, `confirmation.ts`).

- **Orchestrator decision needed #14: `CONFIRMATION_DECLINED` and AD-19.** Recommended:
  - **The code.** A new refusal code in `refusals.ts`. It is not a governance key, has no `mutates` and no preset row, and is documented in the README refusal table and `packages/shared/README.md`. Tool counts stay 110/115 and the baseline 141.
  - **Audit.**
    - One entry per logical call, written by the round that ends it. An input-required round writes none.
    - A decline is `outcome: "denied"`, with `denyReason: "CONFIRMATION_DECLINED"`: a human authority refused before anything changed, which is what `denied` means for governance.
    - The additive `confirmation` field records `accepted`, `declined`, `cancelled` or `unconfirmed`.
  - **Known limit.** A dialog that is never answered writes no entry and changes nothing. That is a modern client that never retries, or a legacy shim leg that times out, is cancelled or fails. Every write still has an entry, because a write runs only in an audited final round.
  - **Alternatives:**
    - `error` for a decline, as other refusals and the PHI policy use;
    - a pending-ask map that closes the gap at more cost. The asking round records `{tool, action, profile, args, start}` under its nonce, and the decision round writes the one entry and deletes it. An unref'd 600 s timer, or `stop()` before the audit shutdown, writes a still-pending ask as `outcome: "error"`, `error: "The confirmation dialog was not answered. Nothing was changed."`, `confirmation: "unanswered"`. About 60 lines and fake-timer tests; take it if the lead reads AD-19's "one entry per call" as covering every asked dialog.
  - **Lead action under Rule 20:** AD-19's Rule defines "call" for a multi-round request as the logical call, with its one entry written by the round that ends it (and states the unanswered-dialog limit, or the alternative), and names `CONFIRMATION_DECLINED` as `denied`. AD-34's Rule names the audit rule.

- **Orchestrator decision needed #15: binding (AC 43.3.4).** Recommended:
  - **The state.** The payload `{v: 1, tool, hash, nonce}` is minted by `createRequestStateCodec({key: randomBytes(32), ttlSeconds: 600})`. The key is per process, and over stdio one process serves every round, including the probe-discard rebuild, because the codec lives on `McpServerBase`. The hash is computed over the tool, the resolved profile and the validated arguments.
  - **Single use.** A `ConfirmationNonces` map of `nonce → expiry` marks a nonce used on the decision round and prunes expired entries.
  - **Outcomes:**
    - forged, malformed, tampered or expired: no state, so the client is asked again (or gets the fallback on a client without the capability);
    - replayed: the nonce is used, so the client is asked again;
    - arguments changed: the hash mismatches, so the client is asked again with a new state for the new arguments;
    - no wire error, nothing runs, no audit entry for the asking round.
  - **Legacy.** The state never leaves the process (probe: 0 occurrences on the wire). Forged `inputResponses` in a plain 2025 call carry no valid state, so they are not honored.
  - **Evidence:** the spec's MRTR text says the server "**MUST** treat `requestState` as an attacker-controlled input … **MUST** protect its integrity (e.g. HMAC or AEAD)", should bind "a digest of its salient parameters", and "**MUST** enforce [single use] server-side" (`/specification/2026-07-28/basic/patterns/mrtr`). The probe showed the replay.
  - **Threat model, for the docs.** The dialog stops the AGENT from proceeding on its own. It is only as strong as the client software, which relays the person's answer. A client or hook that answers by itself removes the person.

- **Orchestrator decision needed #16: the order, and the IRIS-side gates (AC 43.3.3; the epic context's open question).** Recommended: each handler calls `ctx.confirm` immediately before its first IRIS write, after all its own checks.
  - **`clean` + `killAppData`:** TS asks only when `killAppData === true && confirm === true`, exactly IRIS's pass condition. There is no read-only route, so the scope is fixed text.
  - **`resendFiltered`:** on an eliciting client only, a read-only preflight (`dryRun: true`, no `confirm`). IRIS's argument checks (item, from, window, cap range, status) run before guard (e) in both requests, so a refused preflight means the execute is refused identically: no dialog, execute as today.
    - The dialog is shown only for `1 <= matchCount <= maxMessages`.
    - Over the cap or at zero: no dialog, execute as today. IRIS refuses over the cap and resends nothing at zero.
  - **`resend`:** no preflight.
  - **Known limits:**
    - the count can change between the preview and the run; IRIS recounts and never exceeds `maxMessages`;
    - a dialog may be accepted and then refused by IRIS's production-running check, which the dry run skips, or by bad header IDs on `resend`; nothing changes;
    - on modern every round re-runs the handler's checks, and the preflight runs only on asking rounds.
  - **Alternative:** a TS-side production-status read before the dialog. Rejected: it duplicates an IRIS check.

- **Orchestrator decision needed #17: AC 43.3.6, "each gated tool's description".** Recommended: no tool description changes in 43.3. The sentence lands in 43.4 together with DW-639's golden retirement.
  - **Evidence.** The four gated descriptions are raw bytes in the frozen `fixtures/sdk-wire-golden.json` (`main/tools-list` of admin, dev and interop). The golden, which is v1-captured and never recaptured (`story-43-1-sdk-wire-golden.test.ts:16-17`, `:135-141`), goes red on `toBe(row.line)` at `:224-235`, and so does `story-43-2-cross-era-pin` (a) `:278-291` and (d) `:348-357`. No sanctioned-delta mechanism feeds those comparisons. The epic requires those assertion lines unchanged.
  - **Meanwhile:**
    - the README and the per-package READMEs say it;
    - at run time the dialog itself and the `CONFIRMATION_DECLINED` text ("Do not repeat this call unless the person asks for it again") tell the agent.
  - **Lead action:**
    - amend AC 43.3.6 in `epics.md` (apply-and-report is not enough, because it defers part of an AC);
    - add "the gated tools' descriptions name the elicitation dialog" to 43.4 with DW-639, and regenerate the tools-list snapshot there (`pnpm gen:tools-list-snapshot --force`).
  - **Alternative:** a description exception list in the golden tests. Rejected: it changes 43.1 assertion logic.

- **Orchestrator decision needed #18: what a cancelled call records (DW-642).** Recommended:
  - **The audit entry.** `outcome: "error"`, with `error` = `CANCELLED_CALL_TEXT` = `Cancelled by the client before a result was sent. An IRIS request still in flight was aborted; a write IRIS had already received may still have completed.`
  - **Which of DW-642's two pins holds.** Both, each where it can:
    - a cancel that lands before the request never reaches IRIS (pinned in memory and in unit tests);
    - a cancel that lands while the request is in flight aborts it, but IRIS may already have received it, so the pin is "never audited `ok`" (pinned over real stdio, both eras).
  - **Alternative:** a new `cancelled` outcome. Rejected: AD-19 keeps the closed domain.

- **Orchestrator decision needed #19: DW-637.** Recommended: no validator change; record the verdict and add the tripwire (task 17).
  - **Bundled versions** (from the `//#region` markers in `ajvProvider-CEoC__sr.mjs` and its source map): ajv 8.18.0, ajv-formats 3.0.1, fast-uri 3.1.0, fast-deep-equal 3.1.3, json-schema-traverse 1.0.0. Also `@cfworker/json-schema` 4.1.1 and `content-type` 1.0.5 in other chunks. `require-from-string` is not bundled.
  - **Advisories:**
    - ajv: GHSA-2g4f-4pwh-qvx6 is fixed in 8.18.0, and GHSA-v88g-cgmw-v5xw affects <6.12.3. Not affected.
    - ajv-formats, fast-deep-equal, json-schema-traverse, @cfworker, content-type: none. Not affected.
    - **fast-uri 3.1.0: affected by 9.** q3j6-qgpj-74h6, v39h-62p7-jpjc, 4c8g-83qw-93j6, v2hh-gcrm-f6hx, 7p8r-x3mc-p8w7, f65p-4m7j-42xc, jqff-g426-hqxp and qw65-cvwx-89v3 (8 high), and hrr3-gc8f-f4qj (moderate). All are fixed by 3.1.8; the latest is 3.1.9.
  - **Why fast-uri is unreachable.**
    - The advisories need attacker-controlled URLs that are normalized or compared. Inside ajv, fast-uri resolves only schema `$id`/`$ref`, and our schema is a constant. ajv-formats checks `uri` by regex.
    - Our server never invokes the validator: the shim passes `validateAcceptedContent: false`, the modern path does not validate, and source uses no `elicitInput`, `fromJsonSchema` or 3-argument `acceptedContent` (the tripwire keeps it so).
    - A custom validator would not stop the module loading (a static import through `_shims`).
    - The client-side exposure (`callTool` compiling a server's `outputSchema`) is test-only (a devDependency), and our servers declare no `outputSchema`.
  - **Upstream:** issue modelcontextprotocol/typescript-sdk#2966 (open) and PR #2973 (pins fast-uri 3.1.8; open). 2.3.1 is the latest server release.
  - **Lead action:** close DW-637 `wontfix-accepted` with `reopen_if` = an SDK bump, any source use the tripwire names, or a server `outputSchema` compiled client-side outside tests. The CHANGELOG Security line names it.

- **Orchestrator decision needed #20: the live check (AC 43.3.5).** Recommended: the lead runs this procedure at smoke. A leg whose oracle fails takes the failed-smoke path, unless the failure is Claude Code behavior our server cannot change (for example, the hook does not fire for 2026-07-28 input-required elicitations). In that case the lead records it, the README states it, and 43.4's smoke re-checks it.
  - **Hook contract** (code.claude.com/docs/en/hooks#elicitation, read 2026-10-20):
    - The event `Elicitation` is configured under `hooks` in `.claude/settings.json`, and the `matcher` matches the MCP server name.
    - stdin carries `mcp_server_name`, `message`, `mode`, `elicitation_id` and `requested_schema`.
    - To answer: exit 0 and print `{"hookSpecificOutput":{"hookEventName":"Elicitation","action":"accept","content":{"confirm":true}}}`, or `"action":"decline"`. Printing nothing leaves it to the dialog.
    - Hooks run in `-p`, with no extra flag.
    - With `--permission-prompts none`, "Any MCP elicitation request that no Elicitation hook answers is cancelled". With no hook and no flag the behavior is not documented, so it is recorded live.
    - On 2026-07-28 Claude Code declares `elicitation: {form: {}, url: {}}`. Its 2025 declaration is not documented, so it is recorded from the tap.
    - Hooks exist since 2.1.76, and the top-level `decision` fix is in 2.1.284. Latest: 2.1.304.
  - **Procedure.** `<S>` is a scratch dir under the lead's scratchpad. Record `claude --version` (at least 2.1.292). Rebuild all dists first. All files go through the file tools.
    1. `<S>/tap.mjs`: the 43.2 tap, unchanged in contract.
    2. `<S>/hook.mjs <mode> <log>`:
       - it reads stdin and appends it as one line to `<log>`;
       - for `accept` it prints the accept object above, and for `decline` the decline object;
       - for `silent` it prints nothing;
       - it exits 0.
    3. `<S>/leg.mjs <leg>` runs as ONE foreground process:
       - It starts `startFakeIris({bootstrapVersion: readBootstrapVersion(<repo>/packages/shared/dist)})` from the repo's `scripts/lib`.
       - It writes `<S>/mcp-<leg>.json`: one server `iris-admin`, `command: node`, `args: [<S>/tap.mjs, <S>/wire-<leg>, <repo>/packages/iris-admin-mcp/dist/index.js]`, and `env: {IRIS_HOST: "127.0.0.1", IRIS_PORT: <fake port>, IRIS_USERNAME: "qa", IRIS_PASSWORD: "qa", IRIS_NAMESPACE: "HSCUSTOM", IRIS_GOVERNANCE: "{\"global\":{\"iris_audit_manage:purge\":true}}", IRIS_AUDIT_LOG: <S>/audit-<leg>.jsonl}`.
       - For the hook legs it writes `<S>/proj-<leg>/.claude/settings.json` = `{"hooks":{"Elicitation":[{"matcher":"iris-admin","hooks":[{"type":"command","command":"node <S>/hook.mjs <mode> <S>/hook-<leg>.jsonl"}]}]}}`.
       - From `<S>/proj-<leg>` it spawns `perl -e 'alarm 300; exec @ARGV' -- env -u CLAUDECODE [MCP_PROTOCOL_NEGOTIATION=legacy] claude -p --model haiku --max-budget-usd 1 --strict-mcp-config --mcp-config ../mcp-<leg>.json --setting-sources project [--permission-prompts none] --allowedTools mcp__iris-admin__iris_audit_manage --disallowedTools Read,Write,Edit,Bash --output-format stream-json --verbose "Call the iris_audit_manage tool of the iris-admin server exactly once with action purge, end 2026-01-01 00:00:00 and confirm true. Do not call it again. Then reply DONE."`, with stdout to `<S>/<leg>.jsonl`.
       - After the child exits it writes the listener's `requests` to `<S>/requests-<leg>.json`, then closes the listener.
    4. **Legs** (USD 1 cap each, haiku):
       - `modern-accept` (hook `accept`) and `modern-decline` (hook `decline`), with `MCP_PROTOCOL_NEGOTIATION` unset;
       - `legacy-accept` and `legacy-decline`, with `MCP_PROTOCOL_NEGOTIATION=legacy`;
       - `headless-nohook` (no settings file, no flag);
       - `headless-none` (no settings file, `--permission-prompts none`).
    5. **Oracle, accept legs.** First, the tap's opening request shows whether the client declared form elicitation: the modern envelope, or legacy `initialize.params.capabilities`.
       - If it did:
         - `hook-<leg>.jsonl` holds exactly 1 event, with `mcp_server_name` `iris-admin`, a `message` that equals the template (purge strings, `end=2026-01-01 00:00:00`), and `requested_schema` equal to `CONFIRMATION_SCHEMA`;
         - `requests-<leg>.json` holds exactly 1 `POST /api/executemcp/v2/security/audit` whose body has `confirm: true` and that `end`;
         - the stream-json tool result has no `isError`;
         - the audit has exactly 1 `iris_audit_manage` entry, `ok`, with `confirmation: "accepted"`;
         - the tap shows, on modern, 2 `tools/call` (an `input_required` with `requestState`, then a retry with `inputResponses`), and on legacy, 1 `tools/call` plus 1 server `elicitation/create` and its accept.
       - If it did not: 0 hook events, 1 purge POST and an `ok` entry with no `confirmation` (the fallback on a real client). Record it as a finding.
    6. **Oracle, decline legs.**
       - 1 hook event (never 2: no re-ask);
       - 0 purge POSTs;
       - the tool result is `isError` with `structuredContent` `{code: "CONFIRMATION_DECLINED", action: "purge", response: "decline"}`;
       - 1 `denied` entry with `denyReason: "CONFIRMATION_DECLINED"` and `confirmation: "declined"`.
    7. **Oracle, headless legs.**
       - Record what Claude Code did: a cancel gives `CONFIRMATION_DECLINED` with `response: "cancel"`; or a decline; or a hang until the alarm.
       - The leg passes only if there are 0 purge POSTs and no `ok` entry. `headless-none` is expected to show `cancel`, as documented.
    8. **Both eras.** stderr holds the era line. Record `total_cost_usd` per leg.
    9. **Teardown.** Every `leg.mjs` run closes its listener, and `<S>` is deleted.
  - **What proves each leg false:**
    - accept: a declared capability with 0 hook events, a purge count not equal to 1, 2 or more hook events, or an entry without `confirmation: "accepted"`;
    - decline: any purge POST, a result that is not `CONFIRMATION_DECLINED`, or a second hook event;
    - headless: any purge POST, or an `ok` entry.
  - **Safety.** Only the local fake listener is used, never the shared instance. The purge is enabled only in the throwaway `mcp-<leg>.json`.

**Fallback captures (task 0).** Each captured call is sent with no client capability, by both an SDK `legacy` session and a `{pin}` session:
- **purge:** `{action: "purge", end: "2026-01-01 00:00:00", confirm: true}` (executes), and the same without `confirm` (today's error).
- **`clean`:** `{action: "clean", killAppData: true, confirm: true}` (executes), and the same without `confirm` (IRIS refusal via the fake route).
- **`resendFiltered`:** `{action: "resendFiltered", item: "Demo.Item", from: "2026-01-01T00:00:00Z", dryRun: false, confirm: true}` (executes), and with `dryRun` omitted (a preview).
- **`resend`:** `{action: "resend", headerIds: [11, 12]}`.
- **`regenerateStorage`:** an edit on `Demo.Stored.cls` that removes its Storage block.

Record each result line, the listener's request list and the normalized audit entry. The modern capture must equal the legacy one apart from the decision #7 fields (cross-era pin rule).

**Fake-listener routes (task 15).** Each reply is a function of the request alone.
- **`POST /api/executemcp/v2/security/audit`:** `envelope({action: "purge", deleted: 3, success: 1})` when `body.confirm` is true; otherwise `errorEnvelope("ERROR #5001: Parameter 'confirm' must be true to purge audit-log records", 5001)` with HTTP 400.
- **`POST /api/executemcp/v2/interop/production/control`, `action` `clean`:**
  - `killAppData && !confirm`: HTTP 400 with the `Interop.cls:369` text;
  - otherwise `envelope({action: "cleaned", killAppData: !!killAppData})`.
- **`POST /api/executemcp/v2/interop/message/resend`, `action` `resendFiltered`:**
  - **The count** comes from the item: `Demo.Zero` → 0, `Demo.Many` → 600, anything else → 3.
  - **The cap** is `maxMessages`, default 100.
  - **Preview** (`dryRun` absent or true): `envelope({action: "resendFiltered", dryRun: true, matchCount, sample: [], item, status: "Error", from, to: from, maxMessages})`.
  - **Execute:**
    - `!confirm`: the guard (e) text;
    - count over the cap: the guard (d) text;
    - otherwise `envelope({action: "resendFiltered", dryRun: false, matchCount, results: [], summary: {resent: matchCount, failed: 0}})`.
  - Use the exact `MessageResend.cls` texts, wrapped as `ERROR #5001: `.
- **`POST /api/executemcp/v2/interop/message/resend`, `action` `resend`:** `envelope({results: [], summary: {resent: headerIds.length, failed: 0}})`.
- **`Demo.Stored.cls`:**
  - a GET of `doc/Demo.Stored.cls` returns a class with one `Storage Default` block;
  - a `PUT doc/Demo.Stored.cls` returns `envelope({name, ts: "2026-01-02 00:00:00.000", status: "", content: []})` with HTTP 200;
  - a HEAD returns its ETag.

Match the shapes the TS handlers parse, read from the handler source; the implement stage adjusts field names to what the handlers read.

**v1.29 oracle (probe, `@modelcontextprotocol/sdk@1.29.0` with zod 3.25.76, captured server-side 2026-10-20).** Send these bytes exactly; the response id is the server's request id.
- `{"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{"elicitation":{}},"clientInfo":{"name":"v129-oracle","version":"1.29.0"}},"jsonrpc":"2.0","id":0}`
- `{"method":"notifications/initialized","jsonrpc":"2.0"}`
- `{"method":"tools/call","params":{"name":"iris_audit_manage","arguments":<the row's arguments object>},"jsonrpc":"2.0","id":1}`, the member order the v1.29 client uses
- the accept: `{"result":{"action":"accept","content":{"confirm":true}},"jsonrpc":"2.0","id":<n>}`
- the decline: `{"result":{"action":"decline"},"jsonrpc":"2.0","id":<n>}`
- the cancel: `{"result":{"action":"cancel"},"jsonrpc":"2.0","id":<n>}`
- the no-capability `initialize`: the same line with `"capabilities":{}`.

The server's request is expected as `{"method":"elicitation/create","params":{"message":…,"requestedSchema":{…},"mode":"form","_meta":{"progressToken":…}},…}`.

**Scope seam (Rule #52).**
- **43.3 delivers:**
  - the helper, the ctx threading, the six call sites, `CONFIRMATION_DECLINED`;
  - the audit mapping and the `confirmation` field;
  - signal forwarding (DW-642), the DW-649 barrier, the DW-637 verdict and tripwire;
  - the elicitation-capable `connectSdkClient` option, `HandWire.untilLine` and the fake routes;
  - the tests on both eras, minimal docs, and the live-check procedure.
- **43.4 owns:**
  - the capstone (one accepted and one declined confirmation on both eras, reusing this story's client option, fake routes and audit oracle);
  - the live smokes (one confirmation round trip per era);
  - the README and client docs on supported revisions and confirmation behavior per client;
  - the spine Stack rows and the AD-32/AD-34 text;
  - the PRD line;
  - DW-639, with #17's description sentence and snapshot regeneration;
  - DW-641 and DW-646.
- **43.3 does not touch** the capstone file or the goldens.

**Rules 1 and 2.**
- **Consumed-by:**
  - this story's `audit.ts`, `env-promote.ts`, `doc-edit.ts`, `production.ts` and `message-resend.ts`, through `ctx.confirm`;
  - 43.4's capstone and smokes, through the helper on both eras and the test-client option.
- **Consumes:** 43.2's `serveStdio` factory and instances, the hand-wire, `startRig`, the holding proxy, and `MODERN_ERA`/`modernEnvelope`; 43.1's owned handlers, the fake listener and `settledAuditEntries`; SDK 2.3.1 `inputRequired`/`inputResponse`/`createRequestStateCodec`.
- **Extend, don't copy:**
  - `contentHash` lifts `env-promote.ts`'s `sortKeysDeep`/`computePlanHash`, which delegates to it;
  - `confirmationDeclinedResult` builds on `refusalResult`;
  - the signal extends `RequestOptions`;
  - the gate unit rows append to each gate's existing test file and reuse its fixtures;
  - the stdio tests extend `connectSdkClient`, the hand-wire and the fake listener;
  - the DW-642 rows extend the 43.2 cancel file and its proxy;
  - the in-memory rows extend `boot()` and the existing mock.

**Ledger inbox (Rule 17):**
- **DW-637:** addressed by decision #19, task 17's tripwire and the AC "DW-637".
- **DW-642:** addressed by decision #18, tasks 5, 6 and 17, and the AC "DW-642".
- **DW-649:** addressed by task 16 and the AC "DW-649".

**AC interpretations (apply and report):**
- "Tests through the real SDK client over stdio": the SDK client cannot change arguments between rounds or forge state, so those rows use the hand-wire over the same real stdio.
- "Arguments that change between rounds" on legacy: the shim re-enters in-process with the same params, so the legacy form is "a new `tools/call` carrying earlier `inputResponses`", which is the forged-accept row.
- "A v1.29-era client": no v1 SDK is installed (43.1 removed it, and no dependency is added), so the hand-wire sends the captured v1.29.0 bytes (Rule #36).
- AC 43.3.6's description bullet: see decision #17.

**Risks for the implementer:**
- **No log lines.** Any new stderr line on the call path reddens `story-43-2-qa-mixed-eras`, so the helper logs nothing.
- **Stub contexts.** 6 test files pass `{signal, mcpReq: {requestState}}`; treat every missing piece as absent.
- **Tests watching `ctx.http`.** `bindSignal` changes the identity of `ctx.http` on the wire path only. Check any test that compares it by identity: grep `ctx.http ===` and `toBe(http)`.
- **Audit field order.** `confirmation` goes last; the existing `normalizeAuditEntry` comparisons are by object.
- **The v2 client** refuses `setRequestHandler("elicitation/create")` unless elicitation is declared. Register it only then.
- **Client timeouts.** On legacy the v2 client's 60 s request timeout covers the person's time, so test handlers answer at once.
- **The pinned SDK client spawns a sibling probe process,** so audit files get 2 `sessionStart` lines; count tool entries only.
- **`release()` in the holding proxy** must not throw on an aborted connection.
- **The `computePlanHash` delegate** must be byte-identical: the existing plan-hash tests stay unchanged and green.

**Mutations (Rule 19).** Apply each mutation, observe red, revert, and record a `mutation:` line under `## Verification`.

| Mutation (src, unless marked) | Must go red | AC |
|---|---|---|
| the helper treats every client as non-eliciting | accept/decline rows of task 13, both eras | 43.3.2, Integration |
| a decline re-asks (returns pending) | the decline rows (second form request, or round limit) | 43.3.2 |
| the no-capability path returns pending | the fallback rows (`-32021` / shim isError) | 43.3.2 |
| legacy reads the envelope | the smuggled-capability row | 43.3.2 (era) |
| `hash` ignores `args` | the changed-arguments row | 43.3.4 |
| the nonce is never consumed | the replay row | 43.3.4 |
| the state is not verified (raw `JSON.parse` of its payload) | the tampered and forged rows | 43.3.4 |
| `audit.ts` calls `ctx.confirm` before the bounds check | the purge refused-first row | 43.3.3 |
| `handleToolCall` audits the input-required round | the one-entry rows | AD-19, #14 |
| `deriveAuditOutcome` drops the `CONFIRMATION_DECLINED` case | the `denied` rows | #14 |
| `dispatchToolCall` does not bind the signal | the DW-642 rows, both eras | DW-642 |
| `removeTools` notifies twice | the DW-649 "exactly one" rows, every run | DW-649 |
| a source file gains `ctx.mcpReq.elicitInput(` | the tripwire | DW-637 |
| each gate's `ctx.confirm` call removed (one per gate) | that gate's unit row and its stdio accept row | 43.3.1 |

## Verification

**Commands.** All run from `/Users/jbrandt/git/iris-execute-mcp-v2`, in the foreground with `timeout: 600000`.
- `CP` stands for `IRIS_HOST=127.0.0.1 IRIS_PORT=1`, set on EVERY command, per-package ones included.
- `<B>` is the `baseline_revision` the implement stage records in the frontmatter.

- **(loop) Builds.** `CP pnpm --filter @iris-mcp/shared build`, then `@iris-mcp/dev`, `@iris-mcp/admin`, `@iris-mcp/interop`, `@iris-mcp/ops` and `@iris-mcp/data`, one per call. Expected: exit 0.
- **(loop) Shared.** `CP pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/confirmation.test.ts src/__tests__/http-client-signal.test.ts src/__tests__/sdk-wire-compat.test.ts src/__tests__/refusals.test.ts src/__tests__/server-base.test.ts src/__tests__/resolve-profile-client.test.ts`. Expected: pass.
- **(loop) Gates, unit.** One call per package:
  - `CP pnpm --filter @iris-mcp/admin exec vitest run src/__tests__/audit.test.ts`
  - `CP pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/env-promote-execute.test.ts src/__tests__/env-promote.test.ts src/__tests__/doc-edit.test.ts`
  - `CP pnpm --filter @iris-mcp/interop exec vitest run src/__tests__/production.test.ts src/__tests__/message-resend.test.ts`

  Expected: pass.
- **(loop) Wire, new.** `CP pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-43-3-confirmation-both-eras.test.ts src/__tests__/story-43-3-confirmation-raw-wire.test.ts src/__tests__/story-43-3-validator-unreachable.test.ts src/__tests__/story-43-2-qa-concurrency-cancel.test.ts`. Expected: pass, with no skip.
- **(loop) Wire pins.** `CP pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-43-1-sdk-wire-golden.test.ts src/__tests__/story-43-1-qa-handler-golden.test.ts src/__tests__/story-43-2-cross-era-pin.test.ts src/__tests__/story-43-2-chokepoint-both-eras.test.ts src/__tests__/story-43-2-qa-meta-smuggling.test.ts src/__tests__/story-43-2-qa-mixed-eras.test.ts src/__tests__/startup-env-roster.test.ts src/__tests__/story-43-1-sdk-confinement.test.ts src/__tests__/story-43-1-qa-pack-confinement.test.ts src/__tests__/story-38-3-qa-doc-claims.test.ts src/__tests__/story-38-6-doc-claims.test.ts src/__tests__/story-40-4-doc-claims.test.ts`. Expected: pass, with no skip in `story-43-*`.
- **(loop) Diff guard.** `git diff <B> -U0 -- packages/*/src/__tests__ packages/iris-mcp-all/src/__tests__ extensions/iris-mcp-launcher/src/__tests__ scripts/lib`, read for removed or changed `expect(` and `assert` lines in pre-existing files. Expected:
  - only the eleven files of tasks 15–17 change: `fake-iris-listener.mjs`, `process-gate-helpers.ts`, `story-43-2-qa-hand-wire.ts`, `sdk-wire-compat.test.ts`, `refusals.test.ts`, `story-43-2-qa-concurrency-cancel.test.ts`, and the five gate unit files;
  - the one changed assertion is `refusals.test.ts`'s key list;
  - `fixtures/` is unchanged.
- **(once) Package suites.** `CP pnpm --filter <pkg> test`, then `type-check`, then `lint`, for shared, dev, admin, interop, ops, data and client-config, one per call. Expected: green.
- **(once) iris-mcp-all sweep.** `cd packages/iris-mcp-all && CP pnpm exec vitest run $(ls src/__tests__/*.test.ts | awk 'NR%3==0')`, then `NR%3==1`, then `NR%3==2`. Expected: green, with the live gates skipped.
- **(once) Launcher.** `IRIS_TEST_HOST=127.0.0.1 IRIS_TEST_PORT=1 CP npm --prefix extensions/iris-mcp-launcher test`. Expected: the failures equal the DW-532 set exactly.
- **(once) Gates.** `CP pnpm gen:governance-baseline:check` (141 keys, `1e62c5ad5bf7`), `pnpm gen:tools-list-snapshot:check`, `pnpm validate:prompts`, `pnpm gen:skills:check` and `pnpm gen:pack:check`. Expected: OK and unchanged.
- **(once) DW-649 stability.** `for i in $(seq 1 25); do CP pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/sdk-wire-compat.test.ts || exit 1; done`. Expected: 25 green runs.
- **(once) Diff checks.** `git diff --name-only <B>` lists no `bootstrap-classes.ts`, no `src/ExecuteMCPv2/`, no `package.json`, no `pnpm-lock.yaml` and no `fixtures/*.json`.
- **(once) Shuffled runs.** The added and changed tests, with `--sequence.shuffle` at seeds 11 and 22. Expected: green.

**Shared surfaces:**
- `REFUSAL_CODES` (`refusals.test.ts` key list; the 38-3 no-inline-literal scan);
- the audit entry schema (the new `confirmation` field; `denied` for a decline);
- `ToolContext` (an optional `confirm`, set on the wire path only; `resolve-profile-client.test.ts` key list unchanged);
- `RequestOptions`;
- the fake-listener route table (43.1 handler golden, 43.2 QA files);
- `WireSessionOptions` and `connectSdkClient` (40 files; `initialize` unchanged when the option is absent);
- the `HandWire` interface;
- `boot()` and `Booted` in `sdk-wire-compat.test.ts`;
- the cancel rows of `story-43-2-qa-concurrency-cancel`;
- the README refusal table (38-6 and 40-4 doc-claims);
- the `CHANGELOG.md` top entry.

Every test added or changed passes on a fresh environment, in either order. No IRIS instance is touched, and no `ExecuteMCPv2.Temp.*` fixture is used.

**Manual checks:**
- `git status --short` shows nothing under `irislib/`, `irissys/` or `extensions/iris-mcp-launcher/package-lock.json`, and no temp capture script.

## Auto Run Result

Status: ready-for-dev
Blocking condition: none
