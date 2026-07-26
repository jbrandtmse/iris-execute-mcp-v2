# Story 31.3: Registry Integration + Provenance + Capstone

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **operator running the iris-mcp suite against a mix of env-configured and Server-Manager-sourced connections**,
I want **one merged profile registry with visible provenance, and proof the whole path works against a live IRIS**,
so that **I can see where each connection came from, trust that explicit env config always wins, and know the feature works end to end rather than only in unit tests.**

## Acceptance Criteria

1. **AC 31.3.1** — `loadProfileRegistry(env)` merges resolved Server-Manager profiles after `default` + `IRIS_PROFILES` (collision ⇒ env wins, single log notice naming both sources); merged profiles get `source: "server-manager"`, env profiles `source: "env"`; `ProfileClientRegistry`/session isolation and governance cascade behave identically for both sources (one test each, keyed on a Server-Manager-sourced profile name).
2. **AC 31.3.2** — `iris_server_profiles` roster entries gain `source` via the explicit allow-list (doc-comment rule against spread preserved); audit entries gain optional `profileSource`; redaction sweep test re-run over the extended shapes.
3. **AC 31.3.3** — Rule #21 genuine live capstone in the default suite where feasible, else a scripted smoke recorded in story notes: define a server in a real workspace `.vscode/settings.json` → store its password via the 31.2 CLI → launch built `iris-dev-mcp` with `IRIS_SERVER_MANAGER=auto` and NO `IRIS_PASSWORD`/`IRIS_PROFILES` password → MCP call `iris_server_info` (default profile from env still required per existing contract; the SM profile addressed via `server` param) succeeds against live IRIS; re-run with `IRIS_SERVER_MANAGER` unset ⇒ SM profile absent (proves the switch).
4. **AC 31.3.4** — Rule #34 second-environment discipline: capstone variant proves workspace-scope definitions override user-scope for the same server name, and the Cursor settings path is exercised via `IRIS_SM_SETTINGS_PATHS` (or a real Cursor install if present); Rule #30 docs rollup: env-var rows (`IRIS_SERVER_MANAGER`, `IRIS_SM_SERVERS`, `IRIS_SM_SETTINGS_PATHS`, `IRIS_CREDENTIAL_HELPER`) with default states in root + per-server READMEs and `tool_support.md` note; CHANGELOG.
5. **AC 31.3.5** — SecretStorage boundary documented plainly in README ("Server Manager passwords are NOT readable outside VS Code; here are the three ways to complete credentials"), so support questions have a canonical answer.

### Integration ACs

**This story IS the epic's integration story** — it wires the Server-Manager source into the live registry and proves it end to end.

- **Integration AC 31.3.6** — AC 31.3.3's capstone is the binding proof: a real built `iris-dev-mcp` process, a real settings file, a real keychain credential, a real MCP `iris_server_info` call against live IRIS. It must be a genuine gate (Rule #21) — it would actually fail if the wire-up broke — not a mocked re-assertion of unit behavior.

## Tasks / Subtasks

- [x] **Task 1 — Full merge semantics in `loadProfileRegistry` (AC: 31.3.1)**
  - [x] Story 31.0 shipped a deliberately minimal, provably-inert-when-off wire-in; this story owns the real thing. Merge resolved Server-Manager profiles AFTER `default` + `IRIS_PROFILES`.
  - [x] Name collision ⇒ **env wins**, with a SINGLE log notice naming both sources (not one line per collision).
  - [x] Add `source: "env" | "server-manager"` to `IrisProfile`. Use the Rule #19 conditional-spread idiom so no field appears as `undefined` on existing shapes.
  - [x] Prove `ProfileClientRegistry` session isolation and the governance cascade behave identically for both sources — one test each, keyed on a **Server-Manager-sourced** profile name (not just an env one).
