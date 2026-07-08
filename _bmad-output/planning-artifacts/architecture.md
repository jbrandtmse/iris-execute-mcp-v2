---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-04-05'
amendedAt: '2026-06-15'  # Epic 14 Foundation ADR appended — multi-server profiles + tool governance + resources capability (Winston / bmad-create-architecture)
inputDocuments:
  - product-brief-iris-execute-mcp-v2.md
  - product-brief-iris-execute-mcp-v2-distillate.md
  - prd.md
  - prd-validation-report.md
  - research/technical-iris-mcp-v2-tools-research-2026-04-05.md
  - research/technical-mcp-server-best-practices-research-2026-04-05.md
  - research/mcp-specification-reference-2025-11-25.md
  - research/iris-mcp-v2-server-suites-2026-04-05.md
workflowType: 'architecture'
project_name: 'iris-execute-mcp-v2'
user_name: 'Developer'
date: '2026-04-05'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
109 FRs across 17 categories covering two distinct systems:
- **Node.js/TypeScript MCP Servers** (consumer-side): Connection lifecycle (FR1-FR7c), auto-bootstrap (FR8-FR15), and 98 tools organized across 5 domain servers
- **ObjectScript REST Service** (IRIS-side): Custom handlers for ~40% of tools where the Atelier API lacks coverage — globals, execution, security, config, interop, monitoring, tasks, analytics

The FR distribution reveals architectural weight: iris-dev-mcp (FR16-FR39, 24 FRs) is heaviest on Atelier API integration, iris-admin-mcp (FR40-FR62, 23 FRs) is heaviest on custom REST, and iris-interop-mcp (FR63-FR80, 18 FRs) wraps Ensemble's complex Ens.Director API.

**Non-Functional Requirements:**
20 NFRs driving hard architectural constraints:
- **Performance**: 2s read, 30s compile, 500ms tool listing, 60s bootstrap
- **Security**: No credential leakage, HTTPS support, privilege boundary enforcement, input validation at REST boundary, no internal error exposure
- **Integration**: Full MCP spec v2025-11-25 compliance, Atelier API auto-negotiation (v1-v8), cookie/CSRF/timeout handling
- **Reliability**: ~5s connection loss detection, auto re-auth on session expiry, idempotent bootstrap, no namespace leaks on error, no inconsistent state on failure

**Scale & Complexity:**
- Primary domain: Developer tooling / API integration layer
- Complexity level: Medium-High
- Estimated architectural components: ~15 (shared HTTP client, auth module, config, MCP server base, 5 server packages, REST dispatch, ~6 REST handler classes, setup/bootstrap class)

### Codebase Context

**Existing v1 implementations (reference, not porting):**
- `iris-execute-mcp` — Python/FastMCP, 8 tools via SuperServer native driver, includes ObjectScript classes in `src/ExecuteMCP/` (Command, Compile, UnitTest, TestRunner — 23 classes)
- `mcp-server-iris` — Python, 10 tools (SQL + interoperability) via native driver

**TypeScript reference codebases (Atelier API patterns):**
- `vscode-objectscript` — VS Code extension with full Atelier API client implementation (`src/api/`), compilation, export, debugging (xdebug), 18+ commands
- `language-server` — LSP implementation, TypeScript, native lexer modules
- `intersystems-servermanager` — VS Code extension with REST request patterns, auth provider, server management API

**IRIS library reference (`irislib/`):**
7,806 ObjectScript classes available for the custom REST service to wrap, including:
- `Security.*` (Users, Roles, Resources, Applications, SSLConfigs) — iris-admin-mcp targets
- `Config.*` (Databases, Namespaces, MapGlobals, MapRoutines, MapPackages) — iris-admin-mcp targets
- `Ens.*`, `EnsLib.*` (Director, Config.Production, Config.Credentials, Util.LookupTable) — iris-interop-mcp targets
- `%SYS.*`, `%SYSTEM.*` (Task, Mirror, Journal, License, Security) — iris-ops-mcp targets
- `%DeepSee.*` — iris-data-mcp analytics targets
- `%REST.*`, `%CSP.REST` — base classes for custom REST service

**v2 code state:** `src/ExecuteMCPv2/` exists but is empty — true greenfield. No root package.json or tsconfig.json yet.

### Technical Constraints & Dependencies

- Web port only (HTTP/HTTPS on default 52773) — no SuperServer, no native driver
- Node.js 18+ LTS (native fetch), TypeScript 5.0+, IRIS 2023.1+
- MCP spec v2025-11-25 compliance is non-negotiable
- Custom REST service must live in %SYS namespace for admin operations
- npm as primary distribution, IPM as secondary for IRIS-side components
- Local IRIS instance available at localhost:52773, namespace HSCUSTOM (from workspace config)
- Atelier API /api/atelier/ must be enabled on target IRIS (default in modern IRIS)

### Cross-Cutting Concerns Identified

1. **HTTP Session Management** — Cookie-based auth with Basic Auth fallback, CSRF token extraction, configurable timeouts, automatic re-authentication on session expiry. Shared across all 5 servers via the shared package.

2. **Namespace Context Management** — 52 tools are namespace-scoped (accept `namespace` parameter), 25 execute in %SYS, 1 is dual-scope. The REST service must switch `$NAMESPACE` per-request and restore it on completion (including error paths) to prevent leaks between concurrent calls.

3. **Error Handling Strategy** — MCP's two-tier model: JSON-RPC protocol errors (-32602 for unknown tools, malformed requests) vs tool execution errors (`isError: true` with actionable messages). Must bridge IRIS-side ObjectScript errors into this model without exposing internals.

4. **Tool Registration & Annotations** — Every tool needs accurate `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` annotations. `*.manage` tools that handle both create and delete must be marked `destructiveHint: true`. The shared MCP server base must enforce consistent annotation patterns.

5. **Input Validation** — Dual boundary: TypeScript-side validation against inputSchema before HTTP call, ObjectScript-side validation in REST handlers before delegating to system classes. Prevents both malformed requests and injection attacks.

6. **Connection Health & Resilience** — Health check via `HEAD /api/atelier/` on startup, ~5s detection of connection loss, automatic session re-establishment, idempotent bootstrap that skips completed steps on reconnect.

7. **Atelier API Version Negotiation** — Auto-detect highest supported version at connection time via `GET /api/atelier/`. URL pattern: `/api/atelier/v{N}/{namespace}/{action}` (confirmed from `irislib/%Api/Atelier.cls`). Each version extends the previous (v8 Extends v7 Extends v6...). v8 adds zero new endpoints over v7. **Recommended minimum: v7** (adds XML import/export and terminal WebSocket). Tools requiring features from newer versions degrade gracefully with clear error messages specifying minimum version needed.

8. **Structured Logging & Audit** — Consistent structured logging across both TypeScript and ObjectScript runtimes for debugging and audit trail. No credential logging.

## Starter Template Evaluation

### Primary Technology Domain

TypeScript monorepo for npm-published MCP server packages — no frontend/UI component. The project spans two runtimes: Node.js (MCP servers) and ObjectScript (IRIS-side REST service).

### Starter Options Considered

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| **Turborepo + pnpm** | `npx create-turbo@latest` | Industry standard, remote caching, strict hoisting, task graphs, native TS project refs | Additional tooling (pnpm + turbo) |
| **npm workspaces** | Native Node.js | Zero extra deps, simpler | Weaker dep resolution, no caching, no task orchestration |
| **create-typescript-server** | Official MCP CLI | MCP-specific scaffold | Single-server only, no monorepo support |

### Selected Starter: Turborepo + pnpm workspaces

**Rationale:** The project publishes 7 npm packages (5 servers + shared + meta-package) that share dependencies, types, and build configuration. Turborepo + pnpm is the current (2026) best practice for this exact scenario — it provides strict dependency hoisting (prevents published package issues), local caching, and task dependency graphs (build shared before servers). The MCP SDK works identically regardless of package manager.

**Initialization Command:**
```bash
npx create-turbo@latest iris-mcp-v2 --package-manager pnpm
```

**Architectural Decisions Provided by Starter:**

**Language & Runtime:**
- TypeScript 5.0+ with strict mode
- Target: ES2022, Module: Node16, ModuleResolution: Node16
- Base tsconfig.json with project references per package
- Node.js 18+ LTS (native fetch, no polyfills)

**Build Tooling:**
- Turborepo for task orchestration and caching (`turbo.json`)
- pnpm workspaces for dependency management (`pnpm-workspace.yaml`)
- TypeScript compiler (tsc) per package — no bundler needed for Node.js server packages
- Local caching for fast incremental builds

**Testing Framework:**
- Vitest (modern, fast, native TypeScript/ESM support, compatible with monorepo)
- Integration tests against local IRIS development instance

**Code Quality:**
- ESLint with TypeScript rules
- Prettier for formatting
- Strict TypeScript (noUncheckedIndexedAccess, exactOptionalPropertyTypes)

**Package Structure:**
```
iris-mcp-v2/
���── turbo.json
├── pnpm-workspace.yaml
├── package.json (root)
├── tsconfig.base.json
├── packages/
│   ├─��� shared/                 # @iris-mcp/shared
│   │   ├── src/
│   ���   │   ├── http-client.ts  # Persistent connection pool, cookies, CSRF
│   │   │   ├── auth.ts         # Basic Auth + cookie session management
│   │   │   ├── config.ts       # Env vars, connection config
│   │   ��   ├── types.ts        # Shared types across all servers
│   │   │   ├── errors.ts       # MCP two-tier error model
│   │   │   ├── server-base.ts  # MCP server registration framework
│   │   │   └── bootstrap.ts    # Auto-bootstrap orchestration
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── iris-dev-mcp/           # @iris-mcp/dev (25 tools)
│   ├── iris-admin-mcp/         # @iris-mcp/admin (26 tools)
│   ├── iris-interop-mcp/       # @iris-mcp/interop (20 tools)
│   ├── iris-ops-mcp/           # @iris-mcp/ops (20 tools)
│   ├── iris-data-mcp/          # @iris-mcp/data (7 tools)
│   └── iris-mcp-all/           # @iris-mcp/all (meta-package)
├── src/                        # IRIS-side ObjectScript classes
│   └── ExecuteMCPv2/
│       └── REST/
│           ├── Dispatch.cls
│           └── ...handler classes
└── .github/
    └── workflows/              # Future CI/CD (not in MVP scope)
```

