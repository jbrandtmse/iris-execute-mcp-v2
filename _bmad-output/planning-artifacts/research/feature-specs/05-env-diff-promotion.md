# Spec 05 — `iris_env_diff` / `iris_env_promote`: Cross-Profile Drift Detection & Promotion

**Server:** `@iris-mcp/dev` (tools) + `@iris-mcp/shared` (one framework extension) | **Priority:** 5 (moat feature) | **Effort:** ~5 stories (1 epic; Phase 1 = stories 1–2 is independently shippable)
**Governance:** `iris_env_diff` → `mutates: "read"`; `iris_env_promote` → `{ plan: "read", execute: "write" }`, `execute` **default-disabled**
**Prereqs:** requires `IRIS_PROFILES` with ≥2 reachable instances for meaningful production use.
**Test-environment decision (stakeholder, 2026-07-07):** for this project's build/smoke cycle, **two
profiles on the single dev instance** (same host/port, different default namespaces) is accepted as
sufficient. The Story-5 capstone runs in that shape and MUST record an explicit residual-risk note
(no cross-instance / cross-IRIS-version drift coverage — e.g. version-skew normalization is exercised
only logically, not against real skew). If a second instance becomes available by Story 5, prefer it.
**Read first:** [`00-conventions.md`](00-conventions.md), `packages/shared/src/profiles.ts`,
`packages/shared/src/server-base.ts` (how the `server` param resolves to a per-profile client),
`packages/shared/src/http-client.ts`, `packages/iris-dev-mcp/src/tools/` (doc tools),
`src/ExecuteMCPv2/REST/Config.cls` (mappings), `src/ExecuteMCPv2/REST/Interop.cls` (SDS handlers),
`src/ExecuteMCPv2/REST/Security.cls` (webapp handlers)

## 1. Objective

The only feature in this set no competitor can copy without first rebuilding multi-instance
profiles. `iris_env_diff` compares two configured profiles (e.g., `stage` vs `prod`) across
code and configuration and returns a structured drift report. `iris_env_promote` turns a diff
into an ordered plan and (gated) executes it. Answers "what's different between stage and
prod?" — today a manual export/compare — in one call, covering exactly the surfaces that live
OUTSIDE git in real IRIS shops (mappings, System Default Settings, web apps).

## 2. Framework extension — second-profile client access

Tool handlers receive `ctx.http` bound to the call's resolved profile. Diff needs TWO clients.
Add to `ToolContext` (in `tool-types.ts` + `server-base.ts`):

```typescript
/** Resolve an HTTP client for a named profile (same pool/session reuse as `server` resolution).
 *  Throws a clear error naming known profiles when the name is unknown. */
resolveProfileClient(profileName: string): IrisHttpClient;
```

