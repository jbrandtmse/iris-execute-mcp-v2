# Story 31.2: `iris-mcp-credentials` CLI

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **iris-mcp user setting up a machine for standalone (non-VS-Code) use**,
I want **a small CLI that stores, lists, tests, and removes IRIS passwords in my OS keychain**,
so that **the one-time per-machine credential setup is a single documented command instead of a hand-edited config file containing a password.**

## Acceptance Criteria

1. **AC 31.2.1** — New bin (in `@iris-mcp/shared` or sibling package per lead call at implementation): `set <serverName>` (hidden interactive prompt — never an argv password; `--stdin` for scripted use), `delete <serverName>`, `list` (names only, never secrets), `test <serverName>` (runs the full 31.1 chain, reports which link resolved, optional `--connect` performs an Atelier HEAD against the mapped profile; output never contains the password).
2. **AC 31.2.2** — Exit codes: 0 success, 1 not-found/unresolved, 2 usage error; errors name remediations; `--json` flag for machine-readable output on `list`/`test`.
3. **AC 31.2.3** — Rule #22 dist smoke: fresh Node process runs the built bin end-to-end (`set` via `--stdin` → `test` → `delete`) against the real OS keychain; disposable smoke script deleted before staging.
4. **AC 31.2.4** — Docs: README section + `docs/client-config/*.md` gain the two-command standalone recipe (`iris-mcp-credentials set` + `IRIS_SERVER_MANAGER=auto` in the client env block).

### Integration ACs

**This story HAS a consumer relationship and must prove it end-to-end.** The CLI is the *writer* for the keychain that Story 31.1's credential chain *reads*.

- **Integration AC 31.2.5** — A password written by `iris-mcp-credentials set <name>` is resolvable by the Story 31.1 chain for that same `<name>` without any further configuration: prove it by writing via the CLI and then reading through `loadProfileRegistry` (or `test <name>`, which runs the real chain). The writer and the reader MUST agree on the keychain service/account key by construction — see Dev Notes.

## Tasks / Subtasks

- [x] **Task 1 — Wire the bin into `@iris-mcp/shared` (AC: 31.2.1)**
  - [x] **Lead decision (AC 31.2.1 explicitly delegates this):** the CLI ships as a **bin in `@iris-mcp/shared`**, NOT a new sibling package. Rationale is in Dev Notes — do not re-litigate or create a new package.
  - [x] Bin name is **`iris-mcp-credentials`** — this is already fixed by the remediation text shipped in Story 31.1 (`credential-chain.ts` tells users to run `iris-mcp-credentials set <name>`). It must match exactly.
  - [x] Follow the established pattern from the 5 server packages: `"bin": { "iris-mcp-credentials": "./dist/<entry>.js" }`. Add the `#!/usr/bin/env node` shebang to the entry source so the built file is directly executable.
  - [x] `packages/shared/package.json` already has `files: ["dist"]`, so no packaging change is needed beyond `bin`. Confirm `pnpm turbo run build` still emits the entry and that the shebang survives compilation.
- [x] **Task 2 — `set <serverName>` (AC: 31.2.1)**
  - [x] Interactive path: prompt for the password with **echo suppressed**. Never accept a password as an argv value (it would land in shell history and in the OS process list).
  - [x] `--stdin` path: read the password from stdin (trimmed of a single trailing newline) for scripted/CI use. This is the path AC 31.2.3's smoke drives.
  - [x] Write to the OS keychain using the SHARED constant (see Dev Notes) — service `iris-mcp`, account `<serverName>`.
  - [x] Confirm success without echoing the secret.
