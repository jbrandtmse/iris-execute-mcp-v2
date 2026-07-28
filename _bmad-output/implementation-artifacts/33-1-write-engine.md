# Story 33.1: Write Engine + Enable/Disable

Status: done

## Story

As an iris-mcp suite maintainer,
I want a format-preserving write engine with a universal safety protocol, per-client × per-server enable/disable, and canonical-entry synthesis in the four env modes,
so that Stories 33.2 (CLI) and 33.3 (extension UI) can expose apply/enable/disable/remove/restore over a certified, never-destructive write foundation.

## Acceptance Criteria

1. **AC 33.1.1** — Format-preserving writes: JSON/JSONC via `jsonc-parser` `modify`/`applyEdits` (foreign keys, comments, formatting untouched — golden-file byte comparisons); TOML via text-level splices strictly bounded to owned `[mcp_servers.<name>]`(+`.env`) tables (user comments elsewhere byte-identical); YAML via comment-preserving document edits under `extensions.<name>`.
2. **AC 33.1.2** — Safety protocol on every write: pre-parse validate → timestamped backup to `~/.iris-mcp/client-manager/backups/` → edit → re-parse → on parse failure auto-restore backup and report; `restore` command surface exists; no config content ever logged (foreign entries may contain third-party secrets).
3. **AC 33.1.3** — Enable/disable: native flag adapters (Cline/Roo `disabled`, Goose `enabled`; Codex `enabled` flag verified live during this story — Rule #16 probe — with stash fallback if absent) toggle in place; stash adapters move the entry byte-preserved into `state.json` and restore it exactly (golden-file round-trip: add → disable → enable → remove ⇒ file byte-equals each expected stage); both directions idempotent.
4. **AC 33.1.4** — Ownership rule enforced in code: operations refuse (with a clear error) to modify any entry whose name is outside the iris-mcp namespace and not recorded as manager-created in `state.json`.
5. **AC 33.1.5** — Entry synthesis: four env modes rendered per adapter capability (`env-reference` uses `${VAR}` for Claude Code, `${env:VAR}`/`inputs` for VS Code, literal-with-doctor-note for no-expansion clients; `server-manager`/`governance-file` modes hidden when Epics 31/32 are not shipped); `explicit` mode requires a typed confirmation string before writing any literal `IRIS_PASSWORD` and marks the entry `contains-secret` in state.

## Integration ACs

**AC 33.1-I1** — The write engine's apply path CONSUMES Story 33.0's pure `diff()` output: for every operation, the engine executes exactly the `NativeEdit` the renderer produced (branching on `mechanism`, treating `native: null` as a no-op) — a mechanical test proves no edit is re-derived on the write path (spy on `diff`; the executed edit `toEqual`s the rendered one). This is the AC 33.0.3 seam closing, and the same single code path the 33.2 CLI and 33.3 UI will drive.

**AC 33.1-I2** — External consumers land in later stories (33.2 CLI confirm flow, 33.3 UI) — the engine's public functions (`apply`/`enable`/`disable`/`remove`/`restore`/`synthesizeEntry`) are exported from the package `index.ts` and exercised through the BUILT dist in this story's dist smoke (Rule #22).

## Tasks / Subtasks

- [x] Task 1: Write executors (AC: 1)
  - [x] `executeNativeEdit(content, native)` per kind: `jsonc` → `applyEdits`; `toml-splice` → line-range splice (insert/replace-region/remove-region using `region`/`insertAfterLine`/`insertText`); `yaml-cst` → `yaml` Document API `setIn`/`deleteIn` (parse → mutate → `doc.toString()`); `native: null` ⇒ byte-identical return
  - [x] Golden-file byte comparisons per format family: apply add + apply update + disable + enable + remove over fixture files with comments and foreign entries — assert foreign text byte-untouched (exact byte diff limited to the owned span)
- [x] Task 2: Safety protocol (AC: 2)
  - [x] `applyWrite(path, content, newContent, {stateDir})`: pre-parse `content` with the 33.0 reader (refuse before touching if already unparseable — report, no write); backup copy to `<stateDir>/backups/<client>/<filename>.<ISO-ts>`; write; re-parse the written bytes; parse failure ⇒ auto-restore backup + report (never leave a broken file)
  - [x] `restore(path, {stateDir, backup?})` — restores the latest (or named) backup for a file; lists available backups; refuses when none
  - [x] Result object per write: `{ok, path, backupPath?, restored?, reason?}` — reasons name path + parse error only, NEVER file content (33.0's no-content-logging discipline extends here)
- [x] Task 3: Engine operations over diff + safety (AC: 1, 2, I1)
  - [x] `apply(ctx, client, scope, entry)`, `enable(ctx, client, scope, name)`, `disable(ctx, client, scope, name)`, `remove(ctx, client, scope, name)` — each: read file (missing ⇒ treated as empty-document for `apply`, absent-no-op for toggles) → `diff()` → execute rendered `NativeEdit` → safety-protocol write → return result incl. `restartHint` from the adapter
  - [x] Spy test: executed edit `toEqual(diff(...).native)` for every op × format family (AC 33.1-I1)
- [x] Task 4: Enable/disable mechanics (AC: 3)
  - [x] Native-flag adapters: toggle per `nativeDisableFlag` (set key to enabledValue/disabledValue in place); both directions idempotent (already-enabled enable ⇒ no-op byte-identical)
  - [x] **Codex live probe (Rule #16)**: probe order — (1) locally installed Codex CLI if present (`codex --version`, `--help`, any docs/schema it ships); (2) official `openai/codex` repo `docs/config.md` via WebFetch. Determine whether `[mcp_servers.<name>]` supports an `enabled` boolean. Record the evidence (command/URL + date + quoted line) in the story Completion Notes; set the Codex adapter's `disableSupport` accordingly (`native` with `nativeDisableFlag` if supported, `stash` otherwise) and bump `ADAPTER_DATA_VERSION` serial
  - [x] Stash adapters: disable ⇒ move entry byte-preserved into `<stateDir>/state.json` (`{client, scope, name, entry, disabledAt}`) + remove from file; enable ⇒ splice back EXACTLY (golden round-trip: add → disable → enable → remove ⇒ byte-equals expected at each stage, including the trailing-newline/indentation of the re-inserted entry); idempotent both directions (disable-when-stashed ⇒ no-op; enable-when-present ⇒ no-op)
- [x] Task 5: Ownership rule (AC: 4)
  - [x] Refusal with a clear error when the target name is NOT in `CANONICAL_SERVERS` AND NOT recorded manager-created in `state.json`; the refusal fires before any backup/write; foreign entries can never be renamed into ownership (name check is exact-match against the canonical set, not prefix — `iris-dev-mcp2` stays foreign per the 33.0 classification tests)
- [x] Task 6: Entry synthesis (AC: 5)
  - [x] `synthesizeEntry(server, mode, {adapter, profile?})` → `CanonicalEntry` per spec §3.3: `server-manager` (`IRIS_SERVER_MANAGER=auto` + `IRIS_SM_SERVERS`, no secrets), `env-reference` (`${VAR}` claude / `${env:VAR}`+`inputs` vscode / literal-with-doctor-note for `none`/`shell`), `governance-file` (`IRIS_GOVERNANCE_FILE=<path>`), `explicit` (literal values)
  - [x] Epics 31/32 ARE shipped in this repo (server-manager + governance-file exist) — modes are NOT hidden here; the hide-when-absent behavior belongs to the 33.2 CLI host probe (document the seam)
  - [x] VS Code `env-reference` upgrades to native `inputs` (`${input:iris-password}` + `promptString`/`password:true`) — render the `inputs` section addition as part of the entry synthesis descriptor
  - [x] `explicit` mode: a typed confirmation string (exact phrase, e.g. the entry name) required as an argument before any literal `IRIS_PASSWORD` is rendered; rendered entries marked `contains-secret: true` in the state record; `env-reference`/`server-manager`/`governance-file` entries NEVER contain a literal password (mechanical test: no `IRIS_PASSWORD` literal value in any non-explicit render)
- [x] Task 7: Tests + gates (AC: all)
  - [x] Golden round-trips per AC 33.1.3; ownership refusals; safety auto-restore (inject a post-write parse failure via a sabotaged executor — assert backup restored + reported); idempotency sweeps; backup listing/restore; synthesis matrix (4 modes × representative adapters incl. vscode inputs + a no-expansion client)
  - [x] Full gates: `pnpm turbo run build test lint type-check`; `pnpm gen:governance-baseline:check` (`:check` ONLY) exit 0; NUL-byte scan of the diff (Rule #55)

## Dev Notes

### Verified 33.0 surface to build on (lead-verified 2026-07-27, Rule #47)

- `diff(content, entry, adapter, scope, action)` → `DiffResult` (`packages/client-config/src/diff.ts:273`): `{ok:true, mechanism, native: NativeEdit | null, text}` — `native` is null EXACTLY for `already-in-state` (executing a rendered no-op was the 33.0-review MEDIUM; branch on `mechanism` first). Mechanisms: `add`, `update`, `native-flag`, `stash-add`, `stash-remove`, `already-in-state`.
- `NativeEdit` kinds (`diff.ts:36-74`): `JsoncNativeEdit{path, value, edits}` (applyEdits-ready), `TomlNativeEdit{op, tablePath, region, insertAfterLine, insertText}`, `YamlNativeEdit{op, path, value, renderedEntry}`.
- Helpers already exported: `renderNativeEntry(adapter, entry)` (canonical → native shape), `serializeTomlEntry`, `findTomlEntryRegion`, `findTomlInsertLine`, `readConfigEntries` (typed ok/error readers), `resolveScopePath`, `CANONICAL_SERVERS`, `CLIENT_ADAPTERS`, `ADAPTER_DATA_VERSION`.
- `CanonicalEntry` (`types.ts:138`): `{name, command, args, env?}` — synthesis target. `HostContext` (`types.ts:148`): injectable `{platform, env, homeDir, projectDir?}` — extend the pattern with an injectable `stateDir` (default `~/.iris-mcp/client-manager` resolved from `homeDir`), NEVER hardcode the real HOME in tests.
- The 33.0 story file documents the Rule #52 seam this story closes (`_bmad-output/implementation-artifacts/33-0-adapter-registry.md`, Dev Notes §Rule #52).

### Binding spec sections

§3.3 (entry synthesis + the four env modes + vscode inputs upgrade), §3.4 (native-flag vs stash; state.json shape `{client, scope, name, entry, disabledAt}`; idempotency; ownership), §3.5 (write engine per format + the 6-point universal safety protocol; prefer client writer CLIs where non-interactive — `claude mcp add-json`, `kimi mcp add` — with direct file edit as the fallback; v1 uses DIRECT EDIT ONLY, the writer-CLI preference is documented in adapter data for later, since a child-process spawn in the engine is out of scope for this story — record if you disagree).

### Constraints

- **Epics 31/32 shipped** (server-manager + governance-file modes available). Mode HIDING belongs to the CLI host probe in 33.2, not the engine.
- **No secrets in logs/results**: error/result text names paths + reasons only; `state.json` never holds MORE secret than the client file already did (spec §3.4); `explicit` entries marked `contains-secret`.
- **Backups are content copies** — they live under the state dir, never in the repo, never in fixtures with real-looking secrets (fixtures use obvious dummies like `API_KEY: shh`).
- **Injectable everything**: state dir, fs surface, clock (timestamped backups need an injectable `now()` for deterministic tests), platform/env/homeDir — no `process.*` reads in the engine core.
- **No new dependencies** beyond the story-33.0 set (jsonc-parser, yaml, smol-toml).
- **No server-runtime changes**; Rules #28/#31/#53 untriggered; frozen baseline untouched.
- **Rule #54**: sabotage/fake shapes must be reachable states (a sabotaged executor producing invalid TOML is reachable; a fake fs returning Buffers is not — the 33.0 QA precedent).
- **Rule #51**: any counts (adapters exercised, modes, backups) derived mechanically.

### Project Structure Notes

- All work in `packages/client-config/src/`: suggested `write.ts` (executors + safety), `engine.ts` (apply/enable/disable/remove/restore), `state.ts` (state.json + backups), `synthesize.ts` (env modes); exports added to `index.ts`. Tests alongside in `src/__tests__/` + new golden fixtures under `fixtures/golden/`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 33.1 (ACs 33.1.1–33.1.5)]
- [Source: _bmad-output/planning-artifacts/research/technical-iris-server-manager-mcp-connections-research-2026-07-25.md#§3.3–§3.5]
- [Source: packages/client-config/src/diff.ts (NativeEdit contracts + null-native no-op discipline)]
- [Source: _bmad-output/implementation-artifacts/33-0-adapter-registry.md (Rule #52 seam)]

## Dev Agent Record

### Agent Model Used

Claude Code (k3[1m]) via bmad-dev-story, 2026-07-27.

### Debug Log References

- `tsc --noEmit` after the first module pass: 14 `exactOptionalPropertyTypes` errors (write.ts/engine.ts) — resolved with conditional-spread result construction throughout.
- First engine.test.ts run: 23/23 failures `TypeError: Cannot read properties of undefined (reading 'files')` — `resolveScopePath(adapter, scope, ctx, fs.exists)` passed an UNBOUND class-method predicate from the injected MemFs; bound as `(p) => fs.exists(p)` in `resolveTarget` (engine.ts) with a comment. REAL_WRITE_FS arrows were never affected; this only bites class-instance fs injections.
- Golden capture run 1: `disable == initial` oracle failed for cline/codex/goose (each ±1 byte) — the oracle expectation was wrong, not the engine: NATIVE-flag disable keeps the entry present-disabled (flag flip), it does not restore the pre-apply bytes (that is the stash semantic). Capture script oracle branched per mechanism; re-capture ALL FAMILIES PASS.
- golden.test.ts run 1: 3 failures in the test's own foreign-span window heuristic (the ±200/+100 char window around the foreign marker legitimately includes the inserted owned block) — replaced with verbatim-foreign-lines + parsed-foreign-deep-equality assertions.

### Completion Notes List

- **Codex `enabled`-flag live probe (AC 33.1.3, Rule #16) — outcome: NATIVE, `enabled` boolean VERIFIED.** Evidence, 2026-07-27: (1) local install first — `Get-Command codex` / `codex --version` / `~/.codex` all absent on this machine, so no local CLI to probe; (2) official docs second — the repo doc `https://github.com/openai/codex/blob/main/docs/config.md` now redirects to the official config reference; `https://developers.openai.com/codex/config-reference` 308-redirects to `https://learn.chatgpt.com/docs/config-file/config-reference`, which documents `mcp_servers.<id>.enabled` (boolean): "Disable an MCP server without removing its configuration."; corroborated at `https://learn.chatgpt.com/codex/extend/mcp`: "`enabled` (optional): Set `false` to disable a server without deleting it." (plus an `[mcp_servers.<name>]` example carrying `enabled = true`). Adapter updated: codex `disableSupport: "native"`, `nativeDisableFlag: {key: "enabled", enabledValue: true, disabledValue: false}`; `ADAPTER_DATA_VERSION` bumped 2026-07-25.1 → 2026-07-25.2; evidence quoted in the adapters.ts codex record comment. No stash fallback needed.
- **Codex native support required renderer extensions (all additive to 33.0's diff.ts):** new `TomlNativeEdit` op `"set-flag"` (replace an existing main-table flag line, else insert directly after the owned table header — the scan STOPS at the `.env` sub-table header so an env var literally named `enabled` is never the toggle target, pinned by test); `serializeTomlEntry` now renders the flag explicitly (`enabled = true`); `renderNativeEntry` stamps every native-flag adapter's flag at its enabled value on fresh entries (Cline/Roo `disabled: false`, Goose `enabled: true` — Goose already did this inline; generalized) so disable → enable restores applied bytes exactly (the golden round-trip). New `DiffAction "remove"` + `DiffMechanism "remove"` so the engine's remove also flows through `diff()` (AC 33.1-I1 covers all five ops); new optional `DiffOptions.nativeEntry` so stash-restore renders the STASHED parsed entry (native-only keys like Cline `autoApprove` survive disable → enable) — no edit is ever re-derived on the write path.
- **TOML stash is now vestigial by data**: with Codex native, every stash adapter is JSON/JSONC — stash byte-preservation is the parsed-entry + jsonc-`modify` determinism path (disable stashes the parsed native entry in the spec §3.4 shape `{client, scope, name, entry, disabledAt}`; enable re-inserts it via the same `modify` formatting that added it, proven byte-exact by the vscode golden: post-disable == pre-apply, post-enable == post-apply). A future TOML stash adapter would need a raw-text stash variant (documented limitation, not built — no adapter requires it).
- **TOML remove-region blank-collapse (executor mechanics, write.ts):** the 33.0 insert mechanic adds one separator blank above a new block and region bounds exclude trailing blanks, so a naive removal leaves a doubled blank; the executor drops exactly one adjacent blank on blank/blank, blank/EOF, or blank/header adjacency — making insert → remove a byte-exact inverse (pinned by write.test.ts + the codex golden stage-4 == stage-0) without ever touching a non-blank line.
- **Safety protocol (AC 33.1.2)** in write.ts: pre-parse refusal (no backup, no write) → timestamped backup `<stateDir>/backups/<client>/<scope>/<basename>.<ISO-ts>` (ISO with `:`/`.` flattened for Windows) → write → re-read + re-parse → post-write failure auto-restores the exact prior bytes (or deletes a brand-new file) and reports `restored: true`; backup failure refuses before touching the file. `restoreBackup` restores latest-or-named through the SAME protocol (the restore itself backs up first) and refuses when none. Result reasons name path + parse reason only — never content.
- **Recorded deviation (backup path shape):** backups live under `backups/<client>/<scope>/` — spec §3.5 says `<client>/<file>.<ts>`; the `<scope>` segment was added because Codex's user and project scopes share the basename `config.toml` (client-only bucketing would interleave two different files' backups). Documented in write.ts's `backupPathFor` doc comment.
- **Ownership (AC 33.1.4):** exact-match canonical namespace OR a `state.json` managed-entry record (a stash record also counts — it is proof the manager handled the entry). The refusal fires before any backup/write — pinned: foreign-name enable/disable/remove/apply-update leave the file byte-identical with ZERO backups and NO state.json created. `iris-dev-mcp2`/`IRIS-DEV-MCP`/lookalikes stay foreign. An apply CREATING a not-yet-present non-canonical entry is allowed and records it manager-created (that is how ownership is established); a present foreign entry can never be clobbered.
- **Synthesis (AC 33.1.5):** four modes per adapter capability; VS Code env-reference upgrades the password to `${input:iris-password}` and returns the `inputs` descriptor (`promptString`/`password:true`) — the DESCRIPTOR only; merging it into the file's top-level `inputs` array is the 33.2 CLI's seam (the engine's apply executes exactly one rendered NativeEdit, per AC 33.1-I1). `explicit` refuses without `confirm === <entry name>` and never echoes the submitted password in refusal text; mechanical sweep: every adapter × the three non-explicit modes renders either no `IRIS_PASSWORD` key or a `${...}` reference — never a literal (13 adapters × 3 modes, counted mechanically). Epics 31/32 are shipped, so server-manager/governance-file modes are NOT hidden here (the 33.2 CLI host probe owns hide-when-absent — documented seam).
- **AC 33.1-I1 mechanical proof:** engine.test.ts injects recording wrappers at the `diffFn`/`executeFn` seams across apply/enable/disable/remove × all four format families (JSON stash, JSON native, TOML native, YAML native) and asserts the executed edits `toEqual` the rendered ones, pairwise in order.
- **Golden round-trips (AC 33.1.1/33.1.3, Rule #36):** four committed golden families (vscode JSONC stash with comments, cline JSON native, codex TOML native with a trailing-comment owned header, goose YAML native with comments), each five stages (initial/added/disabled/enabled/removed), CAPTURED from the built dist against a real tmp HOME via `node packages/client-config/tmp-33-1-capture-golden.mjs` (2026-07-27, script deleted after capture) and cross-checked by independent oracles in golden.test.ts: per-stage byte-equality vs the committed files + stash disable == initial / native enable == added / remove == initial + re-parse with the foreign entry intact + verbatim foreign lines + parsed-foreign deep-equality across all stages.
- **Rule #54:** the sabotage test's injected executor produces invalid JSON (a reachable corrupting-writer bug), never an impossible fake shape; the MemFs fake returns only shapes the real fs returns (strings, string arrays, ENOENT-shaped Errors).
- **Rule #22 dist smoke:** disposable script (deleted after) drove the BUILT dist in a fresh Node process — 19/19 PASS (all six engine exports present per AC 33.1-I2, synthesize + apply + backup existence, disable stash with spec-shaped state.json, byte-exact enable, ownership refusal with file untouched, remove purge, restore latest + no-backups refusal).
- **Gates:** package suite 189 tests / 12 files (33.0 close: 111/7 → +78/+5: write 16, state 11, engine 25, synthesize 18, golden 5, diff.test +3 codex native-flag — mechanically derived from the runner); `pnpm turbo run build test lint type-check` 29/29; `pnpm turbo run test --force` (uncached, the 33.0-review flake discipline) 15/15 tasks [shared 1300, dev 609, admin 451, ops 348, interop 334, data 132, all 112]; `pnpm gen:governance-baseline:check` (`:check` ONLY) exit 0 — frozen 1e62c5ad5bf7 / 141 / 201 / 60 unchanged (no MCP tool/governance key; Rules #28/#31/#53 untriggered); NUL-byte scan of the 22-file diff: NONE; no bootstrap-classes.ts/BOOTSTRAP_VERSION/src/ExecuteMCPv2 contact; extensions/ and docs/client-config untouched; no new dependencies (jsonc-parser/yaml/smol-toml only).
- Changes left UNCOMMITTED for the lead's per-story smoke gate + commit.

### File List

- packages/client-config/src/diff.ts (modified — additive: DiffAction/DiffMechanism "remove", TomlNativeEdit "set-flag", DiffOptions.nativeEntry, native-flag TOML rendering, flag stamping in renderNativeEntry/serializeTomlEntry)
- packages/client-config/src/adapters.ts (modified — codex native `enabled` + ADAPTER_DATA_VERSION 2026-07-25.2)
- packages/client-config/src/status.ts (modified — codex flag verified comment)
- packages/client-config/src/index.ts (modified — write/state/engine/synthesize exports + DiffOptions type)
- packages/client-config/src/write.ts (new — executors + safety protocol + backups/restore)
- packages/client-config/src/state.ts (new — state.json ledger: managed entries + stash records)
- packages/client-config/src/engine.ts (new — apply/enable/disable/remove/restore + ownership)
- packages/client-config/src/synthesize.ts (new — four env modes)
- packages/client-config/src/__tests__/write.test.ts (new, 17 tests — 16 dev + 1 review regression)
- packages/client-config/src/__tests__/state.test.ts (new, 11 tests)
- packages/client-config/src/__tests__/engine.test.ts (new, 26 tests — 25 dev + 1 review regression)
- packages/client-config/src/__tests__/synthesize.test.ts (new, 18 tests — gemini shell test rewritten in review)
- packages/client-config/src/__tests__/golden.test.ts (new, 5 tests)
- packages/client-config/src/__tests__/helpers.ts (modified — MemFs + fixedNow test helpers)
- packages/client-config/src/__tests__/adapters.test.ts (modified — native roster gains codex)
- packages/client-config/src/__tests__/status.test.ts (modified — codex verified-flag test)
- packages/client-config/src/__tests__/diff.test.ts (modified — codex native-flag tests + remove action + set-flag test-local splice)
- packages/client-config/src/__tests__/e2e.test.ts (modified — codex native-flag chain, remove action, verified-flag classification)
- packages/client-config/src/__tests__/fixtures/golden/vscode/stage-*.jsonc (new, 5 golden stages)
- packages/client-config/src/__tests__/fixtures/golden/cline/stage-*.json (new, 5 golden stages)
- packages/client-config/src/__tests__/fixtures/golden/codex/stage-*.toml (new, 5 golden stages)
- packages/client-config/src/__tests__/fixtures/golden/goose/stage-*.yaml (new, 5 golden stages)
- packages/client-config/src/__tests__/engine-e2e.test.ts (new, QA stage — 24 tests: 23 QA + 1 review dist-level regression; built-dist lifecycle chains on the real fs + adversarial edges)
- packages/client-config/src/write.ts (QA-modified — F1 skipPreParse for restore, F2 timestamp-pattern backup filter)
- packages/client-config/src/diff.ts (QA-modified — F3 last-property-with-trailing-comma removal span)

## Change Log

- 2026-07-27 (dev): Write engine + enable/disable + entry synthesis shipped in `@iris-mcp/client-config` (write.ts/state.ts/engine.ts/synthesize.ts). Codex `enabled` flag verified native via the Rule #16 probe (ADAPTER_DATA_VERSION 2026-07-25.2); additive diff.ts extensions (remove action, TOML set-flag, DiffOptions.nativeEntry, flag stamping); universal safety protocol with timestamped backups + auto-restore; AC 33.1.4 ownership ledger in state.json; golden byte round-trips across 4 families; 189/189 package tests, all monorepo gates green, frozen governance baseline untouched.
- 2026-07-27 (qa): E2E/edge layer `engine-e2e.test.ts` (+23 tests, 189 → 212/13 files — counts from the vitest runner): full lifecycle chains over the BUILT dist in real-fs sandbox HOMEs per format family; synthesis × engine × status flips; sabotage/restore chains; codex user+project same-basename segregation; corrupted state.json mid-flow; multi-client interleavings in one HOME; ownership refusals with zero on-disk side effects; CRLF/unicode/EACCES edges; state.json §3.4 shape round-trips. **Three QA-found product defects fixed in the package (each confirmed live against the pre-fix dist before fixing):**
  - **QA-33.1-F1 (write.ts):** `restore` refused when the CURRENT config was unparseable — the exact disaster case restore exists for, leaving no manager-side recovery path. `restoreBackup` now skips pre-parse of the current file only (`skipPreParse`, internal); the broken bytes are still backed up first and the restored bytes are re-parsed.
  - **QA-33.1-F2 (write.ts):** `listBackups` treated ANY `<basename>.*` file as a backup — a non-timestamp file (`.claude.json.zzz-not-a-backup`) sorted after every ISO stamp and was silently restored over the real config (verified live with a planted file). Only the manager's timestamped naming `<base>.<ISO-ts>` now counts as a backup.
  - **QA-33.1-F3 (diff.ts):** `removalEdits` swallowed the trailing comma + the whitespace BEFORE the closing bracket for a LAST property carrying a trailing comma (trailing-comma-styled JSONC), leaving the entry's indent glued to `}` — apply → remove and apply → disable → enable were NOT byte-exact inverses on trailing-comma-styled files (the committed vscode golden family has no trailing commas, so dev's goldens never saw it; the QA trailing-comma fixture chain exposed it). The last-property-with-trailing-comma case now swallows the comma + the PRECEDING newline+indent and keeps the closer's whitespace.
  - Gates after fixes: `pnpm turbo run build test lint type-check` 29/29; `pnpm turbo run test --force` (uncached) 15/15; package suite 212/212; NUL-byte scan of the QA diff: NONE. Changes left UNCOMMITTED.
- 2026-07-27 (review): bmad-code-review — **review → done**. 4 patched / 5 deferred / 1 dismissed / 0 decision-needed; all 3 background layers failed to return (32.3/33.0 precedent — reviewer-driven pass, failed layers recorded above). HIGH: remove-while-stashed skipped the state purge → zombie resurrection via enable (probe-verified pre-fix; purge fix + unit/dist regressions). MEDIUM: restore threw on an unreadable current config (typed-refusal fix). MEDIUM: Gemini `shell` env-reference mistreated as no-expansion (now `${VAR}` references per the registry's declared capability). LOW: writer-CLI preference recorded in adapter data (spec §3.5 point 6). AC 33.1-I1 spy proof mutation-verified; Codex probe evidence independently re-verified; package 215/13; full uncached gate 29/29; frozen baseline `1e62c5ad5bf7` unchanged. Details in Review Findings. Changes left UNCOMMITTED for the lead's smoke gate + commit.

### Review Findings

Code review 2026-07-27 (bmad-code-review, story key `33-1-write-engine`, target = uncommitted working tree). **Failed layers: blind, edge, auditor** — all three background review layers failed to return findings within the review window (the 32.3/33.0 precedent); the reviewer-driven pass covered their mandates directly (full-diff read, boundary walk, spec/rules audit, live probes, mutation verification). Any late layer return goes to lead triage. Triage: **0 decision-needed / 4 patch (all applied) / 5 deferred / 1 dismissed.**

**Patched (all applied + regression-pinned this review):**

- [x] [Review][Patch] **HIGH — remove while stashed skipped the state purge; a later enable RESURRECTED the "removed" server** [engine.ts `remove`]. Probe-verified against the pre-fix dist: apply → disable (stashed) → remove returned `ok` with note "already in the requested state" while the stash AND ownership records survived (`stashes: 1, entries: 1`), and a subsequent enable spliced the entry back (`stash-add`). Violated remove's own contract ("purge ... plus its stash and ownership records") and the AC 33.1.4 ownership ledger's lifecycle. Fix: when the entry is absent from a parseable file, remove purges stash + managed records (mirroring the missing-file branch) and reports "entry not present in the file; state records purged". Regression: engine.test.ts (unit, MemFs) + engine-e2e.test.ts (dist-level chain: remove-while-stashed purges; enable then refuses "nothing to enable"); re-verified live on the rebuilt dist.
- [x] [Review][Patch] **MEDIUM — restore threw an exception when the CURRENT config was unreadable** [write.ts `restoreBackup`]. The current-file read was unguarded: EACCES/EBUSY on the recovery path escaped as an exception (probe-verified against the pre-fix dist) instead of the engine's typed `{ok:false, reason}` contract — the 33.2 CLI would crash on exactly the disaster-recovery surface. Fix: guarded read → typed refusal naming path + I/O reason; nothing overwritten. Regression: write.test.ts (explicit-delegation WriteFs fake — never `{...memfs}`, whose spread drops prototype methods); re-verified live on the rebuilt dist (typed refusal, file intact).
- [x] [Review][Patch] **MEDIUM — env-reference synthesis mistreated the `shell` adapter (Gemini) as no-expansion** [synthesize.ts]. The registry declares Gemini's `envExpansion: "shell"` for its documented `$VAR`/`${VAR}` substitution (types.ts comment + spec §3.2 table + the 33.0 review's verified deviation record), and spec §3.3 mode 2 renders references "where envExpansion supports it" — yet the branch routed `shell` to the `none` literal+doctor-note treatment, omitting the password reference and mis-advising "does not expand env vars in MCP config" (and leaving `referenceForm`'s shell branch dead). Fix: only `none` takes the literal treatment; `shell` renders `${VAR}` references (`IRIS_PASSWORD` a reference, never a literal). Regression: synthesize.test.ts gemini test rewritten (references with and without a profile; no doctor note); the 13×3 no-literal-password sweep still holds; live-verified on the rebuilt dist. If Gemini's substitution ever proves not to cover MCP `env` values, the correct follow-up is flipping the adapter's `envExpansion` to `"none"` with a Rule #16 evidence comment — not the old routing.
- [x] [Review][Patch] **LOW — writer-CLI preference not recorded in adapter data** [adapters.ts claude-code + kimi records]. Spec §3.5 point 6 ("prefer the client's own writer CLI where non-interactive ... adapter data records which path is used") and the story's own Dev Notes ("the writer-CLI preference is documented in adapter data for later ... record if you disagree") — neither done. Fix: adapter-record comments recording `claude mcp add-json` / `kimi mcp add` as the preferred writer for the 33.2+ consumers (v1 engine: direct edit only).

**Deferred (see deferred-work.md § "Deferred from: code review of 33-1-write-engine (2026-07-27)"):**

- [x] [Review][Defer] **33-1-R1** LOW — a stale stash record survives an already-in-state enable no-op (entry present + stash exists, e.g. after enable's writeState failure): self-healing on the next disable; cosmetic ledger hygiene [engine.ts `runEdit` no-op early return].
- [x] [Review][Defer] **33-1-R2** LOW — CRLF TOML: `set-flag` insert/replace lines are spliced LF-only, diluting CRLF files to mixed endings (parseable; the 33.0 CRLF tests assert parseability, not byte-identity; goldens are LF) [write.ts `executeTomlSplice`, diff.ts `tomlEdit`].
- [x] [Review][Defer] **33-1-R3** LOW — comments INSIDE a manager-owned JSONC entry are not stash-round-tripped (the stash is the parsed entry + `modify` determinism, not raw text; comments elsewhere in the file are always preserved). Raw-text stash variant — the same documented limitation as a future TOML stash [engine.ts `disable`, state.ts `StashRecord`].
- [x] [Review][Defer] **33-1-R4** LOW — backup names collide when two writes to the same file land in the same millisecond (ISO-ms stamp; second backup overwrites the first) [write.ts `stamp`/`backupPathFor`].
- [x] [Review][Defer] **33-1-R5** LOW — state.json loss orphans non-canonical manager-created entries: a present non-canonical entry with no record can be neither updated nor removed (ownership refusal) until the file or record is repaired manually [engine.ts `ownershipRefusal`].

**Dismissed (1):** restore being blocked by a corrupt state.json — conservative-by-design (the manager never guesses at its own ledger); restore's target file is unrelated to state content, but refusal is the safe direction and matches the QA-pinned "corrupted state.json mid-flow" contract.

**Reviewer independent verification (fresh, this review — not the Dev Agent Record):**

- **AC 33.1-I1 spy proof MUTATION-VERIFIED (Rule 1/Rule #19-class):** engine.ts runEdit mutated to re-derive the edit via a second diff call ⇒ exactly the I1 spy test went red (24/25 pass), restored ⇒ green. The proof genuinely fails on re-derivation.
- **Rule #16 Codex probe evidence independently re-verified** against the live official docs (learn.chatgpt.com/codex/extend/mcp: "`enabled` (optional): Set `false` to disable a server without deleting it.") — the recorded evidence is real and the adapter change matches; `ADAPTER_DATA_VERSION` 2026-07-25.2 confirmed in dist.
- **Rule #36/#49 golden discipline:** fixtures carry comments, foreign entries with dummy secrets, and realistic shapes (plausibly captured, not hand-authored); golden.test.ts asserts byte-equality against the committed files PLUS independent cross-stage oracles (stash disable == initial, native enable == added, remove == initial, foreign verbatim lines + parsed deep-equality); the vscode/cline/codex/goose cross-stage byte equalities were re-verified at the file level this review.
- **QA-33.1-F3 (trailing-comma removal) probe-verified** on the pre-review dist: add → remove on trailing-comma-styled JSONC is byte-exact.
- **33.0 contracts not weakened (Rule 1):** diff.ts changes are additive (new `remove` action/mechanism, `set-flag` op, optional `DiffOptions`); null-native no-op discipline intact (runEdit branches on `native === null` before executing); 33.0's suites updated only where the Codex native flip genuinely reclassified behavior (all green).
- **Security lens:** reasons name path + parse reason only throughout write/engine; explicit mode requires `confirm === <entry name>` and marks `contains-secret` (e2e-pinned); ownership refusals fire before any backup/write (QA e2e pins zero on-disk side effects); the 13×3 mechanical sweep proves no literal `IRIS_PASSWORD` outside explicit mode.
- **Rule #52 seam:** no CLI/UI surfaces built; the vscode `inputs` merge stays the documented 33.2 seam; the engine consumes diff() output exactly.
- **Rule #3 real-runtime bar:** QA's engine-e2e drives the built dist over real-fs sandbox HOMEs (mkdtemp) — satisfies the bar for this engine story; the reviewer's own probes also drove the dist in fresh Node processes.
- **Rule #51:** test counts taken from the runner (215/13 post-review); adapter roster 13 counted mechanically from dist.
- **Gates post-patch:** package 215 tests / 13 files (212 + 3 review regressions: engine zombie guard, write restore-EACCES, engine-e2e dist zombie chain); `pnpm turbo run build test lint type-check --force` (uncached) green; `pnpm gen:governance-baseline:check` (`:check` ONLY) exit 0 — frozen `1e62c5ad5bf7` / 141 / 201 / 60 unchanged; NUL-byte scan of the review diff: NONE; no bootstrap/`BOOTSTRAP_VERSION`/`src/ExecuteMCPv2` contact; no new dependencies. Changes left UNCOMMITTED for the lead's per-story smoke gate + commit.
