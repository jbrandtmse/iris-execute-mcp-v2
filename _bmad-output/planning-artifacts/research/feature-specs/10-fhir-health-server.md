# Spec 10 — `@iris-mcp/health`: FHIR / HealthShare Server (Read-Only MVP)

**Server:** NEW sixth package `packages/iris-health-mcp` | **Priority:** 10 — strategic bet, separate initiative | **Effort:** ~2 epics (this spec covers Phase 1 read-only MVP only)
**Governance:** all Phase-1 tools `mutates: "read"` (enabled by default). Phase 2 writes are a
separate future spec.
**Prereqs:** an **IRIS for Health** test instance with ≥1 configured FHIR endpoint and sample
resources. Do NOT start this spec without it.
**Read first:** [`00-conventions.md`](00-conventions.md), `packages/iris-data-mcp/` END TO END
(the smallest package — your scaffold template: package.json, tsconfig, index.ts, tools/,
__tests__/, README), `packages/shared/src/server-base.ts`, `irislib/HS/FHIRServer/` (if the
irislib export includes HS classes — else export them from the Health instance first)

## 1. Objective

The first MCP server for FHIR-on-IRIS: discover configured FHIR endpoints, read capability
statements, search and read FHIR resources — targeting IRIS's dominant vertical (healthcare)
where no MCP competitor operates. Phase 1 is deliberately **read-only** (PHI-safe posture,
caps the risk of the biggest-scope item in the feature set).

## 2. Package scaffold

Mirror `iris-data-mcp` exactly: `@iris-mcp/health`, same build/test/tsconfig shape, same
`McpServerBase` construction, same env vars. Update: turbo/workspace registration, root README
server table (5→6 servers; suite counts per Rule #31 discipline — this is a package, so it has
its own tool array + counts), `tool_support.md` new section, client-config guides, meta-package
`@iris-mcp/all` dependency list, CHANGELOG. **Platform note in every doc surface:** requires
IRIS for Health / HealthShare; on plain IRIS every tool returns a clear capability error.

## 3. MANDATORY Story 0 — endpoint discovery probe (Rule #16)

How to enumerate configured FHIR endpoints is the load-bearing unknown. Probe on the Health
instance, in order:
1. `HS.FHIRServer.ServiceAdmin` / installer-API query surfaces `[verify names in HS source]` —
   enumerate endpoints (URL path, FHIR version, storage strategy, namespace).
2. Fallback: enumerate CSP applications whose dispatch class descends from
   `HS.FHIRServer.HC.FHIRService` (via the existing webapp-list handler pattern +
   `%Dictionary` superclass walk).
3. Pin: does discovery require %SYS or the HS namespace? What identifies R4 vs STU3?
4. Decide ObjectScript-vs-TS split: if (2) suffices, discovery can go through the EXISTING
   webapp endpoint with TS-side filtering — zero new ObjectScript. Prefer that. Otherwise a
   minimal `/health/fhir/endpoints` route.
Deliverable: amended §4 with the pinned mechanism.

## 4. Tools (Phase 1 — all read)

All FHIR calls are plain HTTP against the endpoint path on the SAME IRIS web port the suite
already talks to (`ctx.http` with `Accept: application/fhir+json`) — this feature is
predominantly **TypeScript**, a perfect fit for the web-port-only architecture.

| Tool | Input | Behavior |
|---|---|---|
| `iris_fhir_endpoints` | — | Discovery per Story 0: `[{url, fhirVersion, namespace, enabled}]`. Capability error on plain IRIS ("no FHIR endpoints found — requires IRIS for Health with a configured FHIR server"). |
| `iris_fhir_capability` | `endpoint: string` | `GET {endpoint}/metadata`; returns condensed CapabilityStatement: version, supported resource types + interactions + search params per type (full statement in `structuredContent`, condensed table in text). |
| `iris_fhir_search` | `endpoint`, `resourceType: string`, `params?: Record<string,string>` (FHIR search params passed through), `count?: number` (default 20, **max 100** — maps to `_count`), `summary?: boolean` (default **true** — maps to `_summary=true`; PHI-minimizing default) | Executes the search; returns bundle summary: total, entry list (id, resourceType, key identifying fields), `nextPageToken` from bundle links (wire through as an opaque cursor param). Validates `resourceType` against the capability statement (cached per endpoint per session) and refuses unknown types naming the valid ones. |
| `iris_fhir_read` | `endpoint`, `resourceType`, `id`, `versionId?` (vread), `history?: boolean` | `GET {endpoint}/{type}/{id}` (or `/_history[/{vid}]`); returns the resource (or history bundle summary). |

**PHI handling requirements (apply to all):** `summary:true` default on search; no
response caching to disk anywhere; document prominently that these tools return PHI and that
operators should combine with Spec 02's read-only preset + Spec 07's audit log for governed
deployments (cross-reference, not dependency). OperationOutcome error responses parsed into
readable messages (never dump raw HTML/500s).

## 5. Story breakdown (Phase 1 epic)

1. **Story 0 — discovery probe (0.5–1):** §3.
2. **Story 1 — package scaffold + endpoints tool (1):** full package skeleton, registration,
   count tests, `iris_fhir_endpoints` per pinned mechanism, plain-IRIS capability error.
3. **Story 2 — capability + read (1):** `iris_fhir_capability` (+condensing logic + per-session
   cache), `iris_fhir_read` incl. vread/history; OperationOutcome parsing; unit tests with
   captured FHIR fixture payloads (capture REAL responses from the Health instance — Rule #36
   spirit: fixtures are reference-captured, not hand-written).
4. **Story 3 — search (1):** `iris_fhir_search` + resourceType validation + `_count` cap +
   pagination cursor + `summary` default; fixtures as above.
5. **Story 4 — docs + smokes (1):** full docs rollup (§2 surfaces; all tools read/enabled per
   Rule #30); live smokes on the Health instance: discover → capability → search Patient
   (`summary` default verified in the actual outbound URL) → read one resource → vread;
   plain-IRIS (or FHIR-less namespace) capability-error smoke; unknown-resourceType refusal
   live; second FHIR endpoint if configured (Rule #34 spirit) else residual-risk note.

## 6. Acceptance criteria

1. Story-0 mechanism pinned and documented; probes deleted.
2. On the Health instance: endpoints discovered with correct FHIR versions; capability
   statement condensed accurately (spot-check 3 resource types against raw metadata).
3. Search: params pass through, `_count` capped at 100, `_summary=true` by default (asserted
   on the outbound request), pagination cursor round-trips, unknown resourceType refused
   naming valid types.
4. Read/vread/history return parsed resources; FHIR OperationOutcome errors surface readable
   messages (404 unknown id test).
5. Plain IRIS / no-FHIR: every tool returns the documented capability error — never a raw error.
6. All tools `mutates:"read"`, enabled by default, governance-disableable (policy unit test).
7. Package counts, suite counts, meta-package, and all doc surfaces updated (6-server suite).
8. Unit fixtures are reference-captured from real FHIR responses.
9. Conventions §6 checklist complete.

## 7. Out of scope (Phase 1)

- ALL writes (create/update/patch/delete/transaction bundles) — Phase 2 spec, `write` +
  default-disabled + per-resource-type governance discussion required.
- HL7v2↔FHIR transformation testing; bulk data ($export); SMART-on-FHIR auth flows
  (the suite's Basic-Auth-to-IRIS model is assumed); CDS Hooks.
- FHIR endpoint provisioning/configuration (admin-side; future).