- [x] **Task 3 — `delete <serverName>` and `list` (AC: 31.2.1)**
  - [x] `delete`: remove the entry; a missing entry is exit code 1 (not-found), not a crash.
  - [x] `list`: print stored server **names only**. Never print, log, serialize, or retain a password value. *(Amended in place 2026-07-25 at code review, Rule 5/#42, on a verified-live API constraint — the original wording was "never **read** a password value in order to list", which `@napi-rs/keyring@1.3.0` makes impossible: its only service-scoped enumeration entry point is `findCredentials(service)`, returning `{account, password}` pairs with no account-only variant, so the passwords under the service necessarily transit process memory. The implementation extracts `.account` and discards the rest at the first opportunity; the amended requirement is what is actually achievable and what the tests assert. AC 31.2.1 in `epics.md` carries the matching amendment.)*
  - [x] Note the platform limitation honestly in `--help`/docs if the keychain backend cannot enumerate entries by service (see Dev Notes — verify before assuming).
- [x] **Task 4 — `test <serverName>` (AC: 31.2.1, Integration AC 31.2.5)**
  - [x] Run the **real Story 31.1 chain** (do not reimplement it) and report WHICH link resolved: env / keychain / helper / exhausted.
  - [x] Optional `--connect`: perform an Atelier `HEAD /api/atelier/` against the mapped profile. Reuse the existing health-check helper in `packages/shared/src/health.ts` rather than hand-rolling a request.
  - [x] Output must never contain the password — including on the failure path and in any error the connect attempt surfaces.
- [x] **Task 5 — Exit codes, `--json`, `--help` (AC: 31.2.2)**
  - [x] `0` success · `1` not-found/unresolved · `2` usage error (unknown command, missing required arg, bad flag). Be consistent across all four subcommands.
  - [x] `--json` on `list` and `test` produces machine-readable output; the human and JSON shapes must both be secret-free.
  - [x] Every error names its remediation, matching the style the chain already uses.
- [x] **Task 6 — Keychain-unavailable handling (AC: 31.2.1)**
  - [x] `@napi-rs/keyring` is an **optionalDependency**. The Story 31.1 chain *skips* the keychain link when the native module is unavailable — **the CLI must NOT do that.** Its entire purpose is the keychain, so it must fail loudly with a clear, actionable message and a non-zero exit. Do not copy the chain's silent-skip behavior here.
- [x] **Task 7 — Tests (AC: 31.2.1, 31.2.2, 31.2.5)**
  - [x] Unit-test argument parsing, all three exit codes, `--json` shapes, and secret-absence in every output path, using an injected fake keychain (no test may touch the real keychain — same discipline as AC 31.1.2).
  - [x] Integration AC 31.2.5: prove the CLI-written entry is resolvable by the chain, keyed on the shared constant.
  - [x] Full suite green: `pnpm turbo run build test lint type-check`; `pnpm gen:governance-baseline:check` exit 0.
- [x] **Task 8 — Docs (AC: 31.2.4)**
  - [x] README section for the CLI: all four subcommands, the three exit codes, `--stdin`/`--json`, and the keychain service/account shape.
  - [x] All three `docs/client-config/*.md` files (`claude-code.md`, `claude-desktop.md`, `cursor.md`) gain the **two-command standalone recipe**: `iris-mcp-credentials set <name>` plus `IRIS_SERVER_MANAGER=auto` in that client's env block, using each file's existing formatting.
  - [x] State default states at point of use (Rule #30/#43): `IRIS_SERVER_MANAGER` defaults to `off`.

## Dev Notes

**Lead's packaging decision (AC 31.2.1 delegates this explicitly) — bin in `@iris-mcp/shared`.** Three reasons, in priority order:
1. **Writer/reader drift is the real risk.** The CLI writes the keychain entry that `credential-chain.ts` reads. `credential-chain.ts` already **exports** `CREDENTIAL_CHAIN_KEYCHAIN_SERVICE` (`= "iris-mcp"`, at `credential-chain.ts:74`) — the CLI MUST import that constant and the same account-key derivation rather than re-declaring the string. Same-package co-location makes drift structurally impossible; a separate package makes it a versioning hazard.
2. **The bin name is already load-bearing.** Story 31.1 shipped remediation text telling users to run `iris-mcp-credentials set <name>`. That string is live in error messages; the bin must match it exactly.
3. **Zero new-package wiring.** A sibling package would need its own tsconfig/eslint/vitest/turbo entries and would move cross-package rosters; `@iris-mcp/shared` already builds, tests, lints, and ships `files: ["dist"]`.

**Verify the keyring API for WRITE and DELETE before coding** (Rule #14/#16). Story 31.1 only exercised `getPassword()`. Read `packages/shared/node_modules/@napi-rs/keyring/*.d.ts` and confirm the exact write/delete/enumerate surface — in particular, **do not assume the backend can enumerate entries by service**. `list` is an AC, so if enumeration is not supported by the native API, decide and document a concrete approach (e.g. maintain a names-only index file, or scope `list` to names discoverable from Server Manager definitions) rather than silently shipping a `list` that returns nothing.

**Never let a password reach argv.** Interactive `set` must suppress echo; scripted `set` uses `--stdin`. An argv password is visible in shell history and to any same-user process listing — that would undercut the entire epic, whose premise is keeping secrets out of files and config.

**The CLI's keychain-unavailable behavior is deliberately OPPOSITE the chain's.** The chain treats a missing native module as "skip this link" because it has other links; the CLI has nothing else to do. Fail loudly, non-zero, with an actionable message.

**Reuse, don't reimplement.** `test` must drive the real Story 31.1 chain (`credential-chain.ts`) so it reports true behavior, and `--connect` should reuse `health.ts`'s existing `HEAD /api/atelier/` probe. A reimplementation would drift from what the servers actually do — the exact failure mode `test` exists to prevent.

**Secret discipline.** Every output path (human, `--json`, `--help`, error, and the `--connect` failure surface) must be secret-free. Assert it in tests, as Stories 31.0/31.1 did — their reviews specifically added thrown-error assertions after finding that only `logger.warn` had been covered.

**Rules that do NOT apply:** no new MCP tool ⇒ Rules #28/#53 untriggered, no tool count moves (Rule #31). No ObjectScript ⇒ no bootstrap/`BOOTSTRAP_VERSION` change. No new governance key ⇒ frozen baseline `1e62c5ad5bf7` (141 keys) unchanged; run `pnpm gen:governance-baseline:check` (the `:check` ONLY — never the bare generator, Rule #25). Rule #19: adding a bin changes no existing runtime behavior; `loadProfileRegistry` with `IRIS_SERVER_MANAGER` unset must stay byte-identical and its mutation-sensitive gate must stay green.

**AC 31.2.3 is a LEAD smoke gate** — the lead runs the built bin in a fresh Node process against the real OS keychain (`set --stdin` → `test` → `delete`) after code review. Make the bin runnable directly from `dist` with no dev-only shims.

**No carried deferred items belong to this story.** `31-0-3` and `31-0-4` are assigned to Story 31.3; `31-1-1`…`31-1-5` were filed by the Story 31.1 review — check their entries in `deferred-work.md` and pull one in ONLY if it is genuinely in this story's path.

### Project Structure Notes

- CLI source under `packages/shared/src/` (e.g. `cli/credentials.ts` or `credentials-cli.ts`); it may import from `credential-chain.ts` freely — that module deliberately does not import `profiles.ts`, so no new cycle is introduced.
- **Do not deepen the existing `profiles.ts` ↔ `server-manager-source.ts` import cycle.** Guard comments at both import sites name the prohibited pattern (module-scope evaluation of an imported binding).
- Tests in `packages/shared/src/__tests__/`; vitest (`pnpm test` = `vitest run`). Do NOT use the `*.integration.test.ts` suffix — excluded from the default run (Rule 8).
- Bin pattern to mirror: any of the 5 server packages, e.g. `packages/iris-dev-mcp/package.json` → `{"iris-dev-mcp": "./dist/index.js"}`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-31.2] — AC 31.2.1-31.2.4.
- [Source: research spec#Feature-1-Design] — F1-D4 (the CLI's four commands and its role as the one-time per-machine setup); Pattern D item 1 (suite-owned keychain namespace).
- [Source: packages/shared/src/credential-chain.ts:74] — `CREDENTIAL_CHAIN_KEYCHAIN_SERVICE`, the constant the CLI must import; `:308` shows the `Entry(service, serverName)` account shape the writer must match.
- [Source: packages/shared/src/health.ts] — existing `HEAD /api/atelier/` probe for `test --connect`.
- [Source: packages/shared/src/profiles.ts] — `loadProfileRegistry` (async as of Story 31.1) for the Integration AC 31.2.5 proof.
- [Source: docs/client-config/{claude-code,claude-desktop,cursor}.md] — the three files AC 31.2.4 must update.
- [Source: .claude/rules/project-rules.md] — #14/#16 verify-API-live, #19 additive gate, #22 built-dist smoke, #25 baseline `:check`, #30/#43 docs with default state at point of use, #31 no tool-count change.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- Live probe (Rule #14/#16, deleted before commit — `packages/shared/keyring-probe.mjs`, disposable): verified `@napi-rs/keyring@1.3.0`'s real API shape against `node_modules/.pnpm/@napi-rs+keyring@1.3.0/node_modules/@napi-rs/keyring/index.d.ts` AND live behavior on this machine's real Windows Credential Manager: `Entry.setPassword()` (void), `Entry.getPassword()` (`string | null`, `null` — never throws — for a missing entry), `Entry.deleteCredential()` (`boolean`, `false` — never throws — for a missing entry), and `findCredentials(service): Array<{account, password}>` — enumeration by service IS supported (the story's "do not assume enumeration is possible" caution did not hold for this native module version), resolving Task 3's `list` design without a names-only index-file fallback.
- Manual end-to-end smoke of the built dist (`node dist/cli/credentials-cli.js`) against the real OS keychain using an isolated probe server name (`story312-dev-smoke`, deleted immediately after): `set --stdin` → `list`/`list --json` → `test`/`test --json` → `delete` → `delete` again (not-found, exit 1) → `test` after delete (unresolved, exit 1) all behaved as designed; `list --json` confirmed empty afterward (no residue). This is informal dev verification only — AC 31.2.3's formal lead smoke gate is unrun and remains the lead's action.
- One authoring bug caught and fixed during implementation: literal control characters (Ctrl-D/Ctrl-C/Backspace) typed directly into `credentials.ts`'s interactive-prompt `switch` statement collapsed to duplicate `case ""` labels in the written file. Caught by re-reading the file post-write; fixed by replacing the raw bytes with `\u0004`/`\u0003`/`\u007f` escape sequences via a disposable Node script, then verified via `grep`.

### Completion Notes List

- **Packaging & bin wiring (Task 1).** `"bin": {"iris-mcp-credentials": "./dist/cli/credentials-cli.js"}` added to `packages/shared/package.json` (no other packaging change needed — `files: ["dist"]` already present). Two-file split: `src/cli/credentials.ts` (all logic, no shebang, exports `runCli` for tests) + `src/cli/credentials-cli.ts` (shebang + thin `process.exitCode` wiring, mirrors the `iris-dev-mcp/src/index.ts` pattern). Verified the shebang survives `tsc` compilation (`head -1 dist/cli/credentials-cli.js` → `#!/usr/bin/env node`).
- **`set`/`delete`/`list` (Tasks 2-3).** All three operate on a `KeyringPort` seam (`setPassword`/`getPassword`/`deleteCredential`/`listCredentials`), production-backed by `loadRealKeyring()` which imports (never re-declares) `CREDENTIAL_CHAIN_KEYCHAIN_SERVICE` from `credential-chain.ts` and constructs `new Entry(service, account)` exactly as the chain's own `getKeychainPasswordDefault` does. `list` uses the verified-live `findCredentials(service)` enumeration, extracting `.account` only — `.password` is received (the native API bundles both fields; there is no account-only enumeration entry point) but never read further, logged, or serialized. `set --stdin` trims a single trailing newline only (not a full `.trim()`); both the interactive and `--stdin` paths reject an empty/whitespace-only password as a usage error (exit 2) before ever touching the keychain. `delete` of a missing entry and `set`'s keychain-unavailable path both verified against the REAL `@napi-rs/keyring` import (mocked module, not an injected fake) in dedicated isolated test files, per the existing `credential-chain-keychain-unavailable.test.ts` pattern.
- **`test` (Task 4, Integration AC 31.2.5).** Drives the REAL, un-mocked `resolveCredential` (`credential-chain.ts`) directly — not through `loadProfileRegistry` — since link 1 (env) is only reachable via direct `resolveCredential` calls per that module's own doc comment. `--connect` additionally calls the real `loadProfileRegistry()` + `resolveProfile()` to get the mapped connection profile, then reuses `health.ts`'s `checkHealth()` (HEAD `/api/atelier/`) unchanged — no reimplementation of either the chain or the health probe. Added defense-in-depth secret redaction (`redactSecret`, mirroring `credential-chain.ts`'s `SECRET_MIN_REDACTION_LENGTH` pattern) on the `--connect` failure surface and on `set`'s keychain-write failure surface, so even a hypothetical upstream bug that echoed a password into an error message would not leak it — proven with a deliberately adversarial test (`connectFn` throws an error whose message contains the real password; assert `[REDACTED]` in output, password absent).
- **Exit codes / `--json` / `--help` (Task 5).** `0` success / `1` not-found-or-unresolved (including a failed `--connect`) / `2` usage error, consistent across all four subcommands via a small hand-rolled `parseArgs` (no CLI-framework dependency, per the pre-answered checkpoint). `--json` implemented on `list` and `test`. Every error message names its remediation (the "set / IRIS_CREDENTIAL_HELPER / IRIS_PROFILES" trio, matching `credential-chain.ts`'s exhaustion-message style — written to match since that function is module-private and not importable).
- **Keychain-unavailable (Task 6).** New `KeyringUnavailableError`, thrown by `loadRealKeyring()` on an `@napi-rs/keyring` import failure — surfaces as exit 1 with an actionable message on `set`/`delete`/`list`. Deliberately NOT applied to `test`, which runs the real chain as-is (including the chain's own silent-skip-on-missing-module behavior), per Task 4's "do not reimplement it."
- **Tests (Task 7).** 45 net-new tests across 4 files (mechanically counted via the vitest run output, Rule #51): `credentials-cli.test.ts` (37 — usage errors, `set`/`delete`/`list`/`test` behavior incl. `--connect` success/failure/no-mapped-profile, `--help`, all using an injected in-memory fake keychain, never the real one), `credentials-cli-chain-agreement.test.ts` (4 — Integration AC 31.2.5: a shared in-memory store stands in for the native keyring on BOTH the CLI's `set` write path and the REAL, un-mocked `resolveCredential`'s read path, proving service/account agreement "by construction"; also proven end-to-end through the CLI's own `test` subcommand), `credentials-cli-real-keyring.test.ts` (1 — `@napi-rs/keyring` module-mocked with a working fake that RECORDS constructor args, proving the PRODUCTION `loadRealKeyring()` wiring — not just the injected-fake tests — really does pass `CREDENTIAL_CHAIN_KEYCHAIN_SERVICE`), `credentials-cli-real-keyring-unavailable.test.ts` (3 — `@napi-rs/keyring` module-mocked to fail import, proving `set`/`list`/`delete` fail loudly through the REAL default wiring, isolated into its own file per the existing `credential-chain-keychain-unavailable.test.ts` pattern so the failure mock cannot leak into other test files' module registries). `pnpm turbo run build test lint type-check`: 25/25 tasks green (`@iris-mcp/shared` 58 files / 1022 tests, up from 977 — the 45 new tests above, zero regressions across all 4 other server packages + `iris-mcp-all`). `pnpm gen:governance-baseline:check` ( `:check` only, Rule #25): exit 0, frozen `1e62c5ad5bf7` / 141 frozen / 201 live / 60 post-foundation, unchanged (no new governed tool/action — this story adds no MCP tool). No `bootstrap-classes.ts`/`BOOTSTRAP_VERSION`/`src/ExecuteMCPv2/**` change; no tool count moved (Rule #31); confirmed via `git diff --stat` touching only `packages/shared/package.json` (the `bin` addition), new CLI/test files, and docs.
- **Docs (Task 8).** README: replaced the "upcoming `iris-mcp-credentials set <name>`" placeholder (Story 31.1 text) with a link to a new `#### iris-mcp-credentials CLI` subsection documenting all four subcommands, the three exit codes, `--stdin`/`--json`, the keychain service/account shape, and the keychain-unavailable behavior contrast with the credential chain. All three `docs/client-config/*.md` files (`claude-code.md`, `claude-desktop.md`, `cursor.md`) gained an identically-structured new `## Standalone Setup: Server Manager + OS Keychain (optional)` section (placed after "Multiple Servers & Governance", before "Read-only Mode", matching each file's existing section rhythm) with the two-command recipe (`npx -y -p @iris-mcp/shared iris-mcp-credentials set <name>` — verified via research that plain `npx -y @iris-mcp/shared <bin>` would NOT resolve a differently-named bin; `-p` is required — then `IRIS_SERVER_MANAGER: "auto"` in the env block) and states the `off` default at point of use (Rule #30/#43).
- **Integration AC 31.2.5 proof, restated:** the writer (`credentials.ts`'s `loadRealKeyring`) and reader (`credential-chain.ts`'s `getKeychainPasswordDefault`) both import `CREDENTIAL_CHAIN_KEYCHAIN_SERVICE` from the same module (never re-declared) and both construct `new Entry(service, serverName)` with identical arguments — proven at three levels: (1) a shared fake store exercising the real `set` command and the real `resolveCredential` together, (2) the same proof driven end-to-end through the CLI's own `test` subcommand, (3) a module-mocked-but-working `@napi-rs/keyring` proving the PRODUCTION default wiring (not a test-injected bypass) passes the correct service constant.

### File List

*(Counts below re-derived mechanically at code review via `vitest run --reporter=json` per file, Rule #51 — the dev's "45 tests across 4 files" was stale by then and omitted the QA-added packaging file.)*

- `packages/shared/package.json` (added `bin` entry)
- `packages/shared/src/cli/credentials.ts` (new — core CLI logic, `runCli`, `promptPasswordFromStream`, `KeyringPort`/`KeyringUnavailableError`, exit codes, `--json`, secret redaction)
- `packages/shared/src/cli/credentials-cli.ts` (new — shebang bin entry, thin wiring)
- `packages/shared/src/__tests__/credentials-cli.test.ts` (new — **76** unit tests, injected fake keychain)
- `packages/shared/src/__tests__/credentials-cli-chain-agreement.test.ts` (new — **4** tests, Integration AC 31.2.5 account dimension)
- `packages/shared/src/__tests__/credentials-cli-real-keyring.test.ts` (new — **2** tests, production `loadRealKeyring` wiring + writer/reader service round-trip, module-mocked)
- `packages/shared/src/__tests__/credentials-cli-real-keyring-unavailable.test.ts` (new — **4** tests, production keychain-unavailable path, module-mocked)
- `packages/shared/src/__tests__/credentials-cli-dist-packaging.test.ts` (new — **4** tests, `bin` path / shebang / the built bin actually running)
- `README.md` (new `#### iris-mcp-credentials CLI` subsection; updated the Story 31.1 "upcoming CLI" placeholder text)
- `docs/client-config/claude-code.md` (new `## Standalone Setup: Server Manager + OS Keychain (optional)` section)
- `docs/client-config/claude-desktop.md` (same new section)
- `docs/client-config/cursor.md` (same new section)
- `_bmad-output/planning-artifacts/epics.md` (AC 31.2.1 amended / AC 31.2.2 clarified in place at code review — Rule 5/#42)

**Mechanical totals at code review: 90 net-new tests across 5 files; `@iris-mcp/shared` 59 files / 1067 tests** (up from 977 at Story 31.1 close). `pnpm turbo run build test lint type-check` 25/25 green; `pnpm gen:governance-baseline:check` exit 0, frozen `1e62c5ad5bf7` / 141 / 201 / 60 unchanged.

## Senior Developer Review (AI) — 2026-07-25

Three-layer adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor) plus independent live verification. **40 findings after dedupe: 3 HIGH / 15 MEDIUM / 9 LOW patched in-story · 6 deferred (all LOW) · 7 dismissed · 0 decision-needed.** All three HIGHs were reproduced live before being actioned, and every fix is mutation-verified.

**The three HIGHs — all in the default interactive `set` path or the `--connect` failure surface, all silent:**

1. **`set` exited 0 having stored nothing.** `promptPasswordDefault` registered only a `"data"` listener — no `"end"`. Against a piped or closed stdin (`echo pw | ... set myserver`, a supervisor-provided stdin, CI) the promise never settled; a pending promise does not hold the event loop open, so Node drained, `process.exitCode` was never assigned, and the process exited **0**. Reproduced live (probe: `outcome="HANG" settled=false`). A false success on the one command whose entire job is the write.
2. **A pasted password was stored corrupted.** The prompt's `switch` compared the WHOLE `data` chunk against each terminator. A password copied with its trailing newline arrives as one chunk (`"pw\n"`), matched nothing, and was appended verbatim; the user's next Enter resolved with an embedded newline inside the secret. `set` printed success and every later authentication failed against a value unreadable from anywhere. Both fixed by code-point iteration + `"end"`/`"error"` handling; the prompt is now bound to the injected stdin/stderr seams and has 9 dedicated tests where it previously had **zero** (every `set` test injected `promptPassword` and bypassed it).
3. **`test --connect` printed a password in cleartext.** The catch redacted only against `profile.password`, which is `undefined` precisely on the branch that matters — a throw from `loadProfileRegistryFn`, the layer that parses `IRIS_PROFILES`. Verified live on Node v24: V8 embeds a ~20-character source excerpt in a JSON `SyntaxError`, so `{"prod":{"password":sup3rs3cret}}` yields `Unexpected token 's', ..."password":sup3rs3cre"... is not valid JSON`, which `buildProfileRegistry` wraps verbatim. Now redacted against every known secret (`profile?.password`, the chain-resolved password, `IRIS_PASSWORD`), and a secret too short to redact safely **withholds** the whole body — mirroring `credential-chain.ts`'s `WITHHELD_SHORT_SECRET`, whose branch the CLI had omitted while copying the constant (a separate MEDIUM leak for 1-3 character passwords).

**Lead-flagged items, adjudicated:** the `list` AC-vs-API tension was resolved by **amending AC 31.2.1 and Task 3 in place** (Rule 5/#42) — `findCredentials(service)` has no account-only variant, so "never *read* a password" is unachievable; the achievable and now-asserted property is that no password is printed, logged, serialized, or retained. The `list --json` failure asymmetry was **fixed, not documented away**: one CLI-wide rule now governs both commands (operational outcome ⇒ exactly one JSON object on stdout with an `error` field on failure; usage errors ⇒ plain text on stderr), stated in `--help` and the README. Secret-never-in-argv holds (`set <name> <password>` is exit 2 before the keychain is touched, adversarially tested). Writer/reader key agreement holds and is now pinned on **both** sides through their production wirings — the chain-agreement file was service-blind and nothing pinned the reader's constant. Keychain-unavailable behavior is consistent across `set`/`delete`/`list` and correctly different for `test`. The `bin` runs from `dist` (verified live in a fresh Node process and now asserted by `spawnSync` in the packaging test) and `dist/cli/credentials-cli.js` is confirmed present in `npm pack --dry-run`. `npx -y -p @iris-mcp/shared iris-mcp-credentials` is the correct form for a differently-named bin, but the suite is unpublished — a pre-release caveat naming the `node <path>` form was added to all three client-config docs.

**Mutation verification:** chunk-granular prompt restored ⇒ 5 prompt tests red; unguarded `.map()/.sort()` restored ⇒ 2 list tests red; Story 31.0's Rule #19 gate flipped (`off`→`auto` default) ⇒ 2 AC 31.0.4 tests red. All restored green.

## Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-07-25 | 0.1 | Story created (Epic 31; lead resolved the AC 31.2.1 packaging choice to a bin in `@iris-mcp/shared`) | Bob (SM) |
| 2026-07-25 | 1.0 | Dev complete via bmad-dev-story — ready-for-dev → review. `iris-mcp-credentials` CLI (`set`/`delete`/`list`/`test`) shipped as a bin in `@iris-mcp/shared`; README + all 3 client-config docs updated. | Amelia (Dev) |
| 2026-07-25 | 1.1 | Code review (3-layer adversarial + live verification) — review → done. 3 HIGH / 15 MEDIUM / 9 LOW patched, 6 deferred (LOW), 7 dismissed. AC 31.2.1 amended + AC 31.2.2 clarified in place (Rule 5/#42). Mechanical recount (Rule #51): 90 tests / 5 files; shared 59 files / 1067 tests; 25/25 turbo green; baseline `:check` exit 0 unchanged. | Senior Dev Review (AI) |