- [x] **Task 2 — Provenance on the `iris_server_profiles` surface (AC: 31.3.2)**
  - [x] Add `source` to the roster entries via the **explicit allow-list**. The existing doc-comment rule forbidding object spread on this surface MUST be preserved — spreading would leak future fields (including passwords) automatically. Read that comment before editing.
  - [x] Add optional `profileSource` to audit entries (Epic 29's audit log).
  - [x] Re-run the redaction sweep test over the extended shapes; confirm no password or new field leaks.
  - [x] **Rule #31 check:** adding a field is NOT a tool-count change — no tool count may move, and no package tool array changes.
- [x] **Task 3 — Resolve deferred item 31-0-4 (`pathPrefix` vs the `baseUrl` invariant)**
  - [x] Today `pathPrefix` is a post-merge `baseUrl` string suffix, so `baseUrl === deriveBaseUrl(host, port, https)` no longer holds for SM profiles and the prefix is unrecoverable from any structured field.
  - [x] This story adds `source` to `IrisProfile` — the ledger's suggested resolution is to add an optional `pathPrefix` field alongside it and derive `baseUrl` in ONE place, restoring the invariant **without changing `deriveBaseUrl`'s behavior for env profiles** (that would risk the Rule #19 gate). Implement or consciously re-defer with a documented reason.
- [x] **Task 4 — Resolve deferred item 31-0-3 (CWD workspace candidate)**
  - [x] In `auto`, the workspace candidate defaults to the process CWD — chosen by the MCP *client*, not the operator — so a merely-cloned third-party repo's `.vscode/settings.json` can contribute named profiles.
  - [x] The behavior is AC-mandated so do NOT change it here. The assigned resolution is provenance-side: with `source` now on the roster, **surface the originating FILE** for a Server-Manager-sourced profile so an operator can see exactly where a profile came from. Keep it secret-free.
- [x] **Task 5 — Resolve deferred item 31-1-1 (`required` silently succeeds with zero imports)**
  - [x] `definitionsFound`/`consideredCount` increment at first *sighting*, before `mergeProfile` validation, so when every definition is structurally invalid neither `required` check trips and the server starts with only `default`. Reproduced live (sole definition with `"port": "not-a-port"` ⇒ no throw, empty registry).
  - [x] `required` means "fail fast if Server Manager gives me nothing usable" — count what actually SURVIVED validation, not what was sighted. Fix and pin with a regression test.
- [x] **Task 6 — Live capstone (AC: 31.3.3, Integration AC 31.3.6)**
  - [x] Scripted smoke recorded in story notes (a default-suite test cannot launch a real server process against live IRIS).
  - [x] Sequence: disposable workspace with its own `.vscode/settings.json` → store the password via the **built** 31.2 CLI → launch the **built** `iris-dev-mcp` with `IRIS_SERVER_MANAGER=auto`, a `default` profile from env, and NO password for the SM profile → MCP `iris_server_info` addressed via the `server` param → succeeds against live IRIS.
  - [x] Control run: `IRIS_SERVER_MANAGER` unset ⇒ the SM profile is absent (this is what proves the switch, not the happy path).
  - [x] **Never write `intersystems.servers` into this repository's own `.vscode/settings.json`** — see Dev Notes.
- [x] **Task 7 — Second-environment discipline (AC: 31.3.4, Rule #34)**
  - [x] Prove workspace-scope beats user-scope for the SAME server name (two real files, not the `IRIS_SM_SETTINGS_PATHS` override, which bypasses discovery precedence).
  - [x] Exercise the Cursor settings path via `IRIS_SM_SETTINGS_PATHS` or a real Cursor install if present.
- [x] **Task 8 — Docs rollup (AC: 31.3.4, 31.3.5; Rules #30/#43)**
  - [x] Env-var rows for `IRIS_SERVER_MANAGER`, `IRIS_SM_SERVERS`, `IRIS_SM_SETTINGS_PATHS`, `IRIS_CREDENTIAL_HELPER` (and `IRIS_SM_WORKSPACE`, which the earlier stories introduced) **with default states at point of use** — root README + all 5 per-server READMEs + `iris-mcp-all`, plus a `tool_support.md` note.
  - [x] CHANGELOG entry for the epic's user-facing surface.
  - [x] AC 31.3.5: a plain-language README section on the SecretStorage boundary — Server Manager passwords are NOT readable outside VS Code, and here are the three ways to complete credentials (CLI/keychain, `IRIS_CREDENTIAL_HELPER`, `IRIS_PROFILES`). This is the canonical answer for support questions; write it for a user, not for us.
- [x] **Task 9 — Verification**
  - [x] `pnpm turbo run build test lint type-check` green; `pnpm gen:governance-baseline:check` exit 0 (the `:check` ONLY).
  - [x] Story 31.0's Rule #19 gate still green AND mutation-sensitive.
  - [x] No tool count moved; no `bootstrap-classes.ts`/`BOOTSTRAP_VERSION`/`src/ExecuteMCPv2/**` change.

## Dev Notes

**⚠️ Never write `intersystems.servers` into this repository's `.vscode/settings.json`.** That file is tracked, and it carries this project's `objectscript.conn` block for the VS Code ObjectScript extension. The capstone must build a **disposable workspace directory** elsewhere (with its own `.vscode/settings.json`) and point at it with `IRIS_SM_WORKSPACE`, or use `IRIS_SM_SETTINGS_PATHS` where discovery precedence is not what's under test. Delete the disposable workspace afterward, and never stage it.

**Live IRIS for the capstone** (verified available on this machine): `localhost:52773`, user `_SYSTEM`, password `SYS`, namespace `HSCUSTOM`. The `default` profile still comes from the `IRIS_*` env vars per the existing contract — the point of the capstone is that the **Server-Manager-sourced** profile carries NO password in any config and is completed from the keychain.

**The control run is the actual proof.** A capstone that only shows the happy path proves the code runs, not that the switch works. `IRIS_SERVER_MANAGER` unset ⇒ the SM profile must be ABSENT. Both runs belong in the recorded evidence.

**The `iris_server_profiles` allow-list is a security boundary, not a style preference.** Its doc comment explicitly forbids object spread so that a future field (a password, a token) cannot leak by default. Add `source` by naming it explicitly. The redaction sweep test exists to catch exactly this class of mistake — re-run it over the widened shape.

**Rule #19 is still the epic's release gate.** With `IRIS_SERVER_MANAGER` unset, `loadProfileRegistry` output must remain byte-identical to pre-feature, and adding `source` must not break that: an env-only registry's profiles must keep the exact shape existing tests pin. Use the conditional-spread idiom (`...(x !== undefined ? { x } : {})`) that `sqlMaxRows`/`sqlTimeoutMs` already use. If `source` must appear on env profiles too, the pre-feature `toEqual` fixtures need a deliberate, reviewed update — flag that rather than quietly loosening the assertion.

**Three carried deferred items are in scope** (Tasks 3, 4, 5): `31-0-3`, `31-0-4`, `31-1-1`. Read their full entries in `deferred-work.md`. `31-1-1` is the most consequential — `required` mode silently succeeding with zero imported servers defeats the entire purpose of that mode. The remaining open items (`31-0-5`, `31-1-2`…`31-1-5`, `31-2-1`…`31-2-6`) are NOT this story's scope; leave them for the epic-close triage.

**Governance/audit join key is unchanged.** Governance keys on tool/action + profile NAME, never on how the profile was resolved. `profileSource` is attribution only — it must not become an input to any authorization decision.

**Rules that do NOT apply:** no new MCP tool ⇒ Rules #28/#53 untriggered; adding a FIELD to an existing tool's output is not a tool-count change (Rule #31 holds). No ObjectScript ⇒ no bootstrap/`BOOTSTRAP_VERSION` change. No new governance key ⇒ frozen baseline `1e62c5ad5bf7` (141 keys) unchanged.

### Project Structure Notes

- Merge logic in `packages/shared/src/profiles.ts`; provenance surfacing in `packages/shared/src/server-discovery.ts` / `server-base.ts` (the `iris_server_profiles` roster) and `packages/shared/src/audit.ts`.
- **Do not deepen the `profiles.ts` ↔ `server-manager-source.ts` import cycle**; guard comments at both import sites name the prohibited pattern (module-scope evaluation of an imported binding).
- Tests in `packages/shared/src/__tests__/`; vitest. Do NOT use the `*.integration.test.ts` suffix — excluded from the default run, and Rule #21/#19 proofs must run in the default suite (Rule 8).
- Cross-package assertions (if any) belong in `packages/iris-mcp-all` — `@iris-mcp/shared` cannot import leaf packages (Rule #45).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-31.3] — AC 31.3.1-31.3.5.
- [Source: research spec#Feature-1-Design] — F1-D3 (integration seam, `source` through the allow-list, audit `profileSource`); #Data-Architecture (precedence/merge model, `/default` and `superServer` handling).
- [Source: packages/shared/src/profiles.ts] — `loadProfileRegistry` (async as of 31.1), `mergeProfile`, `deriveBaseUrl`, Rule #19 conditional spread.
- [Source: packages/shared/src/server-manager-source.ts:10-33] — the seam contract naming Story 31.3's ownership of full merge semantics.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — items `31-0-3`, `31-0-4`, `31-1-1` with full rationale.
- [Source: _bmad-output/planning-artifacts/architecture.md#D1/#D2/#D5/#E1] — per-profile registry, `server` framework param, governance chokepoint, the discovery tool.
- [Source: .claude/rules/project-rules.md] — #19 additive gate, #21 genuine capstone, #25 baseline `:check`, #30/#43 docs default-state at point of use, #31 no tool-count change, #34 second environment, #45 cross-package tests.

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (via `bmad-dev-story`).

### Debug Log References

None — no debugger/global-based debugging was needed. All evidence for AC 31.3.3/31.3.4/Integration AC 31.3.6 was
captured by driving the BUILT `dist/` output of `@iris-mcp/shared` and `@iris-mcp/dev` over real stdio
(`@modelcontextprotocol/sdk` `Client` + `StdioClientTransport`) against live IRIS (`localhost:52773`, `_SYSTEM`/`SYS`,
`HSCUSTOM`) with one disposable smoke script (`packages/iris-dev-mcp/tmp-31-3-capstone-smoke.mjs`), deleted after
evidence capture. Full commands, disposable-fixture layout, and observed output below.

**Build (prereq for the smoke):**
```
pnpm --filter @iris-mcp/shared build   # tsc clean
pnpm --filter @iris-mcp/dev build      # tsc clean
```

**Disposable fixtures** (all under the session scratchpad, outside the repo tree; deleted after capture):
- `sm-capstone-primary/.vscode/settings.json` — one `intersystems.servers` entry `capstoneSm` (`http://localhost:52773`,
  `username: "_SYSTEM"`, **no password**).
- `sm-second-env/workspace/.vscode/settings.json` — `precedenceTest` → `workspace-host.example.com`.
- `sm-second-env/appdata/Code/User/settings.json` — `precedenceTest` → `user-code-host.example.com` (same name,
  different host — must be shadowed).
- `sm-second-env/appdata/Cursor/User/settings.json` — `cursorOnly` → `cursor-host.example.com` (a name unique to
  Cursor's own settings file, proving that specific discovery path is read).

**Setup:** `node packages/shared/dist/cli/credentials-cli.js set capstoneSm --stdin` (piped `"SYS"`) → exit 0, stored
under OS-keychain service `iris-mcp`, account `capstoneSm`.

**RUN A — `IRIS_SERVER_MANAGER=auto`, `IRIS_SM_WORKSPACE=<sm-capstone-primary>`, no `IRIS_PROFILES`/inline password for
`capstoneSm` (AC 31.3.3 happy path).** `iris_server_profiles` roster: `capstoneSm` present, `source: "server-manager"`,
`sourceFile` = the primary workspace's `settings.json`. `iris_server_info(server: "capstoneSm")` → `isError: undefined`,
real Atelier payload:
```json
{"version":"IRIS for Windows (x86-64) 2026.1 (Build 235U) Tue Apr 7 2026 16:29:09 EDT","id":"D72F77AF-...","api":8,
 "features":[{"name":"DEEPSEE","enabled":true},{"name":"ENSEMBLE","enabled":true},{"name":"HEALTHSHARE","enabled":true}],
 "namespaces":["%SYS","HSCUSTOM","HSLIB","HSSYS","HSSYSLOCALTEMP","IRISCOUCH","SADEMO","SATEST64","USER"]}
```
— proves the credential chain's OS-keychain link genuinely resolved the password and the connection reached live IRIS,
with NO password anywhere in the process env or any settings file.

**RUN B — `IRIS_SERVER_MANAGER` unset, `IRIS_SM_WORKSPACE` still set (AC 31.3.3 control run — the actual proof).**
`iris_server_profiles` roster: only `default` (`source: "env"`) — `capstoneSm` ABSENT. `iris_server_info(server:
"capstoneSm")` → `isError: true`, `"Unknown server profile \"capstoneSm\". Valid profiles: default. ..."`. Confirms the
switch, not just the happy path.

**RUN C — `IRIS_SERVER_MANAGER=auto`, `IRIS_SM_WORKSPACE=<sm-second-env/workspace>`,
`APPDATA=<sm-second-env/appdata>` (AC 31.3.4 second-environment discipline, Task 7 — real discovery precedence, NOT
`IRIS_SM_SETTINGS_PATHS`).** `iris_server_profiles` roster: `precedenceTest` → `host: "workspace-host.example.com"`,
`sourceFile` = the workspace file (the user-scope Code definition, `user-code-host.example.com`, was correctly
shadowed); `cursorOnly` → `host: "cursor-host.example.com"`, `sourceFile` = the REAL Cursor product discovery path
(`APPDATA/Cursor/User/settings.json`) — read via normal discovery precedence order (no real Cursor install exists on
this dev machine, so the Cursor product path was exercised via the `APPDATA` env-var override that IS the real
discovery mechanism, per the story's "or a real Cursor install if present" clause).

**Cleanup:** `node packages/shared/dist/cli/credentials-cli.js delete capstoneSm` → exit 0 ("Deleted the stored
password"). Smoke script deleted; both disposable scratch workspace trees deleted; `git status`/`git diff` confirmed
zero residue and this repository's own `.vscode/settings.json` untouched.

### Completion Notes List

- **Task 1 (AC 31.3.1).** `IrisProfile` gained an optional `source?: "env" | "server-manager"` field (optional, not
  required — Rule #19 idiom, so hand-built `IrisProfile` literals elsewhere in the test suite keep compiling
  unchanged). `mergeProfile` gained `source` (default `"env"`, so its two pre-existing `IRIS_PROFILES` call sites in
  `profiles.ts` need no change) and `pathPrefix` params, and always sets `source` on its output (never leaves it
  `undefined`). The reserved default profile (built by object-spread in `buildProfileRegistry`) explicitly sets
  `source: "env"`. `server-manager-source.ts`'s `mergeProfile` call passes `"server-manager"` + `entry.pathPrefix`.
  `loadProfileRegistry`'s name-collision filter was rewritten: collisions are collected into an array during the
  filter and reported as ONE aggregate `logger.warn` afterward, naming both provenance sources (`"env"` /
  `"server-manager"`) and every colliding name — proven with a dedicated 2-collision test asserting exactly one warn
  call. `ProfileClientRegistry`/governance-cascade parity for an SM-sourced profile name: two new tests in
  `profiles.test.ts` build a real registry via `loadProfileRegistry` with an `IRIS_SERVER_MANAGER=auto` fixture and
  prove (a) `ProfileClientRegistry.getOrCreate` hands the SM-sourced profile its own distinct/cacheable
  `IrisHttpClient`, identically to an env profile, and (b) `effective()` (the governance cascade) resolves a
  profile-layer override identically whether keyed on the SM-sourced name or an env name — the cascade's own
  implementation keys purely on the profile NAME string and has no notion of `source` at all, so this is a genuine
  parity proof, not a tautology.
- **Task 2 (AC 31.3.2).** `buildRosterEntry` (the `iris_server_profiles` allow-list — spread-forbidding doc comment
  read and preserved, both new fields named explicitly) gained `source`/`sourceFile` via conditional spread.
  `AuditEntryInput`/`AuditEntry` gained an optional `profileSource`, emitted by `AuditLogger.log()` only when present
  (mirrors the existing `denyReason`/`presetApplied` conditional-inclusion pattern exactly). `server-base.ts`'s
  `recordAuditEntry` populates it via `this.profiles?.get(profileName)?.source` — the SAME in-memory lookup
  `deriveAuditNamespace` already uses, so it is attribution only and never touches the governance gate (which remains
  keyed purely on `profile.name`, evaluated earlier in `dispatchToolCall`, before this audit derivation runs at all).
  Redaction sweep re-run over the widened shape: a new test in `profiles.test.ts` builds a registry with a real
  keychain-password-bearing SM profile and asserts (i) no roster entry has an own `password` key, (ii) the serialized
  roster JSON never contains the secret value, and (iii) `buildRosterEntry` called directly on the SM profile is
  likewise clean.
- **Task 3 (deferred item 31-0-4, resolved).** `pathPrefix` is now a structured, optional `IrisProfile` field.
  `mergeProfile` derives `baseUrl` in the ONE place it always did (`deriveBaseUrl(host, port, https)`), now suffixed
  with `pathPrefix ?? ""` — so `baseUrl === deriveBaseUrl(host, port, https) + (pathPrefix ?? "")` holds for every
  profile, recoverable from the returned object. `deriveBaseUrl` itself is byte-unchanged (no `pathPrefix` argument
  added to it), so env profiles (which never pass a `pathPrefix`) are provably unaffected — Rule #19 preserved.
  `server-manager-source.ts`'s old manual post-merge `baseUrl` string-suffix hack was removed in favor of passing
  `entry.pathPrefix` straight into `mergeProfile`. Existing pathPrefix tests extended with explicit `pathPrefix`
  field assertions and the invariant-recovery formula; a new test confirms the field is entirely ABSENT (not merely
  `undefined`) when no prefix applies.
- **Task 4 (deferred item 31-0-3, resolved).** New `sourceFile?: string` field on `IrisProfile`, populated in
  `resolveServerManagerProfiles` with the exact settings-file path a profile's WINNING definition came from (correctly
  tracks the 31-0-1 "rescue" case too, since it is set at the same point the winning `profile` is chosen). Surfaced
  through the roster allow-list (Task 2) so an operator can see precisely which file a Server-Manager-sourced
  connection came from — the CWD-workspace-injection risk itself is unchanged (AC-mandated, per the item's own
  disposition), but is no longer invisible.
- **Task 5 (deferred item 31-1-1, resolved).** A THIRD `required`-mode check added to `resolveServerManagerProfiles`,
  positioned after the existing two (zero-found; allow-list-matched-none) so it only fires when both of those have
  already passed: `results.length === 0` (nothing survived per-entry `mergeProfile` validation or the "must declare
  its own `username`" guard) now throws, naming the count considered and pointing at the per-entry warnings already
  logged. Reproduced the exact live defect first: a sole `{"port": "not-a-port"}` definition under `required` used to
  return `[]` with no throw (confirmed red before the fix, via a new regression test asserting the throw). A
  pre-existing test whose fixture accidentally exercised this exact bug (a "does NOT throw" test whose sole entry
  also lacked `username`, so it was silently skipped for the WRONG reason) was corrected to declare `username`,
  isolating it to testing password-absence specifically; a new test proves a mix of one good + one rejected
  definition does NOT throw (partial success is not failure). `epics.md` AC 31.0.3 amended in place (documents the
  third check, dated parenthetical, no re-litigation) — deferred item 31-1-4 (AC 31.1.1's `argv[1]` wording, a
  docs-only correction explicitly assigned to this story's rollup) amended alongside it.
- **Task 6/Integration AC 31.3.6 (live capstone).** See Debug Log References above for full evidence (Runs A/B/C).
  The control run (B) is the actual proof the switch works, not just Run A's happy path, per the Dev Notes.
- **Task 7 (AC 31.3.4, Rule #34).** Folded into the same capstone script as Run C (see above) — two REAL settings
  files prove workspace-scope beats user-scope for the identical name via genuine discovery precedence (not
  `IRIS_SM_SETTINGS_PATHS`, which the story explicitly says would bypass the very precedence under test), and a third
  real file at the Cursor product's actual discovery path (`APPDATA` override, since no real Cursor install exists on
  this machine) proves that path is read live.
- **Task 8 (docs rollup, Rules #30/#43).** Root README: `source`/`sourceFile` added to the roster field list, a
  `profileSource` audit-entry note, a provenance bullet in the existing "Server Manager connections" section, and a
  new "Where do Server Manager passwords come from? (the canonical answer)" section (AC 31.3.5 — the three
  remediations spelled out plainly: OS keychain via the CLI, `IRIS_CREDENTIAL_HELPER`, or a full `IRIS_PROFILES`
  replacement). All 5 per-server READMEs + `iris-mcp-all` gained a new "Server Manager connections
  (`IRIS_SERVER_MANAGER`)" subsection (none had one before this story — Story 31.0-31.2 documented it only in the
  root README) with the default state (`off`) stated at point of use. `tool_support.md` gained a framework-tool field
  note under the Epic 19 entry and an audit-note update. `CHANGELOG.md` gained a full Epic 31 entry mirroring the
  Epic 30 entry's structure/depth, since this is the epic's closing story.
- **Task 9 (verification).** `pnpm turbo run build test lint type-check`: 25/25 tasks green.
  **Test tally — CORRECTED at code review 2026-07-25 (Rule #51; the dev-stage numbers below were hand-authored and
  wrong three different ways, and QA's and sprint-status' numbers disagreed with both).** Mechanically recounted from
  the vitest summary and from `git diff HEAD | grep -cE '^\+\s*it\('` per file:
  `@iris-mcp/shared` **59 test files / 1082 tests**, up from **1067** at Story 31.2's close = **+15 net new**, split
  `profiles.test.ts` +9, `server-manager-source.test.ts` +5, `audit.test.ts` +1, `audit-interceptor.test.ts` +1
  (16 added `it(` blocks less 1 removed — an existing pathPrefix test was retitled, which the diff counts as a
  remove+add). 1067 + 15 = 1082 ✓. Of the +15, **13** are dev+QA's and **2** were added by the code review (the
  `profileSource`-absent-on-unknown-profile regression and the reserved-`default` collision message test).
  *(Superseded dev-stage claim, kept for the record: "1076 tests / +9 net new: 5 + 4 + 2" — wrong total, wrong delta,
  and self-inconsistent since 5+4+2=11≠9.)*
  `pnpm gen:governance-baseline:check` (`:check` ONLY, Rule #25):
  exit 0, frozen `1e62c5ad5bf7` / 141 frozen / 201 live / 60 post-foundation, unchanged — no new MCP tool or
  governance key. `git status` confirms no `bootstrap-classes.ts`/`BOOTSTRAP_VERSION`/`src/ExecuteMCPv2/**` diff and
  no capstone-script residue. Rule #19 gate: `profiles.test.ts`/`profiles-resolution.test.ts`'s pinned byte-for-byte
  fixtures were deliberately, reviewably widened (per this story's own Dev Notes) to strip `source` alongside `name`
  before comparing to `loadConfig`/`defaultConfig` output, with `profile.source === "env"` asserted explicitly
  immediately before the strip in every case — an intentional shape addition (AC 31.3.1 mandates `source` on env
  profiles too), not a loosened assertion.
- **Deferred-work disposition:** `31-0-3`, `31-0-4`, `31-1-1` — all three RESOLVED in this story (see Tasks 3-5
  above), not re-deferred. The remaining open items (`31-0-5`, `31-1-2`…`31-1-5`, `31-2-1`…`31-2-6`) are explicitly
  OUT of this story's scope per its own Dev Notes and are left for the epic-close triage.

### File List

- `packages/shared/src/profiles.ts`
- `packages/shared/src/server-manager-source.ts`
- `packages/shared/src/server-discovery.ts`
- `packages/shared/src/audit.ts`
- `packages/shared/src/server-base.ts`
- `packages/shared/src/__tests__/profiles.test.ts`
- `packages/shared/src/__tests__/profiles-resolution.test.ts`
- `packages/shared/src/__tests__/server-discovery.test.ts`
- `packages/shared/src/__tests__/server-manager-source.test.ts`
- `packages/shared/src/__tests__/audit.test.ts`
- `packages/shared/src/__tests__/audit-interceptor.test.ts`
- `README.md`
- `CHANGELOG.md`
- `tool_support.md`
- `packages/iris-dev-mcp/README.md`
- `packages/iris-admin-mcp/README.md`
- `packages/iris-data-mcp/README.md`
- `packages/iris-interop-mcp/README.md`
- `packages/iris-ops-mcp/README.md`
- `packages/iris-mcp-all/README.md`
- `_bmad-output/planning-artifacts/epics.md` (AC 31.0.3, AC 31.1.1 amended in place)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status + `last_updated` narrative)

## Senior Developer Review (AI) — 2026-07-25

Three-layer adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor) plus independent reviewer verification. **25 findings after dedupe: 10 patched in-story · 9 deferred · 6 dismissed · 0 decision-needed.** Every behavioral patch is mutation-verified. Full rationale, deferred-item dispositions and dismissal reasoning: `deferred-work.md` → "Deferred from: code review of 31-3-registry-integration (2026-07-25)".

**Verified live at review:** `pnpm turbo run build test lint type-check` **25/25 green (0 cached — a real full run)**, `@iris-mcp/shared` 59 files / **1082** tests; `pnpm gen:governance-baseline:check` (the `:check` ONLY, Rule #25) exit 0 with frozen `1e62c5ad5bf7` / 141 / 201 / 60 unchanged and the frozen file byte-unchanged; Rule #31 held (`git diff --stat` over every `packages/*/src/tools/**` is empty — no tool count moved); no `bootstrap-classes.ts` / `BOOTSTRAP_VERSION` / `src/ExecuteMCPv2/**` change; this repository's own `.vscode/settings.json` untouched.

**The lead-found spec contradiction — resolved by amending the planning artifact, not by weakening a test.** AC 31.3.1 mandates `source: "env"` on env profiles, so `loadProfileRegistry`'s output is deliberately no longer byte-identical to pre-feature — yet **AC 31.0.4 still literally read "deep-equals its pre-feature output"**, unamended, while AC 31.0.3 and AC 31.1.1 were both amended and the gate's meaning was materially changed. Two ACs in one epic contradicted each other. Per Rule 5/#42, AC 31.0.4 was **amended in place** to state the property that actually matters and that the tests actually assert: *with `IRIS_SERVER_MANAGER` unset, **no Server-Manager data enters the registry**, and every profile's CONNECTION field deep-equals its pre-feature value* — naming `source` as the single permitted additive difference, requiring `source === "env"` to be asserted immediately before the strip, recording the mutation evidence, and stating explicitly that this is not a licence to widen the strip again.

**Rule #19 gate — independently mutation-verified (three mutations, all restored).** An extra `sourceFile` seeded on the default profile ⇒ **7** red; `host`/`port`/`password`/`namespace` drift ⇒ **4** red; the unset-mode default flipped `off`→`auto` ⇒ **8** red, including both on-disk-fixture proofs. The strip removes `name`/`source` and nothing else, and object-rest keeps unknown keys, so a future field leaking onto an env profile still fails. **Confirmed: the widened gate is still real and cannot mask connection-field drift.**

**ADR conformance (Rule #6): clean.** D5 — `profile.source` is read in exactly TWO non-test places (roster attribution, audit attribution), verified by exhaustive grep; the governance gate is `effective(governanceKey, profile.name, …)`, name-keyed, and runs in `dispatchToolCall` long before audit derivation, so no authorization decision reads provenance and an SM-sourced and env profile with identical name-level config are structurally indistinguishable to it. E1 — the allow-list adds `source`/`sourceFile` by EXPLICIT naming with single-value conditional spread, never `{...profile}`; the spread-forbidding doc comment is preserved and extended; the redaction sweep was re-run over the widened shape with a password-bearing profile at three levels.

**Capstone (AC 31.3.3 / Integration AC 31.3.6, Rule #21): CREDIBLE — Run B is a genuine control, not a happy-path demo.** Attacked adversarially and it held: Run B's quoted error text matches `profiles.ts`' template byte-for-byte; Run B changed ONLY `IRIS_SERVER_MANAGER` while leaving `IRIS_SM_WORKSPACE` set, so the delta is the switch alone; and Run A's "the OS keychain resolved it" claim is *structurally forced* rather than asserted — the chain reaches the `IRIS_PASSWORD` fallback only for the reserved default name, which `capstoneSm` cannot be, and a failed keychain link would have EXCLUDED the profile, so `iris_server_info` would have errored instead of returning a live Atelier payload. Residual (not re-runnable, no CI gate) carried as `31-3-8`.

**Patched in this review (10):**

1. **AC 31.0.4 amended in place** — the contradiction above.
2. **Docs contradicted the code they shipped with** (found independently by two layers): the README and `tool_support.md` said the audit entry's `profileSource` is *"omitted, meaning `env`"* for an env profile. It is not — **every** entry from a stock deployment carries `profileSource: "env"`, and the field is absent only on an *unknown-profile* call, so the published contract inverted the truth and a log consumer would mis-classify 100% of env calls. Both docs corrected; **regression test added and mutation-verified** (forcing a `?? "env"` fallback turns it red).
3. **A new QA test would go RED on any non-Windows host** — the expected path was built with the host `path.join` while discovery was pinned to `"win32"` (which composes with `path.win32.join`). This is the **identical defect class the Story 31.0 review already caught once**.
4. **`sourceFile` information disclosure — decision made, docs made honest.** DECIDED: keep the full path, do not redact (a basename is useless — every candidate file is literally `settings.json`, so the directory IS the information the field exists to convey, and the disclosure is non-credential). But the docs said *"never a secret"* / *"secret-free"* and were silent on the fact that a user-scope hit embeds the **OS account name** and is returned to the connected MCP client. Corrected in all four places (root README, both doc comments, the QA test comment — now a recorded decision with a standing pin). Confirmed `sourceFile` does **not** reach the audit log; only the `source` enum does.
5. **The AC 31.0.4-labelled tests had become a self-referential oracle** — they compare against `buildProfileRegistry`, whose *byte-unchanged body* was the explicit premise of the Story 31.0 review's dismissal, and this story changed that body. Both gained an independent pre-feature anchor. Mutation sensitivity rose from 5 to **7** red.
6. **Rule #51 — every test tally in the record was wrong and mutually inconsistent** (story 1076/+9 with a breakdown summing to 11; sprint-status 1076/+6). Mechanical truth **1082 / +15**; both artifacts corrected with the derivation shown.
7. **CHANGELOG accuracy (user-facing)** — *"Three new environment variables, all optional and default `off`"* introduced **five** bullets, four with no `off` default (`IRIS_SM_WORKSPACE` defaults to the process CWD — the opposite of "off"); plus the self-negating "byte-for-byte … **plus** the new field" sentence, an internal monorepo `dist/` path published as the CLI's identity, and *"Delivered across four stories"* presenting Epic 31 as complete while Story 31.4 sits in `backlog`.
8. **AC 31.3.4's literal docs requirement was half-met** — per-server READMEs stated a default state for `IRIS_SERVER_MANAGER` only; all **6** package READMEs now state defaults for the other four vars inline.
9. **The collision notice prescribed an impossible remedy for the reserved `default` name** (found independently by two layers) — a Server Manager server named `default` collides unconditionally, and the advice was to remove an `IRIS_PROFILES` entry the operator may not have. Now called out separately with the only workable remedy, with a regression test that also asserts the note does NOT appear on an ordinary collision.
10. **`profileSource` typed as bare `string`** while the closed `ProfileSource` union was already exported — now compiler-enforced via a type-only import (no runtime import edge added, so the `profiles.ts` ↔ `server-manager-source.ts` cycle is not deepened).

**Deferred-item dispositions (Rule #37 mirror, Rule #48 higher bar — each verified in the code, not accepted from the Completion Notes):** `31-0-3` **RESOLVED as assigned** (provenance-side only, as Task 4 instructed; created a new exposure surface, now documented). `31-0-4` **RESOLVED, above bar** (invariant pinned by reconstruction and proven at the real `fetch` URL; `deriveBaseUrl` byte-unchanged). `31-1-1` **RESOLVED, above bar** — verified it **fires** on the reproduced defect and does **not** over-trigger on partial success or on a valid-but-passwordless definition; the dev also corrected a pre-existing test that had been passing for the wrong reason. `31-1-4` **RESOLVED** (AC 31.1.1 amended as prescribed). `31-0-5`, `31-1-2`, `31-1-3`, `31-1-5`, `31-2-1`…`31-2-6` **RE-DEFERRED, count now 2** — confirmed untouched and out of scope per this story's own Dev Notes.

**Deferred (9 new, `31-3-1`…`31-3-9`):** two MEDIUM are the *remaining halves of the `required`-starts-degraded class* that `31-1-1` only partly closed — collision-discard has no `required` guard at any layer (`31-3-1`), and parser-level silent drops make `required` blame "zero definitions found" on a file that visibly contains the server while `auto` says nothing at all (`31-3-2`). Seven LOW cover the terminal-`invalid` precedence interaction, the `sourceFile` opt-out residual, relative `sourceFile` paths, `IRIS_SM_SERVERS` empty-string semantics, URL-userinfo in `host` reaching `baseUrl`, the capstone's non-re-runnability, and the `packages/shared/README.md` docs gap.

## Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-07-25 | 0.1 | Story created (Epic 31 capstone; absorbs deferred items 31-0-3, 31-0-4, 31-1-1) | Bob (SM) |
| 2026-07-25 | 1.0 | Dev complete via bmad-dev-story — ready-for-dev → review. Full merge semantics, provenance (`source`/`sourceFile` on the roster, `profileSource` on audit entries), deferred items 31-0-3/31-0-4/31-1-1 resolved, live capstone (Runs A/B/C) against live IRIS, second-environment discipline, and the full docs rollup. See Completion Notes for detail. | Claude Opus 5 (dev) |
| 2026-07-25 | 1.1 | Code review complete via bmad-code-review — review → done. 25 findings after dedupe: 10 patched · 9 deferred (`31-3-1`…`31-3-9`) · 6 dismissed · 0 decision-needed. The lead-found AC 31.0.4 ↔ AC 31.3.1 spec contradiction resolved by amending AC 31.0.4 in place (Rule 5/#42), not by weakening a test. Rule #19 gate independently mutation-verified (3 mutations ⇒ 7/4/8 red) and confirmed still real; ADR D5/E1 clean under exhaustive grep; capstone confirmed credible with Run B a genuine control. Deferred items 31-0-3/31-0-4/31-1-1/31-1-4 marked RESOLVED in `deferred-work.md`; the rest re-deferred at count 2. All tallies mechanically recounted (1082 tests / +15). | Claude Opus 5 (review) |
