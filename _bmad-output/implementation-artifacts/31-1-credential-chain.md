# Story 31.1: Credential Chain (shared)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **iris-mcp user whose IRIS connections come from Server Manager definitions on disk**,
I want **the suite to complete those definitions with a password from my OS keychain, an env var, or a credential-helper command**,
so that **a Server-Manager-sourced profile actually connects — without a password ever living in an MCP client config file.**

## Acceptance Criteria

1. **AC 31.1.1** — Ordered chain per Server-Manager-sourced profile lacking a password: (1) `IRIS_PROFILES.<name>.password` / `IRIS_PASSWORD` for the default-mapped name; (2) OS keychain service `iris-mcp`, account `<serverName>` via `@napi-rs/keyring` declared as **optionalDependency** — when the native module fails to load, the chain SKIPS this link with a debug log (never a crash; verified by a test that mocks the import failure); (3) `IRIS_CREDENTIAL_HELPER` executed with the server name as argv[1] — trimmed stdout is the password, non-zero exit skips the link, stderr passed through to logs, 10s timeout; (4) exhausted ⇒ profile excluded with an error log naming ALL remediations verbatim (`iris-mcp-credentials set <name>`, `IRIS_CREDENTIAL_HELPER`, `IRIS_PROFILES`); `required` mode escalates exhaustion to startup failure.
2. **AC 31.1.2** — Unit tests drive the full chain with injected fake keychain + fake helper (order, first-hit-wins, skip-on-error per link); no test touches a real keychain.
3. **AC 31.1.3** — Live smoke (Windows, this machine): password stored in Windows Credential Manager under `iris-mcp/<name>` resolves through the real `@napi-rs/keyring` path; secret never appears in logs or errors (assert on captured output).
4. **AC 31.1.4** — Passwords resolved via any link are held in memory only, flow through the existing `IrisHttpClient` construction unchanged, and never appear in `iris_server_profiles` output (existing allow-list test extended to the new fields).

### Integration ACs

**This story HAS a consumer and must prove the wire-up end-to-end.** The chain's output feeds the minimal `loadProfileRegistry` wire-in that Story 31.0 already shipped.

- **Integration AC 31.1.5** — With `IRIS_SERVER_MANAGER=auto`, a settings-file definition carrying **no** password, and a password available from an injected keychain seam, `loadProfileRegistry(env)` returns a registry containing that profile with the chain-resolved password — driven through the real `loadProfileRegistry` entry point, not `resolveServerManagerProfiles` in isolation. The same call with the keychain seam empty and no helper/env must **exclude** the profile (and, under `required`, throw).

## Tasks / Subtasks

- [x] **Task 1 — Add `@napi-rs/keyring` as an optionalDependency + verify its real API (AC: 31.1.1)**
  - [x] Add `@napi-rs/keyring` (current stable is **1.3.0**) to `packages/shared/package.json` **`optionalDependencies`** — NOT `dependencies`. This is authorized by AC 31.1.1 and binding-spec F1-D2; do not halt as out-of-spec.
  - [x] **Rule #16 — verify, do not assume, the API surface.** After install, read the package's own `.d.ts` in `node_modules/@napi-rs/keyring/` and confirm the exact constructor/method names before writing code against them. Do not code from memory of `keytar` or of this story's prose.
  - [x] Confirm the package installs on this machine and that `pnpm turbo run build` stays green.
- [x] **Task 2 — Widen the Story 31.0 seam (AC: 31.1.1)**
  - [x] Story 31.0 deliberately left `resolveServerManagerProfiles` returning `IrisProfile[]` with unresolved entries **dropped inside the function** — no `credentialStatus` field exists yet. Widening that return contract is **this story's assigned work** (documented at `server-manager-source.ts` lines 19-26); it is NOT re-opening finished 31.0 work.
  - [x] Choose and document the widened shape (e.g. return unresolved entries tagged `credentialStatus: "unresolved"`, or a richer result object) so the chain has something to resolve.
