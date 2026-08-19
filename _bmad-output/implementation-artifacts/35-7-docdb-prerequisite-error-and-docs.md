# Story 35.7: MEDIUM - DocDB Prerequisite: Actionable Error + Documentation

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **operator or AI client calling any of the four DocDB tools**,
I want **a disabled `%Service_DocDB` to surface as an actionable error that names the cause and both remedy routes**,
so that **I am never left staring at a bare `ERROR #822: Access Denied` with no path forward**.

## Context — why this story exists

Ledger item **`35-SWEEP-5`** (MEDIUM, `deferred-work.md` line 2356): `%Service_DocDB` is **disabled by IRIS default**; all of `iris_docdb_manage`/`_document`/`_find`/`_property` fail with a bare `ERROR #822: Access Denied` from `/api/docdb/v1/{ns}`. The `/api/docdb` webapp exists and IS enabled, and `_SYSTEM` holds `%All` — so it is purely the service gate. The remedy (`iris_service_manage:enable`) is itself governance-default-disabled, leaving no path forward from inside the suite.

**This story is pure TypeScript — no ObjectScript handler changes, so NO bootstrap regen; `BOOTSTRAP_VERSION` must NOT move (currently `e1168c1ebe56`). Prove that.**

## Acceptance Criteria

Sourced verbatim from `_bmad-output/planning-artifacts/epics.md`, "### Story 35.7".

