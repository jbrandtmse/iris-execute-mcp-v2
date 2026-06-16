# Story 15.3: `iris_x509_manage` — X.509 Certificate Credentials

Status: done

## Story

As an administrator,
I want to manage X.509 credentials via the agent,
so that I can administer certificates used by SSL configs and services — without ever exposing private-key material.

## Context

Third Epic 15 admin tool. Follows the proven Story 15.1/15.2 pattern. Cross-cutting decisions in force (unchanged): **frozen-foundation governance baseline** (hash `1e62c5ad5bf7`, 141 keys; new keys NOT added) and **bootstrap regen per ObjectScript story** (`pnpm run gen:bootstrap`, Rule #18; `BOOTSTRAP_VERSION` current `80487cda8d82`).

The dominant concern here is **secret hygiene**: `%SYS.X509Credentials` holds private-key material (`PrivateKey`, `PrivateKeyPassword`, and the `*Export` variants). `list`/`get` must NEVER return any of it — only public metadata (alias, public certificate info, `HasPrivateKey` boolean).

## Acceptance Criteria

1. **AC 15.3.1 — Tool surface.** Tool `iris_x509_manage` in `@iris-mcp/admin`; single multi-action tool; `action: z.enum(["list","get","import","delete"])`. `annotations.readOnlyHint:false`. No `server` field (D2). Registered in `index.ts`.

2. **AC 15.3.2 — Governance classification.** `mutates: { list:"read", get:"read", import:"write", delete:"write" }` (all 4 classified). Under empty `IRIS_GOVERNANCE`: `import`/`delete` **disabled**, `list`/`get` **enabled** — proven through the real `McpServerBase.handleToolCall` gate (denial = `GOVERNANCE_DISABLED`, handler not invoked).

3. **AC 15.3.3 — NO private-key material in output (security-critical).** `list`/`get` return ONLY public metadata: `alias`, `hasPrivateKey` (boolean), and safe public-certificate fields (subject/issuer/serial/thumbprint/notBefore/notAfter if cheaply available via `GetProperties`). They MUST NEVER return `PrivateKey`, `PrivateKeyPassword`, `PrivateKeyExport`, `PrivateKeyPasswordExport`, or the raw private key in any form. A test asserts no private-key field appears at any depth of the output.

4. **AC 15.3.4 — `import` mechanism (Rule #16 live probe).** Probe `%SYS.X509Credentials` for the supported import path. The native `Import(FileName, .NumImported, Flags)` loads from a server-side XML export file. Determine during impl whether to: (a) accept a server-side file path and call `Import`, and/or (b) construct a credential from a base64/PEM certificate (+ optional private key) via object create + `Save`. Implement the path the class actually supports; document the chosen mechanism + its input contract in the tool description + Dev Notes. Do NOT claim a capability the class doesn't support. If a private key is supplied on import, accept it write-only (XMLIO=IN) and NEVER echo it back.

5. **AC 15.3.5 — ObjectScript handler.** New methods (e.g. `X509List` + `X509Manage`) on `ExecuteMCPv2.REST.Security`, backed by `%SYS.X509Credentials` (`ListAll`/`ListDetails` query, `GetProperties(handle,.props)`, `Import(...)` or object-create+`Save`, `Delete(alias)`, `Exists`). Namespace save/restore (NEVER `New $NAMESPACE`; catch restores NS first). `/security/x509` GET+POST routes in `Dispatch.cls`. Avoid `[Internal]` props except `HasPrivateKey` (Internal but the safe presence-indicator — read it but expose only the boolean).

6. **AC 15.3.6 — I/O contract.** Input: `action`, `alias`, cert payload (per AC 15.3.4 mechanism — `filePath` or `certificate`/`privateKey` base64), `server` (framework-injected), `namespace`. Output: credential metadata list / single metadata (private-key-free) / import-delete structured result.

7. **AC 15.3.7 — Errors (Rule #9).** `SanitizeError` preserves `%Status` text (e.g. "alias does not exist"); never leak a private key or password into an error message (length-gated redaction if any secret could appear).

8. **AC 15.3.8 — Tests.** `@iris-mcp/admin` unit tests for each action (mocked HTTP) incl. the no-private-key-material assertion (deep-scan, like the 15.2 password test) + the governance-default-disabled real-gate test (default suite).

9. **AC 15.3.9 — Back-compat + bootstrap.** Governance hash `1e62c5ad5bf7` / 141 keys unchanged (x509 keys NOT in baseline); `bootstrap-classes.ts` regenerated; record `BOOTSTRAP_VERSION` from→to; full monorepo build/test/lint green; `tsc` strict clean.

10. **AC 15.3.10 — Live verification.** Deploy `Security.cls` to HSCUSTOM (`iris_doc_load` glob, Rule #17), compile; live `list` returns credentials (or empty — valid); `get` on a known alias (or graceful not-found) returns metadata with NO private-key field. Smoke evidence. No destructive import/delete on live unless on a clearly-disposable test alias that is then removed.

## Tasks / Subtasks

- [x] **Task 1 — Read `irislib/%SYS/X509Credentials.cls` (Rule #2/#16):** ListAll/ListDetails ROWSPEC, `GetProperties` property names, `Import`/`Delete`/`Exists` signatures, the private-key property set to EXCLUDE, and the supported import mechanism. Resolve AC 15.3.4.
- [x] **Task 2 — TypeScript tool** — mirror `service.ts`/`ldap.ts`; 4-action enum + `mutates`; private-key-free output mapping; register in `index.ts`.
- [x] **Task 3 — ObjectScript handler** — `X509List`/`X509Manage` on `Security.cls`; `/security/x509` routes; namespace save/restore; `SanitizeError`; NEVER read private-key props into output.
- [x] **Task 4 — Tests** — per-action + no-private-key-material deep-scan + real-gate governance.
- [x] **Task 5 — Deploy + live-verify** (Rule #17).
- [x] **Task 6 — Bootstrap regen + back-compat proof.**

### Review Findings (code review 2026-06-16)

All findings auto-fixed inline or deferred; no `decision-needed`, no unresolved HIGH/MEDIUM. Fixes deployed + compiled on HSCUSTOM and live-verified (disposable probe, removed). Bootstrap regenerated `3dfe34fbe183`→`dc6e10143476`; governance hash unchanged `1e62c5ad5bf7`/141; full monorepo green.

- [x] [Review][Patch] `import` silently overwrote an existing credential (Alias is IdKey → clobbered cert + private key, success:true) — FIXED via `Exists` precheck [src/ExecuteMCPv2/REST/Security.cls:X509Manage import branch]
- [x] [Review][Patch] get-path `Exists` truthy-`%Status` on `%Admin_Secure` failure misread as "exists" → `<INVALID OREF>` — FIXED, guard now checks `$$$ISERR(tStatus)`/`'$IsObject(tCred)` [src/ExecuteMCPv2/REST/Security.cls:X509List single-get]
- [x] [Review][Patch] `X509List` `%ResultSet` cursor leak on mid-loop exception — FIXED, catch now closes `tRS` (also closes the X509List instance of the suite-wide CR 15.1-1/15.2-2 pattern) [src/ExecuteMCPv2/REST/Security.cls:X509List catch]
- [x] [Review][Defer] `import` does not validate decoded cert is real DER before Save (junk/PEM-armored persists empty metadata) — deferred (CR 15.3-4), operator is trust boundary; overwrite guard limits blast radius
- [x] [Review][Defer] `notBefore`/`notAfter` not ISO-8601-normalized (Rule #11) — deferred (CR 15.3-5), `%TimeStamp` is already readable, low urgency
- [x] [Review][Defer] `namespace` schema field declared but never forwarded — deferred (CR 15.3-6), pre-existing suite-wide pattern (ldap/service/mapping/user/webapp), cross-tool cleanup not this leaf story

## Dev Agent Record

### Completion Notes

**AC 15.3.4 — import mechanism resolved (Rule #16 live probe).** Read `irislib/%SYS/X509Credentials.cls` in full. The native `Import(FileName,.NumImported,Flags)` reads a server-side XML *export* file — not agent-friendly for a single cert. The class DOES support **object-create + `Save`**: `%New()` → set `Alias` → set `Certificate` (the setter `CertificateSet` auto-derives Thumbprint/Subject/Issuer/Serial/SubjectKeyIdentifier from the DER), optionally set write-only `PrivateKey`/`PrivateKeyPassword`, then `Save()`. **Chosen mechanism: object-create + Save.** Input contract: `certificate` = base64 of the DER bytes (equivalently, the PEM body between the armor lines, which is already base64-of-DER); optional `privateKey` = base64 of the PEM private-key text (write-only); optional `privateKeyPassword` (write-only). Documented in the tool description and the handler doc-comment.

**AC 15.3.3 — NO private-key material (security-critical), enforced in BOTH layers.** The handler deliberately does NOT call `%SYS.X509Credentials.GetProperties` (which populates the secret `PrivateKey`/`PrivateKeyPassword` array entries — confirmed at lines 1042–1043 of the IRIS class). Instead it opens the object and reads ONLY safe public properties (`SubjectDN`, `IssuerDN`, `SerialNumber`, `Thumbprint`, `SubjectKeyIdentifier`, `ValidityNotBefore/After`, `PeerNames`, `CAFile`) plus the `HasPrivateKey` presence boolean. Binary fields are hex-encoded via `BinaryToHexString`. The TS output mapping only forwards the server's already-private-key-free envelope, and a deep-scan test asserts no private-key field (`privateKey`/`privateKeyPassword`/`*Export`, or any key starting with a private-key marker) appears at any depth — while explicitly allowing the safe `hasPrivateKey` boolean.

**Live verification (AC 15.3.10).** Deployed `Security.cls` + `Dispatch.cls` to HSCUSTOM (glob path, Rule #17) — both compiled clean. Via a disposable `ExecuteMCPv2.Temp.X509Probe` class (since the REST handlers need `%request`), imported a self-signed cert alias `x509smoketest` **WITH a real private key**, then exercised the list + get metadata paths. Output: `hasPrivateKey:true` plus full public metadata (subjectDN, issuerDN, serialNumber, hex thumbprint, hex SKI, notBefore/notAfter) and **NO private-key field anywhere** — proving secret hygiene end-to-end against a credential that genuinely holds a key. Deleted the alias (0 credentials remain), deleted the probe class, removed all temp files.

**Back-compat (AC 15.3.9).** Governance baseline untouched: `GOVERNANCE_BASELINE_HASH` stays `1e62c5ad5bf7` / 141 keys (x509 keys NOT added; the 4 new `iris_x509_manage:*` keys are classified at runtime via `mutates`, outside the frozen baseline). `bootstrap-classes.ts` regenerated; `BOOTSTRAP_VERSION` `80487cda8d82` → `3dfe34fbe183` (dev) → `dc6e10143476` (after code-review hardening; idempotent — re-run yields the same hash). Full monorepo: build green (7 packages), test green (shared 500, admin 321, data 120, interop 171, dev 293, ops 159), lint clean, `tsc` strict clean. Updated the admin `index.test.ts` tool-count assertion 24 → 25 and added the `iris_x509_manage` name assertion.

### File List

- `packages/iris-admin-mcp/src/tools/x509.ts` (new) — `iris_x509_manage` tool (list/get/import/delete; 4-action `mutates`; private-key-free output mapping; write-only key forwarding).
- `packages/iris-admin-mcp/src/tools/index.ts` (modified) — import + register `x509ManageTool`.
- `packages/iris-admin-mcp/src/__tests__/x509.test.ts` (new) — per-action unit tests + no-private-key-material deep-scan + metadata assertions.
- `packages/iris-admin-mcp/src/__tests__/x509-governance.test.ts` (new) — real-gate governance proof (import/delete default-disabled, list/get enabled, per-action opt-in flip).
- `packages/iris-admin-mcp/src/__tests__/index.test.ts` (modified) — tool count 24 → 25; added `iris_x509_manage` name assertion.
- `src/ExecuteMCPv2/REST/Security.cls` (modified) — `X509List`, `BuildX509Entry`, `X509Manage` methods (namespace save/restore; SanitizeError; never reads private-key props).
- `src/ExecuteMCPv2/REST/Dispatch.cls` (modified) — `/security/x509` GET + POST routes.
- `packages/shared/src/bootstrap-classes.ts` (regenerated) — `BOOTSTRAP_VERSION` `80487cda8d82` → `3dfe34fbe183` (dev) → `dc6e10143476` (code-review hardening of `Security.cls`; output-only; do not hand-edit — Rule #18).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified) — story status ready-for-dev → in-progress → review.

## Dev Notes

- **`%SYS.X509Credentials` (from `irislib/%SYS/X509Credentials.cls`):** props — `Alias` (Required), `Certificate` (%Binary, public — OK to derive metadata from), `PrivateKeyType`, **`PrivateKey`/`PrivateKeyPassword`/`PrivateKeyExport`/`PrivateKeyPasswordExport` (SECRET — NEVER output)**, `HasPrivateKey` (Internal %Boolean — safe presence flag), `CAFile`. Methods: `Import(FileName,.NumImported,Flags)` (file-based XML import), `Delete(alias)`, `GetProperties(handle,.props)`, `Exists(name,.cred,.status)`, `ListAll()`/`ListDetails()` SQLQueries, `GetByAlias(alias,pwd)`. Confirm the exact metadata fields `GetProperties` returns (Rule #2).
- **Import mechanism:** the native `Import` is file-based. If a base64/PEM create path is desired, probe whether constructing `%SYS.X509Credentials` with `Alias`+`Certificate` (decoded binary) + `Save` works, and whether a private key can be attached write-only. Implement what the class supports; document it. Don't fabricate.
- **Secret hygiene is the headline:** the `get`/`list` output mapping (TS) AND the ObjectScript handler must both exclude every private-key field. Expose only `hasPrivateKey:true|false`. Mirror the 15.2 deep-scan redaction test.
- **Patterns to copy:** `service.ts`/`ldap.ts` (tool), `Security.cls` `Ldap*`/`Service*` (handler), `Dispatch.cls` routes, `ldap-governance.test.ts` (real-gate harness), the 15.2 password deep-scan test (adapt for private-key fields).
- **Bootstrap:** `iris_doc_load path="c:/git/iris-execute-mcp-v2/src/**/Security.cls" compile=true namespace=HSCUSTOM`; then `pnpm run gen:bootstrap`.

## Change Log

| Date | Change |
|---|---|
| 2026-06-16 | Story 15.3 authored. `iris_x509_manage` (list/get/import/delete); per-action `mutates` (import/delete write); `%SYS.X509Credentials` handler + `/security/x509` route; NO private-key material in output (AC 15.3.3, security-critical); import mechanism TBD via live probe (Rule #16). Frozen-foundation + bootstrap-regen inherited. |
| 2026-06-16 | Story 15.3 implemented. Import mechanism resolved = object-create + Save (base64 cert + optional write-only base64 private key); native file-based Import not exposed. Handler reads ONLY safe public props (never GetProperties, which leaks PrivateKey). TS deep-scan + real-gate governance tests added. Live-verified on HSCUSTOM with a real-private-key cert: hasPrivateKey:true + public metadata, NO key material; disposable alias + probe cleaned up. Baseline hash unchanged `1e62c5ad5bf7`/141; `BOOTSTRAP_VERSION` `80487cda8d82`→`3dfe34fbe183`. Full build/test/lint/tsc green. Status → review. |
| 2026-06-16 | Code review (no HIGH). AC 15.3.3 secret-hygiene independently verified at the ObjectScript exclusion authority; QA hostile-payload deep-scan confirmed non-vacuous (asserts the scanner throws on a leak). Three findings auto-fixed inline in `Security.cls` + live-verified: (CR 15.3-1, MED) `import` silently overwrote an existing credential incl. its private key — added `Exists` precheck rejecting overwrite; (CR 15.3-2, MED) get-path `Exists` truthy-`%Status` on `%Admin_Secure` failure misread as "exists" → `<INVALID OREF>` — guard now also checks `$$$ISERR(tStatus)`/`'$IsObject(tCred)`; (CR 15.3-3, LOW) `X509List` `%ResultSet` cursor leak on mid-loop exception — catch now closes `tRS`. Bootstrap regenerated `3dfe34fbe183`→`dc6e10143476` (idempotent); governance hash unchanged `1e62c5ad5bf7`/141. CR 15.3-4/5/6 deferred (cert-DER validation, ISO-8601 timestamps, suite-wide vestigial `namespace` field). Full monorepo re-verified green (build/tsc 0, lint 0; shared 500, admin 343, dev 293, interop 171, data 120, ops 159). |