**Note:** Project initialization using Turborepo scaffold should be the first implementation story. The ObjectScript classes in `src/` live outside the Node.js monorepo and are deployed to IRIS via the Atelier API (auto-bootstrap) or IPM.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- HTTP client architecture (every tool call flows through this)
- Authentication flow (required for any IRIS communication)
- ObjectScript REST service URL structure and JSON format (IRIS-side contract)
- MCP tool registration pattern (shared base for all 5 servers)
- Error handling strategy (bridges two runtimes)

**Important Decisions (Shape Architecture):**
- Namespace switching mechanism
- Pagination implementation
- Versioning strategy
- CI/CD pipeline design (deferred — post-MVP)

**Deferred Decisions (Post-MVP):**
- OAuth2 for MCP servers themselves
- WebSocket transport for debug/terminal tools
- Multi-instance connection management
- Remote caching configuration for Turborepo

### HTTP Client & Connection Architecture

**HTTP Client Library: Native `fetch` + thin wrapper**
- Rationale: Zero external dependencies, standard API, Node 18+ required anyway. The `vscode-objectscript` extension uses its own HTTP layer but that's VS Code-specific — we need a simpler Node.js server-side client.
- Implementation: `IrisHttpClient` class in `@iris-mcp/shared` wrapping native fetch with:
  - Cookie jar (simple Map-based — IRIS uses one session cookie)
  - CSRF token extraction from response headers and injection into mutating requests
  - Basic Auth header for initial authentication
  - Configurable timeout via AbortController (default 60s, overridable via IRIS_TIMEOUT env var)
  - Auto re-auth on 401 response
- Version: Node.js 18+ native fetch (no polyfill)

**Connection Pool: Node `http.Agent` with `keepAlive: true`**
- Rationale: HTTP/1.1 to IRIS web port — Node's built-in agent handles connection persistence. No custom pool needed.
- Affects: All 5 server packages via shared HTTP client

### Authentication & Security

**Auth Flow: Basic Auth → Cookie Session → Auto Re-Auth**
- First request sends Basic Auth header, IRIS returns session cookie
- Subsequent requests use cookie (lower overhead than re-sending credentials)
- On 401 response, automatically retry with Basic Auth to re-establish session
- CSRF token extracted from response headers and included in all mutating requests (POST/PUT/DELETE)
- Matches the VS Code ObjectScript extension's authentication pattern

**Credential Storage: Environment Variables Only**
- `IRIS_HOST` (default: `localhost`), `IRIS_PORT` (default: `52773`), `IRIS_USERNAME`, `IRIS_PASSWORD`, `IRIS_NAMESPACE` (default namespace for NS-scoped tools), `IRIS_HTTPS` (boolean, default: `false`), `IRIS_TIMEOUT` (default: `60000`) — per-server HTTP request timeout in milliseconds
- No config file with credentials — MCP client passes these via its server configuration
- All 5 servers share identical env var names (same IRIS connection)

**Privilege Enforcement: IRIS-Enforced**
- No client-side privilege checks — IRIS's own permission model is authoritative
- If a user lacks required privileges, IRIS returns a permission error; the MCP server surfaces it as an actionable tool error with specific guidance (e.g., "Requires %Admin_Manage:USE privilege")
- Exception: Bootstrap flow detects privilege tiers to provide appropriate fallback instructions

### ObjectScript REST Service Architecture

**URL Routing: Versioned Domain-Entity Pattern**
```
/api/executemcp/v2/command          POST — execute ObjectScript commands
/api/executemcp/v2/classmethod      POST — call class methods
/api/executemcp/v2/tests            POST — run unit tests
/api/executemcp/v2/global           GET/PUT/DELETE — global operations
/api/executemcp/v2/security/:entity POST — security (users, roles, resources, permissions)
/api/executemcp/v2/config/:entity   POST — config (namespaces, databases, mappings)
/api/executemcp/v2/interop/:entity  POST — interop (production, credentials, lookups)
/api/executemcp/v2/monitor/:entity  GET  — monitoring (jobs, locks, journals, mirrors, audit)
/api/executemcp/v2/task/:action     POST — task scheduling
/api/executemcp/v2/sysconfig        GET/POST — system configuration
/api/executemcp/v2/analytics/:entity POST — DeepSee operations
```
- Versioned (`v1`) for future evolution without breaking existing deployments
- Each route maps to a handler class: `ExecuteMCPv2.REST.Command`, `ExecuteMCPv2.REST.Security`, etc.
- Dispatch class: `ExecuteMCPv2.REST.Dispatch` extends `%Atelier.REST` (not `%CSP.REST`) — inherits `RenderResponseBody()`, `StatusToJSON()`, ETag helpers, and standardized error formatting. We define our own `OnPreDispatch` and `UrlMap` — `%Atelier.REST` has no namespace handling or routing logic that would constrain us.

**Response Format: Unified Atelier-Style Envelope**

Both the Atelier API and our custom REST service use the same three-part response envelope (from `%Atelier.REST.RenderResponseBody` — confirmed in `irislib/%Atelier/REST.cls`):
```json
{
  "status": { "errors": [], "summary": "" },
  "console": [ /* messages, warnings, debug info */ ],
  "result": { /* domain-specific data */ }
}
```

Our `ExecuteMCPv2.REST.Dispatch` extends `%Atelier.REST`, so all custom REST handlers inherit this format for free via `RenderResponseBody()`. This means:
- **Single response parser** in `IrisHttpClient` — one format for both API paths
- **`console` array** carries debug messages, compilation notes, and warnings alongside results
- **`status.errors[]`** supports multiple structured errors per response (e.g., 3 compilation errors)
- **ETag caching** available via built-in `If-None-Match` / `ETag` headers
- **`StatusToJSON()`** converts `%Status` to structured error objects automatically

Request format for custom REST (POST body):
```json
{ "action": "create", "namespace": "USER", "params": { ... } }
```

The TypeScript side maps: `status.errors` empty → MCP `content`/`structuredContent` from `result`; `status.errors` non-empty → MCP `isError: true` with actionable messages extracted from the errors array.

**Namespace Switching: Per-Request with Try/Catch Restore**
- Each REST handler saves current `$NAMESPACE`, switches via `SET $NAMESPACE = pNamespace`
- Work executes inside a Try block
- Both normal exit and Catch paths restore original `$NAMESPACE`
- Prevents namespace leaks between concurrent requests
- Standard IRIS pattern used by Ensemble and other system classes

### MCP Server Registration Pattern

**Tool Registration: Declarative ToolDefinition Objects**
```typescript
interface ToolDefinition {
  name: string;                    // e.g., "iris_doc_get"
  title: string;                   // Human-readable title
  description: string;             // LLM-optimized description
  inputSchema: ZodObject;          // Zod schema for validation
  outputSchema?: object;           // JSON Schema for structured output
  annotations: ToolAnnotations;    // readOnlyHint, destructiveHint, etc.
  scope: "NS" | "SYS" | "BOTH" | "NONE";
  handler: (args: unknown, context: ToolContext) => Promise<ToolResult>;
}
```
- Each server package exports an array of ToolDefinition objects
- Shared `server-base.ts` handles: MCP registration, Zod validation, pagination, listChanged notifications, namespace injection based on `scope`, and transport setup (stdio/HTTP)
- Annotation patterns enforced by the shared base: `*_list`/`*_get` → readOnly, `*_manage` → destructive, etc.

**Tool Naming Convention: Flat Underscore**

Tool names use the flat `iris_<domain>_<verb>` pattern — lowercase ASCII letters, digits, and underscores only. Examples: `iris_doc_get`, `iris_task_manage`, `iris_execute_classmethod`.

This convention matches the Anthropic Messages API `tools[].name` regex `^[a-zA-Z0-9_-]+$`, which is stricter than the MCP specification. The MCP spec (2025-03-26) permits dots in tool names, but Claude Desktop — which routes tool registrations through the Anthropic Messages API — rejects dotted names at registration time with a "tool name not valid" error. Claude Code silently rewrites dotted names to underscores as part of its internal `mcp__{server}__{tool}` prefixing, but other MCP clients may not. The flat underscore convention is the only naming style that works reliably across all current MCP clients in the ecosystem.

**Enforcement:** A regression test in `packages/shared/src/__tests__/tool-naming.test.ts` iterates every registered tool across all 5 servers and asserts `/^[a-z0-9_]{1,64}$/`, preventing any future regression from landing. The rename from the original dot-notation (`iris.doc.get`) to flat underscore (`iris_doc_get`) was performed in Epic 9 after the defect was discovered during beta testing.

**Pagination: Server-Controlled, Opaque Cursors**
- Default 50 tools per page (spec-compliant but practically single-page for all servers — max is 26 tools)
- Base64-encoded cursor with page offset
- Most clients get everything in one request; pagination exists for spec compliance

### Error Handling Strategy

**TypeScript Error Hierarchy:**
- `IrisConnectionError` — connection loss, timeout, DNS failure → triggers reconnect/re-auth logic
- `IrisApiError` — IRIS returned HTTP 4xx/5xx (from Atelier or custom REST) → maps to MCP tool error with actionable message
- `McpProtocolError` — unknown tool name, malformed arguments → JSON-RPC error code -32602

**IRIS → TypeScript Error Bridging:**
- Custom REST handlers return structured JSON errors (`{status, code, message, detail}`) — TypeScript never parses raw IRIS error strings
- Atelier API errors come as JSON with `status.errors[]` array — mapped directly to MCP tool errors
- Internal IRIS details (stack traces, global references, $ZERROR) are stripped at the REST boundary — only safe, actionable messages reach the MCP client

### Infrastructure & Deployment

**Versioning: Synchronized Semver via Changesets**
- All packages share the same version number (e.g., all at `2.3.0`)
- `@changesets/cli` manages version bumps and changelog generation
- Rationale: Simpler for consumers ("use v2.3.0 of everything"), avoids compatibility matrix across 7 packages

**Build & Test: Local Development**
- Integration tests run against the local IRIS development instance (connected via VS Code)
- Build and test orchestration via Turborepo tasks (`turbo build`, `turbo test`, `turbo lint`)
- CI/CD pipeline (GitHub Actions) deferred to post-MVP
- npm publish workflow deferred to post-MVP

**npm Scope: `@iris-mcp/*` Public Packages**
- `@iris-mcp/shared`, `@iris-mcp/dev`, `@iris-mcp/admin`, `@iris-mcp/interop`, `@iris-mcp/ops`, `@iris-mcp/data`, `@iris-mcp/all`
- All published as public packages to npm registry
- Meta-package `@iris-mcp/all` lists the other 5 servers as dependencies

### Decision Impact Analysis