1. **AC 35.7.1** - All four DocDB tools (`iris_docdb_manage`, `_document`, `_find`, `_property`) surface an actionable error when `%Service_DocDB` is disabled. Today all four return a bare `ERROR #822: Access Denied` from `/api/docdb/v1/{ns}`.
2. **AC 35.7.2** - Root cause verified live 2026-08-17: `%Service_DocDB.enabled = false` (IRIS default) while the `/api/docdb` webapp exists and IS enabled - so the failure is the service gate, not the webapp and not privileges (`_SYSTEM` holds `%All`).
3. **AC 35.7.3** - The error names the fix AND the catch: enabling the service is itself governance-default-disabled (`iris_service_manage:enable`), so the message must point at both routes - the Management Portal, or an `IRIS_GOVERNANCE` override. A user must never be left with "Access Denied" and no path forward.
4. **AC 35.7.4** - Detection must not manufacture a state the real system cannot produce (#54): probe how the disabled-service condition is actually distinguishable from a genuine privilege failure, and pin any test fake to that real shape. Do not guess.
5. **AC 35.7.5** - Prerequisite documented at the point of use (#30/#43): the per-server README DocDB entries plus `tool_support.md`, each stating that `%Service_DocDB` is disabled by default on IRIS and must be enabled before these four tools function.
6. **AC 35.7.6** - Live proof: with the service disabled, all four tools return the new actionable error. If the service can be temporarily enabled under an override, prove one tool then works and RESTORE the service to disabled afterward.

## Lead pre-story findings — verified live 2026-08-19, ready to build on

**1. Current live state:** `%Service_DocDB` `enabled: false` (via `iris_service_manage:get` just now). The `/api/docdb` webapp exists and is enabled.

**2. The real error shape (captured raw, `curl -i`):** HTTP **200** with body:

```json
{"status":{"errors":[{"error":"ERROR #822: Access Denied","code":822,"domain":"%ObjectErrors","id":"AccessDenied"}],"summary":"ERROR #822: Access Denied"},"content":null}
```

NOT an HTTP error status. The shared HTTP client throws `IrisApiError` because `envelope.status.errors` is non-empty (`http-client.ts:411-422`) — the HTTP status on the error is **200**. The DocDB envelope uses `content`, not `result` (see `extractResult`'s doc comment in `docdb.ts:115-137`). **Test fakes must reproduce exactly this shape** (code-822 error object inside `status.errors`, HTTP 200) — anything else manufactures a state the real system cannot produce (#54).

**3. The AC 35.7.4 discriminator (probed):** code **822 is shared** between service-disabled and genuine privilege failures — the error code alone cannot distinguish them. The grounded discriminator is the **live service state**: on an `IrisApiError` carrying an `errors[].code === 822` (numeric code = locale-stable; NEVER match the message text — Rule #8/#13), the tool performs ONE follow-up `GET /api/executemcp/v2/security/service?name=%25Service_DocDB` (the custom REST route, `Dispatch.cls:84`; `encodeURIComponent` works on this route — verified live, it returned the correct record; the CSP non-decoding quirk in `docdb.ts`'s BUG-5 note applies to the DocDB API, NOT this route). Then:
   - `enabled === false` → the actionable error (cause + both remedies).
   - `enabled === true` → a genuine privilege/other failure → **pass the original error through unchanged**.
   - The service-state check itself fails → **pass the original error through** (never mask the real error with a secondary one).

**4. Governance fact (verified in the live effective policy):** `iris_service_manage:enable` is `configSource: default → false` — default-DISABLED. The actionable message must therefore name BOTH routes: (a) Management Portal → System Administration → Security → Services → `%Service_DocDB` → enable; (b) enable via `iris_service_manage:enable`, which itself requires an `IRIS_GOVERNANCE` override, e.g. `{"global": {"iris_service_manage:enable": true}}`. Name the resource `%Service_DocDB` WITHOUT a caret and plainly (Rule #33 does not apply — no globals — but keep error text free of `^` tokens by habit).

**5. Doc-state corrections needed (verified by reading):**
   - `packages/iris-data-mcp/README.md:123` and `:581` ALREADY document the prerequisite, and the error table (`:593`) lists a "DocDB service not available" error — but that error text is idealized; reality is `ERROR #822: Access Denied`. Reconcile: docs state the REAL error text and that after this story it becomes the actionable message.
   - `tool_support.md:388` claims DocDB/Mgmt API "typically are [enabled] by default" — **factually wrong for DocDB** (`%Service_DocDB` is disabled by IRIS default). Correct it.
   - The four tool descriptions themselves (all in `packages/iris-data-mcp/src/tools/docdb.ts`) say nothing about the prerequisite — each gains a one-line prerequisite note (#43: this story ships its own minimal docs).

**6. Where the fix lives:** all four tools' handlers are in `packages/iris-data-mcp/src/tools/docdb.ts`, each with its own `try/catch` on `IrisApiError` (e.g. `docdbManageTool` at line 242). Write ONE shared helper in `docdb.ts` (e.g. `withDocDbServiceGate(ctx, error)` returning an enriched message string or `null` for pass-through) and call it from all four catch paths. Do NOT modify the shared HTTP client — this is a DocDB-specific translation, not a global error policy.

## Tasks / Subtasks

- [x] **Task 1 — Re-probe (AC 35.7.2, 35.7.4)**
  - [x] Re-verify `%Service_DocDB` disabled and capture the raw 200-with-822 envelope yourself (curl or the tool). Confirm the service-state route returns `enabled: false` for `%Service_DocDB` (encodeURIComponent on the name works on THIS route — the docdb BUG-5 quirk does not apply here; verify, don't inherit).
  - [x] Confirm the genuinely-privileged-vs-disabled distinction: with the service disabled, `_SYSTEM` (holds `%All`) still gets 822 — proving it is NOT a privilege failure. (Already lead-verified; re-confirm cheaply.)

- [x] **Task 2 — Shared helper + four call sites (AC 35.7.1, 35.7.3, 35.7.4)**
  - [x] Implement the helper per finding #3: code-822 match on the errors array (numeric, never text), one service-state follow-up, three-way outcome (actionable / pass-through / pass-through-on-check-failure).
  - [x] Actionable message names: the cause (`%Service_DocDB` disabled, IRIS default), portal path, the `iris_service_manage:enable` route WITH its governance catch and an example `IRIS_GOVERNANCE` override.
  - [x] Wire into all four tools' `IrisApiError` catch paths. `isError: true` in every translated case.
  - [x] No new tool/action keys (E-1); no new imports beyond what docdb.ts already uses (it already imports `IrisApiError`; the custom-service base URL constant pattern exists in `rest.ts` — `BASE_EXECUTEMCP_URL`).

- [x] **Task 3 — Tests**
  - [x] Extend `packages/iris-data-mcp/src/__tests__/docdb.test.ts`: for EACH of the four tools — disabled-service → actionable message (assert portal route AND governance-override route named; assert the real 822 detail preserved); enabled-service + 822 → original error passed through unchanged; service-check failure → pass-through; non-822 IrisApiError → pass-through. Fakes pinned to the captured real envelope shape (finding #2).
  - [x] The mock HTTP must serve the service-state GET as a SEPARATE expectation from the docdb call — assert both calls happened (a translation that never checks state is the defect this story exists to prevent being faked).
  - [x] Rule #19 back-compat: non-822 error paths byte-identical to today.

- [x] **Task 4 — Live proof (AC 35.7.6; Rules #26/#59)**
  - [x] Service DISABLED: all four tools return the actionable error through the built tool layer (fresh-Node dist smoke) — plus one raw-REST leg showing the underlying 200-with-822 envelope the translation keys on.
  - [x] Temporarily enable the service: direct REST `POST /api/executemcp/v2/security/service` (bypasses MCP governance by design — this tests the handler path; note the admin tool would need the `IRIS_GOVERNANCE` override). Prove ONE DocDB tool genuinely works while enabled (e.g. `iris_docdb_manage` `list` succeeds, or create+drop a scratch DB and clean up).
  - [x] RESTORE `%Service_DocDB` to disabled and verify via `iris_service_manage:get` + one tool returning the actionable error again. Record the restore explicitly.
  - [x] Rule #59 statement: name the path each guard was proven on.

- [x] **Task 5 — Docs (AC 35.7.5; #30/#43/#56)**
  - [x] Every surface in Dev Notes → *Doc surfaces*, including reconciling the pre-existing idealized error text with reality and correcting `tool_support.md:388`'s "typically enabled by default" claim. Check `packages/iris-mcp-all/README.md` explicitly (record the verdict).

- [x] **Task 6 — Constraints and gates**
  - [x] E-1: counts unmoved (`@iris-mcp/all`). E-2: `pnpm gen:governance-baseline:check` ONLY.
  - [x] No ObjectScript change ⇒ `bootstrap-classes.ts` absent from the diff; `BOOTSTRAP_VERSION` stays `e1168c1ebe56`.
  - [x] Per-package standalone suites (data/shared/all at minimum) — never full parallel turbo (`35-1-DEV-1`).
  - [x] Ledger: `35-SWEEP-5` to terminal RESOLVED with mechanical tally (#51). Changeset: patch for `@iris-mcp/data`.

## Dev Notes

### The translation is a catch-path enrichment, not a gate

Do NOT pre-check the service state before every docdb call (an extra round-trip on the happy path for a rare condition). Translate on the error path only — one extra request only when a call has already failed with 822.

### The actionable message shape

Suggested skeleton (dev wordsmiths, but all elements are mandatory per AC 35.7.3):

```
ERROR #822: Access Denied — this usually means the %Service_DocDB service is disabled (it is disabled by default on IRIS). Checked live: %Service_DocDB is currently DISABLED on this instance.
To fix: enable it in the Management Portal (System Administration > Security > Services > %Service_DocDB), or via iris_service_manage action="enable" with name="%Service_DocDB" — note that action is itself governance-default-disabled and needs an IRIS_GOVERNANCE override such as {"global": {"iris_service_manage:enable": true}}.
Original error: <the original detail text>
```

### Traps

- **Never match on "Access Denied" text** — locale-dependent (Rule #13; the instance can localize prefixes — 35.3). Match the numeric `code: 822` in `status.errors[]`.
- **The HTTP status is 200** on this failure — do not branch on `response.ok` or `error.status`.
- **Pass-through must be total**: if the service reads enabled, or the state check throws, or the error isn't 822 — the caller gets today's exact error behavior. Tests pin all three.
- The docdb `extractResult` quirk (`content` not `result`) applies to SUCCESS responses; the error path throws before it. Don't confuse the two.
- Rule #55: never generate file content through a shell heredoc.

### Testing standards

- Existing suite: `packages/iris-data-mcp/src/__tests__/docdb.test.ts` — extend; fixtures per the captured envelope (finding #2).
- Rule #59: the translation must be proven on the REAL disabled service (live legs in Task 4), not only against mocks.
- Standalone suites: data (baseline 143), shared (1326), all (120) — your tests add to data.

### Doc surfaces — enumerate exhaustively (#56)

| File | What changes |
|---|---|
| `packages/iris-data-mcp/src/tools/docdb.ts` | all four tool descriptions gain the `%Service_DocDB` prerequisite line (disabled by IRIS default) |
| `packages/iris-data-mcp/README.md` | line 123 + 581 prerequisite notes (add both remedy routes incl. the governance catch); error table line 593 (real error text + what it becomes); tool rows 143-146 if they carry per-tool notes |
| `tool_support.md` | line 388's "typically enabled by default" is factually wrong for DocDB — correct; docdb rows 263-266 if they carry notes |
| `packages/iris-mcp-all/README.md` | CHECK EXPLICITLY (expected: no change; record the check) |
| root `README.md` | CHECK (expected: no change) |

### Project Structure Notes

- All four tools: `packages/iris-data-mcp/src/tools/docdb.ts` (`docdbManageTool` :156, plus document/find/property in the same file). Shared helpers already exported from this file (`extractResult`, `toStructured`) — the new helper belongs here too.
- The custom REST service base constant pattern: `BASE_EXECUTEMCP_URL` in `packages/iris-data-mcp/src/tools/rest.ts:26`; the service route is `GET {BASE}/security/service?name=<encodeURIComponent(name)>` (`Dispatch.cls:84` → `Security:ServiceList`).
- `iris_service_manage` reference implementation (admin package): `packages/iris-admin-mcp/src/tools/service.ts:138-165`.

### Proof path

Raw REST legs + fresh-Node dist smoke against the built `@iris-mcp/data` dist (this session's MCP servers run the pre-story dist). The enable/restore leg uses the direct REST route (MCP-governance-free by design); the restore is mandatory and must be verified.

### References

- Ledger: `_bmad-output/implementation-artifacts/deferred-work.md` line 2356 (`35-SWEEP-5`)
- Epic + ACs: `_bmad-output/planning-artifacts/epics.md`, "### Story 35.7"
- Sweep evidence: `sprint-change-proposal-2026-08-17.md` F5 (line 38)
- Rules: `.claude/rules/project-rules.md` — #8, #13, #19, #26, #30/#43, #31, #33, #51, #54, #55, #56, #59
- Prior stories: `35-5`/`35-6` (done — commits cef1d4b, 8437bbe)

### Previous story intelligence — Stories 35.5/35.6

- **Numeric error CODES are locale-stable; message text is not** (35.5 CR matched #8881 by code; 35.3 established per-worker-process locale independence). The 822 detection keys on the code.
- **Run every documented example/claim you ship** (35.5 smoke caught the OpenAPI-3.0 example; here the README's pre-existing "service-not-available" text never matched reality — reconcile, don't copy-paste).
- **A live toggle needs a verified restore** (35.6 sweeps restored every fixture; AC 35.7.6 makes the restore an explicit AC — do not close the story with the service enabled).
- **35-1-DEV-1:** per-package standalone only.
- This session's own MCP servers run the pre-story dist — tool-layer proof needs a fresh-Node process (pattern established in the 35.5/35.6 smokes; the dist rebuild is `pnpm build` in the package).

## Dev Agent Record

### Agent Model Used

claude-fable-5 (dev-35-7), 2026-08-18 — agent self-report. Spawned at the **sonnet tier** per the epic pipeline; the harness's tier→model mapping is not observable from inside the session, so the cycle log records the spawn tier (`claude-sonnet-5`) and this file records the runtime self-report. Both are accurate records of different things (reconciled at commit prep per the code-review flag).

### Debug Log References

- Task 1 live probes (this session, 2026-08-18):
  - `iris_service_manage:get name=%Service_DocDB` → `enabled: false` (re-confirmed pre-story state).
  - `curl -i -u _SYSTEM:SYS http://localhost:52773/api/docdb/v1/USER` → **HTTP 200** with `{"status":{"errors":[{"error":"ERROR #822: Access Denied","code":822,"domain":"%ObjectErrors","id":"AccessDenied"}],"summary":"ERROR #822: Access Denied"},"content":null}` — exact lead-captured shape re-confirmed byte-for-byte; `_SYSTEM` holds `%All`, so the 822 is the service gate, not a privilege failure.
  - `curl -u _SYSTEM:SYS "http://localhost:52773/api/executemcp/v2/security/service?name=%25Service_DocDB"` → `result.enabled: false` — encodeURIComponent name verified working on THIS route (the docdb BUG-5 CSP non-decoding quirk does NOT apply here).
- Live smoke: fresh-Node script driving the BUILT dist (`packages/iris-data-mcp/dist/tools/docdb.js` + real `IrisHttpClient`) — 31/31 checks PASS; script deleted after use (scratch at `%TEMP%/story-35-7-smoke.mjs`).

### Completion Notes List

- **AC 35.7.1/35.7.3/35.7.4 (Task 2):** new exported helper `translateDocDbAccessDenied(ctx, error)` in `packages/iris-data-mcp/src/tools/docdb.ts`. Detection keys on the NUMERIC `code === 822` in `IrisApiError.errors[]` (never message text — Rules #8/#13); on a match it makes ONE follow-up `GET /api/executemcp/v2/security/service?name=%25Service_DocDB` and enriches ONLY when the live state reads `enabled: false` (the grounded #54 discriminator — 822 is shared with genuine privilege failures). Pass-through (`null`) is total for: service enabled, check failure (any throw), unexpected response shape, non-822, and string-form error entries. Wired into all four tools' `IrisApiError` catch paths; translated results keep `isError: true`. The actionable message names the cause (`%Service_DocDB` disabled — disabled by default on IRIS, checked live), the Management Portal route, and the `iris_service_manage` `action="enable"` route WITH its governance catch and the example `IRIS_GOVERNANCE` override `{"global": {"iris_service_manage:enable": true}}`, and preserves the original 822 detail. No shared-http-client change (DocDB-specific translation, per the story); no new tool/action keys (E-1); only new import is the `ToolContext` type from `@iris-mcp/shared`.
- **AC 35.7.2 (Task 1):** root cause re-verified live — service disabled (IRIS default), `/api/docdb` webapp enabled, `_SYSTEM`/`%All` still receives 822. See Debug Log References.
- **Tests (Task 3):** 17 new tests in `docdb.test.ts` under four `Story 35.7 — … service gate` describes. Per tool: disabled→actionable (asserts portal route, governance route with the exact override JSON, live-DISABLED statement, preserved 822 detail, AND both HTTP calls — the DocDB call plus the service-state GET as separate expectations, incl. `toHaveBeenCalledTimes` pins); enabled+822→byte-identical pass-through (Rule #19 `.toBe` exact-match against the pre-story format string); check-failure→byte-identical pass-through; non-822→byte-identical pass-through with a NO-service-probe assertion (`get` never called / called exactly once). A fifth manage test pins the locale-safety rule: a string-form `"ERROR #822: Access Denied"` entry (no numeric code) passes through untouched. Fixtures pinned to the live-captured 2026-08-18 envelope and service-route shapes with capture comments (Rule #36/#54).
- **AC 35.7.6 (Task 4, live proof):** fresh-Node dist smoke (built `@iris-mcp/data` dist, real HTTP client — this session's MCP servers run the pre-story dist). Leg 0/1: service confirmed disabled; raw `curl`-equivalent leg shows HTTP 200 + code-822 envelope. Leg 2: all four tools return the actionable error while disabled. Leg 3: service enabled via DIRECT REST `POST /api/executemcp/v2/security/service` `{action:"enable"}` (`success:true`) — bypasses MCP governance by design (the governed `iris_service_manage:enable` is default-disabled, which is exactly the catch the message documents). Leg 4: `iris_docdb_manage` `list` genuinely succeeded while enabled → returned `["HS.BulkFHIR.Log"]`. Leg 5: RESTORED to disabled via the same direct route; restore verified THREE ways — service route `enabled:false`, `iris_service_manage:get` (MCP admin tool) `enabled:false`, and a post-restore `iris_docdb_manage:list` returning the actionable error again. **The instance is left with `%Service_DocDB` DISABLED (its pre-story state).** Rule #59 path statement: the translation guard was proven on the real disabled service through the built dist tool layer plus the raw wire envelope it keys on; pass-through branches proven on the handler path in unit tests; the enable/prove/restore leg exercised the real custom REST handler path.
- **AC 35.7.5 (Task 5, docs):** all four tool descriptions gained the prerequisite line. `packages/iris-data-mcp/README.md`: Prerequisites section rewritten (disabled-by-default + both remedy routes + the governance catch + real `ERROR #822` text); a prerequisite note added under the DocDB tools table; the Namespace-Scoping note now names the real error and the translation; the error-table row's idealized "DocDB service not available" text replaced with the real `ERROR #822: Access Denied` and both remedies. `tool_support.md`: line-388 claim corrected (Management API typically enabled by default; `%Service_DocDB` is NOT — asymmetry stated) plus a note under the data tools table. **Verdicts:** `packages/iris-mcp-all/README.md` CHECKED — only a one-line package description mention, no default-state/error claims, NO CHANGE needed; root `README.md` CHECKED — line 692's architecture bullet makes no default-state claim, NO CHANGE needed.
- **Constraints/gates (Task 6):** E-1 — `@iris-mcp/all` standalone 120/120 (unmoved); no new tool/action keys. E-2 — `pnpm gen:governance-baseline:check` OK (141 frozen keys all present; no baseline regen). Pure TS — `bootstrap-classes.ts` absent from the diff; `BOOTSTRAP_VERSION` stays `e1168c1ebe56` (verified in the file). Standalone suites: **data 160/160** (baseline 143 + 17 new), **shared 1326/1326**, **all 120/120**; `tsc --noEmit` + `eslint src/` clean on data. No full parallel turbo run (35-1-DEV-1). Ledger: `35-SWEEP-5` → terminal RESOLVED with mechanical tally (new state: 0 HIGH / 25 MEDIUM / 95 LOW = 120 open / 197 distinct / 76 terminal; check 0+25+95=120). Changeset: `.changeset/docdb-service-disabled-actionable-error.md` (patch `@iris-mcp/data`). Scratch smoke script deleted; no residual instance state (service restored, no scratch DocDB databases created — the tool calls in leg 2/5 all failed at the service gate before any mutation, and leg 4 was a read-only `list`).

### File List

- `packages/iris-data-mcp/src/tools/docdb.ts` (modified — `translateDocDbAccessDenied` helper + four catch-path wirings + four description prerequisite lines)
- `packages/iris-data-mcp/src/__tests__/docdb.test.ts` (modified — 17 new Story 35.7 tests)
- `packages/iris-data-mcp/README.md` (modified — Prerequisites, DocDB table note, Namespace Scoping note, error table row)
- `tool_support.md` (modified — data-table note + corrected "typically enabled by default" claim)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified — `35-SWEEP-5` terminal disposition + ledger state)
- `.changeset/docdb-service-disabled-actionable-error.md` (new — patch `@iris-mcp/data`)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — story status)

## QA Results — Story 35.7 (qa-35-7, 2026-08-19)

### Verdict: PASS — no product defects found

### Live reproduction (independent of dev transcript; own fresh-Node smoke, script deleted after use)

- **Raw envelope re-captured (own captures, Rule #54):** `curl -i http://localhost:52773/api/docdb/v1/USER` → HTTP **200** with `{"status":{"errors":[{"error":"ERROR #822: Access Denied","code":822,"domain":"%ObjectErrors","id":"AccessDenied"}],...},"content":null}` — byte-matches the test fixture `LIVE_822_ERRORS`. Raw `GET /api/executemcp/v2/security/service?name=%25Service_DocDB` → `result: {"name":"%Service_DocDB","enabled":false,"description":"Controls Doc DB applications","autheEnabled":1024,"clientSystems":""}` — byte-matches `SERVICE_DISABLED_RESULT`, and `enabled` is a JSON **boolean** (load-bearing for the helper's strict `enabled !== false`).
- **Fresh-Node dist smoke** (built `@iris-mcp/data` dist + real `IrisHttpClient`; this session's MCP servers run the pre-story dist): with the service DISABLED, all four tools returned `isError: true` with the actionable message — every mandatory element asserted per tool: `%Service_DocDB`, "disabled by default on IRIS", "currently DISABLED", portal route (`System Administration > Security > Services`), `iris_service_manage` `action="enable"`, the exact `{"global": {"iris_service_manage:enable": true}}` override, and the preserved original `ERROR #822: Access Denied` detail. Namespace variant proven: `iris_docdb_find` with `namespace:"HSCUSTOM"` also returns the actionable error (service gate is instance-wide).
- **Enable/prove/restore (AC 35.7.6):** enabled via direct REST `POST /api/executemcp/v2/security/service` `{action:"enable"}` (raw route then read `enabled === true`); `iris_docdb_manage` `list` genuinely succeeded while enabled (returned `HS.BulkFHIR.Log`); **restored** to disabled via `{action:"disable"}` and verified THREE ways — raw service route `enabled === false`, MCP `iris_service_manage:get` `enabled: false`, and a post-restore `iris_docdb_manage:list` again returning the actionable error. **Instance left with `%Service_DocDB` DISABLED (pre-story state).**

### Adversarial legs

- **(a) 822 + service ENABLED → pass-through, PROVEN LIVE (stronger than the planned unit-only leg):** with the service enabled, `iris_docdb_document` `get` on a nonexistent database produced an `IrisApiError` that DID carry code 822 (smoke log shows the service-state follow-up GET firing — it only fires on a code-822 match) and read `enabled === true`; the result passed through with **no gate text** (asserted absence of "currently DISABLED" and "IRIS_GOVERNANCE"). The live fixture basis (`enabled: true` as a strict JSON boolean on the same record shape) was captured in the same smoke's leg 3.
- **(b) service-check failure → pass-through:** unit-pinned per tool (check rejects → original text byte-identical). Raw probes: double-encoded name and unknown service both yield `ERROR #5001` envelopes, which the http client turns into a throw → helper catch → `null` (pass-through); the throw mapping is pinned by reading `http-client.ts:411-422`.
- **(c) string-form 822 entry:** real pin in `docdb.test.ts` ("never matches on message text") — `new IrisApiError(200, ["ERROR #822: Access Denied"], ...)` passes through with exactly one HTTP call (no service probe). The helper's `typeof entry === "object"` guard safely skips string entries.
- **(d) namespace variants:** USER + HSCUSTOM both translate while disabled (smoke legs 2/2b).
- **(e) wiring scope:** repo-wide grep — `translateDocDbAccessDenied` appears ONLY in `packages/iris-data-mcp/src/tools/docdb.ts`; no other tool file imports it. Happy path untouched (translation fires only inside the `IrisApiError` catch).
- **Mutation verification (Rule #59, on the unit-guard path):** `IRIS_ERROR_CODE_ACCESS_DENIED` 822→823 made exactly 5 Story-35.7 tests RED (all four actionable tests + the manage enabled-pass-through test that pins the service-state GET); restored byte-exact (0 mutation markers in the diff), suite re-run GREEN (74/74 in `docdb.test.ts`). Combined with the live disabled-service legs, the guard is proven fail-capable on both the unit path and the real wire.

### Rule checks

- **#19 back-compat:** pass-through pins are non-vacuous — `.toBe` exact-string against the pre-story formats (`Error managing DocDB database: …`, `Error managing document: …`, `Error querying documents: …`, `Error managing property '<name>': …`), verified against the pre-story diff lines. Non-822 pins assert NO service probe (`get` not called / called exactly once).
- **#36/#54 fakes:** both fixtures independently re-captured live by QA this pass (see above) — byte-identical to what the tests pin.
- **#56 doc enumeration re-run:** `iris-data-mcp/README.md` (prerequisites :123, table note :148, namespace note :583, error-table row :595) all updated; `tool_support.md` (data-table note + corrected :388 claim — "typically enabled by default" no longer present) updated; root `README.md` (3 mentions — :19, :37, :692 — all product/architecture descriptions, NO default-state or error claims; no-change verdict CONFIRMED); `packages/iris-mcp-all/README.md` (:29 package-table row only; no-change verdict CONFIRMED). CHANGELOG docdb mentions are historical fix entries, no stale default-state claims.
- **#51 ledger tally:** arithmetic verified — prior 0/26/95 = 121 open / 197 distinct / 75 terminal; `35-SWEEP-5` open→terminal gives 0/25/95 = 120 open / 197 / 76 terminal; check 0+25+95=120 ✓.
- **Constraints:** E-1 — `@iris-mcp/all` standalone **120/120** (unmoved); no new tool/action keys (helper is internal). E-2 — `pnpm gen:governance-baseline:check` exit 0 (141 frozen present, 201 live / 60 post-foundation). `BOOTSTRAP_VERSION` stays `e1168c1ebe56`; `bootstrap-classes.ts` absent from the diff. Suites standalone only: **data 160/160** (143 baseline + 17 new — count verified against the diff: 5 manage + 4 document + 4 find + 4 property), **shared 1326/1326**, **all 120/120**; `eslint src/` exit 0 on data.

### Observations (NOT 35.7 defects — pre-existing, flagged for lead triage)

1. **`iris_docdb_manage list` live `structuredContent` shape is `{content: [...]}`**, not the `{items, count}` shape the unit tests pin — the live list payload is plain JSON with a `content` key (no `result`), so `extractResult` returns it whole and `toStructured` passes the object through. The success path is untouched by this story; the data is returned and readable. Possible LOW doc/consistency item.
2. **A historical CHANGELOG entry records the disabled-DocDB failure surfacing as `ERROR #800: Logins for Service %Service_DocDB are disabled` (HTTP 403 era)** on an earlier IRIS version — this instance produces 200+822, which is the shape the ACs pinned. On a version producing #800 the translation will not fire (code ≠ 822), but that error text already names the service and its disabled state, so the user is not stranded. Recorded as residual risk, no action taken.

### Instance / workspace cleanliness

`%Service_DocDB` restored to DISABLED (three-way verified); no scratch DocDB databases created (all disabled-state calls failed at the gate before mutation; enabled-state calls were read-only `list` / `get` on a nonexistent DB); QA scratch scripts (`%TEMP%/qa-35-7-smoke.mjs`, `-probe.mjs`, `-probe2.mjs`) deleted; no files added to the diff by QA.

### QA-authored tests

None committed — the dev's 17 new tests already pin every branch non-vacuously, and QA's additive value was the independent live proof (fresh-Node dist smoke incl. enable/prove/restore + the live 822-while-enabled pass-through leg) plus the mutation cycle, all recorded above. No File List addition required.

## Review Findings — Story 35.7 (cr-35-7, 2026-08-19)

**Close kind: CLEAN** — `review_degraded=false`. All three adversarial layers DELIVERED explicit findings payloads against the frozen diff snapshot (`review-diff-snapshot-35-7-...-20260819-024120.diff`, disposed at close), each well inside the hard 20-minute bound against real armed timers (Blind ~5.4 min / Edge ~7.7 min / Auditor ~6.0 min). Layers ran as **sequential synchronous subagents** (the accepted Epic-35 adaptation first recorded in 35.6: an in-process teammate cannot spawn background/named agents); `failed_layers` empty. 12 raw findings → 8 after dedupe: **5 patched in-story (2 MEDIUM, 3 LOW), 2 dismissed, 1 flagged-to-lead, 0 decision-needed, 0 surviving HIGH/MEDIUM.**

### Patched in-story

- [x] [Review][Patch] **MEDIUM (blind+edge+auditor): `tool_support.md` note inserted mid-table severed the data-tools GFM table** — the blockquote + blank line sat between rows 4 and 5, so rows 5–7 (`iris_analytics_mdx`, `iris_analytics_cubes`, `iris_rest_manage`) detached from the header and rendered as literal pipe text. All three layers found it independently; neither dev nor QA's Rule #56 pass caught it. Fix: note moved below row 7 (region re-verified intact: 7 contiguous rows, note after the table).
- [x] [Review][Patch] **MEDIUM (blind): the "original error preserved" pin was vacuous (Rule #59)** — `expectActionableGateMessage` asserted `toContain("ERROR #822: Access Denied")`, which the helper's own hardcoded prefix satisfies; deleting the `` `Original error: ${error.message}` `` suffix kept all 17 new tests green. Fix: the oracle now takes the original message and asserts the `Original error: <message>` suffix verbatim; the four actionable tests hold the error reference (the live fake's message embeds the real 822 detail via `formatIrisErrors`, so the pin proves detail preservation, not just suffix presence). **Mutation-verified: suffix removal → exactly the 4 actionable tests RED → restored byte-exact (md5) → GREEN.**
- [x] [Review][Patch] **LOW (blind+edge): `error.errors.some(...)` unguarded against a non-array `errors`** — `http-client.ts:411-413` throws whenever `envelope.status.errors.length > 0`, and a non-empty STRING satisfies that check and is passed through as-is, so `errors` can be a non-array at runtime despite its `unknown[]` type (the shared `formatIrisErrors` already guards the same shape). A TypeError would have escaped the tool's catch block, replacing the original error with an unhandled rejection — the exact masking the helper's contract forbids. Fix: `Array.isArray(error.errors) &&` guard + one new test pinning non-array pass-through with no service probe. **Mutation-verified: guard removal → exactly the new test RED (TypeError escaped as predicted) → restored byte-exact (md5) → GREEN.**
- [x] [Review][Patch] **LOW (edge): README promised the actionable error unconditionally** — when the custom ExecuteMCPv2 REST app is not deployed on the instance, the service-state follow-up fails and the raw 822 passes through (by design), contradicting the unconditional "the tools detect this case" claim on a supported DocDB-only configuration. Fix: the Prerequisites paragraph now states the detection's dependency on the suite's custom REST endpoint explicitly.
- [x] [Review][Patch] **LOW (edge): the message routed users to `iris_service_manage` without naming its home server** — that tool ships in `@iris-mcp/admin`, so a data-only user could not act on remedy route 2. Fix: the helper message now says "the `iris_service_manage` tool (in the `@iris-mcp/admin` server)"; the README Prerequisites sentence aligned. Proven live post-patch (see below).

### Dismissed (reasoning recorded)

- [x] [Review][Dismiss] **Blind LOW: sprint-status `last_updated` describes "story created" while the same diff flips the story to `review`** — superseded by construction: this review close rewrites the active `last_updated` itself (the create-story entry was the standing value the review close replaces). Not a defect in the change set.
- [x] [Review][Dismiss] **Auditor cosmetic: fixture capture-date attribution differs across records (2026-08-18 in dev notes vs 2026-08-19 in test comments/cycle-log)** — local-vs-UTC date artifact (dev completed 02:14 UTC = prior evening local); QA independently re-captured both fixture shapes live on 2026-08-19 byte-identical, so Rule #36 is satisfied in substance. No action.

### Flagged to lead (no code action by the reviewer)

- [x] [Review][Flag] **Blind LOW: cycle-log `dev_complete`/`qa_complete` rows for 35.7 record `model=claude-sonnet-5` while the story file records `claude-fable-5` for both dev-35-7 and qa-35-7** — a records contradiction in the lead's own artifact; the reviewer cannot determine which is true. The date differences in the same rows are local-vs-UTC artifacts (see dismissal above). Lead to reconcile at commit prep. (Not ledgered — record-keeping, not product debt; 35.5's cycle-log flag precedent.)

### Reviewer verification (fresh, this pass)

- **Live re-probes:** raw `curl -i` re-captured the HTTP **200** + code-822 envelope on `/api/docdb/v1/USER` byte-identical to the pinned fixture, and the service-state route returns `enabled: false` (JSON boolean) for `name=%25Service_DocDB`. `%Service_DocDB` confirmed still DISABLED (pre-story state) both before and after the review.
- **Post-patch live smoke (fresh-Node, rebuilt `@iris-mcp/data` dist, real `IrisHttpClient`):** 32/32 PASS — all four tools return `isError: true` with the actionable message on the real disabled service, asserting every mandatory element INCLUDING the two review-added ones (the `@iris-mcp/admin` server note and the preserved `Original error:` detail); the logs show the service-state follow-up GET firing only on the error path. Smoke script deleted after use.
- **Wiring scope:** grep confirms `translateDocDbAccessDenied` exists only in `docdb.ts` (definition + exactly the four catch-path call sites).
- **Constraints/gates post-patch (all standalone per 35-1-DEV-1):** data **161/161** (160 + 1 review guard test; docdb.test.ts 74→75), shared **1326/1326**, all **120/120** (E-1 unmoved; no new tool/action keys); `tsc --noEmit` + `eslint src/` clean on data; `pnpm gen:governance-baseline:check` exit 0 (frozen 141 keys present; E-2 — check only, no regen); `BOOTSTRAP_VERSION` stays `e1168c1ebe56` (verified in both `bootstrap-classes.ts:25` and the embedded parameter), `bootstrap-classes.ts` and all `.cls` ABSENT from the diff; a full-repo root vitest run also passed 3914/3914 (observation only, not a gate).
- **QA's two pre-existing observations:** confirmed sensible for the lead's commit-prep ledgering — (1) `iris_docdb_manage list` live `structuredContent` shape `{content:[...]}` vs the unit-pinned `{items,count}` (LOW consistency; success path untouched by this story); (2) the older-IRIS `ERROR #800`/HTTP-403-era disabled-service shape will not fire the code-822 translation, but its native text already names the service and state (residual-risk note). No re-litigation.
- **Ledger tally (Rule #51):** re-verified — prior 0/26/95 = 121 open / 197 distinct / 75 terminal; `35-SWEEP-5` open→terminal gives 0/25/95 = 120 open / 197 / 76 terminal; 0+25+95=120 ✓.
- **Instance/workspace cleanliness:** `%Service_DocDB` left DISABLED throughout; the review's live legs were read-only at the service gate (no DocDB databases created — all calls failed before mutation); scratch smoke script deleted; frozen diff snapshot disposed at close.

## Change Log

| Date | Change | Author |
|---|---|---|
| 2026-08-18 | Story created. Lead live probes: `%Service_DocDB` confirmed disabled NOW; raw error shape captured (HTTP 200 + code-822 envelope — the http client throws on `status.errors`, not HTTP status); the AC 35.7.4 discriminator established (822 is shared between disabled-service and privilege failures — distinguish via the live service-state route, which the tools can reach and which accepts encodeURIComponent names); `iris_service_manage:enable` confirmed default-disabled in the effective policy; doc-state review found the README's pre-existing prerequisite notes carry idealized error text and `tool_support.md:388` is factually wrong about the default. | Lead (claude-opus-5) |
| 2026-08-18 | Implemented: `translateDocDbAccessDenied` helper (numeric-822 detection + live service-state discriminator, total pass-through) wired into all four DocDB tools; 17 new tests (all pass-through branches byte-identical per Rule #19); live proof incl. enable/prove/restore with three-way restore verification; docs corrected at every enumerated surface; ledger `35-SWEEP-5` → RESOLVED; changeset added. Standalone suites green (data 160, shared 1326, all 120); governance baseline check OK; bootstrap untouched. | dev-35-7 (claude-fable-5) |
| 2026-08-19 | QA complete (qa-35-7): PASS, no product defects. Independent live reproduction via own fresh-Node dist smoke (raw 200+822 envelope re-captured; all four tools actionable while disabled, both namespaces; enable/prove/restore with three-way restore verification — service left DISABLED). Adversarial: 822-while-enabled pass-through proven LIVE (nonexistent-DB error carried 822, service check read enabled, original error returned without gate text); mutation cycle 822→823 → 5 tests RED → restored → 74/74 GREEN; helper wiring confirmed docdb-only. Suites: data 160/160, shared 1326/1326, all 120/120; governance :check exit 0; BOOTSTRAP_VERSION unmoved. Two pre-existing observations flagged to lead (list structuredContent `{content:[...]}` shape; historical #800-era error variant). QA Results appended to Dev Agent Record. | qa-35-7 (claude-fable-5) |
| 2026-08-19 | Code review complete (cr-35-7): CLEAN close, `review_degraded=false` — all three layers DELIVERED (Blind 5 / Edge 4 / Auditor 1+1 cosmetic; sequential synchronous subagents per the 35.6 adaptation, each under its armed 20-min bound). 12 raw → 8 after dedupe: 5 patched in-story (2 MEDIUM: tool_support.md mid-table note severed the data-tools GFM table — found by all three layers; vacuous "original error preserved" pin made fail-capable, mutation-verified RED→restored byte-exact→GREEN; 3 LOW: Array.isArray guard for the non-array `errors` shape http-client can pass through — mutation-verified, README unconditional-translation claim caveated for instances without the custom REST app, message now names `iris_service_manage`'s home server `@iris-mcp/admin`), 2 dismissed (sprint-status header superseded by the close update; capture-date attribution is a local-vs-UTC artifact), 1 flagged-to-lead (cycle-log 35.7 rows say claude-sonnet-5 where the story records claude-fable-5). Post-patch: data 161/161, shared 1326/1326, all 120/120; governance :check exit 0; BOOTSTRAP_VERSION e1168c1ebe56 unmoved, no bootstrap/.cls in the diff; fresh-Node live smoke 32/32 against the real disabled service (message renders with both review additions; follow-up GET fires only on the error path). Instance left with `%Service_DocDB` DISABLED; scratch deleted; snapshot disposed. Status → done. | cr-35-7 (claude-fable-5) |
| 2026-08-19 | Lead smoke PASS (33/33, fresh-Node against the rebuilt post-review data dist): raw-REST leg confirms the 200+code-822 envelope; all four tools return the actionable error with every mandatory element (cause, currently-DISABLED live check, portal route, iris_service_manage route with the admin server named, the exact governance override example, original 822 preserved). Gates: baseline :check exit 0; suites unchanged since the review (my post-review edits are docs/ledger only); service verified still DISABLED after the smoke; no residue. The CR-flagged model-record contradiction reconciled in Agent Model Used (spawn tier vs runtime self-report). | Lead (claude-opus-5) |