- [x] **Task 3 — Implement the 4-link chain (AC: 31.1.1, 31.1.2)**
  - [x] Link 1 — explicit env: `IRIS_PROFILES.<name>.password`, and `IRIS_PASSWORD` for the default-mapped name.
  - [x] Link 2 — OS keychain: service `iris-mcp`, account `<serverName>`. **Load via a guarded dynamic import inside try/catch**; a native-module load failure logs at debug and SKIPS the link. Never let it throw. Provide an injectable seam so tests never touch a real keychain.
  - [x] Link 3 — helper: run `IRIS_CREDENTIAL_HELPER` with the server name as `argv[1]`; trimmed stdout = password; non-zero exit ⇒ skip link; stderr passed through to logs; **10s timeout**. Injectable seam for tests.
  - [x] Link 4 — exhausted: exclude the profile with an error log naming ALL THREE remediations verbatim (`iris-mcp-credentials set <name>`, `IRIS_CREDENTIAL_HELPER`, `IRIS_PROFILES`).
  - [x] First-hit-wins ordering; a failure in one link never aborts the chain — it advances to the next.
- [x] **Task 4 — `required`-mode credential escalation (AC: 31.1.1)**
  - [x] `required` + chain exhausted for a profile ⇒ startup failure. **Keep this distinct from Story 31.0's `required` check**, which fires only on zero definitions FOUND (before credential completeness) — see Dev Notes.
- [x] **Task 5 — Resolve deferred item 31-0-1 (`seenNames` shadowing)**
  - [x] Today an unresolved higher-precedence entry is added to `seenNames` *before* the credential check, permanently shadowing a resolvable same-named entry in a lower-precedence file.
  - [x] With the chain in hand, decide the rule once: either add to `seenNames` only on successful resolution, or track shadowed candidates so a lower-precedence resolvable definition can fill an unresolved slot. Document the choice.
  - [x] Add a two-file fixture test proving the chosen behavior.
- [x] **Task 6 — Resolve deferred item 31-0-2 (`username` inheritance)**
  - [x] `smBase` clears only `password`; `username` still inherits from the local default config, so an entry with an inline password but no `username` can authenticate with a pair that was never valid together — repeated failures risk **locking out the account** on the remote instance.
  - [x] Decide explicitly: (a) inherit as today, (b) treat as unresolved, or (c) take the username from the keychain account key. Document the choice in the README row (binding spec F1-D2 point 2 floats a `<serverName>/<username>` account shape — settle it here).
