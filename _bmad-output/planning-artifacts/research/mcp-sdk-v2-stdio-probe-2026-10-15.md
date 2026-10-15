---
title: 'Probe: MCP TypeScript SDK v2 over stdio — dual protocol revisions and elicitation'
date: '2026-10-15'
status: complete
feeds: 'Epic 43 (Stories 43.1-43.3); spine AD-32'
method: 'Live probe. @modelcontextprotocol/server and @modelcontextprotocol/client 2.3.1 with zod 4.3.6, installed with --ignore-scripts into a disposable scratch folder. Node v26.8.1, macOS. Scripts lived outside the install folder and were deleted after the run.'
---

# Probe: MCP TypeScript SDK v2 over stdio

**Question (Project Lead, 2026-10-15):** can SDK v2 serve MCP revision `2026-07-28` over stdio? The answer should be settled now rather than in Story 43.2. And would multi-round-trip requests (MRTR) or the Tasks extension benefit us?

## Answer

**Yes. One stdio server process serves both protocol revisions.** SDK v2's `serveStdio(factory)` entry, from `@modelcontextprotocol/server/stdio`, decides the era from each connection's opening exchange. It then pins one server instance from the factory for that connection's lifetime. The default `legacy: 'serve'` keeps 2025-era clients working, and `legacy: 'reject'` would refuse them. A hand-built `McpServer` on a plain `StdioServerTransport` speaks only the 2025 era. Sources: the SDK type definitions (`server/dist/stdio.d.mts`) and the SDK migration guide `docs/migration/support-2026-07-28.md` (main branch, fetched 2026-10-15).

## Results

One probe server was built with `serveStdio`. It had two tools: `ping_era`, and `guarded_write`, a write that asks for confirmation through `inputRequired.elicit()`. The same server was driven by five clients:

| Client | Negotiated revision | `tools/list` and `instructions` | Elicitation-guarded write |
|---|---|---|---|
| v2 client, pinned to `2026-07-28`, human accepts | `2026-07-28` (modern) | identical | confirmed in 1 round, then executed |
| v2 client, pinned to `2026-07-28`, human declines | `2026-07-28` | identical | the probe re-asked on each decline; the client gave up after 10 rounds (`inputRequired.maxRounds`) |
| v2 client, `auto` (what Claude Code does) | `2026-07-28` (modern) | identical | confirmed in 1 round |
| v2 client, `legacy` | `2025-11-25` | identical | confirmed in 1 round; the SDK shim sends a real `elicitation/create` |
| **v1.29.0 client (this repo's current SDK)** | 2025 era | identical | confirmed in 1 round |
| v2 client, pinned to `2026-07-28`, **no elicitation capability** | `2026-07-28` | — | `ProtocolError`: the client did not declare the capability |
| v2 client, `legacy`, **no elicitation capability** | `2025-11-25` | — | `isError` result: the client did not declare the capability |

## Facts the stories build on

1. **Dual revision is the default on stdio** with `serveStdio`, so Story 43.2's "if not viable" exit is unnecessary.
2. **Claude Code already negotiates `2026-07-28` with stdio servers that support it** (code.claude.com/docs/en/mcp, fetched 2026-10-15: it "asks HTTP, stdio, and claude.ai connector servers whether they support the newer revision, and uses it with those that do"). After Story 43.2, our primary client takes the modern path, so modern-era behavior must be pinned as rigorously as the legacy path. Users can force the old path with `MCP_PROTOCOL_NEGOTIATION=legacy`.
3. **The framework never reads client identity** (`getClientVersion` and `getClientCapabilities` are unused in `packages/shared/src`). So the SDK's caveat that these return `undefined` on modern connections does not affect us.
4. **The factory shape is new.** `McpServerBase` must build its `McpServer` (tool, prompt and resource registration) inside a factory function. Over stdio there is one connection per process, so the factory runs once.
5. **A single MRTR handler works on both eras.** The SDK shims `inputRequired` into real server→client requests on 2025-era stdio connections.
6. **Two traps in MRTR handlers:**
   - `acceptedContent()` returns `undefined` both for "not yet asked" and for "declined". A handler that re-asks whenever it gets `undefined` loops until the client gives up. A decline must end the call with a refusal.
   - A client that cannot elicit gets an error, so a gate needs a fallback for those clients.
7. **Claude Code supports elicitation** (form and URL modes) and shows a dialog. A user can auto-answer it with an `Elicitation` hook. Claude Code also honors `_meta["anthropic/requiresUserInteraction"]: true`, a per-tool flag that forces a permission prompt on every call, even in bypass modes.
8. **The Tasks extension has limited SDK support.** Task methods are excluded from the SDK's typed method maps; `tasks/get` and `tasks/cancel` are served on modern connections, while `tasks/result` and `tasks/list` stay refused; the experimental interception layer is removed. Claude Code's MCP documentation does not mention the extension. It instead moves a tool call that runs past two minutes into a background task, and aborts a stdio call that sends no response or progress for 30 minutes.

## Existing confirmation gates (2026-10-15)

Today these four tools take a `confirm: true` parameter that the agent itself sets:

- `iris_audit_manage` (`purge`);
- `iris_env_promote` (`execute`);
- `iris_production_control` (`clean` with `killAppData`);
- `iris_message_resend` (`resend` and `resendFiltered` execute).
