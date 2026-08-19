# Story 35.5: MEDIUM - Validate Before Delegating: OAuth Client + `interop_rest` Name

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **operator or AI client calling `iris_oauth_manage` or `iris_interop_rest`**,
I want **invalid inputs rejected with a clear, actionable validation error before the handler delegates to a system API, and documented examples the implementation actually accepts**,
so that **I never receive a raw `<PARAMETER>` ObjectScript error with no diagnosis, and never follow a documented example into a rejection**.

## Context — why this story exists

Two ledger items from the 2026-08-17 post-Epic-34 full-surface sweep:

- **`35-SWEEP-6`** (MEDIUM): `iris_oauth_manage` client-create leaks a raw `<PARAMETER>`. The sweep recorded the cause as "`serverName` validated only for non-emptiness, never against a real server definition". **The lead pre-story probe (below) found the mechanism is different and worse**: on this IRIS version `%SYS.OAuth2.Registration.RegisterClient` takes **one** argument; the handler calls it with two (`Security.cls:1792`), so the `<PARAMETER>` is an **arity error** thrown before any lookup could ever run. Client-create has never worked on this instance and cannot work as written.
- **`35-SWEEP-7`** (MEDIUM): `iris_interop_rest`'s `name` description documents `'/myapi'`, which the implementation rejects (*"Application name is not a valid package name"*); a package name (`ClaudeSmokeApi`) succeeds. The interop README example **and** the TS test fixtures carry the same wrong value.

Ledger: `deferred-work.md` lines 2357 (`35-SWEEP-6`) and 2358 (`35-SWEEP-7`).

## Acceptance Criteria

Sourced verbatim from `_bmad-output/planning-artifacts/epics.md`, "### Story 35.5". **AC 35.5.1's stated mechanism is corrected by the lead probe — see the premise correction below; the AC's intent (clean validation error naming the real precondition, never a raw `<PARAMETER>`) stands unchanged.**