Implement by reusing the EXACT per-profile client construction/caching the `server` param
resolution already uses (do not duplicate session/cookie logic — extract if needed).
**Back-compat (Rule #19):** additive context field; snapshot test that existing tools see no
behavioral change. Governance note: the per-call governance gate resolves against the CALLING
profile (`server` param); document that diff reads the second profile ungated (it is read-only
by construction) and promote WRITES only to the `target` profile — see §4 gate note.

## 3. `iris_env_diff`

```
scope: "NONE" (profiles are explicit params; per-domain namespace params below)
annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false, destructiveHint: false }
```

**Input:** `source: string` (profile), `target: string` (profile), `domains?: enum[]`
(default all: `documents`, `mappings`, `defaultSettings`, `webapps`, `config`),
`spec?: string` (REQUIRED when `documents` included — package/doc spec like `MyApp.*.cls`;
Rule #38: no whole-namespace default; description documents the timeout risk for wide specs),
`namespace?: string` (applies to both sides; default = each profile's default namespace),
`ignoreTimestamps?: boolean` (default true — compare by content hash only).

**Output (`structuredContent`):**
```json
{ "source": {"profile":"stage","namespace":"HSCUSTOM"}, "target": {...},
  "domains": { "documents": {
      "onlyInSource": ["MyApp.NewThing.cls"], "onlyInTarget": [],
      "differs": [{"name":"MyApp.Svc.cls","sourceHash":"...","targetHash":"...",
                    "sourceTs":"...","targetTs":"..."}],
      "identical": 41 },
    "mappings": { "onlyInSource": [...], "onlyInTarget": [...], "differs": [...] },
    "defaultSettings": {...}, "webapps": {...}, "config": {...} },
  "summary": { "driftCount": 7, "identicalCount": 63 } }
```

**Per-domain comparison sources:**

| Domain | How to enumerate/compare | Notes |
|---|---|---|
| `documents` | New ObjectScript hash endpoint (§3.1) called on BOTH profiles; compare name→hash maps | Source-content hash, not compiled artifacts (cross-IRIS-version safe) |
| `mappings` | Existing mapping-list endpoint per profile | global/routine/package incl. subscript-level; compare full tuples |
| `defaultSettings` | Existing SDS list endpoint per profile | compare (production,item,hostClass,setting)→value; values may embed secrets — see §6 redaction AC |
| `webapps` | Existing webapp list/get endpoints | compare a curated property subset (name, dispatchClass, enabled, authFlags, path-independent fields); EXCLUDE instance-specific paths by default |
| `config` | Existing config get (the ~11 supported keys) | small, exact compare |

### 3.1 New ObjectScript endpoint — document hashes

`GET/POST /dev/doc/hashes` (Dispatch route → new method in an appropriate REST class, likely a
small new `EnvSync.cls`): input `{spec, namespace}`; output array of
`{name, hash, timestamp}` for every doc matching the spec. Hash = SHA-256 over the document's
UDL source lines, normalized (join with `$Char(10)`, exclude the storage-section? NO — include
everything; storage differences are real drift) via `$SYSTEM.Encryption.SHAHashStream` or
`SHAHash` `[PROBE: verify exact method name + arg order in irislib/%SYSTEM/Encryption.cls
before use]`. Enumerate docs the same way existing doc-list handlers do. Require `spec`
(reject `*` with the Rule #38 guidance unless `allowWide: true` passed, and document the
timeout risk).

## 4. `iris_env_promote`

**Input:** `action: "plan" | "execute"`, `source`, `target`, `diff?: object` (a prior
`iris_env_diff` structuredContent — required for `plan`), `plan?: object` (a prior `plan`
output — required for `execute`), `steps?: number[]` (allowlist of plan step indices to
execute; **required** for `execute`), `confirm?: boolean` (**required true** for `execute`),
`namespace?`.

- **`plan` (read):** transforms a diff into an ordered step list — dependency order:
  `mappings` → `documents (put+compile, batched)` → `defaultSettings` → `webapps` → `config`.
  Each step: `{index, domain, operation, subject, detail, direction: "sourceToTarget"}`.
  Steps for `onlyInTarget` items are emitted as `warning` entries (something exists on target
  only) — NEVER as automatic deletions.
- **`execute` (write, default-disabled):** executes ONLY the allowlisted step indices, in plan
  order, halt-on-first-error (report completed/failed/skipped per step). Implementation calls
  the SAME HTTP endpoints the existing tools use (doc get from source → doc put to target →
  compile; mapping create; SDS set; webapp modify) — reuse the package's existing request
  helpers; do NOT reimplement handler logic. No deletions of any kind in v1.
- **Gate note:** `execute` must ALSO consult the governance policy of the **target** profile
  for the underlying write families `[design decision — implement as: refuse execute when the
  target profile's policy disables iris_doc_put / mapping / SDS writes, naming the blocking
  key]`. This prevents `server:"stage"` calls from writing to a governance-locked `prod` target.
- Refusals (missing confirm, missing steps allowlist, plan/diff mismatch hash) follow the
  standard envelope, mutate nothing, and are live-smoke assertions (Rule #26). Plans embed a
  content hash of their diff; `execute` verifies it to prevent stale-plan execution.

## 5. Story breakdown

1. **Story 1 (1.5):** framework `resolveProfileClient` + back-compat test; ObjectScript hash
   endpoint (+probe of SHAHash API, +unit tests, deploy loop, bootstrap regen); `iris_env_diff`
   documents domain end-to-end.
2. **Story 2 (1):** remaining diff domains (mappings, SDS, webapps, config) + redaction (§6
   AC 6) + unit tests with fixture payloads for every domain's three buckets.
3. **Story 3 (1):** `promote:plan` generator + ordering + warnings + plan-hash.
4. **Story 4 (1):** `promote:execute` + allowlist/confirm/target-governance gates + halt-on-error
   + unit tests.
5. **Story 5 (1):** docs rollup (Rule #30: `execute` default-disabled prominently) + live
   smokes: two live profiles; seed drift (one class edit, one SDS change, one mapping on source);
   diff detects exactly the seeded drift; plan orders it correctly; execute with allowlist
   promotes it; re-diff shows clean. Rejection smokes: no-confirm, no-allowlist, stale-plan,
   governance-disabled execute, wide-spec-without-allowWide. Rule #34: run diff against a second
   namespace pair.

## 6. Acceptance criteria

1. Diff of two live profiles with seeded drift reports exactly the seeded items in the right
   buckets, and `identical` counts are plausible.
2. Hash comparison is stable across repeated calls (idempotent) and insensitive to timestamp-only
   differences when `ignoreTimestamps:true`.
3. `documents` domain without `spec` is refused with Rule #38 guidance.
4. Plan ordering: mappings before documents before SDS; `onlyInTarget` emitted as warnings, no
   delete steps exist anywhere.
5. Execute runs ONLY allowlisted steps, halts on first error with per-step statuses, and
   requires `confirm:true` + fresh plan hash — all three refusals verified live, no-write.
6. SDS values matching credential-ish setting names (name contains `password`/`secret`/`key`,
   case-insensitive) are reported as `[REDACTED:differs]`/`[REDACTED:identical]` — values never
   leave the server in diff output.
7. Governance: `execute` default-disabled (policy unit test) + target-profile gate refusal live.
8. Framework back-compat snapshot green (context extension additive).
9. Conventions §6 checklist complete.

## 7. Out of scope (v1)

- Deletions on target; bidirectional sync; three-way merge.
- Credentials/users/roles promotion (secrets — deliberate exclusion, listed in docs).
- Scheduled drift monitoring (future pairing with Spec 07).
- Compiled-object comparison (source-only by design).