**Implementation Sequence:**
1. Monorepo scaffold (Turborepo + pnpm) + shared package skeleton
2. `IrisHttpClient` with auth flow, cookie management, health check
3. MCP server base (tool registration, pagination, annotations, transport)
4. Auto-bootstrap orchestration
5. iris-dev-mcp (Atelier API tools first — validates HTTP client)
6. ObjectScript REST service (Dispatch + Command handler — validates custom REST path)
7. iris-dev-mcp custom REST tools (globals, execute, tests)
8. iris-admin-mcp, iris-interop-mcp, iris-ops-mcp, iris-data-mcp (sequential)
9. Documentation + publish pipeline

**Cross-Component Dependencies:**
- All 5 servers depend on `@iris-mcp/shared` (HTTP client, auth, config, server base, errors)
- iris-admin-mcp through iris-data-mcp depend on the ObjectScript REST service being deployable
- Auto-bootstrap depends on the Atelier API client (part of shared) being functional
- Integration tests depend on the local IRIS development instance being accessible via web port

### Multi-Server Profiles & Tool Governance (Epic 14 — added 2026-06-15)

This decision record extends four sections above for the platform capabilities added by Epic 14. All additions are backward-compatible: with neither `IRIS_PROFILES` nor `IRIS_GOVERNANCE` set, behavior is identical to the original single-server, ungoverned design.

**Multi-server profiles (extends *HTTP Client & Connection Architecture* and *Authentication & Security*):**
- Connection config is resolved per *profile*. `IRIS_PROFILES` (a JSON blob in an environment variable) defines named profiles `{ name: { host, port, username, password, namespace, https } }`. The existing `IRIS_*` variables synthesize a reserved `default` profile, so single-server installs are unchanged.
- `IrisHttpClient` keys its session/cookie cache per profile (no cross-profile session bleed). Every tool gains an optional `server` parameter (profile name); omitted → `default`. The `server` param carries only the profile name — credentials never leave the server process. This composes with the existing per-call `namespace` override: `server` picks the instance, `namespace` picks the namespace within it.

**Tool governance (extends *MCP Server Registration Pattern* and *Error Handling Strategy*):**
- Each tool action declares `mutates: read | write` metadata at registration. `IRIS_GOVERNANCE` (JSON env blob) defines a two-layer policy: `global` baseline + per-`profiles` overrides.
- Effective policy resolves as `profile.explicit(action) ?? global.explicit(action) ?? defaultSeed(action)`. The default seed enables existing actions and new read actions, and disables new write/change actions — so newly-added mutating capability is opt-in.
- Enforcement is **call-time** (a gate in the shared registration framework, run after profile resolution and before the handler). It is call-time *by necessity*: the governing profile is selected per call via `server`, so per-profile policy cannot be evaluated at advertise/registration time. All tools remain advertised; a disabled action returns a structured denial error naming the action and target profile.

**New `resources` capability (extends *MCP Server Registration Pattern*):**
- The suite was tools-only; Epic 14 adds the MCP `resources` capability to the shared server base (`resources/list`, `resources/read`, `resources/templates/list`). The resource template `iris-governance://{profile}` returns the effective policy for a profile, letting a client avoid blocked calls. It is advisory — the call-time gate remains the authoritative boundary.

**Config home:** both `IRIS_PROFILES` and `IRIS_GOVERNANCE` are JSON blobs in environment variables (not external files), keeping all configuration in the MCP client's `env` block alongside the existing `IRIS_*` vars.

#### Epic 14 Foundation — Architecture Decision Record (amended 2026-06-15)

Grounded in a read of the `@iris-mcp/shared` tool-call flow (registration → context → client → IRIS). These are the load-bearing engineering decisions for Epic 14.

> **The crux:** a server profile is *not* like a namespace. The existing per-call `namespace` override ([`server-base.ts:110`](../../packages/shared/src/server-base.ts) `resolveNamespace`) is a path-only string on the *same* authenticated session. A server profile is a *different host + credentials* → a different session (cookie jar, CSRF token, base URL) and cannot reuse the single `IrisHttpClient` ([`http-client.ts:41`](../../packages/shared/src/http-client.ts)). That distinction drives **D1**.

**D1 — Per-profile client registry (the crux).** Replace the single `this.http` (created once in `McpServerBase.start()`, `server-base.ts:385`) with a lazily-populated `Map<profileName, IrisHttpClient>`. `handleToolCall` (`server-base.ts:225`) resolves the `server` param → profile, gets-or-creates that profile's client (health-check + Atelier-version negotiation on first touch, then cached), and `buildToolContext` (`server-base.ts:102`) receives that client + the profile's namespace default + negotiated Atelier version. The **default** profile's client is created eagerly at startup, preserving today's bootstrap/health-check/negotiation exactly. *Rationale:* session state is bound to host+credentials; sharing one client across profiles would cross-contaminate auth, and different profiles may run different IRIS/Atelier versions. *Cost:* first call to a new profile pays a one-time negotiation latency — acceptable.

**D2 — `server` is a framework parameter, injected centrally, invisible to handlers.** Merge `server: z.string().optional()` into every tool's input schema at registration (`registerTool`, `server-base.ts:185-216`, extending `tool.inputSchema.shape` at line 191). `handleToolCall` consumes `server` to select the profile client, then strips it before invoking the handler. Handlers keep using `ctx.http` / `ctx.resolveNamespace(namespace)` exactly as today — **zero handler changes**. *Rationale:* DRY + total coverage (every current and future tool, for free) vs. the per-tool `namespace` declaration; keeping `server` out of the handler preserves existing handler code byte-for-byte. *Back-compat nuance (explicit):* this adds one optional field to every tool's advertised `inputSchema`. Per JSON-Schema/MCP semantics that is additive and non-breaking — calls omitting `server` behave identically; output schemas untouched. This is our accepted definition of "no breaking change" for schemas.

**D3 — Provable back-compat via a generated governance baseline.** A build-time generator (`scripts/gen-governance-baseline.mjs`, mirroring `gen-bootstrap.mjs`) enumerates every existing tool and its `action`-enum values into `packages/shared/src/governance-baseline.ts` (generated, output-only — Rule #18). The default seed enables every baseline entry; anything NOT in the baseline is "new" → read enabled, write disabled. *Rationale:* makes "no pre-existing action is disabled by default" mechanically verifiable rather than a hand-maintained `isNew` flag that can drift; existing actions need no manual read/write classification (grandfathered enabled).

**D4 — Governance key + the `action` discriminator standard.** The governance key is `tool` for single-operation tools and `tool:action` for multi-action tools. New governed tools MUST surface their mutating operations via an `action` enum parameter (all Epic 15–17 tools already do); the gate reads `args.action`. Only NEW actions carry `mutates: 'read' | 'write'` metadata. *Rationale:* matches the existing multi-action idiom (`iris_production_item`, `iris_*_manage`); existing single-op tools are grandfathered, so no retro-classification.

**D5 — Gate placement & ordering (one chokepoint).** Inside `handleToolCall` (`server-base.ts:225`): validate args (Zod) → resolve `server`→profile → extract `action` → evaluate `getEffectivePolicy(profile)[key]` → if disabled, return a structured `isError` result (machine-readable code, names action + profile) WITHOUT calling the handler → else build per-profile context and invoke. One change point cascades to all five servers. *Rationale:* validate-before-gate gives reliable action extraction + clean errors; a single chokepoint keeps enforcement uniform and un-bypassable.

**D6 — Minimal governance resource (no premature framework).** Add `resources: { listChanged: true }` to capabilities (`server-base.ts:163`); implement `resources/list`, `resources/templates/list` (`iris-governance://{profile}`), and `resources/read` → `getEffectivePolicy(profile)` as JSON. Build a focused governance-resource provider; do NOT generalize into a `ResourceDefinition` framework yet (YAGNI — one resource type today). *Rationale:* additive (clients ignoring `resources` unaffected); generalize only when a second resource appears.

**D7 — Config parsing & fail-fast.** Parse `IRIS_PROFILES` and `IRIS_GOVERNANCE` centrally in `config.ts` (`loadConfig`, `config.ts:43-83`) at startup; malformed JSON fails fast naming the offending var. The default profile is synthesized from the existing `IRIS_*` vars under the reserved name `default`; a profile may omit fields to inherit the default's. *Rationale:* both are new vars — only opted-in operators are affected, so fail-fast carries no back-compat risk and beats silent misconfiguration.

**Blast radius:** the entire foundation lands in `@iris-mcp/shared` — principally `server-base.ts` (client registry, gate, capability, resource handlers), `config.ts` (profile/governance parsing), two new modules (`profiles.ts`, `governance.ts`), and the generated `governance-baseline.ts`. The five server entry points and **every existing tool handler are unchanged** — the single-wiring-point leverage the suite was designed for.

**D8 — Lazy per-profile bootstrap with graceful failure (decided 2026-06-15).** Custom-REST tools (admin/interop/ops) require the `ExecuteMCPv2` REST service on the *target* instance. On the first custom-REST call against a non-default profile, the framework **attempts the existing auto-bootstrap flow** (detect → deploy → compile → register, FR8–FR15; reuse the `start()` bootstrap orchestration at `server-base.ts:411-433`), caching the result so it runs at most once per profile. **If the attempt fails** (e.g., insufficient privileges), it falls back to the existing structured "which steps succeeded / which failed + manual remediation" report (FR12/FR13), surfaced as a clear, actionable error — **not** a silent no-op. Atelier-only tools (most of iris-dev) never trigger bootstrap and work against any profile. *Rationale:* reuses proven bootstrap machinery and matches the default profile's own startup behavior; graceful failure keeps the agent informed rather than guessing. *Note:* the bootstrap attempt mutates the target on first use (identical to today's default-profile startup) — it is part of establishing the profile's connection, not a separately-governed tool action.

### Server & Governance Discovery (Epic 19 — added 2026-06-18)

This decision record extends two sections above for the discovery tool added by Epic 19. The addition is backward-compatible: with neither `IRIS_PROFILES` nor `IRIS_GOVERNANCE` set, the tool reports the single `default` profile and the default-seed policy — today's behavior plus one new (optional-to-call) read tool.

**Discovery tool (extends *MCP Server Registration Pattern* and *Authentication & Security*):**
- Epic 14's governance policy is exposed only as an **advisory resource** (D6). That resource neither enumerates configured profile *names* (the per-profile template's `list` is `undefined`) nor is read by the agent's loop before tool calls — so a client cannot *discover* its operating environment and falls back to inspecting client config. Epic 19 closes this with a callable read tool.
- The discovery tool returns, for the server it is invoked on: (a) the **profile roster** with per-profile connection metadata **excluding `password`**, and (b) the **effective governance policy** for a selected profile (default = `default`).