1. **AC 35.5.1** - `Security.cls:1792` pre-validates that `serverName` names an existing OAuth2 server definition before calling `%SYS.OAuth2.Registration.RegisterClient(tServerName, .tProps)`. Today only non-emptiness is checked (lines 1770-1776), so a missing definition surfaces as a raw `<PARAMETER>` ObjectScript error. Probe-first (#16) which class actually backs the lookup: `OAuth2.ServerDefinition` does NOT exist on this instance (`COUNT(*) = 0`), so do not assume it.
2. **AC 35.5.2** - The error names the real precondition: client registration requires a prior successful `discover`, which itself requires an IRIS SSL/TLS configuration. Verified live: `discover` against `https://accounts.google.com` fails with *"Although Https property is enabled no SSLConfiguration is specified"*. Both prerequisites are documented in the tool description (#43 - the story ships its own minimal docs).
3. **AC 35.5.3** - `iris_interop_rest`'s `name` description is corrected. `rest.ts:32` currently reads `"REST application name (e.g., '/myapi')"`, and that documented example is REJECTED: *"Application name is not a valid package name: /claudesmokeapi"*. A package name (`ClaudeSmokeApi`) succeeds. Fix the description to state the package-name contract with a working example; if a path-shaped value should also be accepted, that is a handler change and must be called out as such rather than silently assumed.
4. **AC 35.5.4** - Audit the remaining tool descriptions for the same class of defect - a documented example the implementation rejects (#56). At minimum, every `describe()` containing an `e.g.` in the touched packages is checked against its validator. Report the audit result.
5. **AC 35.5.5** - Live proof of each corrected contract: the documented example now works, and the rejected form yields a clear validation error rather than a raw ObjectScript error (#26).
6. **AC 35.5.6** *(lead-directed scope addition, 2026-08-18, mid-dev — dev probe evidence below)* - The `delete` + `entity:"client"` branch (`Security.cls:1824`) calls `##class(OAuth2.Client).Delete(tName)`, which **does not exist** on this instance (dev verified via `%Dictionary` AND a live call: `<METHOD DOES NOT EXIST>`; only `DeleteId` exists). Client-delete is as dead as client-create was — same defect family (pre-2023 API drift), same handler, same epic goal ("no known-broken tool action"). Fix in-story: `DeleteId(tName)` resolves because `ApplicationName` is the IdKey. Probe the not-found behavior (status vs. silent OK) so the handler surfaces a clean "not found"; add the live-proof leg (create fixture client → delete via the route → verify gone) and an ObjectScript route-test leg. Constraint E-1 unaffected: an existing action's implementation corrected, no new key. Mirrored into `epics.md` Story 35.5.

## Lead pre-story probe — verified findings you may build on

Run 2026-08-18 against the live instance. No disposable classes were needed — the probes are SQL against `%SYS` (recorded so you can re-run them; re-probe anything you extend, per Rule #16).

**Probe 1 — the live `%SYS.OAuth2.Registration` API signature** (`namespace=%SYS`):

```sql
SELECT Name, FormalSpec, ReturnType FROM %Dictionary.MethodDefinition
 WHERE parent = '%SYS.OAuth2.Registration' ORDER BY Name
```

| Method | Live FormalSpec |
|---|---|
| `Discover` | `issuerEndpoint:%String, sslConfiguration:%String, *server:OAuth2.ServerDefinition` |
| `RegisterClient` | `applicationName:%String` |
| `ReadClient` / `UpdateClient` / `DeleteClientRegistration` | `applicationName:%String` |

**Probe 2 — class existence and row counts** (`namespace=%SYS`):

```sql
SELECT (SELECT COUNT(*) FROM %Dictionary.ClassDefinition WHERE Name = 'OAuth2.ServerDefinition') AS ClassExists,
       (SELECT COUNT(*) FROM OAuth2.ServerDefinition) AS ServerDefRows,
       (SELECT COUNT(*) FROM OAuth2.Client) AS ClientRows
```

Result: `ClassExists=1, ServerDefRows=0, ClientRows=0`. **The sweep's "`OAuth2.ServerDefinition` does NOT exist (`COUNT(*) = 0`)" is a ROW count, not a missing class** — the class exists; zero server definitions have ever been created. Baseline to restore after live proof: 0 server definitions, 0 clients.

**Probe 3 — irissys source matches live.** The local `irissys/%SYS/OAuth2/Registration.cls` (Copyright 2025) declares exactly the live signatures. Read it — it is the authoritative reference for this fix:

- `RegisterClient(applicationName)` (irissys `Registration.cls:68`): opens an **existing** `OAuth2.Client` by name and calls its instance `RegisterClient()`. It does NOT accept a server name or a property array.
- `Discover(issuerEndpoint, sslConfiguration, Output server)` (`Registration.cls:13`): fetches metadata via `OAuth2.ServerDefinition.GetServerMetadata`, then **saves** an `OAuth2.ServerDefinition` (inside Tstart/Tcommit, refreshing JWKS). Discovery itself MUTATES — consistent with `iris_oauth_manage:discover` being classified `write` (`baseline-classifications.ts:158`, pinned by `baseline-classifications-safety.test.ts:102`).
- `OAuth2.ServerDefinition` (irissys `OAuth2/ServerDefinition.cls`): `IssuerEndpoint` is the identity — Required, EXACT collation, unique via `IssuerIndex` on a SHA512 `Hash`. Lookup: `OpenByIssuer(issuerEndpoint, .sc)` (`:214`) — returns `""` with `sc=$$$OK` when not found. **There is no user-chosen "name"** for a server definition in this model.
- `OAuth2.Client` (irissys `OAuth2/Client.cls`): IdKey `ApplicationName` (`:12`, Required, MAXLEN=128); `ClientType` Required, VALUELIST `",public,confidential,resource"` (`:31`); `SSLConfiguration` **Required, MINLEN=1** (`:35`); `RedirectionEndpoint` As `OAuth2.Endpoint` (serial; required for public/confidential, `:40`); `Relationship ServerDefinition As OAuth2.ServerDefinition [ Cardinality = one, Inverse = Clients ]` (`:190`); `Metadata` As `OAuth2.Client.Metadata` auto-created in `%OnNew` (`:196`).
- The instance method `OAuth2.Client.RegisterClient()` (`Client.cls:346`) returns `$$$ERROR($$$OAuth2NoRegistrationEndpoint)` when `ServerDefinition.Metadata."registration_endpoint"` is empty (`:353`) — a **clean** error for issuers like Google that publish no registration endpoint. Otherwise it POSTs the client metadata to the registration endpoint and stores the returned `client_id` on the record.

### ⚠️ Premise correction to AC 35.5.1 (Rule #16/#42 — spec claim is wrong; widen scope, flag for retro)

The AC asks to "pre-validate `serverName` … before calling `RegisterClient(tServerName, .tProps)`". That cannot fix the defect: **the 2-arg call itself is invalid on this instance** — `RegisterClient` takes one argument, so `<PARAMETER>` is thrown on arity before any server-definition lookup could run. A pure pre-validation would satisfy a narrow reading of the AC while leaving the action permanently dead — against the epic goal ("no known-broken tool action"). **The fix must rework the client-create branch to the real flow:**

1. Resolve `serverName` → an existing `OAuth2.ServerDefinition` via `OpenByIssuer(serverName)`. Not found → clean `$$$ERROR($$$GeneralError, …)` naming **both** preconditions: run `discover` for the issuer first, and `discover` itself requires an SSL/TLS client configuration (name `iris_ssl_list`/`iris_ssl_manage` as the way to inspect/create one).
2. Create the `OAuth2.Client` record: `ApplicationName = clientName`, `ClientType` (from `clientType`, default per IRIS docs = `confidential`… probe the real default requirement — the property is Required with no InitialExpression), `SSLConfiguration` (source from the resolved server definition's `SSLConfiguration` — it is Required on the client and the definition already carries the one discovery used), `RedirectionEndpoint` parsed from `redirectURIs` via the **`%Net.URLParser` idiom already in this file at `Security.cls:1712-1718`** (copy it, don't invent), `ServerDefinition` = the resolved definition, `Description` when supplied. `%Save()`.
3. `##class(%SYS.OAuth2.Registration).RegisterClient(clientName)` — the real 1-arg signature.
4. Reopen the client to harvest `ClientId` into the response only when present (existing `$Data` guard pattern at line 1802 is fine). **Never return `ClientSecret`** (NFR6 — existing discipline, keep it).

A failed remote registration (e.g. `OAuth2NoRegistrationEndpoint`) leaves the local client record saved — that matches the Management Portal's configure-then-register semantics; keep the record and surface the clean error.

### ⚠️ Adjacent defect the probe surfaced — the `discover` branch is mis-shaped too

`Security.cls:1656` calls `Discover(tIssuerURL, .tConfig)` against the **3-arg** signature: `.tConfig` binds into the **by-value `sslConfiguration`** slot and the `Output server` is never received. Consequences: (a) every https discover fails with the SSL error the sweep saw, because `sslConfiguration` is always `""`; (b) even a *successful* discover returns `"configuration": {}` — the response-mapping block (lines 1671-1677) reads from an object the call never populated. **The admin README's discovery example (lines 929-940) documents a response shape the code cannot produce.**

Fix, in scope for AC 35.5.2 (the "prior successful discover" precondition must be a thing the tool can actually do):

- Additive **`sslConfiguration`** parameter on `iris_oauth_manage` (Constraint E-1: additive parameter on an existing action — NOT a new action), forwarded tool → handler, passed as `Discover`'s 2nd argument; bind the discovered server via the 3rd (`Output`) argument.
- The mapping block works unchanged once fed the real object: `IssuerEndpoint` is a plain property; `AuthorizationEndpoint`/`TokenEndpoint`/etc. exist on `OAuth2.ServerDefinition` with Metadata-backed getters (`ServerDefinition.cls:43-56`), so `$Property(tServer, "AuthorizationEndpoint")` resolves.
- Omitted `sslConfiguration` + https issuer: IRIS's native error (*"Although Https property is enabled no SSLConfiguration is specified"*) already names the problem; wrap/augment it with actionable guidance (create a client SSL/TLS configuration first via `iris_ssl_manage`) rather than passing it through bare.

## Tasks / Subtasks

- [x] **Task 1 — Re-probe the ground truth (AC 35.5.1)**
  - [x] Re-run Probe 1/Probe 2 yourself; do not rely solely on the lead's tables.
  - [x] Probe the default `ClientType` requirement and `OAuth2.Client` `%Save()` validation behavior with a disposable `ExecuteMCPv2.Temp.*` class (delete from IRIS **and** disk afterward — Rule #16).
  - [x] Confirm `OpenByIssuer` not-found semantics (`""` + `$$$OK`) live.

- [x] **Task 2 — Rework `OAuthManage` client-create (AC 35.5.1, AC 35.5.2)**
  - [x] `src/ExecuteMCPv2/REST/Security.cls`, client branch at lines 1766-1805: resolve server definition via `OpenByIssuer`, clean precondition error when absent, create `OAuth2.Client` per the probe findings, call the 1-arg `RegisterClient`, harvest `ClientId` on reopen.
  - [x] **Client-delete fix (AC 35.5.6, lead-directed):** `Security.cls:1824` — replace the nonexistent `OAuth2.Client.Delete(tName)` with `DeleteId(tName)`; probe not-found behavior first and surface a clean error for it.
  - [x] Preserve the namespace save/restore discipline (`Set $NAMESPACE = tOrigNS` before every render, `Set tSC = $$$OK` + argumentless `Quit` on every early exit) on every NEW path you add.
  - [x] Error text names the precondition chain and avoids caret-global tokens (Rule #33 — `SanitizeError` strips `^Name`). If wrapping native status text, strip exactly ONE `ERROR #` prefix (Rule #8).

- [x] **Task 3 — Fix the `discover` branch (AC 35.5.2)**
  - [x] Accept `sslConfiguration` from the body; pass as `Discover`'s 2nd arg; bind the 3rd Output arg into the existing response-mapping block.
  - [x] Omitted + https ⇒ augmented actionable error naming the SSL/TLS prerequisite and `iris_ssl_manage`.

- [x] **Task 4 — `oauth.ts` tool layer (AC 35.5.2)**
  - [x] `packages/iris-admin-mcp/src/tools/oauth.ts`: additive `sslConfiguration` zod field + wire forwarding (mirror the existing optional-string fields); `serverName` `.describe()` updated to the issuer-URL contract; tool `description` documents the full precondition chain (discover first; discover needs an SSL/TLS config) — Rule #43, this story ships its own minimal docs.
  - [x] Rule #10: send documented defaults explicitly on the wire where applicable.

- [x] **Task 5 — `rest.ts` description fix + fixture correction (AC 35.5.3)**
  - [x] `packages/iris-interop-mcp/src/tools/rest.ts:32`: state the package-name contract with a working example (e.g. `'MyApi'`). Description-only — do NOT change handler behavior to accept path-shaped names (that would be a handler change the AC requires to be called out; it is not called out, so it is out of scope).
  - [x] `packages/iris-interop-mcp/src/__tests__/rest.test.ts`: fixtures currently use `"/myapi"` throughout (lines 29-75) — replace with a value the real server ACCEPTS (Rule #54: a fake must be a shape the real API can return/accept).

- [x] **Task 6 — `e.g.` audit (AC 35.5.4, #56)**
  - [x] Mechanically enumerate every `describe()` containing `e.g.` in **both touched packages** (the grep output is in Dev Notes → *Audit surface* — re-run it, don't trust it) and check each example against its validator/handler contract.
  - [x] Report the full audit result in Completion Notes even when clean.

- [x] **Task 7 — Tests (AC 35.5.5 + Rule #59)**
  - [x] TS: extend `oauth.test.ts` — `sslConfiguration` accepted + forwarded; description strings carry the contract. Extend `rest.test.ts` — description states the package-name contract.
  - [x] ObjectScript live-route test: new `src/ExecuteMCPv2/Tests/OAuthClientValidationTest.cls` following the `SqlPrivilegeBoundTest.cls` precedent — drive the DEPLOYED `/api/executemcp/v2/security/oauth` route with `%Net.HttpRequest`: (a) client-create with a nonexistent `serverName` ⇒ clean precondition error, response does NOT contain `<PARAMETER>`; (b) https discover with no `sslConfiguration` ⇒ actionable SSL error; (c) fixture-backed local half: probe-create a throwaway `OAuth2.ServerDefinition` in %SYS (Metadata needs `authorization_endpoint` + `token_endpoint` to save — ERROR #8875 otherwise), client-create ⇒ `OAuth2.Client` record exists + clean `OAuth2NoRegistrationEndpoint`-class error (not `<PARAMETER>`), then delete both fixtures in teardown; (d) **client-delete leg (AC 35.5.6):** fixture client deleted via the route is gone, and deleting a nonexistent name yields a clean not-found — never `<METHOD DOES NOT EXIST>`. Keep the class OUT of the bootstrap manifest (Rule #39 — `ExecuteMCPv2.Tests.*` are never manifest members).
  - [x] **Mutation evidence (Rule #48/#59):** revert the validation, show the raw `<PARAMETER>` on the wire (RED), restore, show the clean error (GREEN). Same for the discover Output binding if you can construct a RED cheaply.
  - [x] Back-compat (#19): no prior working behavior exists for client-create or https discover (both always errored) — state this as the back-compat argument; TS schema tests prove the new field is optional.

- [x] **Task 8 — Docs at point of use (AC 35.5.2/35.5.3, Rule #30/#43/#56)**
  - [x] Update every surface in Dev Notes → *Doc surfaces*. Enumerate exhaustively; check `packages/iris-mcp-all/README.md` EXPLICITLY (the thrice-missed blind spot) even if the answer is "no change needed" — record the check.

- [x] **Task 9 — Constraints, ledger, gates**
  - [x] E-1: no new tool, no new action key; `sslConfiguration` is an additive parameter only. Tool/action counts unmoved (#31) — verify via the `@iris-mcp/all` suite.
  - [x] E-2: `pnpm gen:governance-baseline:check` ONLY, exit 0 at frozen `1e62c5ad5bf7`/141/201/60. Never the bare generator (#23/#25). `discover`'s `write` classification is already pinned (`baseline-classifications-safety.test.ts:102`) — verify, do not change.
  - [x] `Security.cls` is bootstrapped ⇒ `pnpm run gen:bootstrap` in-story, record `BOOTSTRAP_VERSION` from→to, re-run to confirm idempotence (Rule #24). Roster unchanged at 29 classes, `REST/Dispatch.cls` last (#39). `Interop.cls` should NOT change (description-only fix lives in TS) — if you find you must touch it, flag why.
  - [x] Verify per-package standalone — the full parallel `turbo run` is NOT reliably green in this environment independent of any diff (`35-1-DEV-1`, MEDIUM, ledgered). Do not report it as a regression.
  - [x] Ledger: move `35-SWEEP-6` and `35-SWEEP-7` to terminal RESOLVED dispositions with a mechanically-derived tally (Rule #51).
  - [x] Changeset added (patch, both packages if both changed).

## Dev Notes

### The `%Net.URLParser` idiom to copy (already in `Security.cls:1712-1718`)

```objectscript
Do ##class(%Net.URLParser).Decompose(tIssuerURL, .tUrlParts)
Set tEndpoint = ##class(OAuth2.Endpoint).%New()   // RedirectionEndpoint is an OAuth2.Endpoint serial
Set tEndpoint.Host = $Get(tUrlParts("host"))
Set tEndpoint.Port = $Get(tUrlParts("port"))
Set tPrefix = $Get(tUrlParts("path"))
If $Extract(tPrefix, 1) = "/" Set tPrefix = $Extract(tPrefix, 2, *)
Set tEndpoint.Prefix = tPrefix
Set tEndpoint.UseSSL = ($ZConvert($Get(tUrlParts("scheme")), "L") '= "http")
```

(The server branch assigns sub-properties directly on `tConfig.IssuerEndpoint`; the same works for the client record — **dev probe (2026-08-18) confirmed `Set client.RedirectionEndpoint.Host = …` auto-instantiates the serial on a fresh `%New()`** (the IRIS portal does exactly this at `%CSP.UI.Portal.OAuth2.Server.Configuration.cls:1046`), so no explicit `OAuth2.Endpoint.%New()` is needed. This supersedes the earlier note to create the endpoint explicitly.)

**Fixture requirement (dev probe, 2026-08-18):** a fixture `OAuth2.ServerDefinition` only `%Save()`s when its `Metadata` carries at least `authorization_endpoint` and `token_endpoint` (`ERROR #8875` otherwise) — the live-test fixture must set both.

### Traps

- **Arity is the defect, not the lookup.** Do not "fix" the story by adding a lookup in front of the dead 2-arg call. The call shape changes.
- **`RegisterClient` on a nonexistent client name does NOT silently succeed**: `OAuth2.Client.Open` leaves the `%OpenId` not-found status in `sc` (unlike `ServerDefinition.Open`, which swallows `LoadObjectNotFound` into `$$$OK` + `""`). Still, you pre-create the record, so this path should be unreachable — belt-and-braces `$$$ISERR` checks after every call.
- **`Discover` PERSISTS.** Even the currently-mis-bound call saves a server definition on success. Live proof must delete created `OAuth2.ServerDefinition` / `OAuth2.Client` rows afterward and verify the baseline (0/0) is restored (`OAuth2.ServerDefinition.DeleteId(id)` exists at `ServerDefinition.cls:523`; clients delete via the existing `OAuth2.Client.Delete(name)` path the handler already uses at line 1824).
- **Governance on the live proof:** `iris_oauth_manage:create`/`discover`/`delete` and `iris_interop_rest:create`/`delete` are `write`-classified but **grandfathered default-ENABLED** (pre-foundation keys — verified via `iris_server_profiles`: `configSource=default`, value `true`; the "default-disabled" population is POST-foundation writes only). The governance gate still genuinely guards them: an explicit `IRIS_GOVERNANCE` `{"global": {"iris_oauth_manage:create": false}}` refuses at the tool layer (proven in the lead smoke). No override is needed for the live proof; a direct REST-route drive bypasses MCP governance and tests the handler's own guards (Rule #26) — both layers were exercised (carry-forward from 35.4: the TS layer can hide AC violations from curl). *(Corrected at lead smoke — the original version of this note claimed default-DISABLED; wrong for grandfathered keys.)*
- **`%SYS` privilege:** `RegisterClient`/`Discover`/`OpenByIssuer` all check `$system.Security.Check(%Admin_OAuth2Client:U)` and self-elevate with `$$$AddAllRoleTemporary`; the deployed `_SYSTEM` account holds `%All`. No extra grants needed — but if a probe hits `OperationRequires`, that's why.
- **Rule #15:** never `$Get(tBody.%Get("x"), d)` — use `%IsDefined` presence checks, as the surrounding code already does.
- **Doc-comment markup:** `///` banners with DocBook markup; no `//` comments in class code; no `/* */` around method signatures (project rules).

### Audit surface (AC 35.5.4) — every `e.g.` in the touched packages, enumerated 2026-08-18

Re-run both greps; this list is a starting point, not the oracle.

- `iris-admin-mcp/src/tools`: `database.ts:27` (prose e.g., not an input example), `database.ts:36`, `mapping.ts:43,154`, `oauth.ts:48,71,83,99`, `namespace.ts:32`, `permission.ts:31,35,39`, `resource.ts:136,146`, `role.ts:26,33,42,48`, `user.ts:245`, `webapp.ts:40,48,60,251`.
- `iris-interop-mcp/src/tools`: `credential.ts:34`, `item.ts:59`, `rest.ts:32` (the defect), `production.ts:36`, `rule.ts:148`, `transform.ts:150`.

For each: is the documented example a value the handler/validator ACCEPTS? Notable prior art: `webapp.ts:40` documents `'/api/myapp'` **with** its constraint ("must start with '/'") — that is the correct pattern; `rest.ts:32` documents the example **without** the constraint, and the constraint is the opposite of the example. Most others are non-emptiness-validated free strings (no mismatch possible) — verify rather than assume.

### Constraints

- **E-1** — no new tool, no new action key. `sslConfiguration` is an additive **parameter**; description changes are docs. Tool counts must not move (#31).
- **E-2** — `GOVERNANCE_BASELINE` frozen at `1e62c5ad5bf7`/141/201/60; `:check` only (#23/#25).
- **Governance** — all four touched action keys (`iris_oauth_manage:create/delete/discover`, `iris_interop_rest:create/delete/get`) are pre-existing baseline keys; `discover` is `write` by pinned test. No classification or preset change expected. **Verify; do not assume.**
- **Rule #24** — `Security.cls` is bootstrapped ⇒ regenerate bootstrap in this same story; record `BOOTSTRAP_VERSION` from→to; confirm idempotence.
- **Rule #55** — never generate file content through a shell heredoc.

### Testing

- Existing coverage to extend, not duplicate: `packages/iris-admin-mcp/src/__tests__/oauth.test.ts` (609 lines — mocked wire forwarding; `serverName: "AuthServer"` fixtures remain valid as wire tests), `packages/iris-interop-mcp/src/__tests__/rest.test.ts` (177 lines — fixtures use the rejected `/myapi`; fix them).
- ObjectScript live-route precedent: `src/ExecuteMCPv2/Tests/SqlPrivilegeBoundTest.cls` (drives the deployed route via `%Net.HttpRequest`; disposable fixtures dropped in setup AND teardown). Follow it.
- Rule #59: prove each guard RED on the path it guards (the wire), not just that parameters parse. Rule #35: when running `iris_execute_tests`, compare `total` against the mechanical `Test*` count.
- Rule #34: this surface is %SYS-scoped (namespace-invariant), so the second-namespace rule is satisfied by noting that; the *environment* dimension that matters is the SSL-config precondition — covered by the discover proof.
- Full end-to-end client registration against a real issuer is likely UNPROVABLE on this instance (Google publishes no `registration_endpoint`; outbound internet may be unavailable). The provable contract: (a) nonexistent serverName ⇒ clean precondition error; (b) fixture-backed flow reaches the clean `OAuth2NoRegistrationEndpoint`-class error, never `<PARAMETER>`; (c) discover success path provable iff the host has outbound internet — probe it; if unavailable, record an explicit residual risk rather than claiming it.

### Doc surfaces — enumerate exhaustively (#56)

| File | What changes |
|---|---|
| `packages/iris-admin-mcp/src/tools/oauth.ts` | tool `description` (precondition chain), `serverName` describe (issuer-URL contract), new `sslConfiguration` field describe |
| `packages/iris-admin-mcp/README.md` | OAuth2 Tools table row (~line 189, parameter list gains `sslConfiguration?`); server-creation notes (~192-196); OIDC discovery example (~918-943 — the documented output shape is currently UNREACHABLE; fix it and document the `sslConfiguration` input); consider adding the client-create contract |
| `packages/iris-interop-mcp/src/tools/rest.ts` | `name` describe (line 32) |
| `packages/iris-interop-mcp/README.md` | tool table row (~line 288); create example (~822-840) — fix BOTH the rejected `"/myapi"` name AND the output shape (handler returns `{"action":"created","name":…}`; the README shows `"action":"create"` + `"status":"created"` — wrong on two counts) |
| `tool_support.md` | lines 96-97 (oauth rows), 171 (interop_rest row) — check whether the route table needs a prerequisite note |
| `packages/iris-mcp-all/README.md` | CHECK EXPLICITLY (expected: no change — it is count/package-granularity and no counts move; record the check) |
| root `README.md` | CHECK (expected: no change) |
| `src/ExecuteMCPv2/REST/Security.cls` | `OAuthManage` doc banner (~1608-1611) — document the real flow + prerequisites |
| `src/ExecuteMCPv2/REST/Interop.cls` | `RestManage` doc banner (2216-2220) — state the package-name contract for `name` (doc comment only; if the banner edit is the only Interop.cls change, it still triggers bootstrap regen — Rule #24 counts comment bytes) |

### Project Structure Notes

- Handler: `src/ExecuteMCPv2/REST/Security.cls` → `OAuthManage()` (banner 1608, body 1614+; client branch 1766-1805; discover branch 1645-1682; delete branch 1807-1829 — the client leg at 1824 IS in scope per AC 35.5.6; the server leg stays untouched). `OAuthList()` (1495-1606) is NOT in scope — see below.
- Tool layers: `packages/iris-admin-mcp/src/tools/oauth.ts` (306 lines), `packages/iris-interop-mcp/src/tools/rest.ts` (88 lines).
- Reference sources (read-only): `irissys/%SYS/OAuth2/Registration.cls`, `irissys/OAuth2/ServerDefinition.cls`, `irissys/OAuth2/Client.cls` — verified to match the live instance's signatures.
- **Known adjacent gap — ledger, don't fix:** `iris_oauth_list` lists `OAuth2_Server.Configuration` (the IRIS-as-authorization-server singleton) and `OAuth2.Client`, but NOT `OAuth2.ServerDefinition` rows — the very entities `serverName` now references. Users who forgot the issuer URL they discovered cannot list discovered definitions through the suite. Ledger as a new LOW; do not expand this story.

### Proof path

Live proof against the real deployed route AND the MCP tool layer (carry-forward #1 from 35.4: curl sits below the TS layer; drive both). The instance currently has one enabled client SSL config, `ISC.FeatureTracker.SSL.Config` (type 0/client, verifyPeer=0, `%OSCertificateStore`) — verify it still exists at proof time (`iris_ssl_list`) before relying on it for the discover success leg.

### References

- Ledger: `_bmad-output/implementation-artifacts/deferred-work.md` lines 2357-2358 (`35-SWEEP-6`, `35-SWEEP-7`)
- Epic + ACs: `_bmad-output/planning-artifacts/epics.md`, "## Epic 35" (constraints E-1/E-2) and "### Story 35.5"
- Sweep evidence: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-17.md` F6/F7 (lines 39-40)
- Rules: `.claude/rules/project-rules.md` — #6, #8, #10, #15, #16 (probe-first), #19 (back-compat proof), #24 (bootstrap), #26 (live endpoint proof), #30/#43 (docs at point of use), #31 (tool counts), #33 (SanitizeError caret stripping), #34, #35, #36, #38, #39, #48 (mutation evidence), #51 (mechanical tally), #54 (real-system shapes), #55 (no heredoc), #56 (enumeration completeness), #59 (gates proven red)
- Prior story: `35-4-bound-list-privileges.md` (status done)

### Previous story intelligence — Stories 35.3/35.4

- **The sweep's causal story can be wrong — probe the mechanism, not the symptom (35.3/35.4 both).** 35.3's recorded mechanism was confounded until isolated at the socket; here the sweep's "missing definition ⇒ <PARAMETER>" diagnosis was wrong — the probe shows an arity mismatch on a re-versioned API. Extend that habit: when your fix's error text names a precondition, verify live that the text IRIS produces actually reads the way you claim.
- **Review layers find the degenerate inputs dev missed (35.3: empty/CRLF env values, vacuous tests; 35.4: cap-fires-but-count-partial, transitive chains, vacuous pins).** Anticipate the analogues: `serverName` present-but-whitespace, `serverName` that is a valid issuer with trailing slash vs without (EXACT collation on `IssuerEndpoint` — hash lookup is exact-match; decide and document trailing-slash handling), `clientType` omitted, `redirectURIs` malformed, `sslConfiguration` naming a disabled or nonexistent config.
- **A back-compat pin must be able to fail (35.4 HIGH):** the AC 35.4.5 pin was vacuous against a no-op mock. Here: a "description states the contract" test must assert the actual string content, not `toBeTruthy()`.
- **Rule #56 doc blind spot is thrice-confirmed** — check `packages/iris-mcp-all/README.md` explicitly.
- **35-1-DEV-1 (MEDIUM, ledgered):** full parallel `turbo run` is not reliably green in this environment independent of any diff; verify per-package standalone.
- Recent commits `5ba75ca` (35.3), `d8320ef` (35.4) establish the epic's commit convention: state what was proven, how, and what was deliberately not claimed.

## Dev Agent Record

### Agent Model Used

dev-35-5 (k3[1m] / Claude Fable 5)

### Debug Log References

- Disposable probe `ExecuteMCPv2.Temp.OAuthProbe` (Rule #16 — created on disk, loaded, run, then deleted from IRIS AND disk): confirmed `OpenByIssuer` not-found = `""` + `$$$OK`; `RedirectionEndpoint` sub-property assignment auto-instantiates the serial on a fresh `%New()`; `%Save()` validation matrix (ClientType Required + VALUELIST, SSLConfiguration Required MINLEN=1, RedirectionEndpoint required for public/confidential per ERROR #8850, ServerDefinition relationship required); fixture ServerDefinition requires Metadata authorization/token endpoints (ERROR #8875); 1-arg `RegisterClient` on a fixture client → clean `ERROR #8881: Dynamic client registration endpoint is not configured.`; `OAuth2.Client.Delete` THREW `<METHOD DOES NOT EXIST>` (AC 35.5.6 trigger); `OAuth2.Client.DeleteId` on a nonexistent name errors on the internal open (probed via `iris_execute_classmethod` in %SYS); discover without SSL → native `ERROR #6159`; discover WITH `ISC.FeatureTracker.SSL.Config` → SUCCESS (outbound internet works); baseline restored 0/0 after every leg.
- Mutation RED/GREEN (Rule #48/#59): old HEAD `Security.cls` redeployed → client-create returned `ERROR #5001: ObjectScript error: <PARAMETER>` on the wire and discover with `sslConfiguration` supplied still failed with bare ERROR #6159 (RED, both captured via curl); fixed version redeployed → clean precondition error / successful discover (GREEN). Delete fix: single-line mutation (`DeleteId` → nonexistent `Delete`) → `TestClientDeleteWorksAndNotFoundIsClean` failed on the wire with `<METHOD DOES NOT EXIST>` (RED); restored → 4/4 pass (GREEN).
- MCP-tool-layer proof (carry-forward from 35.4): built dists (`shared`, `admin`, `interop` rebuilt) driven from a disposable fresh-Node smoke script (`smoke-35-5.mjs`, deleted after) against the LIVE server — 9/9 checks passed, including `sslConfiguration` forwarded on the wire and the precondition error surfaced through the tool envelope (the session's own MCP servers run the pre-story dist, so the in-session tool call demonstrated the old behavior; the fresh-process dist smoke is the tool-layer proof). The `UV_HANDLE_CLOSING` assertion after the pass line is the known benign Windows teardown noise (Rule #22).

### Completion Notes List

- **AC 35.5.1** — Client-create reworked to the real 2026.1 flow (premise-corrected): `serverName` resolves via `OAuth2.ServerDefinition.OpenByIssuer` (exact-match; not-found returns `""` + `$$$OK`, probed); a missing definition yields a clean precondition error naming BOTH prerequisites (prior `discover`; discover of an https issuer needs an SSL/TLS config via `iris_ssl_list`/`iris_ssl_manage`). The client record is built per the live-probed `OAuth2.Client` contract (ApplicationName, ClientType default `confidential`, SSLConfiguration inherited from the server definition, RedirectionEndpoint via the in-file `%Net.URLParser` idiom with serial auto-instantiation, ServerDefinition relationship, optional Description and grantTypes-as-$list Metadata), saved, then registered via the REAL 1-arg `%SYS.OAuth2.Registration.RegisterClient(clientName)`. A failed remote registration keeps the record (portal configure-then-register semantics) and the ERROR #8881-class failure is augmented to say so. `ClientId` is harvested on reopen; `ClientSecret` never returned (NFR6). Trailing-slash decision: NO normalization — the error text tells the caller the match is exact and to reuse the discovered issuer string.
- **AC 35.5.2** — Discover branch fixed: `sslConfiguration` accepted from the body and passed as Discover's 2nd argument; the discovered server is bound via the 3rd (Output) argument, so the response-mapping block now actually populates (`jwksEndpoint` now sourced from `Metadata."jwks_uri"` — no `JWKSEndpoint` property exists on `OAuth2.ServerDefinition`; the old `$Property(tConfig,"JWKSEndpoint")` line would have thrown had it ever run). Omitted `sslConfiguration` + https issuer is validated BEFORE delegating with actionable guidance naming `iris_ssl_list`/`iris_ssl_manage`. Tool description and field describes document the full precondition chain (Rule #43). Proven live: `discover` of `https://accounts.google.com` with the SSL config returned the full documented configuration shape (previously unreachable).
- **AC 35.5.3** — `rest.ts` `name` describe now states the package-name contract (`'MyApi'`, `'MyCompany.MyApi'`) with `'/myapi'` documented AS the rejected form; handler behavior unchanged (path-shaped names stay rejected — per the AC, accepting them would be a called-out handler change, out of scope). `rest.test.ts` fixtures (`/myapi`, `/test`, `/bad`) replaced with accepted package-name values (Rule #54); new description-content pin asserts actual strings, not `toBeTruthy()`.
- **AC 35.5.4** — `e.g.` audit re-run mechanically (grep over both packages' `src/tools/*.ts`): 50 hits across 18 files — the story's starting list had missed `audit.ts` (2), `ldap.ts` (2), `service.ts` (5), `message-resend.ts` (3), validating the re-run-don't-trust instruction. Every hit classified: the only input-example defect was the fixed `rest.ts:32`; everything else is prose, a value its validator accepts (`RS256` verified against the live `SigningAlgorithm` VALUELIST; `%Service_SQL`, `%Developer`, `USER`, `'MyDB:RW,MyApp:U'` etc. all real), or a format description with its constraint stated (`webapp.ts:40` is the correct pattern). Audit result: CLEAN apart from the known defect.
- **AC 35.5.5** — Live proof on BOTH layers: deployed route via curl (4 legs: unknown-issuer create → clean precondition error, no `<PARAMETER>`; https discover without SSL → actionable guidance; https discover with SSL → real Google configuration; fixture-backed create → clean augmented #8881 with record saved) and the built tool layer via fresh-Node dist smoke (9/9). All created `OAuth2.ServerDefinition`/`OAuth2.Client` rows deleted; baseline verified 0/0 after every leg.
- **AC 35.5.6** (lead-directed mid-dev addition) — Client-delete fixed: `%ExistsId` pre-check (clean "No OAuth2 client named 'X' exists") + `OAuth2.Client.DeleteId(tName)` (IdKey is `ApplicationName`). Route-test leg (d): fixture client created via the route, deleted via the route, `%ExistsId` false after; nonexistent name → clean not-found, never `<METHOD DOES NOT EXIST>`. Mutation-verified RED on the wire via the test itself.
- **Back-compat (Rule #19)** — no prior working behavior existed for client-create (always `<PARAMETER>`), https discover (always #6159), or client delete (always `<METHOD DOES NOT EXIST>`), so no working behavior changed; TS schema tests prove `sslConfiguration` is optional and absent from the wire when omitted.
- **Gates** — `BOOTSTRAP_VERSION` `b353ec0ab2e7` → `a7670fbe4f8b` (idempotent re-run confirmed; roster unchanged at 29 classes, `REST/Dispatch.cls` last; test class NOT in the manifest per Rule #39 — `bootstrap.test.ts` 46/46). Governance baseline check exit 0 (141 frozen / 201 live / 60 new; `discover`'s pinned `write` classification verified via `baseline-classifications-safety.test.ts` 36/36, unchanged). Tool/action counts unmoved (`@iris-mcp/all` 120/120, E-1). Per-package standalone: shared 1326/1326, admin 486/486 (30 oauth tests incl. 6 new), interop 337/337 (10 rest tests incl. new contract pin), all 120/120, dev 665/665, ops 348/348. ObjectScript: `ExecuteMCPv2.Tests` package 409/409 (total cross-checked against the mechanical Test* count: 416 grep hits minus 7 string literals inside `LocClassifierTest` fixture lines = 409 exactly — Rule #35). *(Corrected at QA to 410/410 and at review to 412/412 — see QA Results and Review Findings; the dev-recorded tally was stale, Rule #51.)* Full parallel turbo run not attempted per `35-1-DEV-1`.
- **`Interop.cls` note (Task 9 flag)** — Interop.cls WAS touched, but doc-banner-only (the `RestManage` banner now states the package-name contract), exactly as the story's Doc-surfaces table sanctioned; no handler behavior changed. Bootstrap regen covers it (comment bytes count, Rule #24).
- **Doc checks** — `packages/iris-mcp-all/README.md` and root `README.md` checked explicitly: neither mentions oauth/interop_rest/examples (count/package granularity; no counts move) — no change needed, as expected. `tool_support.md` rows 96-97/171 are route mappings with no example values; prerequisite notes live in the per-server READMEs — no change needed.
- **Residual risk (recorded, not claimed away)** — the discover SUCCESS leg depends on outbound internet (proven working on this instance today, captured live); it is deliberately NOT in the automated suite because a test that depends on external reachability cannot fail for the right reason (Rule #59). The route-test class covers the three deterministic legs + delete.
- **Ledger** — `35-SWEEP-6`/`35-SWEEP-7` → terminal RESOLVED; `35-5-DEV-1` (client-delete) added and resolved in-story under AC 35.5.6; `35-5-DEV-2` (LOW: `iris_oauth_list` cannot list `OAuth2.ServerDefinition` rows) added open. Ledger state: 0 HIGH / 28 MEDIUM / 93 LOW = 121 open / 195 distinct / 73 terminal (mechanical, Rule #51).
- **Changeset** — `.changeset/oauth-client-create-rest-name-contract.md` (patch: admin, interop, shared — shared carries the regenerated bootstrap embed).

### File List

- `src/ExecuteMCPv2/REST/Security.cls` (modified — client-create rework, discover 3-arg + sslConfiguration + pre-validation, client-delete fix, OAuthManage banner)
- `src/ExecuteMCPv2/REST/Interop.cls` (modified — RestManage doc banner only: package-name contract)
- `src/ExecuteMCPv2/Tests/OAuthClientValidationTest.cls` (NEW — 4 dev live-route tests + 1 QA-added degenerate-input pin + 1 review-added malformed-redirectURI pin = 6)
- `packages/iris-admin-mcp/src/tools/oauth.ts` (modified — sslConfiguration field + forwarding, serverName/tool descriptions)
- `packages/iris-admin-mcp/src/__tests__/oauth.test.ts` (modified — 6 new 35.5 tests)
- `packages/iris-admin-mcp/README.md` (modified — OAuth2 table row, discovery/client-registration notes, discovery example with live-captured output)
- `packages/iris-interop-mcp/src/tools/rest.ts` (modified — name describe)
- `packages/iris-interop-mcp/src/__tests__/rest.test.ts` (modified — fixtures to accepted values + description-contract pin)
- `packages/iris-interop-mcp/README.md` (modified — tool table row, create example name + output shape + package-name note)
- `packages/shared/src/bootstrap-classes.ts` (regenerated — BOOTSTRAP_VERSION a7670fbe4f8b)
- `.changeset/oauth-client-create-rest-name-contract.md` (NEW)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified — 35-SWEEP-6/7 RESOLVED, 35-5-DEV-1 resolved in-story, 35-5-DEV-2 added, tallies)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — story status)
- `_bmad-output/implementation-artifacts/35-5-validate-before-delegating-oauth-restname.md` (this story file)

### QA Results (2026-08-18, bmad-agent-qa / Quinn)

**Verdict: PASS.** No product-code defects found. Every dev claim that was cheap to reproduce was independently reproduced; nothing was taken from the transcript on faith.

**Priority 1 — independent live reproduction on the deployed route (Rule #26/#48), 10 curl legs against `POST /api/executemcp/v2/security/oauth` + 1 against `/interop/rest`, all on the fixed deployed code.**

- Client-create, never-discovered issuer → `ERROR #5001: No OAuth2 server definition exists for issuer '…' (issuer match is exact …). Client registration requires a prior successful discover … discover of an https issuer itself requires an IRIS SSL/TLS client configuration (inspect with iris_ssl_list; create one with iris_ssl_manage)`. No `<PARAMETER>`. ✓ AC 35.5.1/35.5.2.
- https discover without `sslConfiguration` → pre-delegation validation error naming the prerequisite, the parameter, and both SSL tools. ✓ AC 35.5.2.
- Client-delete of a nonexistent name → clean `No OAuth2 client named '…' exists`. No `<METHOD DOES NOT EXIST>`. ✓ AC 35.5.6.
- **Discover SUCCESS leg reproduced** (the leg the automated suite deliberately omits): `discover` of `https://accounts.google.com` with `ISC.FeatureTracker.SSL.Config` (verified present/enabled via `iris_ssl_list` first) returned the full documented configuration — `issuerEndpoint`, `authorizationEndpoint`, `tokenEndpoint`, `userinfoEndpoint`, `revocationEndpoint`, `jwksEndpoint` — matching the corrected admin README example field-for-field, and proving the 3rd-argument Output binding works (pre-fix code returned `"configuration": {}`). The saved ServerDefinition was used as the fixture for the degenerate legs below, then deleted; baseline re-verified 0/0.
- **Degenerate-input hunt (the story's named list), all live:** whitespace-only `serverName` → clean precondition error; `sslConfiguration` naming a nonexistent config → clean native socket error naming the config (`'QA355NoSuchConfig' is not activated`) — not augmented, but a real, actionable message, not an ObjectScript crash; trailing-slash variant of a discovered issuer (`https://accounts.google.com/`) → clean precondition error that explicitly documents the exact-match semantics — the no-normalization decision behaves exactly as documented (EXACT collation confirmed live); invalid `clientType:"bogus"` → clean `VALUELIST ',public,confidential,resource'` validation failure, no record persisted; omitted `redirectURIs` with the `confidential` default → clean RedirectionEndpoint-required error; valid create against the Google fixture → the augmented clean `OAuth2NoRegistrationEndpoint`-class error stating the record "was created and remains saved" (record verified present, then deleted **through the route** — proving the AC 35.5.6 happy path end-to-end).
- `interop/rest` rejected form: `name:"/myapi"` → clean `Application name is not a valid package name: /myapi.` — the corrected description documents exactly this rejection. Handler response shape read from source (`{"action":"created","name":…}`) — matches the corrected interop README output example. ✓ AC 35.5.3/35.5.5.
- **Defect mechanism independently grounded (Rule #16):** live `%Dictionary.MethodDefinition` re-probe confirms `RegisterClient(applicationName)` is 1-arg and `Discover(issuerEndpoint, sslConfiguration, *server)` is 3-arg on this instance — the arity-error premise correction is correct.

**Priority 2 — independent wire-level mutation verification (Rule #48/#59), AC 35.5.6 leg.** QA performed its own mutation rather than trusting the dev's: copied working-tree `Security.cls` to a scratch dir, applied the single-line mutation `DeleteId(tName)` → `Delete(tName)`, deployed via `iris_doc_load` + compile to HSCUSTOM, and ran `OAuthClientValidationTest.TestClientDeleteWorksAndNotFoundIsClean` → **RED, 5 failed assertions**, wire error `ERROR #5001: ObjectScript error: <METHOD DOES NOT EXIST>OAuthManage *Delete,OAuth2.Client` — the exact pre-fix defect, caught by the test. Restored the real file via `iris_doc_load` from `src/**/Security.cls` + compile → **GREEN (1/1)**, post-restore curl sanity leg clean, scratch dir removed, `git status` clean of artifacts. The gate provably fails on the path it guards (the wire), not just in mocked parameter parsing. The dev's own RED/GREEN evidence for the other two legs (create/discover) is consistent with everything QA observed and was not re-run (redundant with QA's mutation of the third leg plus the 11-leg live reproduction above).

**Priority 3 — audits, tallies, suites, gates.**

- **AC 35.5.4 audit re-run mechanically (Rule #56):** `grep -rn "e\.g\."` over both touched packages' `src/tools/*.ts` yields **51 hits across 19 files** — the dev recorded 50/18. The dev's enumerated coverage (the story's 15-file starting list + audit/ldap/service/message-resend) matches QA's mechanical file list exactly, so coverage was complete; the tally itself was off by one on both axes (the +1 hit is at least partly the dev's own new `sslConfiguration` describe, added after the audit ran). QA re-classified all 51: every example is prose, a format-with-constraint-stated (webapp.ts:40 pattern), or a value its validator accepts — `RS256` re-verified against the live `SigningAlgorithm` VALUELIST (`,HS256,…,RS256,…`), `'%Service_SQL'`, `'%Developer'`, `'USER'`, `'MyDB:RW,MyApp:U'` etc. all real. Substantive verdict confirmed: the only input-example defect was the fixed `rest.ts:32`.
- **Ledger (Rule #51):** `35-SWEEP-6`/`35-SWEEP-7` terminal-RESOLVED rows present and accurate in substance; `35-5-DEV-1` resolved-in-story; `35-5-DEV-2` open LOW. The global tally (0/28/93 = 121 open / 195 distinct / 73 terminal) is an unbroken arithmetic chain from the previously-accepted 35.4 state (0/30/92 = 122/192/70 at line 2688): −2 MEDIUM terminal, +1 LOW open, +1 distinct+terminal (DEV-1, never open); every step shows its work and the internal check (0+28+93=121) passes. A whole-file independent recount is not mechanically feasible (pre-Epic-30 sections predate the current ID scheme) — accepted on chain-of-custody plus per-edit verification, same basis as prior passes.
- **Suites, standalone, sequential (never the parallel turbo run):** shared 1326/1326 (65 files), admin 486/486 (34 files; oauth.test.ts 30 tests incl. 6 new — counted), interop 337/337 (22 files; rest.test.ts 10 tests incl. the content pin — counted), all 120/120 (18 files; E-1 tool counts unmoved). `ExecuteMCPv2.Tests` package: **410/410**, and the Rule #35 mechanical cross-check matches EXACTLY: 410 anchored `Method Test…(` signatures on disk = 410 reported (the 7 raw-grep extras are 6 string literals in `LocClassifierTest` fixture lines + 1 prose mention — QA re-derived this, not trusted). The dev's recorded "409" was off by one in the safe direction; reality is 410/410 with a matching count.
- **Gates:** `pnpm gen:governance-baseline:check` exit 0 (141 frozen / 201 live / 60 new — E-2 holds, `discover` write-classification untouched). `pnpm run gen:bootstrap` re-run by QA: `BOOTSTRAP_VERSION` unchanged at `a7670fbe4f8b` (idempotent; content hash), 29 classes, `REST/Dispatch.cls` last, no `ExecuteMCPv2.Tests.*` in the roster (Rule #39). E-1: `sslConfiguration` is an additive optional field; the omit-when-absent wire behavior is pinned by a TS test.
- **Docs (Rule #30/#43/#56):** admin README discovery example now matches the live-captured response exactly; precondition chain documented at the tool, field, and README levels; interop README create example fixed on all three counts (name, action value, output shape — verified against the handler source); `packages/iris-mcp-all/README.md` and root `README.md` re-grepped by QA — zero oauth/interop_rest/example mentions, "no change needed" confirmed; `tool_support.md` rows 96-97/171 are route mappings with no example values — confirmed. epics.md carries the AC 35.5.6 mirror.
- **Residual state:** `OAuth2.ServerDefinition` = 0 rows, `OAuth2.Client` = 0 rows, zero `QA355*`/`Story355*` leftovers (all QA fixtures removed: Google ServerDefinition deleted via `DeleteId`, `QA355Real` deleted through the route itself); no `ExecuteMCPv2.Temp.*` classes in HSCUSTOM, %SYS, or USER; mutation scratch dir removed from disk.

**QA-added coverage:** `TestInvalidClientTypeGivesCleanValidationError` in `OAuthClientValidationTest.cls` — pins the story-named "clientType invalid" degenerate input on the deployed route: clean VALUELIST error, never `<PARAMETER>`, and no record persisted after the rejected `%Save`. Loaded via `iris_doc_load`, compiled clean, class now **5/5** (total=5 matches the 5 Test* methods). Bootstrap roster untouched (test classes are never manifest members, Rule #39).

**Findings (all LOW; none block):**

1. **(LOW, lead decision) Rule #8 nuance — nested `ERROR #` prefix, intentionally labeled.** The augmented registration error reads `ERROR #5001: Client record '…' was created and remains saved, … Native error: ERROR #8881: Dynamic client registration endpoint is not configured.` (verified on the wire). Rule #8 says strip ONE leading prefix before re-wrapping; here the inner prefix is mid-message behind an explicit `Native error:` label, which reads as deliberate and is arguably more useful than a stripped fragment. Recorded for a lead call: acceptable as-is, or strip the inner `ERROR #8881: ` prefix for strict rule conformance.
2. **(LOW, cosmetic) Malformed `redirectURIs` is reported as "RedirectionEndpoint required" rather than "malformed".** `%Net.URLParser.Decompose`'s return status is unchecked; garbage input decomposes to an empty endpoint serial, so the %Save `ERROR #8850`-class required-field error fires. Clean and non-crashing (verified live), but a caller who DID supply a redirect URI gets a "required" message. A `$$$ISERR`/empty-host check after `Decompose` could name the real problem. Not a regression — the pre-fix code never reached this path at all.
3. **(LOW, record-keeping — Rule #51 pattern) Three stale hand-tallies in story artifacts.** Dev-recorded "50 hits / 18 files" (audit) vs measured 51/19; ledger `35-SWEEP-6` row and the changeset both say "3 tests" for `OAuthClientValidationTest` (actual: 4 at dev close, 5 after QA's addition); Completion Notes recorded "409/409 (416−7)" for the ObjectScript package vs the verified 410/410 (= the exact disk signature count). All three are conservative/miscounted-by-one with the underlying coverage verified complete — the class of slip Rule #51 exists to catch. Suggest correcting the ledger row and changeset counts at commit time.

**Rule #54 check:** every new fixture/test value is a shape the real server accepts — `rest.test.ts` now uses `MyApi`/`TestApi`/`BadApi` (all `$ZNAME`-valid); the OAuth fixture issuer is a real https URL whose placeholder SSL config name is documented as never dereferenced (registration fails fast before any HTTP); the test's `_SYSTEM`/`SYS` defaults are overridable via `^UnitTestConfig("OAuth",…)`. The description-content pins assert actual strings (not `toBeTruthy`), per the 35.4 vacuous-pin lesson.

## Review Findings (2026-08-18, cr-35-5 — bmad-code-review, Rule #57 machinery)

**Close kind: CLEAN.** All three adversarial layers DELIVERED explicit findings payloads well inside the 20-minute hard bound (real armed background timer): Blind Hunter (11 findings), Edge Case Hunter (6), Acceptance Auditor (4). `failed_layers` empty, `review_degraded` = false. Frozen diff snapshot `review-diff-snapshot-35-5-...-20260818-184513.diff` taken at review start, reviewed by all layers, disposed at close. 21 raw findings → 14 after dedupe: **7 patched in-story, 4 dismissed, 2 flagged-to-lead, 1 resolved-by-reviewer-live-proof; 0 surviving HIGH/MEDIUM, 0 decision-needed outstanding.**

Reviewer verification beyond the layers (the epic's carry-forward bar): `%Dictionary.MethodDefinition` re-probed live — `RegisterClient(applicationName)` is 1-arg and `Discover(issuerEndpoint, sslConfiguration, *server)` is 3-arg on this instance (the premise correction stands). QA's wire mutation evidence (DeleteId→Delete RED) reviewed and judged sound; the reviewer mutation-verified the NEW review-added guard (see Patch 1) RED→GREEN on the wire. AC 35.5.5's interop accepted-form leg was proven fresh by the reviewer (Auditor finding A4): `Cr355Api` created live via the deployed route → `{"action":"created","name":"Cr355Api"}` (exactly the corrected README shape) → deleted → verified gone; the leftover generated `Cr355Api.impl.cls` removed (see Flag 2). OAuth2 baseline re-verified 0/0 after all review activity.

### Patched in-story (7)

- [x] **[Review][Patch] Malformed `redirectURIs` misreported as "RedirectionEndpoint required"** [`Security.cls` client-create] (QA LOW #2 + Auditor A3 + Edge E3; lead lean: patch) — `%Net.URLParser.Decompose` never errors on garbage (Edge verified live: garbage in → empty host out), so a supplied-but-unparseable URI fell through to the %Save required-field error. Now: an empty-host check right after `Decompose` renders a clean "not a parseable absolute URL (no host found)" error before any save. Pinned by new route test `TestMalformedRedirectUriGivesCleanError` (class now 6 tests), **mutation-verified by the reviewer on the wire**: guard removed → RED with exactly QA's misleading message (`These properties are required … RedirectionEndpoint`); restored → GREEN 6/6.
- [x] **[Review][Patch] `grantTypes` and array-form `redirectURIs` legs shipped with zero coverage** [`Security.cls:1889-1905`] (Blind B1, the only MEDIUM) — the hypothesized mechanism (`<INVALID OREF>` on `Metadata."grant_types"`) was falsified against `irissys/OAuth2/Client.cls:193-197` (`%OnNew` auto-creates `Metadata`) and `irissys/OAuth2/Client/Metadata.cls:73` (`grant_types` is a declared `%List` property — a `$ListBuild` assignment is the documented portal idiom, not a dynamic-property gamble). The REAL residual was coverage: `TestFixtureBackedClientCreateReachesCleanRegistrationError` now drives the JSON-ARRAY forms of both `redirectURIs` and `grantTypes` and asserts the saved record's content live (grant_types $list carries both grants; `RedirectionEndpoint.Host = "localhost"`; `UseSSL = 0` for the http URI). GREEN on the wire — the paths work as written.
- [x] **[Review][Patch] Non-endpoint `RegisterClient` failures stranded the saved record silently, and the curated branch was keyed on a case-sensitive English substring** [`Security.cls` post-RegisterClient] (Blind B4+B5 / Edge E1+E2) — the "record remains saved" disclosure now fires for EVERY registration failure (with the retry path named: delete the record before re-creating), and the no-endpoint class is matched on its error CODE (`#8881`, which survives message localization per Rule #13's evidence) instead of the English substring. The fixture-leg test assertions (`"registration endpoint"` / `"remains saved"`) still pass unchanged.
- [x] **[Review][Patch] Whitespace degenerate inputs bypassed the discover pre-validation** [`Security.cls` discover branch] (Blind B6) — `issuerURL` and `sslConfiguration` are now `$ZStrip(...,"<>W")`-normalized at read, so a whitespace-only `sslConfiguration` gets the friendly validation error and a padded https issuer cannot slip past the prefix check into the bare native #6159.
- [x] **[Review][Patch] `DropFixture` did not cover the designed-never-saved client names** [`OAuthClientValidationTest.cls`] (Blind B7 / Edge E4) — a validation-order regression would have orphaned `Story355BadType`/`Story355NeverCreated` rows forever, falsifying the class's self-healing banner. All four names (plus `Story355NeverExisted`, `Story355BadRedirect`) are now in the cleanup loop.
- [x] **[Review][Patch] Fixture setup failures were swallowed into confusing downstream assertion failures** [`OAuthClientValidationTest.cls` `OnBeforeOneTest`/`OnAfterOneTest`] (Edge E5) — statuses now propagate (`Quit ..DropFixture()` / `DropFixture` then `BuildFixture` chained on `$$$ISOK`).
- [x] **[Review][Patch] Stale hand-tallies in shipped artifacts** (QA LOW #3 / Auditor A1 / Blind B11 / Edge E6; lead: fix at review if convenient) — changeset and ledger `35-SWEEP-6` row now say **6 tests** (was "3"); ledger audit tally corrected to **51 hits / 19 files** (was 50/18); dev Completion Notes "409/409" annotated — the post-review package reality is **412/412** (runner total == mechanical `Method Test\w+(` disk count of 412 exactly, Rule #35; the 2-test drift vs QA's recorded 410 = the review-added test + one counting-pattern delta between QA's and this review's anchored regex — both derivations agree against the CURRENT tree, which is what the gate needs).

### Dismissed (4, with reasoning)

- [x] **[Review][Dismiss] Nested `ERROR #8881:` retained after the explicit "Native error:" label** (QA LOW #1 / Auditor A2 / Blind B3; lead lean: ACCEPT — **confirmed**) — Rule #8's strip-one-prefix discipline exists to kill the AMBIGUOUS double prefix (two stacked errors reading as one garbled message). Here the inner prefix sits behind an explicit provenance label, so the wrap reads as one outer error quoting a native cause; the `#8881` code is the searchable diagnostic. Both QA and the Auditor independently leaned accept. The reviewer accepts deliberately; the lead may still override at the commit gate.
- [x] **[Review][Dismiss] `UseSSL=1` for any non-"http" scheme** (Blind B2) — the idiom is the story-directed verbatim copy of the in-file server-branch pattern ("copy it, don't invent"); after Patch 1 the missing-scheme garbage case is rejected outright, and custom-scheme redirect URIs (native-app `com.example:/callback`) are outside the `OAuth2.Endpoint` host/port/prefix model entirely. No reachable wrong-polarity case remains for http/https input.
- [x] **[Review][Dismiss] Default `_SYSTEM`/`SYS` credentials in the test class** (Blind B8) — documented local-dev convention, the `SqlPrivilegeBoundTest` precedent, and overridable via `^UnitTestConfig("OAuth",…)` for any other instance.
- [x] **[Review][Dismiss] Blind B1's `<INVALID OREF>` / JSON-serialization mechanism** — falsified by irissys source (see Patch 2); only the coverage gap was real, and it is patched.

### Flagged to lead (2 — not reviewer-patched)

- [x] **[Review][Flag] Cycle-log rows for 35.5 break the file's format** (Blind B9) — `story_created` (17:01:05Z) sits after the 17:50 handoff row, and the `lead_decision` row carries no timestamp. The embedded timestamps are accurate (the ordering is a session-restart append artifact), so the reviewer did not rewrite the lead's log rows; normalize at commit if you care.
- [x] **[Review][Flag] `iris_interop_rest` delete leaves the generated `.impl` class behind** (reviewer observation during the A4 live proof) — create of `Cr355Api` generated `spec`/`disp`/`impl`; route delete removed the app but left `Cr355Api.impl.cls` (reviewer deleted it manually; instance verified clean). Plausibly by-design (the impl class is user-editable code; deleting it would destroy user work) — pre-existing handler behavior, untouched by this diff. Lead call: ledger as LOW, or accept-by-design with a doc note.

### Post-patch gates (all re-run by the reviewer)

- `ExecuteMCPv2.Tests` package: **412/412**, runner total == mechanical disk signature count (412 == 412, Rule #35). `OAuthClientValidationTest` 6/6 including the review-added guard test (mutation-verified RED→GREEN).
- Per-package standalone (never the parallel turbo run, per 35-1-DEV-1): shared **1326/1326**, admin **486/486**, interop **337/337**, all **120/120** (E-1 tool/action counts unmoved).
- `pnpm gen:governance-baseline:check` (:check ONLY) exit 0 — 141 frozen / 201 live / 60 new (E-2).
- `pnpm run gen:bootstrap`: `a7670fbe4f8b` → **`e1168c1ebe56`** (Security.cls content changed by the review patches), re-run idempotent, roster 29 classes with `REST/Dispatch.cls` last, no `ExecuteMCPv2.Tests.*` in the manifest (Rule #39, Auditor-verified against `gen-bootstrap.mjs`).
- Doc surfaces: Auditor independently re-grepped `packages/iris-mcp-all/README.md` and root `README.md` — "no change needed" confirmed (Rule #56 blind spot explicitly checked).
- Instance residual state: `OAuth2.ServerDefinition`/`OAuth2.Client` 0/0; no `Cr355*` classes in HSCUSTOM; no review scratch files (`Security.cls.reviewbak` consumed by the restore; frozen diff snapshot disposed).

## Change Log

| Date | Change | Author |
|---|---|---|
| 2026-08-18 | Code review complete (bmad-code-review, 3 adversarial layers, ALL DELIVERED within the Rule #57 20-minute bound against a real armed timer — failed_layers empty, close CLEAN, frozen-diff snapshot used and disposed). 21 raw findings → 14 after dedupe: 7 patched in-story / 4 dismissed / 2 flagged-to-lead / 1 resolved by reviewer live proof; 0 surviving HIGH/MEDIUM. The only MEDIUM (Blind: grantTypes/redirectURIs-array legs shipped with zero coverage) was closed by extending the fixture-backed route test to drive both array forms and assert the saved record's content live (the hypothesized <INVALID OREF> mechanism was falsified against irissys source: Metadata auto-created in %OnNew, grant_types a declared %List). Patches: malformed-redirectURI guard (QA LOW #2) with new route test TestMalformedRedirectUriGivesCleanError, mutation-verified RED→GREEN ON THE WIRE by the reviewer (guard removal reproduced exactly QA's misleading "RedirectionEndpoint required"); registration-failure disclosure now fires for EVERY RegisterClient failure class with the delete-before-retry path named, no-endpoint class matched on error CODE #8881 instead of a locale-fragile English substring; $ZStrip normalization of discover issuerURL/sslConfiguration (whitespace degenerate inputs); DropFixture covers all five client names; OnBeforeOneTest propagates fixture setup status; stale tallies corrected (changeset/ledger "3 tests" → 6, audit 50/18 → 51/19, dev "409/409" annotated — package verified 412/412 with runner total == mechanical disk signature count). Dismissed per lead lean with independent reasoning: the labeled "Native error: ERROR #8881:" nest (Rule #8's harm is the ambiguous double prefix; the label disambiguates and the code is diagnostic). Flagged to lead: cycle-log 35.5 row format (lead's own log); interop delete leaves the generated .impl class (plausibly by-design — lead call). AC 35.5.5 interop accepted-form leg proven FRESH by the reviewer (live create → {"action":"created"} → delete → verified gone, impl-class leftover cleaned). Gates re-run post-patch: OS package 412/412, class 6/6; shared 1326/1326, admin 486/486, interop 337/337, all 120/120 (E-1 unmoved); governance :check exit 0 (141/201/60, E-2); bootstrap a7670fbe4f8b → e1168c1ebe56, idempotent, roster 29/Dispatch last, no Tests classes (Rule #39); iris-mcp-all + root README explicitly re-checked (Auditor, Rule #56); instance residual 0/0 OAuth2 rows, no review leftovers. Status: review → done. | cr-35-5 |
| 2026-08-18 | QA pass (bmad-agent-qa / Quinn). Independently reproduced every live claim on the deployed route (10 curl legs, all clean; discover-with-SSL success leg reproduced with the full documented configuration shape); independently mutation-verified the AC 35.5.6 delete leg RED on the wire (`DeleteId`→`Delete` redeploy → `<METHOD DOES NOT EXIST>` → restore → GREEN); re-ran the AC 35.5.4 `e.g.` audit mechanically (51 hits / 19 files post-edit vs dev's recorded 50/18 — the enumerated coverage is complete and correct, the tally was off by one; every example verified against its validator, `RS256` re-verified against the live VALUELIST); re-ran all four touched suites standalone (shared 1326/1326, admin 486/486, interop 337/337, all 120/120) plus `ExecuteMCPv2.Tests` 410/410 with the Rule #35 count matching the disk signature count exactly; governance baseline check exit 0 (141/201/60); bootstrap regen idempotent at `a7670fbe4f8b` (29 classes, Dispatch last, no Tests classes); ledger edits verified (both sweeps terminal, DEV-1 resolved in-story, DEV-2 open LOW, tally arithmetic chain consistent). Added 1 QA test (`TestInvalidClientTypeGivesCleanValidationError`). No product defects found; three LOW record-keeping/UX observations recorded in QA Results (nested `ERROR #` prefix after an intentional "Native error:" label; malformed redirectURI reported as "RedirectionEndpoint required"; three stale "3 tests"/"50 hits/18 files"/"409" hand-tallies vs the verified 4-then-5 / 51/19 / 410 reality — Rule #51 pattern). Instance left at the 0/0 OAuth2 baseline with no Temp classes. | qa-35-5 |
| 2026-08-18 | Story created. Lead pre-story probe (live SQL against %SYS, no disposable classes) established: `%SYS.OAuth2.Registration.RegisterClient` is 1-arg on this instance (the F6 `<PARAMETER>` is an ARITY error, not a lookup miss — AC 35.5.1 premise corrected, flagged for retro); `Discover` is 3-arg and the handler's 2-arg binding leaves `configuration` unreachable; `OAuth2.ServerDefinition` exists with 0 rows; baseline 0 server definitions / 0 clients to restore after live proof; governance already classifies all touched keys (`discover` = write, pinned). | Lead (claude-opus-5) |
| 2026-08-18 | Lead-directed scope addition mid-dev (AC 35.5.6): dev probe found the client-DELETE branch equally dead (`OAuth2.Client.Delete` does not exist — only `DeleteId`; verified via %Dictionary + live `<METHOD DOES NOT EXIST>`). Fixed in-story per the epic's no-known-broken-action goal (35.1 durability precedent). Dev probe also confirmed: `RedirectionEndpoint` sub-property assignment auto-instantiates the serial (Dev Notes corrected), a fixture ServerDefinition requires Metadata `authorization_endpoint` + `token_endpoint` to %Save (ERROR #8875), and outbound internet works — `Discover("https://accounts.google.com", "ISC.FeatureTracker.SSL.Config")` succeeded live (fixture cleaned up), so the discover success path is provable. | Lead (claude-opus-5) |
| 2026-08-18 | Dev complete: client-create reworked to the 1-arg RegisterClient flow with OpenByIssuer pre-validation; discover fixed (3-arg binding, additive sslConfiguration, https pre-validation); client-delete fixed (AC 35.5.6); rest.ts name contract corrected; e.g. audit clean (50 hits/18 files, one defect = the known one); 4 live-route ObjectScript tests + 7 new TS tests; mutation RED/GREEN on the wire for all three fixed paths; live proof on route AND built tool layer; bootstrap regen b353ec0ab2e7 → a7670fbe4f8b (idempotent); governance baseline check exit 0; all per-package suites green standalone. | dev-35-5 |
| 2026-08-18 | Lead smoke PASS (method: raw REST 6 legs + MCP tool layer 13/13 via fresh-Node against the BUILT dists — this session's own MCP servers run the pre-story dist). Smoke CAUGHT one residual same-class defect the dev/QA/review chain missed: the corrected interop README create example still specified `"openapi": "3.0.0"`, which `%REST.API.CreateApplication` on this instance rejects ("Correct OpenAPI 2.0 version was not specified") — fixed to `"swagger": "2.0"` and proven working on the deployed route (create → `{"action":"created"}` → delete → clean; the by-design `.impl` remnant removed manually, ledgered as `35-5-SMOKE-1` LOW for a 35.8 doc note). Also corrected the story's own Dev Notes governance claim: the touched write keys are grandfathered default-ENABLED (`iris_server_profiles` configSource=default/true), and the governance gate was instead proven by an explicit opt-out refusal. Gates re-verified post-smoke: ExecuteMCPv2.Tests 412/412 (Rule #35 match), `gen:governance-baseline:check` exit 0 (141/201/60), bootstrap regen idempotent (hash-identical re-run, `e1168c1ebe56`), interop 337/337 + all 120/120 after the README fix, OAuth baselines 0/0, no smoke residue. | Lead (claude-opus-5) |