- [x] **Task 7 — Secret safety (AC: 31.1.3, 31.1.4)**
  - [x] No resolved password may appear in any log line, warning, or thrown error — from any of the four links, including helper stderr pass-through (**scrub the helper's stderr before logging it**; a helper may echo the secret).
  - [x] Extend the existing `iris_server_profiles` allow-list test to cover the new/widened fields (AC 31.1.4).
- [x] **Task 8 — Tests (AC: 31.1.2, 31.1.5)**
  - [x] Chain unit tests with injected fake keychain + fake helper: link order, first-hit-wins, skip-on-error per link, all-exhausted messaging, native-module-import-failure path (mock the import failure — AC 31.1.1 names this explicitly).
  - [x] Integration AC 31.1.5 test driving the real `loadProfileRegistry` entry point (resolved and unresolved variants, plus `required` throwing).
  - [x] Rule #19 regression: with `IRIS_SERVER_MANAGER` unset, `loadProfileRegistry` output stays byte-identical — Story 31.0's existing `toEqual` gate must remain green and untouched.
  - [x] Full suite green: `pnpm turbo run build test lint type-check`; `pnpm gen:governance-baseline:check` exit 0.

### Review Findings

Code review 2026-07-25 (3-layer adversarial: Blind Hunter + Edge Case Hunter + Acceptance Auditor).
**3 HIGH / 6 MEDIUM / 6 LOW patched in-story · 5 deferred (LOW) · 7 dismissed · 0 decision-needed.**
All three HIGHs were independently reproduced live by two or more layers *and* by the reviewer before
being actioned.

- [x] [Review][Patch] **HIGH — 31-0-2's guard was defeated by the chain it was written for: a no-`username` entry was still completed, pairing the LOCAL username with a remote password** [`packages/shared/src/server-manager-source.ts:623`] — tagging the entry `"unresolved"` is exactly what hands it to `credential-chain.ts`, which resolves by NAME and wrote the keychain/helper password straight back onto the inherited username. Proven live: `noUserSrv` → `{host: remote.example.com, username: localadmin, password: KEYCHAINPW}` with **zero warnings** (the warn was gated on an inline password being present, so the common no-password shape was silent). The entry is now **not imported at all**, always with a warning naming the file and the fix. README claim "never auto-completed by the chain" is now true.
- [x] [Review][Patch] **HIGH — chain link 1 is unreachable in production, and the remediation text it prints walks operators into aiming a remote credential at localhost** [`packages/shared/src/profiles.ts:396`] — every `IRIS_PROFILES` key and `default` are already in the registry, and registry-shadowed names are filtered out *before* the chain, so link 1 can never fire via `loadProfileRegistry`. Meanwhile both the exhaustion warn and the `required` error said "add a password via `IRIS_PROFILES`"; doing that **replaces** the Server-Manager definition with an env profile inheriting the local host/username (proven live). Fixed: remediation text now says "with its full connection fields", the discard emits a collision warning naming the SM host and the correct remedy, and the reachability rule is documented in code + README.
- [x] [Review][Patch] **HIGH — the module's thrice-stated "NEVER throws" contract was breakable by a seam returning `null` — the shape `@napi-rs/keyring` itself returns** [`packages/shared/src/credential-chain.ts:333`] — the `.trim()` guards sat *outside* the try/catch, so a `TypeError` escaped `resolveCredential` → `resolveServerManagerCredentials` → `loadProfileRegistry` → `McpServerBase.start()`, failing all five servers. `CredentialChainOptions` is public API, so a direct passthrough of `getPassword(): string | null` is the natural consumer wiring. Fixed with a `usablePassword()` type guard applied inside the try.
- [x] [Review][Patch] **MEDIUM — helper stderr was logged in cleartext whenever stdout was empty** [`credential-chain.ts:260`] — `scrubSecret` returned the text unchanged for an empty key, and the non-zero-exit/timeout paths routinely have empty stdout while stderr still carries a token. The body is now WITHHELD when there is no candidate to scrub against.
- [x] [Review][Patch] **MEDIUM — multi-line helper stdout defeated the stderr scrub** [`credential-chain.ts:258`] — the scrub key was the whole trimmed blob, which never matches the bare password as it appears in stderr. `pass show iris/prod` (the README's own example) prints exactly that shape. Scrubbing now also uses each individual stdout line; password semantics stay AC-literal (trimmed stdout).
- [x] [Review][Patch] **MEDIUM — the 31-0-1 rescue silently replaced the whole higher-precedence definition (host, port, username)** [`server-manager-source.ts:639`] — `"resolved"` at that layer only means "carries a *deprecated* inline password", never "is the only resolvable candidate", so a stale lower-precedence host could beat one the chain would have completed. Kept (it is the story-sanctioned option) but now announced with a warning naming both hosts and the remedy; whether a rescue may change the connection *target* is deferred to Story 31.3.
- [x] [Review][Patch] **MEDIUM — a real `spawnSync` timeout took the wrong branch** [`credential-chain.ts:249`] — Node sets BOTH `error.code === "ETIMEDOUT"` and `signal === "SIGTERM"` (verified live), so a 10s hang was reported as a generic `debug` "failed to start" and the `warn` branch its own comment described was unreachable; stderr was discarded on that path. Timeouts are now detected by error code, WARN, and pass their (guarded) stderr through.
- [x] [Review][Patch] **MEDIUM — spawn failure, the most actionable helper misconfiguration, was the only branch logged at `debug`** [`credential-chain.ts:240`] — now `warn`, with an explicit hint for `EINVAL`, which on Windows is almost always a `.cmd`/`.bat` shim (verified live: Node's CVE-2024-27980 hardening makes those unexecutable without a shell, and this chain deliberately never uses one). README documents the `.exe` / `cmd /c` requirement.
- [x] [Review][Patch] **MEDIUM — the one test proving the `required` aggregate never short-circuits was vacuous** [`credential-chain.test.ts:275`] — `toContain("a")`/`toContain("b")` matched ordinary prose ("resolve **a** password", "**b**ut the"); both passed with the name list emptied. Now asserts the rendered list `for: a, b.`.
- [x] [Review][Patch] **LOW — link 1 inverted `buildProfileRegistry`'s precedence for the reserved `default` name** [`credential-chain.ts:152`] — read only `IRIS_PASSWORD`, ignoring `IRIS_PROFILES.default.password`, which `buildProfileRegistry` lets win. Story 31.2's `iris-mcp-credentials test default` would have reported a credential the server does not use.
- [x] [Review][Patch] **LOW — a failed `@napi-rs/keyring` import was re-logged once per profile** [`credential-chain.ts:186`] — Node does not cache failed module resolution. Memoized to one line per process.
- [x] [Review][Patch] **LOW — `IRIS_CREDENTIAL_HELPER` tokenizing to zero arguments resolved silently** [`credential-chain.ts:227`] — now warns (without echoing the raw value, which may embed a secret).
- [x] [Review][Patch] **LOW — two tests used "a real keychain lookup would fire" as their regression signal** [`profiles.test.ts:705,768`] — that makes an AC 31.1.2 violation (touching the developer's real Windows Credential Manager) the failure mode. Both now inject a throwing seam and assert it was never called.
- [x] [Review][Patch] **LOW — both documented `IRIS_CREDENTIAL_HELPER` examples could not work** [`README.md:92`] — the server name is appended, so bare `op read op://vault/item` / `pass show iris/prod` reject the extra positional. README now prescribes a wrapper script using `$1`.
- [x] [Review][Patch] **LOW — story File List and Debug Log References were stale** — missing the two QA-added test files; test counts corrected.

Deferred (recorded in `deferred-work.md` as `31-1-1` … `31-1-5`): `required` does not escalate when every definition is structurally invalid; whether a 31-0-1 rescue may change the connection target (Story 31.3); no aggregate startup budget for `spawnSync` helper calls (10s × N blocked event loop); the AC-literal `argv[1]` vs. final-argv wording; the "N profiles have no password yet" debug line counting entries later filtered out.

## Dev Notes

**Two `required`-mode checks exist — do not merge them.** Story 31.0's `required` check fires when **zero definitions are FOUND** (nothing in any settings file, or the allow-list matched none). This story adds a second, later escalation: definitions were found but a profile's **credential chain was exhausted**. The split is deliberate and spec-backed (binding spec F1-D1 vs F1-D2), was adjudicated in the Story 31.0 code review, and is documented at `server-manager-source.ts:412-415`. Conflating them would make a passwordless definition indistinguishable from a missing one.

**The keychain link must degrade, never crash.** `@napi-rs/keyring` is a native module shipped as an **optionalDependency** precisely because it fails to install/load in some CI images and containers. Load it behind a guarded dynamic `import()` in try/catch; on failure log at debug and move to the next link. AC 31.1.1 requires a test that **mocks the import failure** — a real missing module is not reproducible in CI, so inject the seam.

**Verify the keyring API from the installed package, not from memory** (Rule #14/#16). `keytar`'s API is a different shape and is archived; do not pattern-match from it. Read `node_modules/@napi-rs/keyring/*.d.ts` after install and code against what is actually there.

**Helper-link hygiene.** `IRIS_CREDENTIAL_HELPER` runs an arbitrary operator-configured command: pass the server name as `argv[1]` (never interpolate it into a shell string — avoid shell injection via a server name containing shell metacharacters); enforce the 10s timeout; treat non-zero exit as *skip this link*, not as a fatal error. Its stderr goes to our logs, so **scrub it for the resolved secret before logging** — a naive helper may print the password to stderr.

**Secret discipline is the whole point of this epic.** Every new surface here handles a live password. Assert secret-absence on captured log output AND on thrown error messages (the Story 31.0 review added tests for the thrown-error case specifically because only `logger.warn` had been covered). Existing downstream redaction (`iris_server_profiles` allow-list, audit key-pattern redaction) still applies but does not cover this module's own new messages.

**Rule #19 gate is still binding.** Story 31.0's back-compat proof (`IRIS_SERVER_MANAGER` unset ⇒ `loadProfileRegistry` output `toEqual` pre-feature) must stay green and must not be weakened to accommodate the widened return contract. QA mutation-verified that gate in 31.0 — keep it mutation-sensitive.

**Rules that do NOT apply** (stated so you don't go looking): no new MCP tool ⇒ Rules #28/#53 untriggered, no tool count moves (Rule #31). No ObjectScript ⇒ no bootstrap/`BOOTSTRAP_VERSION` change. No new governance key ⇒ frozen baseline `1e62c5ad5bf7` (141 keys) unchanged; run `pnpm gen:governance-baseline:check` (the `:check` ONLY — never the bare generator, Rule #25).

**Carried deferred items resolved by this story:** `31-0-1` (`seenNames` shadowing) and `31-0-2` (`username` inheritance) — both were deferred from the Story 31.0 review *specifically because this story owns credential resolution*. Both are Tasks above; do not re-defer them without a documented reason. `31-0-3`/`31-0-4` belong to Story 31.3, not here.

**AC 31.1.3 is a LEAD smoke gate.** The live Windows Credential Manager verification is run by the lead after code review, against the built dist. Make the real-keychain path reachable from a plain Node process (no test-only injection required to exercise it) so that smoke can drive it.

### Project Structure Notes

- The chain belongs in `packages/shared/src/` — either extending `server-manager-source.ts` or a sibling module (e.g. `credential-chain.ts`) if that file is growing unwieldy. If you add a module, export it from `packages/shared/src/index.ts` in the existing style.
- **Watch the existing circular import.** `profiles.ts` ↔ `server-manager-source.ts` already cross-import (safe today: references live only inside hoisted function bodies; guard comments at both import sites name the prohibited pattern). Do not add a module-scope evaluation of an imported binding, and prefer a new sibling module over deepening the cycle.
- Tests in `packages/shared/src/__tests__/`; vitest (`pnpm test` = `vitest run`). Do **not** use the `*.integration.test.ts` suffix — it is excluded from the default run, and these proofs must run in the default suite (Rule 8).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-31.1] — AC 31.1.1-31.1.4.
- [Source: research spec#Feature-1-Design] — F1-D2 (the four-link chain, keychain service/account shape, optional-dep rationale); Pattern D (why not MCP elicitation — spec-forbidden for secrets); Pattern E (credential-helper precedent).
- [Source: packages/shared/src/server-manager-source.ts:10-33] — the module's own "what 31.1 owns" seam contract; `:395-415` unresolved-exclusion + the two `required` checks.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#31-0] — items `31-0-1` and `31-0-2` with their full rationale and suggested resolutions.
- [Source: packages/shared/src/profiles.ts] — `mergeProfile`/`ProfileOverride` (now exported), `loadProfileRegistry:320`, Rule #19 conditional spread.
- [Source: _bmad-output/planning-artifacts/architecture.md#D1/#D7/#D8] — per-profile client registry, fail-fast config style, lazy per-profile bootstrap.
- [Source: .claude/rules/project-rules.md] — #14/#16 verify-API-live, #19 additive gate, #25 baseline `:check`, #31 no tool-count change, #52 scope seam.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via bmad-dev-story.

### Debug Log References

- `pnpm turbo run build test lint type-check`: 25/25 tasks green. `@iris-mcp/shared` counts by stage: dev 52 files / 948 tests → QA 54 / 962 → **post-code-review 54 / 977** (+64 net new over Story 31.0's 913); zero regressions in the other 4 server packages + `@iris-mcp/all`. *(Corrected at code review: this line originally reported the dev-stage 52/948 as final.)*
- `pnpm gen:governance-baseline:check` (`:check` only): exit 0 — frozen `141` / live `201` / post-foundation `60`, all unchanged (no new governed tool/action; this story adds no MCP tool).
- Manual live sanity check (disposable script, deleted before staging, never committed): `@napi-rs/keyring`'s `Entry.setPassword`/`getPassword`/`deleteCredential` verified against the real Windows Credential Manager on this machine — confirms `getPassword()` returns `null` (not a throw) on a missing entry, which `getKeychainPasswordDefault` in `credential-chain.ts` already handles. This is a dev-side Rule #14/#16 verification, NOT the formal AC 31.1.3 lead smoke gate (explicitly reserved for the lead per Dev Notes).

### Completion Notes List

- Implemented the 4-link credential chain (env → OS keychain → credential helper → exhausted) in a new sibling module `packages/shared/src/credential-chain.ts`, deliberately NOT importing `profiles.ts` (even though `profiles.ts` imports from it) to avoid deepening the existing `profiles.ts` ↔ `server-manager-source.ts` cycle — the reserved `"default"` profile name is duplicated locally as a comment-documented constant instead of imported.
- Widened `resolveServerManagerProfiles`'s return contract (Task 2) to `ServerManagerProfileResult[]` (`IrisProfile` + `credentialStatus: "resolved" | "unresolved"`); unresolved entries are now INCLUDED (not dropped), with `password: ""`.
- `@napi-rs/keyring` 1.3.0 added to `packages/shared/package.json` `optionalDependencies`; its real `.d.ts` was read before coding (Rule #16) — `Entry` (sync: `getPassword(): string | null`) is used, not `AsyncEntry`. The keychain link is loaded via a guarded `await import("@napi-rs/keyring")` inside try/catch (mockable by vitest's module system, unlike `createRequire().require()`), which is why `resolveCredential`/`resolveServerManagerCredentials`/`loadProfileRegistry` are `async` — see Decisions below.
- `loadProfileRegistry` (`profiles.ts`) is now `async`, gained a 3rd optional `credentialChainDeps` param for test injection (AC 31.1.5), and filters out Server-Manager entries whose name already exists in the registry BEFORE running the chain (so a shadowed name never triggers a real keychain/helper lookup for a profile that would be discarded anyway). `server-base.ts`'s one production call site now `await`s it.
- Deferred item 31-0-1 (`seenNames` shadowing): a later file's entry for an already-claimed-but-unresolved name may now "rescue" the slot by overwriting it, but only when the later entry itself resolves; two fixture tests added (rescue succeeds; rescue correctly does NOT happen when both are unresolved).
- Deferred item 31-0-2 (`username` inheritance): a Server-Manager entry that does not declare its own `username` is now forced `"unresolved"` (password cleared even if a legacy inline value was present) rather than silently inheriting the local default's username; two fixture tests added (forced-unresolved + warning; normal resolution when username IS present).
- Secret safety: credential-helper stderr is scrubbed for the resolved stdout candidate before being logged (with a minimum-length gate per Rule #9 — a <4-char secret is withheld entirely rather than partially redacted); verified live with a real Node subprocess that echoes the password to both stdout and stderr.
- `iris_server_profiles`'s allow-list (`buildRosterEntry`) needed NO code change (no new field was added to `IrisProfile`/`ProfileRosterEntry` — `credentialStatus` lives only on the intermediate `ServerManagerProfileResult`, stripped before a profile enters the registry); extended its test coverage with a synthetic chain-resolved-profile fixture (`server-discovery.test.ts`) plus an end-to-end `loadProfileRegistry` → `buildRoster` no-leak assertion (`profiles.test.ts`).
- Full `Story 31.0` regression surface stays green: all 85 `server-manager-source.test.ts` tests pass (2 tests whose assertions pinned the OLD "excluded" behavior were rewritten to assert the new "included, tagged unresolved" contract — required by the widened seam this story explicitly owns); Story 31.0's own Rule #19 `toEqual` back-compat gate (`IRIS_SERVER_MANAGER` unset ⇒ byte-identical `loadProfileRegistry` output) stays green, `await`ed but assertion-unweakened.

### File List

- `packages/shared/src/credential-chain.ts` (new)
- `packages/shared/src/server-manager-source.ts`
- `packages/shared/src/profiles.ts`
- `packages/shared/src/server-base.ts`
- `packages/shared/src/index.ts`
- `packages/shared/package.json`
- `packages/shared/src/__tests__/credential-chain.test.ts` (new)
- `packages/shared/src/__tests__/credential-chain-keychain-unavailable.test.ts` (new)
- `packages/shared/src/__tests__/credential-chain-secret-leak-sweep.test.ts` (new — QA)
- `packages/shared/src/__tests__/credential-chain-helper-timeout.test.ts` (new — QA)
- `packages/shared/src/__tests__/server-manager-source.test.ts`
- `packages/shared/src/__tests__/profiles.test.ts`
- `packages/shared/src/__tests__/profiles-resolution.test.ts`
- `packages/shared/src/__tests__/server-discovery.test.ts`
- `README.md`
- `.changeset/credential-chain-async-registry.md` (new — code review; documents the `loadProfileRegistry` sync→async API change and the no-`username` behavior change)
- `pnpm-lock.yaml` (from `pnpm add @napi-rs/keyring --save-optional`)

*(The two QA test files and the changeset were added after the dev's own File List was written; corrected at code review.)*

## Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-07-25 | 0.1 | Story created (Epic 31; absorbs deferred items 31-0-1 and 31-0-2 from the Story 31.0 review) | Bob (SM) |
| 2026-07-25 | 1.0 | Story implemented: 4-link credential chain (`credential-chain.ts`), widened `resolveServerManagerProfiles` contract, `loadProfileRegistry` async wiring + `required` escalation, deferred items 31-0-1/31-0-2 resolved, secret-safety scrubbing, `iris_server_profiles` allow-list extended, README docs. 25/25 `pnpm turbo run build test lint type-check`; `gen:governance-baseline:check` exit 0. Status: ready-for-dev → review. | Amelia (Dev) |
| 2026-07-25 | 1.1 | 3-layer adversarial code review: 27 findings — 15 patched in-story (3 HIGH / 6 MEDIUM / 6 LOW), 5 deferred (`31-1-1`…`31-1-5`), 7 dismissed. HIGHs: the 31-0-2 no-`username` guard was defeated by the chain itself (entry now not imported at all); chain link 1 unreachable in production while its remediation text aimed remote credentials at localhost (text corrected, discard now warns); the "NEVER throws" contract breakable by a seam returning `null` (`usablePassword` guard). Plus a cleartext-stderr leak on empty stdout, a multi-line-stdout scrub bypass, a silent rescue overwrite, a mis-branched timeout, debug-only spawn failures, and a vacuous `required`-aggregate assertion. README's three false statements + two unusable helper examples corrected; `.changeset/credential-chain-async-registry.md` added for the previously-undocumented `loadProfileRegistry` sync→async public API change. `@iris-mcp/shared` 962 → 977 tests; 25/25 turbo green; `gen:governance-baseline:check` exit 0 (`1e62c5ad5bf7` / 141 unchanged). Status: review → done. | Code Review (Opus 5) |