**E1 — Framework-provided discovery tool, single source of truth (decided 2026-06-18).** Register the discovery tool (proposed name `iris_server_profiles`) **once in the shared server base** (`server-base.ts`), exactly like the `server`-param injection (D2) and the governance resource (D6) — NOT in any package's `tools/index.ts`. It therefore appears uniformly on all five servers and inherits the live profile/governance state at call time. The roster is built from `profiles.ts`; the policy reuses `getEffectivePolicy` (`governance.ts`) — the same source the D6 resource consumes — so the tool and resource **cannot drift**. Classified `mutates: "read"` (default-enabled; a new non-baseline key, so the frozen baseline `1e62c5ad5bf7` is untouched). Redaction is an **allow-list** of non-secret fields (never a delete-`password`-from-spread), so a future field addition cannot leak. "Call-first" guidance lives in the tool description and is reinforced via the MCP server **`instructions`** field. *Rationale:* DRY + uniform cross-server coverage + drift-free, mirroring D2/D6; allow-list redaction is fail-safe. *Optional companion:* set the per-profile resource template's `list` callback to enumerate configured profile names, closing the same enumeration hole for resource-reading clients at near-zero cost.

### Production Recovery / Clean (Epic 20 — added 2026-06-30)

This decision record adds a `clean` action to `iris_production_control` and extends the Epic 14 governance foundation. Both additions are backward-compatible: existing actions/outputs are unchanged, and absent the new governance marker every existing write still defaults to disabled (byte-for-byte today's governance behavior). See [sprint-change-proposal-2026-06-30.md](./sprint-change-proposal-2026-06-30.md).

**Context.** `iris_production_control`'s `recover` action (`Ens.Director.RecoverProduction()`) is *soft* — it acts only on a `Troubled` state and merely suspends the runtime. A production wedged with stale runtime/queue/job-status globals (and unable to start cleanly) has no remedy via the existing tool. The IRIS-native fix is `Ens.Director.CleanProduction(pKillAppDataToo)` ([`Internal`]), which the Management Portal's own director UI invokes. `CleanProduction` always clears transient runtime state (`^IRIS.Temp.EnsRuntimeAppData` + `$$$EnsRuntime`/`$$$EnsQueue`/job-status globals) and, only when `pKillAppDataToo=1`, additionally wipes the **persistent** `^Ens.AppData` (HL7 sequence numbers, file/FTP done-file tables, batch/control state).

**F1 — `clean` as a destructive-but-guarded, last-resort action (decided 2026-06-30).** Add `clean` to `iris_production_control`, mapping to `CleanProduction(pKillAppDataToo)`. The default passes `pKillAppDataToo=0` (transient state only). The persistent `^Ens.AppData` wipe is opt-in via `killAppData:true` and **double-gated** with `confirm:true` (Rule #26 destructive-path guard); without `confirm:true` it is refused and changes nothing. The tool description and the MCP server `instructions` field position `recover` as the **preferred** first response and `clean` as the **last resort** for when `recover` does not resolve the problem. `CleanProduction`'s running-guard is preserved (refusal surfaced via `SanitizeError`). The same change corrects a latent defect — the `recover` action passed `tForce` to the no-arg `RecoverProduction()`. *Rationale:* reuses the existing lifecycle tool + namespace/error/governance machinery; isolates the one data-loss path behind an explicit, audited gate; records the `[ Internal ]` dependency for IRIS-upgrade audits (Rule #4).

**F2 — "Write, default-enabled" governance mechanism (decided 2026-06-30).** Extend the Epic 14 governance engine so a tool can declare specific `write` actions that default to **enabled** without misclassifying them as reads and without touching the frozen baseline. A `defaultEnabled` marker on `ToolDefinition` (mirroring `mutates`'s per-action shape) feeds a `defaultEnabledWrites` set, threaded as an **optional, default-empty** parameter through `defaultSeed`/`effective`/`getEffectivePolicy`; a write key present in that set seeds to `true`. `iris_production_control:clean` uses this to ship enabled while remaining truthfully `mutates: "write"` (its `annotations.destructiveHint` stays `true`). *Rationale:* keeps `mutates` honest (Rule #28) with the truthful destructive signal in `annotations`; preserves the frozen-baseline model (Rule #23/#25 — `1e62c5ad5bf7` untouched); strictly additive — empty set ⇒ byte-for-byte today's seed, every other write still default-disabled (Rule #19). An operator can still disable `clean` via an explicit `IRIS_GOVERNANCE` override (the cascade honors explicit `false`). This is the one Epic 20 change touching the shared foundation used by all five servers.

### Message Trace Sequence Diagram (Epic 21 — added 2026-07-02)

This decision record adds a Mermaid sequence-diagram capability over Interoperability message traces. All additions are backward-compatible: `iris_production_messages` and every existing tool/schema/output are unchanged; the new tool is a read (default-enabled). See [sprint-change-proposal-2026-07-02.md](./sprint-change-proposal-2026-07-02.md) — its §6 carries the binding behavioral spec distilled from the stakeholder-owned reference implementation (`../DiagramTool/`).

**Context.** The suite can list a session's `Ens.MessageHeader` rows (`iris_production_messages`) but cannot express the flow — request/response pairing, sync vs async, repetition — the way the Portal's Visual Trace does. Mermaid text is an ideal MCP payload (clients render fenced blocks natively; loop compression keeps large traces compact). The stakeholder owns a proven standalone ObjectScript diagram tool; Epic 21 delivers equivalent functionality **plus improvements** (error-state visualization, session metadata header) as a clean-room library inside the suite.

**G1 — Clean-room ObjectScript diagram library under `ExecuteMCPv2.Diagram.*` (decided 2026-07-02, stakeholder-directed placement).** All generation logic (loader, correlator, two-tier compressor, Mermaid writer, callable `Generate` facade) lives in a new subpackage under the existing `ExecuteMCPv2` package in `src/ExecuteMCPv2/Diagram/` — deployed by the **existing bootstrap** (picked up by `gen-bootstrap.mjs`'s `src/ExecuteMCPv2/**/*.cls` glob), requiring **no new IRIS package mappings and no new npm package**. REST surface is one thin handler (`ExecuteMCPv2.REST.Interop` + Dispatch route `GET /interop/production/messages/diagram?sessionIds=<csv>&namespace=&labelMode=&maxRows=&dedup=`) that validates and delegates to the facade; the TS tool (`iris_message_diagram`, `@iris-mcp/interop`) is a thin wrapper. Loader contract: 12-column `Ens.MessageHeader` projection (ID, Invocation, MessageBodyClassName, SessionId, SourceConfigName, TargetConfigName, ReturnQueueName, CorrespondingMessageId, TimeCreated, Type, IsError, ErrorStatus) with the NULL-safe `HS.Util.Trace.Request` filter (`IS NULL OR <>` — a bare `<>` drops bodyless rows under SQL three-valued logic), `ORDER BY TimeCreated, ID` (fallback `ORDER BY ID`), and a `maxRows` cap (default 2000, max 10000) with a `truncated` flag. Library behavior is tested with ObjectScript `%UnitTest` classes (`ExecuteMCPv2.Test.Diagram*Test`); the wrapper gets mocked-HTTP vitest tests. *Rationale:* everything rides the existing bootstrap/deployment surface; the library is a self-contained IRIS-side component (like the reference it reimplements) and the REST handler stays thin by delegating to it. *Note:* this records a deliberate, stakeholder-directed exception to the "handlers thin / logic in TS" default.

**G2 — Clean-room boundary (decided 2026-07-02).** The reference tool is consulted as a functional spec only (captured in the change proposal's §6: data contract, correlation rules, compression semantics, ten-item edge-case ledger). No ObjectScript is ported or copied (fresh code against the spec, even though both sides are ObjectScript), no `MALIB.*` naming, and no reference sample data (real HIE config names) is committed — test fixtures are synthetic. Code review verifies provenance.

**G3 — Output contract (decided 2026-07-02).** The tool returns fenced ` ```mermaid ` block(s) in `content` plus `structuredContent` `{ diagrams: [{ sessionId, mermaid, messageCount, warnings, truncated, dedupOf? }], count }`. Generation is best-effort — anomalies (unknown invocation, unpaired messages, correlation conflicts, errored messages) become `%%` comments AND structured `warnings[]`, never a failed call. Mermaid subset: `sequenceDiagram`, `participant [as]`, sync `->>` / async `-->>`, `loop N times … end`, `%%` comments. Improvements over the reference: **I1** errored messages flagged (` [ERROR]` label suffix + sanitized error summary; `IsError` participates in pair AND episode signatures so errored iterations never merge into clean loops) and **I2** a session-metadata header (`%% Session <id>: <n> messages, <first> .. <last>`; dedup normalizes the whole header line). No file output — MCP clients persist artifacts. Cross-session dedup (default on, disable via `dedup:false`) collapses identical flows and reports the mapping.

### Feature Differentiation Wave 1 (Epics 23–29 — added 2026-07-07)

This decision record covers the seven-feature wave added via [sprint-change-proposal-2026-07-07.md](./sprint-change-proposal-2026-07-07.md) (FR131–FR137; binding specs in [research/feature-specs/](./research/feature-specs/) 00–07). It extends the Epic 14 foundation (D1/D3/D5/D6), the Epic 20 governance mechanism (F2), and the *MCP Server Registration Pattern* / *ObjectScript REST Service Architecture* sections above. All additions are backward-compatible under the standing release gate: with no new env var set and no new tool called, every server behaves byte-for-byte as today (mechanical Rule #19 proofs required per spec). Four epics touch ObjectScript (23, 26, 27, 28 — per-story bootstrap bumps, Rule #24); three are TS/content-only (24, 25, 29). The frozen governance baseline `1e62c5ad5bf7` is untouched throughout.

**H1 — Governance preset layer: `presetSeed` in the cascade + a parallel generated classification artifact (Epic 24).** The effective-policy formula (D5, F2) gains one layer: `profile.explicit(key) ?? global.explicit(key) ?? presetSeed(key) ?? defaultSeed(key)`. `IRIS_GOVERNANCE_PRESET=read-only` derives a full-universe verdict per key — from `mutates` for post-foundation keys and from a **new generated artifact** `packages/shared/src/baseline-classifications.ts` for the 141 grandfathered baseline keys (a hand-curated read/write map whose key set is test-enforced to EQUAL the frozen baseline exactly; when in doubt, `write`). The frozen `governance-baseline.ts` itself is never modified — D3's model is preserved by classifying *alongside* it, not inside it. Under `read-only`, F2 `defaultEnabled` writes are ALSO blocked (preset beats the F2 seed; read-only means read-only — Epic 20's `clean` is off), while explicit `IRIS_GOVERNANCE` keys beat the preset at both layers (operators can re-enable one write). Threading follows the F2 pattern exactly: optional, default-`undefined` parameters through `defaultSeed`/`effective`/`getEffectivePolicy`, so an unset preset is byte-for-byte today's seed. Unknown preset values fail fast at startup (D7 pattern); preset-caused denials carry `presetApplied` in the structured error; `iris_server_profiles` (E1) and the D6 resource report the active preset from the same engine, so they cannot drift. Companion caps `IRIS_SQL_MAX_ROWS`/`IRIS_SQL_TIMEOUT` clamp `iris_sql_execute` at the TS tool layer (clamping annotated in the response; unset = no-op).

**H2 — Third protocol capability: MCP `prompts` (Epic 25).** The shared server base gains prompt registration (`PromptDefinition[]` on the constructor) and `prompts/list`/`prompts/get` handlers, wired the same way D6 wired `resources`. The capability is advertised ONLY when a server registers ≥1 prompt — no prompts ⇒ capabilities byte-for-byte unchanged (snapshot-tested). Prompts are **content, not tools**: they execute nothing, so they carry no governance keys and change no tool counts anywhere (Rule #31 counting discipline: package arrays untouched). Content is single-sourced in `packages/*/src/prompts/`; the installable `skills/` directory is GENERATED from it (`scripts/gen-skills.mjs`, DO-NOT-EDIT headers + `--check` mode — Rules #18/#25), and `scripts/validate-prompts.mjs` runs in the default suite pinning every `iris_*` token in prompt/skill bodies to the live tool catalog (a rename breaks CI, not users). Gated prompts ship inside their feature epics (`resend-failed-messages` → Story 26.3; `promote-environment-change` → Story 27.4). v1 pack: 9 prompts (stakeholder-approved 2026-07-07), 11 after the wave.

**H3 — Audit interceptor at the D5 chokepoint (Epic 29).** Tool-call observability wraps the SAME single chokepoint the governance gate occupies (`handleToolCall`): timer starts before the gate, one JSONL entry is emitted after resolution with outcome `ok`/`error`/`denied` (+ structured `denyReason`, and `presetApplied` when H1 caused the denial — soft dependency only). Audit is **server configuration, not a tool** (`IRIS_AUDIT_LOG`, `IRIS_AUDIT_LOG_MAX_MB`, `IRIS_AUDIT_LOG_PARAMS`) and is deliberately NOT expressible in `IRIS_GOVERNANCE` — an operator-mandated trail an AI client could switch off would be worthless. Redaction (recursive secret-key-family value replacement + truncation) runs BEFORE anything reaches the write queue; the writer is fire-and-forget and must never fail or slow a tool call (post-startup sink failures degrade with a `droppedEntries` counter; only an unwritable path at STARTUP fails fast, because silently running unaudited violates the operator's stated intent). Unset ⇒ mechanically-proven no-op. The phase-2 `iris_audit_sessions` query tool is explicitly deferred (it would be a framework tool with Rule #31 counting implications).

**H4 — Second-profile client access: `ToolContext.resolveProfileClient(name)` (Epic 27).** Cross-profile tools (env diff/promote) need TWO authenticated clients in one call. The context gains a resolver that reuses D1's per-profile client registry verbatim (extracted, not duplicated — same lazy negotiation, caching, and session isolation). Governance nuance, recorded deliberately: the D5 call-time gate governs the **calling** profile (`server` param); `iris_env_diff` reads the second profile ungated (read-only by construction), while `iris_env_promote:execute` additionally consults the **target** profile's effective policy for the underlying write families and refuses naming the blocking key — so a permissive `stage` profile cannot launder writes into a governance-locked `prod`. Additive context field; existing tools snapshot-proven unchanged.

**H5 — Server-side composition, TS-side interpretation (Epics 23 & 28).** Two new ObjectScript endpoints follow a shared split: ONE round-trip gathers raw multi-source data server-side — `/monitor/health` (≈10 probe areas, per-area Try/Catch so a failing probe yields an `error` finding without failing the request) and `/dev/sql/advise-data` (plan text + index dictionary + tune metadata) — while ALL judgment (thresholds→verdicts, advisory heuristics→findings) lives in TypeScript. *Rationale:* interpretation logic iterates far faster than probe plumbing; keeping it TS-side makes threshold/heuristic changes bootstrap-free and fixture-testable. This is the deliberate inverse of the G1 exception (where generation logic lives IRIS-side by stakeholder direction) — G1 remains the exception, H5 the default. Advisor discipline: heuristic fixtures are reference-captured from live plan output (Rule #36), plan-marker strings are the parser's pinned contract, and unrecognized plan text degrades to `findings: []` + an explicit note — the advisor never guesses. Note `/dev/sql/advise-data` is `iris_sql_analyze`'s FIRST ObjectScript surface (Epic 17 shipped it Atelier-only), making it a new bootstrap contributor.

**H6 — Write blast-radius containment for the wave's two write surfaces (Epics 26 & 27).** `iris_message_resend:resend|resendFiltered` and `iris_env_promote:execute` are the only new writes, and both get the strictest treatment in the suite: mandatory pre-implementation live probes (Rule #16 Story-0 for the unverified `Ens.MessageHeader` resend family; SHA-API probe for document hashing); truthful `mutates:"write"` → **default-disabled**, deliberately NOT F2 `defaultEnabled` (neither is a recovery-of-last-resort — resend duplicates clinical data flow, promote mutates a second environment); bounded scope enforced server-side before any mutation (required filters, ≤7-day windows, hard caps that REFUSE rather than truncate, allowlisted plan steps); dry-run-by-default with `confirm:true` double-gates (F1 pattern); promote plans embed a content hash of their source diff so a stale plan cannot execute; `onlyInTarget` drift emits warnings, NEVER deletion steps (no delete path exists in v1). Every refusal returns the standard envelope, changes nothing, and is a live-smoke assertion (Rule #26).

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:** 8 areas where AI agents could make different choices — naming, file structure, tool handler shape, ObjectScript conventions, test organization, error messages, tool descriptions, and unit test execution.

### Naming Patterns

**TypeScript Files & Directories:**
- Files: `kebab-case.ts` (e.g., `http-client.ts`, `iris-doc-get.ts`)
- Directories: `kebab-case/` (e.g., `tools/`, `__tests__/`)
- Exports: `PascalCase` for classes/types/interfaces, `camelCase` for functions/instances
- Types/Interfaces: Prefix interfaces with `I` only when there's a corresponding class; otherwise just `PascalCase` (e.g., `ToolDefinition`, `ToolContext`, `IrisApiError`)

**ObjectScript Classes:**
- Package prefix: `ExecuteMCPv2.` for all v2 classes
- REST handlers: `ExecuteMCPv2.REST.{Domain}` (e.g., `ExecuteMCPv2.REST.Security`)
- Parameters: `p` prefix (e.g., `pNamespace`, `pAction`)
- Local variables: `t` prefix (e.g., `tSC`, `tResult`)
- Properties: PascalCase, no prefix
- Class parameters: ALL_CAPS or PascalCase, no underscores

**Tool Names:**
- Always `iris.{category}.{action}` — lowercase, dot-separated
- Actions: `get`, `put`, `delete`, `list`, `compile`, `search`, `index`, `execute`, `manage`, `control`, `info`, `status`
- `*.manage` for CRUD tools (action parameter: `create`/`modify`/`delete`)
- `*.control` for lifecycle tools (action parameter: `start`/`stop`/`restart`/`update`/`recover`/`clean`)

### Structure Patterns

**Tool Handler File Organization:**
Each server package organizes tools by subdirectory:
```
packages/iris-dev-mcp/
├── src/
│   ├── index.ts              # Entry point: creates McpServer, registers tools, connects transport
│   ├── tools/
│   │   ├── index.ts          # Exports all ToolDefinition arrays
│   │   ├── doc.ts            # iris.doc.* tools (get, put, delete, list, compile, search, index, xml_export, convert)
│   │   ├── sql.ts            # iris.sql.* tools
│   │   ├── global.ts         # iris.global.* tools
│   │   ├── execute.ts        # iris.execute.* tools
│   │   ├── macro.ts          # iris.macro.* tools
│   │   └── server.ts         # iris.server.* tools
│   └── __tests__/
│       ├── doc.test.ts       # Unit tests (mocked HTTP)
│       ├── doc.integration.test.ts  # Integration tests (real IRIS)
│       └── ...
├── package.json
└── tsconfig.json
```

**Test Organization:**
- Unit tests: `__tests__/{module}.test.ts` — co-located within each package, mocked HTTP responses
- Integration tests: `__tests__/{module}.integration.test.ts` — suffix distinguishes, runs against local IRIS instance
- Test naming: `describe("iris_doc_get")` → `it("should retrieve a class document by name")`

**ObjectScript Class Organization:**
```
src/ExecuteMCPv2/
├── REST/
│   ├── Dispatch.cls          # URL routing, extends %CSP.REST
│   ├── Command.cls           # /command, /classmethod endpoints
│   ├── UnitTest.cls          # /tests endpoint
│   ├── Global.cls            # /global endpoint
│   ├── Security.cls          # /security/:entity endpoint
│   ├── Config.cls            # /config/:entity endpoint
│   ├── WebApp.cls            # webapp-specific operations (if needed separately)
│   ├── Interop.cls           # /interop/:entity endpoint
│   ├── Monitor.cls           # /monitor/:entity endpoint
│   ├── Task.cls              # /task/:action endpoint
│   ├── SystemConfig.cls      # /sysconfig endpoint
│   └── Analytics.cls         # /analytics/:entity endpoint
├── Setup.cls                 # Auto-bootstrap: Configure() class method
└── Utils.cls                 # Shared utilities (namespace switch, input validation)
```

### Format Patterns

**Tool Handler Pattern (TypeScript):**
Every tool handler follows the same structure:
```typescript
// In tools/doc.ts
export const docGetTool: ToolDefinition = {
  name: "iris_doc_get",
  title: "Get Document",
  description: "Retrieve an ObjectScript class, routine, CSP page, or include file by name. " +
    "Use this when the user asks to read or view source code. " +
    "Returns the document content in UDL format by default.",
  inputSchema: z.object({
    name: z.string().describe("Document name (e.g., 'MyApp.Service.cls')"),
    namespace: z.string().optional().describe("Target namespace (default: configured)"),
    format: z.enum(["udl", "xml"]).optional().describe("Output format (default: udl)"),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  scope: "NS",
  handler: async (args, ctx) => {
    const ns = ctx.resolveNamespace(args.namespace);
    const response = await ctx.http.atelier.get(`/${ns}/doc/${args.name}`);
    return { content: [{ type: "text", text: response.content }], structuredContent: response };
  },
};
```

**Tool Description Writing Rules:**
- First sentence: what the tool does (imperative)
- Second sentence: when to use it ("Use this when...")
- Third sentence: what it returns
- No implementation details (no mention of Atelier API, REST endpoints)
- Use concrete examples in descriptions where helpful

**ObjectScript REST Handler Pattern:**
Every handler method follows this structure — namespace save/restore in all code paths, using inherited `%Atelier.REST` response methods:
```objectscript
ClassMethod HandleAction(pAction As %String) As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Set tConsole = []
    Try {
        ; Read and validate JSON body
        Set tBody = ##class(%DynamicObject).%FromJSON(%request.Content)

        ; Switch namespace if provided
        If tBody.namespace '= "" {
            Set $NAMESPACE = tBody.namespace
        }

        ; Dispatch to action
        If pAction = "create" {
            Set tSC = ..DoCreate(tBody.params, .tResult)
        } ElseIf pAction = "list" {
            Set tSC = ..DoList(tBody.params, .tResult)
        } Else {
            Set tSC = $$$ERROR($$$GeneralError, "Unknown action: " _ pAction)
        }

        ; Return Atelier-style three-part response (inherited from %Atelier.REST)
        Do ..RenderResponseBody(tSC, tConsole, tResult)
    } Catch ex {
        Do ..RenderResponseBody(ex.AsStatus(), tConsole, {})
    }
    Set $NAMESPACE = tOrigNS
    Quit $$$OK
}
```

**Unit Test Execution Pattern (ObjectScript):**
The `ExecuteMCPv2.REST.UnitTest` handler MUST follow this pattern:
```objectscript
/// Guard: ensure ^UnitTestRoot is set before running tests
/// Sets default "" if not defined (tests are pre-compiled via MCP, not loaded from disk)
/// Respects existing configuration if someone has set a directory path
If '$Data(^UnitTestRoot) {
    Set ^UnitTestRoot = ""
}

/// Always use /noload/nodelete qualifiers:
///   /noload  — skip filesystem loading (tests are compiled via MCP tools)
///   /nodelete — preserve compiled test classes after execution
Set tSC = ##class(%UnitTest.Manager).RunTest(testspec, "/noload/nodelete")
```
- `^UnitTestRoot` is namespace-specific — the guard runs in whichever namespace the tests execute in
- The MCP tool caller (`iris_execute_tests`) should never need to know about `^UnitTestRoot` — the REST handler handles it transparently
- Fresh namespaces get `^UnitTestRoot = ""` automatically; pre-configured namespaces are left untouched

**Error Message Pattern:**
All tool errors follow: `{what happened}. {what to do about it}.`
- "Class 'MyApp.Foo' not found in namespace 'USER'. Check the class name or try a different namespace."
- "Insufficient privileges for user '_SYSTEM'. Requires %Admin_Manage:USE resource."
- "Compilation failed with 3 errors. See the errors array for details."

**Logging Pattern (TypeScript):**
- Use `console.error()` for all logging (stdout reserved for MCP protocol)
- Levels via prefix: `[ERROR]`, `[WARN]`, `[INFO]`, `[DEBUG]`
- Never log credentials, session cookies, or full request bodies
- Log: tool name, namespace, duration, success/failure, error code (not message detail)

### Enforcement Guidelines

**All AI Agents MUST:**
1. Follow the `ToolDefinition` interface exactly — no ad-hoc tool registration
2. Use Zod for input validation — no manual JSON parsing in handlers
3. Return `structuredContent` alongside `content` for all tools that return data
4. Use `ctx.resolveNamespace()` for namespace handling — never read env vars directly in handlers
5. Write both unit tests (mocked) and integration tests for every tool
6. Follow the ObjectScript REST handler pattern with namespace restore in all code paths
7. Write tool descriptions following the 3-sentence pattern
8. Use the standardized JSON envelope for all custom REST communication
9. Use the `^UnitTestRoot` guard pattern and `/noload/nodelete` qualifiers for all unit test execution
10. Never assume `^UnitTestRoot` is pre-configured — always check with `$Data()` and set default if missing

**Anti-Patterns to Avoid:**
- Inline HTTP calls in tool handlers (always go through `ctx.http`)
- Hardcoded IRIS URLs or credentials anywhere
- Returning raw IRIS error strings to the MCP client
- Using `console.log()` instead of `console.error()` for logging
- Creating new error classes beyond the 3-class hierarchy
- Mixing Atelier API calls and custom REST calls in a single tool handler (each tool uses one path)
- Calling `RunTest()` without the `^UnitTestRoot` guard pattern
- Using `/load` or `/delete` qualifiers with MCP-compiled test classes

## Project Structure & Boundaries

### Read-Only Reference Directories

**CRITICAL: The following directories are READ-ONLY reference material. AI agents MUST NEVER modify files in these locations:**

- **`sources/`** — v1 codebases (`iris-execute-mcp`, `mcp-server-iris`, `vscode-objectscript`, `language-server`, `intersystems-servermanager`). Used only for understanding patterns, API usage, and Atelier endpoint behavior. Never edited.
- **`irislib/`** — IRIS system library reference classes (7,806 .cls files: Security.*, Config.*, Ens.*, %SYS.*, etc.). Used only for understanding class signatures and method parameters when writing REST handlers. Never edited.

**Writable code locations:**
- **`packages/`** — All TypeScript MCP server code (monorepo)
- **`src/ExecuteMCPv2/`** — All v2 ObjectScript code (IRIS-side REST service)

### Complete Project Directory Structure

```
iris-mcp-v2/
├── .github/
│   └── workflows/
│       └── .gitkeep                  # CI/CD workflows deferred to post-MVP
├── .changeset/
│   └── config.json                   # Changesets configuration (synchronized versioning)
├── .eslintrc.js                      # Root ESLint config (TypeScript rules)
├── .prettierrc                       # Prettier config
├── .gitignore
├── .env.example                      # IRIS_HOST, IRIS_PORT, IRIS_USERNAME, IRIS_PASSWORD, IRIS_NAMESPACE, IRIS_HTTPS, IRIS_TIMEOUT
├── turbo.json                        # Turborepo task config (build, test, lint, type-check)
├── pnpm-workspace.yaml               # Workspace: packages/*
├── package.json                      # Root: scripts, devDeps (turbo, changesets, eslint, prettier, vitest)
├── tsconfig.base.json                # Shared: target ES2022, module Node16, strict mode
├── README.md                         # Suite-level: architecture overview, quick-start, which server to install
│
├── packages/
│   ├── shared/                       # @iris-mcp/shared — Epic 1: Shared Infrastructure
│   │   ├── src/
│   │   │   ├── index.ts              # Public API barrel export
│   │   │   ├── http-client.ts        # IrisHttpClient: native fetch wrapper, cookie jar, CSRF, timeout
│   │   │   ├── auth.ts               # Basic Auth → cookie session, auto re-auth on 401
│   │   │   ├── config.ts             # Environment variable loading, IrisConnectionConfig type
│   │   │   ├── health.ts             # Connection health check: HEAD /api/atelier/, ~5s loss detection
│   │   │   ├── atelier.ts            # Atelier API version negotiation (auto-detect, recommended minimum v7)
│   │   │   ├── server-base.ts        # McpServerBase: tool registration, pagination, annotations, transport
│   │   │   ├── tool-types.ts         # ToolDefinition, ToolContext, ToolResult, ToolAnnotations interfaces
│   │   │   ├── bootstrap.ts          # Auto-bootstrap orchestrator: detect → deploy → compile → configure → fallback
│   │   │   ├── errors.ts             # IrisConnectionError, IrisApiError, McpProtocolError
│   │   │   ├── json-envelope.ts      # Standardized {status, data, code, message} helpers
│   │   │   └── logger.ts             # Structured logging to stderr: [ERROR], [WARN], [INFO], [DEBUG]
│   │   ├── __tests__/
│   │   │   ├── http-client.test.ts
│   │   │   ├── auth.test.ts
│   │   │   ├── bootstrap.test.ts
│   │   │   ├── health.test.ts
│   │   │   └── atelier.test.ts
│   │   ├── package.json              # name: @iris-mcp/shared
│   │   └── tsconfig.json             # extends ../../tsconfig.base.json
│   │
│   ├── iris-dev-mcp/                 # @iris-mcp/dev — Epic 2 + Epic 3 (custom REST tools)
│   │   ├── src/
│   │   │   ├── index.ts              # Entry: create McpServer, register tools, connect transport
│   │   │   └── tools/
│   │   │       ├── index.ts          # Barrel export of all ToolDefinition arrays
│   │   │       ├── doc.ts            # iris_doc_get/put/delete/list/compile/search/index/xml_export/convert (FR16-FR31)
│   │   │       ├── macro.ts          # iris_macro_info (FR27)
│   │   │       ├── sql.ts            # iris_sql_execute (FR32)
│   │   │       ├── global.ts         # iris_global_get/set/kill/list (FR33-FR36) — custom REST
│   │   │       ├── execute.ts        # iris_execute_command/classmethod/tests (FR37-FR39) — custom REST
│   │   │       └── server.ts         # iris_server_info/namespace (FR2, server info)
│   │   ├── __tests__/
│   │   │   ├── doc.test.ts           # Unit: mocked Atelier API responses
│   │   │   ├── doc.integration.test.ts
│   │   │   ├── global.test.ts        # Unit: mocked custom REST responses
│   │   │   ├── global.integration.test.ts
│   │   │   ├── execute.test.ts
│   │   │   ├── execute.integration.test.ts
│   │   │   ├── sql.test.ts
│   │   │   └── server.test.ts
│   │   ├── package.json              # name: @iris-mcp/dev, deps: @iris-mcp/shared
│   │   └── tsconfig.json
│   │
│   ├── iris-admin-mcp/               # @iris-mcp/admin — Epic 4
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── tools/
│   │   │       ├── index.ts
│   │   │       ├── namespace.ts      # iris_namespace_manage/list (FR40-FR41)
│   │   │       ├── database.ts       # iris_database_manage/list (FR42-FR43)
│   │   │       ├── mapping.ts        # iris_mapping_manage/list (FR44-FR45)
│   │   │       ├── user.ts           # iris_user_manage/get/roles/password (FR46-FR49)
│   │   │       ├── role.ts           # iris_role_manage/list (FR50-FR51)
│   │   │       ├── resource.ts       # iris_resource_manage/list/permission.check (FR52-FR54)
│   │   │       ├── webapp.ts         # iris_webapp_manage/get/list (FR55-FR57)
│   │   │       ├── ssl.ts            # iris_ssl_manage/list (FR58-FR59)
│   │   │       └── oauth.ts          # iris_oauth_manage/list (FR60-FR62)
│   │   ├── __tests__/
│   │   │   ├── namespace.test.ts
│   │   │   ├── namespace.integration.test.ts
│   │   │   ├── user.test.ts
│   │   │   ├── user.integration.test.ts
│   │   │   └── ...                   # One pair per tool file
│   │   ├── package.json              # name: @iris-mcp/admin
│   │   └── tsconfig.json
│   │
│   ├── iris-interop-mcp/             # @iris-mcp/interop — Epic 5
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── tools/
│   │   │       ├── index.ts
│   │   │       ├── production.ts     # iris_production_manage/control/status/summary/item/autostart (FR63-FR69)
│   │   │       ├── production-monitor.ts  # iris_production_logs/queues/messages/adapters (FR70-FR73)
│   │   │       ├── credential.ts     # iris_credential_manage/list (FR74-FR75)
│   │   │       ├── lookup.ts         # iris_lookup_manage/transfer (FR76-FR77)
│   │   │       ├── rule.ts           # iris_rule_list/get (FR78)
│   │   │       ├── transform.ts      # iris_transform_list/test (FR79)
│   │   │       └── rest.ts           # iris_interop_rest (FR80)
│   │   ├── __tests__/
│   │   │   ├── production.test.ts
│   │   │   ├── production.integration.test.ts
│   │   │   └── ...
│   │   ├── package.json              # name: @iris-mcp/interop
│   │   └── tsconfig.json
│   │
│   ├── iris-ops-mcp/                 # @iris-mcp/ops — Epic 6
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── tools/
│   │   │       ├── index.ts
│   │   │       ├── metrics.ts        # iris_metrics_system/alerts/interop (FR81-FR83)
│   │   │       ├── jobs.ts           # iris_jobs_list (FR84)
│   │   │       ├── locks.ts          # iris_locks_list (FR85)
│   │   │       ├── journal.ts        # iris_journal_info (FR86)
│   │   │       ├── mirror.ts         # iris_mirror_status (FR87)
│   │   │       ├── audit.ts          # iris_audit_events (FR88)
│   │   │       ├── database.ts       # iris_database_check (FR89), iris_database_action (FR122)
│   │   │       ├── license.ts        # iris_license_info (FR90)
│   │   │       ├── ecp.ts            # iris_ecp_status (FR91)
│   │   │       ├── task.ts           # iris_task_manage/list/run/history (FR92-FR95)
│   │   │       ├── config.ts         # iris_config_manage (FR96-FR99)
│   │   │       ├── process.ts        # iris_process_manage (FR121)
│   │   │       └── backup.ts         # iris_backup_manage (FR123)
│   │   ├── __tests__/
│   │   │   └── ...
│   │   ├── package.json              # name: @iris-mcp/ops
│   │   └── tsconfig.json
│   │
│   ├── iris-data-mcp/                # @iris-mcp/data — Epic 7
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── tools/
│   │   │       ├── index.ts
│   │   │       ├── docdb.ts          # iris_docdb_manage/document/find/property (FR100-FR103)
│   │   │       ├── analytics.ts      # iris_analytics_mdx/cubes (FR104-FR105)
│   │   │       ├── debug.ts          # iris_debug_session/terminal (FR106-FR107, post-MVP placeholder)
│   │   │       └── rest.ts           # iris_rest_manage
│   │   ├── __tests__/
│   │   │   └── ...
│   │   ├── package.json              # name: @iris-mcp/data
│   │   └── tsconfig.json
│   │
│   └── iris-mcp-all/                 # @iris-mcp/all — Meta-package
│       └── package.json              # deps: @iris-mcp/dev, admin, interop, ops, data
│
├── src/                              # IRIS-Side ObjectScript — Epic 3 + handlers for Epics 4-7
│   └── ExecuteMCPv2/
│       ├── REST/
│       │   ├── Dispatch.cls          # URL map → handler classes, extends %CSP.REST
│       │   ├── Command.cls           # /command, /classmethod — FR37-FR38
│       │   ├── UnitTest.cls          # /tests — FR39, ^UnitTestRoot guard + /noload/nodelete
│       │   ├── Global.cls            # /global — FR33-FR36
│       │   ├── Security.cls          # /security/:entity — FR46-FR54
│       │   ├── Config.cls            # /config/:entity — FR40-FR45
│       │   ├── WebApp.cls            # /webapp — FR55-FR57
│       │   ├── SSL.cls               # /ssl — FR58-FR59
│       │   ├── OAuth.cls             # /oauth — FR60-FR62
│       │   ├── Interop.cls           # /interop/:entity — FR63-FR80
│       │   ├── Monitor.cls           # /monitor/:entity — FR84-FR91
│       │   ├── Task.cls              # /task/:action — FR92-FR95
│       │   ├── SystemConfig.cls      # /sysconfig — FR96-FR99
│       │   └── Analytics.cls         # /analytics/:entity — FR104-FR105
│       ├── Setup.cls                 # Auto-bootstrap: Configure() registers /api/executemcp web app
│       ├── Utils.cls                 # Shared: namespace switch helper, input validation helpers
│       └── Test/                     # ObjectScript %UnitTest.TestCase classes for IRIS-side testing
│           ├── CommandTest.cls       # Tests for REST.Command
│           ├── GlobalTest.cls        # Tests for REST.Global
│           ├── SecurityTest.cls      # Tests for REST.Security
│           ├── ConfigTest.cls        # Tests for REST.Config
│           ├── InteropTest.cls       # Tests for REST.Interop
│           ├── MonitorTest.cls       # Tests for REST.Monitor
│           ├── TaskTest.cls          # Tests for REST.Task
│           └── ...
│
├── ipm/                              # IPM package manifest for IRIS-side installation
│   └── module.xml                    # zpm "install iris-execute-mcp-v2" — classes + web app registration
│
├── sources/                          # READ-ONLY: v1 reference codebases (never modify)
├── irislib/                          # READ-ONLY: IRIS system library reference (never modify)
│
└── docs/                             # Epic 8: Documentation
    ├── migration-v1-v2.md            # v1 → v2 tool mapping, config changes, breaking changes
    └── client-config/
        ├── claude-desktop.md         # MCP config snippet for Claude Desktop
        ├── claude-code.md            # MCP config snippet for Claude Code
        └── cursor.md                 # MCP config snippet for Cursor
```

### Architectural Boundaries

**Boundary 1: MCP Protocol ↔ TypeScript Tool Handlers**
- `server-base.ts` is the boundary — it receives JSON-RPC calls, validates via Zod, resolves namespace, and dispatches to tool handlers
- Tool handlers never touch raw MCP protocol — they receive typed args and return `ToolResult`
- Transport (stdio/HTTP) is configured in each server's `index.ts`, invisible to handlers

**Boundary 2: TypeScript ↔ IRIS (HTTP)**
- `IrisHttpClient` in `@iris-mcp/shared` is the sole HTTP boundary
- Two outbound paths, never mixed in a single tool:
  - **Atelier API path**: `ctx.http.atelier.get("/{ns}/doc/{name}")` — for iris-dev-mcp (70% of tools). The wrapper internally prepends `/api/atelier/v{N}/` where N is auto-negotiated at connection time via `GET /api/atelier/`. Tool handlers provide `/{namespace}/{action}` only.
  - **Custom REST path**: `ctx.http.custom.post("/api/executemcp/v2/security/user", body)` — for admin/interop/ops/data tools
- All IRIS responses flow back through `IrisHttpClient` which handles cookie refresh, error mapping, and JSON parsing

**Boundary 3: ObjectScript REST Dispatch ↔ Handler Classes**
- `ExecuteMCPv2.REST.Dispatch` owns the URL map — routes to handler classes
- Each handler class owns one domain (Security, Config, Interop, etc.)
- Handlers use `ExecuteMCPv2.Utils` for namespace switching and JSON response writing
- Handlers delegate to IRIS system classes (Security.Users, Config.Namespaces, Ens.Director, etc.) — thin wrappers, not reimplementations

**Boundary 4: Auto-Bootstrap ↔ Normal Operation**
- `bootstrap.ts` runs once at server startup (or reconnection)
- It uses the Atelier API client to deploy classes (`PUT /doc`) and compile (`POST /action/compile`)
- After bootstrap completes, the server enters normal operation — bootstrap state is tracked to skip completed steps
- Bootstrap never runs during tool execution

**Boundary 5: Read-Only References ↔ Writable Code**
- `sources/` and `irislib/` are strictly read-only reference material — never modified by any agent or build process
- All new ObjectScript code goes in `src/ExecuteMCPv2/` only
- All new TypeScript code goes in `packages/` only

### Requirements to Structure Mapping

| Epic | TypeScript Location | ObjectScript Location | FRs |
|------|--------------------|-----------------------|-----|
| Epic 1: Shared Infrastructure | `packages/shared/` | — | FR1-FR7c |
| Epic 2: iris-dev-mcp (Atelier) | `packages/iris-dev-mcp/src/tools/doc.ts, sql.ts, macro.ts, server.ts` | — | FR16-FR31 |
| Epic 3: Custom REST + Bootstrap | `packages/shared/src/bootstrap.ts` + `packages/iris-dev-mcp/src/tools/global.ts, execute.ts` | `src/ExecuteMCPv2/REST/Dispatch.cls, Command.cls, UnitTest.cls, Global.cls` + `Setup.cls, Utils.cls` | FR8-FR15, FR32-FR39 |
| Epic 4: iris-admin-mcp | `packages/iris-admin-mcp/` | `src/ExecuteMCPv2/REST/Security.cls, Config.cls, WebApp.cls, SSL.cls, OAuth.cls` | FR40-FR62 |
| Epic 5: iris-interop-mcp | `packages/iris-interop-mcp/` | `src/ExecuteMCPv2/REST/Interop.cls` | FR63-FR80 |
| Epic 6: iris-ops-mcp | `packages/iris-ops-mcp/` | `src/ExecuteMCPv2/REST/Monitor.cls, Task.cls, SystemConfig.cls` | FR81-FR99 |
| Epic 7: iris-data-mcp | `packages/iris-data-mcp/` | `src/ExecuteMCPv2/REST/Analytics.cls` | FR100-FR107 |
| Epic 8: Documentation | `docs/`, per-package `README.md` | — | — |

### Data Flow

```
MCP Client (Claude Code, Cursor, etc.)
    │ JSON-RPC (stdio or Streamable HTTP)
    ▼
McpServerBase (server-base.ts)
    │ Zod validation, namespace resolution, annotation check
    ▼
Tool Handler (e.g., doc.ts → docGetTool.handler)
    │ Typed args + ToolContext
    ▼
IrisHttpClient (http-client.ts)
    │ HTTP/HTTPS with cookies, CSRF, Basic Auth
    ├──► Atelier API (/api/atelier/v{N}/{ns}/{action} — N auto-negotiated via GET /api/atelier/)
    │         │
    │         ▼
    │    IRIS Atelier Service (built-in)
    │
    └──► Custom REST (/api/executemcp/v2/...)
              │
              ▼
         ExecuteMCPv2.REST.Dispatch
              │ URL routing
              ▼
         Handler Class (e.g., Security.cls)
              │ $NAMESPACE switch, validate, delegate
              ▼
         IRIS System Classes (Security.Users, Config.*, Ens.Director, etc.)
```

## Architecture Validation Results

### Coherence Validation

**Decision Compatibility: PASS**
- TypeScript 5.0+ / ES2022 / Node16 modules ↔ MCP SDK v1.x — compatible, SDK is TypeScript-native
- Turborepo + pnpm ↔ Changesets synchronized versioning — standard combination, well-documented
- Native fetch ↔ Node 18+ requirement — fetch is built-in from Node 18
- Zod input validation ↔ MCP SDK — SDK natively supports Zod schemas for `inputSchema`
- Vitest ↔ TypeScript + ESM — native ESM/TS support, no extra config needed
- ObjectScript %CSP.REST ↔ JSON envelope format — %CSP.REST supports JSON natively via %DynamicObject
- No contradictory decisions found

**Pattern Consistency: PASS**
- Naming conventions are consistent: kebab-case files (TS), PascalCase classes (ObjectScript), dot-namespaced tools
- All tool handlers follow the same `ToolDefinition` interface
- All ObjectScript handlers follow the same namespace-save/restore/try-catch pattern
- Error handling is consistent: 3-class TS hierarchy maps cleanly to MCP two-tier model
- Tool descriptions follow uniform 3-sentence pattern

**Structure Alignment: PASS**
- Monorepo structure supports independent package builds via Turborepo task graph
- Each server package has identical internal structure (`src/tools/`, `__tests__/`)
- ObjectScript classes mirror the REST URL routing structure
- Read-only boundaries (`sources/`, `irislib/`) are explicitly marked

### Requirements Coverage Validation

**Functional Requirements Coverage:**

| FR Range | Category | Architectural Support | Status |
|----------|----------|----------------------|--------|
| FR1-FR7c | Connection & Lifecycle | `shared/http-client.ts`, `auth.ts`, `config.ts`, `health.ts`, `server-base.ts` | Covered |
| FR8-FR15 | Auto-Bootstrap | `shared/bootstrap.ts` + `Setup.cls` | Covered |
| FR16-FR31 | Documents, Compilation, Code Intel, XML | `iris-dev-mcp/tools/doc.ts, macro.ts` via Atelier API | Covered |
| FR32-FR36 | SQL & Globals | `iris-dev-mcp/tools/sql.ts, global.ts` — SQL via Atelier, globals via custom REST | Covered |
| FR37-FR39 | ObjectScript Execution | `iris-dev-mcp/tools/execute.ts` + `REST/Command.cls, UnitTest.cls` | Covered |
| FR40-FR62 | Admin (NS, DB, Users, Roles, WebApp, SSL, OAuth) | `iris-admin-mcp/tools/*` + `REST/Security.cls, Config.cls, WebApp.cls, SSL.cls, OAuth.cls` | Covered |
| FR63-FR80 | Interop (Production, Credentials, Lookups, Rules) | `iris-interop-mcp/tools/*` + `REST/Interop.cls` | Covered |
| FR81-FR99 | Ops (Metrics, Jobs, Locks, Journals, Tasks, Config) | `iris-ops-mcp/tools/*` + `REST/Monitor.cls, Task.cls, SystemConfig.cls` | Covered |
| FR100-FR105 | Data (DocDB, Analytics) | `iris-data-mcp/tools/*` + `REST/Analytics.cls` | Covered |
| FR106-FR107 | Debugging (WebSocket) | `iris-data-mcp/tools/debug.ts` — placeholder, deferred post-MVP | Deferred (by design) |

**109/109 FRs covered** (107 active + 2 explicitly deferred)

**Non-Functional Requirements Coverage:**

| NFR | Architectural Support | Status |
|-----|----------------------|--------|
| 2s read latency | Native fetch + keepAlive agent, minimal wrapper overhead | Covered |
| 60s default / configurable compile timeout | AbortController timeout in IrisHttpClient, configurable via IRIS_TIMEOUT env var (default 60s) | Covered |
| 500ms tool listing | Static tool arrays, pagination is simple offset | Covered |
| 60s bootstrap | Sequential steps with progress tracking | Covered |
| No credential leakage | Logger pattern (no credentials), error stripping at REST boundary | Covered |
| HTTPS support | IrisHttpClient respects `IRIS_HTTPS` env var | Covered |
| Privilege enforcement | IRIS-enforced, REST returns structured error codes | Covered |
| Input validation | Dual: Zod (TS) + ObjectScript REST handler validation | Covered |
| MCP spec v2025-11-25 | server-base.ts: pagination, annotations, listChanged, outputSchema | Covered |
| ~5s connection loss | health.ts polling via HEAD /api/atelier/ | Covered |
| Auto re-auth on 401 | auth.ts re-sends Basic Auth on 401 response | Covered |
| Idempotent bootstrap | bootstrap.ts tracks completed steps, skips on reconnect | Covered |
| No namespace leaks | ObjectScript handler pattern: $NAMESPACE save/restore in all paths | Covered |
| No inconsistent state | ObjectScript handlers delegate to IRIS system classes (atomic operations) | Covered |

**20/20 NFRs covered**

### Implementation Readiness Validation

**Decision Completeness: PASS**
- All critical decisions documented with specific technology choices
- Versions specified: Node 18+ LTS, TypeScript 5.0+, ES2022, MCP SDK v1.x, IRIS 2023.1+
- Implementation patterns include concrete code examples (TypeScript tool handler, ObjectScript REST handler, unit test guard pattern)
- Enforcement guidelines are specific and actionable (10 rules + 8 anti-patterns)

**Structure Completeness: PASS**
- Every file in the monorepo is named and mapped to specific FRs
- Every ObjectScript class is named with its REST endpoint and FR mapping
- Test locations defined for both runtimes (TS: `__tests__/`, ObjectScript: `Test/`)
- Read-only boundaries explicitly marked

**Pattern Completeness: PASS**
- All naming, structure, format, and process patterns specified
- One area to resolve during Epic 1: Atelier API version negotiation algorithm — reference `sources/vscode-objectscript/src/api/` for their approach

### Gap Analysis Results

**Critical Gaps: 0**

**Important Gaps: 2**
1. **Atelier API version negotiation algorithm** — Architecture says "auto-detect highest version (v1-v8)" but doesn't specify the exact algorithm. Resolve during Epic 1 by referencing `sources/vscode-objectscript/src/api/`. Not blocking — `GET /api/atelier/` response includes version info.
2. **Streamable HTTP transport configuration** — Architecture specifies both stdio and Streamable HTTP transports but doesn't detail the HTTP server setup (port, host binding). Resolve during Epic 1 — the MCP SDK handles most of this.

**Nice-to-Have Gaps: 2**
1. MCP Inspector integration for development/debugging — add as dev dependency during implementation
2. Monorepo dev workflow hot-reload config — Turborepo watch mode, resolve in `turbo.json` during scaffold

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Project context thoroughly analyzed (109 FRs, 20 NFRs, 6 user journeys)
- [x] Scale and complexity assessed (Medium-High, dual-runtime)
- [x] Technical constraints identified (web port only, Node 18+, IRIS 2023.1+, MCP spec compliance)
- [x] Cross-cutting concerns mapped (8 concerns)

**Architectural Decisions**
- [x] Critical decisions documented with versions (15 decisions across 6 categories)
- [x] Technology stack fully specified (TypeScript, Turborepo, pnpm, MCP SDK, Vitest, Changesets)
- [x] Integration patterns defined (Atelier API path, custom REST path, two-tier error model)
- [x] Performance considerations addressed (timeouts, connection pooling, keepAlive)

**Implementation Patterns**
- [x] Naming conventions established (TS files, ObjectScript classes, tool names)
- [x] Structure patterns defined (tool handler files, ObjectScript class organization)
- [x] Format patterns specified (tool handler template, REST handler template, JSON envelope, error messages)
- [x] Process patterns documented (unit test guard, namespace switching, logging)

**Project Structure**
- [x] Complete directory structure defined (every file named and mapped)
- [x] Component boundaries established (5 boundaries)
- [x] Integration points mapped (data flow diagram)
- [x] Requirements to structure mapping complete (all 8 epics → specific files)

### Architecture Readiness Assessment

**Overall Status: READY FOR IMPLEMENTATION**

**Confidence Level: High**

**Key Strengths:**
- Complete FR/NFR coverage with explicit file-level mapping
- Dual-runtime architecture cleanly separated by HTTP boundary
- Concrete code examples for both TypeScript and ObjectScript patterns
- Read-only reference codebases available for implementation guidance
- Enforcement guidelines prevent common AI agent conflicts

**Areas for Future Enhancement:**
- Atelier API version negotiation algorithm (resolve in Epic 1)
- Streamable HTTP transport server config (resolve in Epic 1)
- OAuth2 for MCP servers themselves (post-MVP)
- WebSocket debug/terminal tools (post-MVP, FR106-107)

### Implementation Handoff

**First Implementation Priority:**
```bash
npx create-turbo@latest iris-mcp-v2 --package-manager pnpm
```
Then restructure into the defined package layout and begin Epic 1 (shared infrastructure).

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect project structure and boundaries (especially read-only `sources/` and `irislib/`)
- Reference `sources/vscode-objectscript/` for Atelier API usage patterns
- Reference `irislib/` for IRIS system class signatures
- All new ObjectScript code goes in `src/ExecuteMCPv2/` only
- All new TypeScript code goes in `packages/` only
- Refer to this document for all architectural questions
