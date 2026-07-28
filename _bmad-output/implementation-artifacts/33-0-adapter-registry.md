# Story 33.0: Adapter Registry + Read Engine

Status: done

## Story

As an iris-mcp suite maintainer,
I want a declarative `ClientAdapter` registry for all 13 v1 MCP clients plus a read-only detect/status/diff engine in a new `@iris-mcp/client-config` package,
so that client wiring knowledge lives in version-stamped data (never engine code) and Stories 33.1–33.3 can build writes, CLI, and UI on a certified read foundation.

## Acceptance Criteria

1. **AC 33.0.1** — `ClientAdapter` registry data for all 13 v1 clients matching the binding spec's capability table (id, format, rootKey, scopes with per-OS path templates, entryShape, envExpansion, disableSupport, restartHint, detection rules, docsUrl); paths resolved via injectable env/platform; adapter data is version-stamped.
2. **AC 33.0.2** — `detect` reports installed clients (config file and/or app-dir probes) without writing anything; `status` renders the client × iris-mcp-server matrix (present-enabled / present-disabled / absent) by parsing each detected config in its native format — JSONC comments, TOML tables, and YAML all parse via fixtures for every adapter.
3. **AC 33.0.3** — `diff` renders the exact pending edit for a hypothetical `apply`/`enable`/`disable` without writing (pure function of current file content + canonical entry) — this story ships the renderer used by 33.1's confirm flow (Rule #52 seam documented in Dev Notes).
4. **AC 33.0.4** — Fixture suite per adapter includes files with foreign third-party entries and asserts they are surfaced read-only and NEVER included in any pending-edit rendering; malformed config files yield a per-client `unparseable` status (never a crash).

## Integration ACs

**No consumers in this story** (Rule 1 escape clause). The package's consumers all land in later stories of this epic: the `diff` renderer's first consumer is **Story 33.1** (write engine confirm flow, AC 33.0.3's stated seam), and `detect`/`status`/`diff`'s first external consumer is **Story 33.2** (`iris-mcp-clients` CLI). The public API surface exported here (registry, detect, status, diff) must therefore be the SAME functions 33.1/33.2/33.3 import — single-sourced (Rule #45 spirit); the Story 33.2 review verifies the CLI imports them from the built dist rather than re-implementing.

## Tasks / Subtasks

- [x] Task 1: Package scaffold (AC: 1)
  - [x] `packages/client-config/` — `@iris-mcp/client-config`, private:false-ready but NOT added as a dependency of any server runtime package or the extension (consumers arrive in 33.2/33.3); mirrors `packages/shared` conventions: `tsconfig.json` extending `../../tsconfig.base.json` (`composite`, `outDir dist`, `rootDir src`), `vitest.config.ts` with the same include/exclude shape, `build`/`test`/`lint`/`type-check` scripts, `"type": "module"`, `main`/`types` → `dist`
  - [x] Dependencies (all NEW to the repo except jsonc-parser — pre-authorized by this story spec, Rule 9): `jsonc-parser` (^3.3.1, already in lockfile via shared), `yaml` (eemeli — comment-preserving CST; 33.1's write engine needs the same package), `smol-toml` (TOML 1.0 parser for Codex configs; read-only use here — 33.1's writes are text-level section splices, NOT serializer rewrites). No other new deps.
  - [x] `pnpm install` + verify `pnpm turbo run build test` picks the package up (turbo.json is task-shape-only; no edit needed)
- [x] Task 2: `ClientAdapter` type + registry data (AC: 1)
  - [x] Type per binding spec §3.2 (`id`, `displayName`, `format`, `rootKey`, `scopes[]` with per-OS path templates + `shareable`, `entryShape`, `envExpansion`, `disableSupport`, optional `nativeDisableFlag`, `restartHint`, `detection[]`, `docsUrl`)
  - [x] Data for all 13 clients, transcribed from the capability table in Dev Notes (Claude Code, Claude Desktop, Cursor, VS Code (Copilot), Cline, Roo Code, Windsurf, Codex CLI, Gemini CLI, Zed, Goose, Kimi CLI, Kimi Code); Pi documented as excluded-not-MCP-capable in package docs/data (disposition, not an adapter); JetBrains/Kilo Code noted as roadmap
  - [x] `ADAPTER_DATA_VERSION` stamp (e.g. `"2026-07-25.1"` — spec date + serial) exported; every adapter record reachable from a `CLIENT_ADAPTERS` registry keyed by id
  - [x] Path resolution: pure function `(adapter, scope, {platform, env, homeDir})` — env/platform injectable, NO direct `process.env`/`process.platform` reads inside the resolution core (tests simulate win32/darwin/linux without host dependence; the 32-3-R2 posix/win32 path discipline applies — use `path.win32`/`path.posix` explicitly per simulated platform, never bare `path` under simulation)
- [x] Task 3: Detection (AC: 2)
  - [x] `detect({platform, env, homeDir, fs probes injectable})` → per client: `{client, detected, probes: [{path, exists}]}` across all scopes; config-file and app-dir probes per adapter data; READ-ONLY (a test spies that no write/mkdir syscall occurs)
  - [x] Undetected clients reported distinctly (33.3 lists them collapsed with a "not detected" note) — detection never throws on missing files
- [x] Task 4: Native-format readers + status matrix (AC: 2)
  - [x] JSON/JSONC reader via `jsonc-parser` `parse()` (collect errors, tolerate comments/trailing commas); TOML reader via `smol-toml`; YAML reader via `yaml` — each returns a typed result: `{ok: true, entries: Record<name, RawEntry>}` | `{ok: false, error}`; a malformed file is NEVER an exception across the boundary
  - [x] Entry classification: iris-mcp-owned (name in the canonical iris-mcp server set: `iris-dev-mcp`, `iris-admin-mcp`, `iris-ops-mcp`, `iris-interop-mcp`, `iris-data-mcp`, `iris-mcp-all`) vs foreign third-party; per-entry enabled/disabled from the adapter's `nativeDisableFlag` when present (Cline/Roo `disabled`, Goose `enabled`; Codex flag unverified ⇒ treat as present-enabled, the 33.1 live probe decides), else present ⇒ enabled
  - [x] `status` → matrix: per detected client × the 6 canonical servers: `present-enabled` | `present-disabled` | `absent`; undetected clients excluded from the matrix but listed; `unparseable` per client on parse failure (AC 33.0.4); foreign entries surfaced as a read-only list per client (names only + rootKey presence — never values)
- [x] Task 5: Diff renderer (AC: 3)
  - [x] `diff(currentContent, canonicalEntry, adapter, scope)` → structured pending-edit description for hypothetical `apply` (add/update entry), `enable`, `disable` — PURE: no fs, no clock, no env; identical inputs ⇒ identical output
  - [x] Renders per format: JSON/JSONC via `jsonc-parser` `modify()` (the same edit set 33.1 will apply), TOML as the text-splice region descriptor (owned `[mcp_servers.<name>]` tables only), YAML via `yaml` CST edit preview; foreign entries provably absent from every rendered edit (AC 33.0.4)
  - [x] Human-readable text render + structured form (the CLI prints one, the extension renders the other — both from this story)
- [x] Task 6: Fixture suite + tests (AC: 2, 4)
  - [x] Per-adapter fixtures under `packages/client-config/src/__tests__/fixtures/<client-id>/`: realistic config incl. JSONC comments (VS Code), TOML tables + comments (Codex), YAML + comments (Goose); each with ≥1 foreign third-party entry; ≥1 malformed fixture per format family
  - [x] Fixture assertions: native parse succeeds per adapter (AC 33.0.2); foreign entries surfaced read-only, never in pending-edit renders (AC 33.0.4); malformed ⇒ `unparseable`, no crash (AC 33.0.4)
  - [x] Path-resolution matrix tests across simulated win32/darwin/linux × user/project scopes
  - [x] Detection read-only spy test; status matrix over a multi-client sandbox fixture tree (fixture HOME, injected paths — never the real HOME)
  - [x] All counts in test assertions derived from the registry/fixtures mechanically (Rule #51), never hand-authored literals that can drift (e.g. assert `Object.keys(CLIENT_ADAPTERS).length === 13` once, then iterate the registry)

## Dev Notes

### Binding spec (read first — the capability table is the deliverable's data)

`_bmad-output/planning-artifacts/research/technical-iris-server-manager-mcp-connections-research-2026-07-25.md`, Feature 3 addendum §3.1–§3.9 (lines ~450–600). §3.2 has the `ClientAdapter` interface verbatim and the verified 13-client table; §3.3 the canonical entry model + env modes (modes are 33.1's synthesis work — 33.0 needs only the canonical server set and entry SHAPE awareness); §3.4 the two disable mechanisms; §3.5 the write engine (33.1); §3.6 deliverable shape; §3.7 certification (33.4).

13-client capability table (transcribe into adapter data; spec §3.2 is authoritative on conflict):

| Client | id | Format | Root key | User scope | Project scope | Env expansion | Disable |
|---|---|---|---|---|---|---|---|
| Claude Code | `claude-code` | JSON | `mcpServers` | `~/.claude.json` | `.mcp.json` (shareable) | `claude` (`${VAR}`, `${VAR:-def}`) | stash |
| Claude Desktop | `claude-desktop` | JSON | `mcpServers` | win `%APPDATA%\Claude\claude_desktop_config.json`; mac `~/Library/Application Support/Claude/claude_desktop_config.json`; linux `~/.config/Claude/claude_desktop_config.json` | — | `claude` convention | stash |
| Cursor | `cursor` | JSON | `mcpServers` | `~/.cursor/mcp.json` | `.cursor/mcp.json` (shareable) | none | stash |
| VS Code (Copilot) | `vscode` | JSONC | `servers` (+`inputs`) | user-profile `mcp.json` | `.vscode/mcp.json` (shareable) | `vscode` (`${input:id}`, `${env:VAR}`) | native (UI) + stash |
| Cline | `cline` | JSON | `mcpServers` | `<VSCode globalStorage>/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` | — | none | **native `disabled`** |
| Roo Code | `roo-code` | JSON | `mcpServers` | ext-storage `mcp_settings.json` | `.roo/mcp.json` (shareable) | `claude`-style in headers/args | native `disabled` |
| Windsurf | `windsurf` | JSON | `mcpServers` | `~/.codeium/windsurf/mcp_config.json` | — | none | stash |
| Codex CLI | `codex` | TOML | `[mcp_servers.<n>]` | `~/.codex/config.toml` | `.codex/config.toml` (trusted projects) | `claude`-style in args/headers | verify `enabled` flag in 33.1 (Rule #16 live probe); else stash |
| Gemini CLI | `gemini` | JSON | `mcpServers` | `~/.gemini/settings.json` | `.gemini/settings.json` (shareable) | shell `$VAR` convention | stash |
| Zed | `zed` | JSON | `context_servers` | `~/.config/zed/settings.json` / `%APPDATA%\zed\settings.json` | `.zed/settings.json` (shareable) | `claude` convention | stash |
| Goose | `goose` | YAML | `extensions` | `~/.config/goose/config.yaml` / `%APPDATA%\goose\config.yaml` | — | `claude` | native `enabled` |
| Kimi CLI | `kimi` | JSON | `mcpServers` | `~/.kimi/mcp.json` | — (`--mcp-config-file` override; document) | none | stash |
| Kimi Code | `kimi-code` | JSON | `mcpServers` | `~/.kimi-code/mcp.json` (or `$KIMI_CODE_HOME`) | repo `.mcp.json` (shared with Claude Code — most specific wins: `.kimi-code/mcp.json` > `.mcp.json`) | none | stash |

Entry shapes (spec §3.2): `standard` = `{command, args, env}`; `zed` = context_servers command-object variant; `goose` = extensions `{type:"stdio", cmd, args, envs}`; `codex-toml` = `[mcp_servers.<name>]`(+`.env`) tables. VS Code user-scope `mcp.json` lives under the editor's user-profile dir (per-OS: win `%APPDATA%\Code\User\mcp.json`, mac `~/Library/Application Support/Code/User/mcp.json`, linux `~/.config/Code/User/mcp.json`) — adapter data records the template; detection probes it. Cline/Roo storage paths sit under the VS Code `globalStorage` dir (same per-OS roots, `globalStorage/<publisher.ext>/settings/…`).

### Rule #52 seam — what this story ships vs. what 33.1 owns

This story ships the **read side, complete-shaped**: registry + detection + native readers + status matrix + **diff renderer (pure)**. Story 33.1 owns exactly: the write engine that APPLIES the edits this renderer computes (`jsonc-parser` `applyEdits`, TOML text splices, YAML CST writes), the safety protocol (validate → backup → edit → re-parse → auto-restore), `state.json` stash for enable/disable on stash adapters, native-flag toggling (incl. the Codex `enabled` live probe), ownership enforcement, entry synthesis in the four env modes, and the confirm flow that consumes this story's renderer. Do NOT build writes, backups, state.json, or entry synthesis here; do NOT leave the renderer a stub 33.1 must redesign — its output must be directly executable by 33.1's apply path.

### Constraints

- **No new MCP tools, no server-runtime changes** (epic scope): Rules #28/#31/#53 untriggered; frozen governance baseline untouched (`pnpm gen:governance-baseline:check` stays exit 0); no `bootstrap-classes.ts`/`src/ExecuteMCPv2/**` contact.
- **Never log or transmit config contents** (spec §3.5.5): foreign entries may hold third-party secrets. Status/diff surfaces expose entry NAMES and owned-entry structure only — never foreign `env` values, never whole-file dumps. Errors name path + parse reason, not content lines.
- **Read-only story**: detection/status/diff must perform ZERO writes. Mechanical proof: an fs-spy test over `writeFile/mkdir/rename/appendFile` fails on any call.
- **Injectable platform/env/homeDir**: the resolution/detection core never reads `process.env`/`process.platform`/`os.homedir()` directly; a thin adapter at the package boundary supplies them (33.2 CLI wires the real ones).
- **Counts mechanical (Rule #51)**: the 13-client count, matrix dimensions, and any doc tallies derive from `CLIENT_ADAPTERS` iteration.
- **Rule #54/#36**: fixtures are realistic captures of each client's documented format (from the spec's cited official docs), not invented shapes; test fakes return only shapes the real parsers produce (e.g. `jsonc-parser` error objects).
- **FR141** covers this epic. Root README/docs are 33.4's rollup — this story ships only the package README skeleton (adapter table generated from the registry at test time as a drift guard is welcome but not required; 33.4 owns the certified table).
- pnpm workspace picks up `packages/*` automatically; add the package to `pnpm-workspace.yaml` NOT needed (glob covers it). Check `extensions/iris-mcp-launcher` is untouched.

### Project Structure Notes

- New package: `packages/client-config/` (`src/index.ts` public API; `src/adapters.ts` data; `src/paths.ts`; `src/detect.ts`; `src/readers.ts`; `src/status.ts`; `src/diff.ts`; `src/__tests__/` with `fixtures/`) — naming may vary; the layout above is a suggestion, the package boundary (`index.ts` exports) is the contract.
- Existing patterns to mirror: `packages/shared/src/cli/governance.ts` (fail-fast error style naming path+var+reason; pure core + thin boundary), `packages/shared/vitest.config.ts` (include/exclude shape), `packages/shared/tsconfig.json`.
- `docs/client-config/` (old per-client recipes) is UNTOUCHED here — 33.4 supersedes it.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 33 / Story 33.0 (ACs 33.0.1–33.0.4)]
- [Source: _bmad-output/planning-artifacts/research/technical-iris-server-manager-mcp-connections-research-2026-07-25.md#§3.1–§3.9 (Feature 3 addendum — binding spec)]
- [Source: packages/shared/src/cli/governance.ts (CLI/engine separation + error-style pattern)]
- [Source: packages/shared/package.json, tsconfig.json, vitest.config.ts (package conventions)]

## Dev Agent Record

### Agent Model Used

Claude Code (k3[1m]) via bmad-dev-story, 2026-07-27.

### Debug Log References

- `pnpm run build` initial failure: `path.PlatformPath` not exported by @types/node — `pathFor()` return type written as `typeof path.win32 | typeof path.posix` (fixed in `src/paths.ts`).
- Vitest run 1 (6 failures): (a) `readConfigEntries("")` returned ok:false — jsonc-parser reports an error on empty input; empty/whitespace content now short-circuits to `{ok:true, entries:{}}` (a valid not-yet-configured client, not a parse failure). (b) TOML remove-region swallowed the trailing comment belonging to the NEXT section — region end now trims the trailing blank+comment run (comments immediately preceding a header belong to the following section, TOML convention); insert-point trimming stays blank-only so a trailing comment is never split from its section. (c) jsonc-parser `modify(path, undefined)` removal REWRITES through the neighboring property — its edit content carried the foreign `github-mcp` key text, violating AC 33.0.4 — replaced by a hand-rolled surgical single-TextEdit removal (empty content, owned property + one adjacent comma only; `findNodeAtLocation` returns the VALUE node, the property node is its parent — caught live). (d) status test compared a simulated-linux resolved path against a host-separator fixture path — assertion corrected to `homeDir + "/.claude.json"` (homeDir verbatim, template separators follow the simulated platform). (e) `vi.spyOn(fs, "writeFileSync")` fails on the frozen ESM namespace — read-only spy proof now uses a `vi.mock("node:fs")` delegation wrapper (mirrors packages/shared's pattern).
- Vitest run 2: 84/85 (one leftover removal-edit failure from the value-node bug); run 3: 85/85 across 6 files.

### Completion Notes List

- **Package** `@iris-mcp/client-config` (0.0.1): scaffold mirroring packages/shared (tsconfig composite/outDir dist/rootDir src, vitest include/exclude shape, build/test/lint/type-check scripts, `"type":"module"`, main/types → dist, exports map). Deps exactly the three pre-authorized: `jsonc-parser` ^3.3.1, `yaml` ^2.9.0, `smol-toml` ^1.7.1 (+ dev `@types/node`, optional peer vitest — same posture as shared). pnpm-workspace glob picked it up with NO edits; turbo task count moved 25 → 29 (the new package's 4 tasks), all green. NOT a dependency of any server runtime package or the extension.
- **AC 33.0.1**: `ClientAdapter` type transcribed from spec §3.2 (`src/types.ts`); 13-adapter `CLIENT_ADAPTERS` registry keyed by id (`src/adapters.ts`), stamped `ADAPTER_DATA_VERSION = "2026-07-25.1"` (spec date + serial). `CLIENT_DISPOSITIONS` documents Pi (excluded-not-MCP-capable) + JetBrains/Kilo Code (roadmap). Path resolution is pure with injectable `{platform, env, homeDir, projectDir}`; `path.win32`/`path.posix` selected by the SIMULATED platform (32-3-R2 discipline); `%VAR%`/`${VAR}`/`~` expansion with unresolved placeholders left verbatim (never invented); kimi-code's `$KIMI_CODE_HOME` envOverride and most-specific-wins project fallback (`.kimi-code/mcp.json` > `.mcp.json`) modeled in data.
- **AC 33.0.2**: `detect` (config-file + app-dir probes per adapter, injectable fs, never throws — a probe error reports exists:false) and `status` (detected clients only in the matrix; undetected listed; per-scope `ok`/`missing`/`unparseable`/`unresolved`; 6-row canonical-server matrix per ok scope; foreign names sorted, names only). Readers: jsonc-parser (comments + trailing commas tolerated, BOM stripped — the Story 31.0 lesson), smol-toml, yaml Document — one typed `{ok}|{ok:false,error}` boundary, malformed never an exception.
- **AC 33.0.3**: `diff(currentContent, entry, adapter, scope, action)` — pure (proven: two consecutive calls `toEqual`); mechanisms `add`/`update`/`native-flag`/`stash-add`/`stash-remove`/`already-in-state`; native-flag enable/disable on absent entries refuses cleanly. JSON/JSONC: jsonc-parser `modify()` edit sets for set/flag ops (directly `applyEdits`-executable by 33.1) + a hand-rolled surgical removal edit (see Debug Log (c)). TOML: text-splice descriptors (`insert`/`replace-region`/`remove-region` with 0-based inclusive line regions, owned `[mcp_servers.<name>]`(+sub) tables only; region end trims trailing blank+comment runs). YAML: CST op descriptors (`set`/`delete`/`set-flag` + owned-entry preview snippet). Human-readable `text` render carries ONLY the owned entry.
- **AC 33.0.4**: per-adapter fixtures (13, each with ≥1 foreign entry; VS Code JSONC with comments + trailing comma pinned as raw text; Codex TOML with comments + foreign table + unrelated sections; Goose YAML with comments + builtin + enabled:false entry) + malformed fixtures per format family (bad.jsonc/bad.toml/bad.yaml) + a 5-client `sandbox-home/` tree (fake HOME; vscode intentionally malformed there). Foreign-leak proof: a word-boundary scan over every rendered edit surface (text + edit contents + TOML insertText + YAML snippet) for all 13 planted foreign names + 2 secret markers, across all 13 adapters × apply/disable renders. Status surface proven to never contain foreign secret values.
- **Executability proofs (the Rule #52 seam honored)**: every rendered edit is applied to a COPY of its fixture with exactly 33.1's future mechanism — `applyEdits` for JSON/JSONC, a test-local line splice for TOML, `parseDocument`+`setIn`/`deleteIn` for YAML — and the result re-parses with the owned change applied and every foreign entry/comment intact. The write engine owns fs/backup/stash/synthesis around these descriptors; nothing in this package writes.
- **Read-only proof (mechanical)**: `vi.mock("node:fs")` delegation wrapper spies `writeFileSync/mkdirSync/renameSync/appendFileSync/rmSync/unlinkSync` while `detect` + `status` run against the real on-disk sandbox tree — zero calls. The injected fs surface structurally has no write methods either.
- **Counts mechanical (Rule #51)**: the 13-client roster asserted once as a literal, everything else iterates `CLIENT_ADAPTERS`; matrix width derived from `CANONICAL_SERVERS`; fixture inventory keys proven to equal registry keys; sandbox detected-set cross-checked against the registry.
- **Recorded spec deviation**: `EnvExpansion` union extended with `"shell"` for Gemini CLI's documented `$VAR`/`${VAR}` shell convention (spec §3.2's own table assigns Gemini "shell `$VAR` convention" while the interface lists only claude/vscode/none — documented in `src/types.ts`). VS Code `disableSupport` recorded as `stash` with a comment (its native disable is a UI gesture, no file flag — spec table "native (UI) + stash"); Codex `stash` pending the 33.1 live probe (flag unverified, spec Confidence Medium).
- **Rule #22 dist smoke**: disposable script (deleted after) drove the BUILT dist in a fresh Node process against the sandbox fixtures — 8/8 PASS (registry count, version stamp, 5-client detection, cline present-disabled, vscode unparseable, no foreign secret leak, diff apply add + text).
- **Gates**: package 85 tests / 6 files green; `pnpm turbo run build test lint type-check` 29/29; package lint + type-check clean; `pnpm gen:governance-baseline:check` (:check ONLY) exit 0 — frozen 1e62c5ad5bf7 / 141 / 201 / 60 unchanged (no new MCP tool/governance key; Rules #28/#31/#53 untriggered); no `bootstrap-classes.ts`/`BOOTSTRAP_VERSION`/`src/ExecuteMCPv2/**` contact; `extensions/iris-mcp-launcher` and `docs/client-config/` untouched (verified via git status); NUL/binary scan clean (Python byte scan over the new package excl. node_modules/dist). pnpm-lock.yaml +32 lines (the three deps only).
- Changes left UNCOMMITTED for the lead's per-story smoke gate + commit.

### File List

- packages/client-config/package.json (new)
- packages/client-config/tsconfig.json (new)
- packages/client-config/vitest.config.ts (new)
- packages/client-config/README.md (new)
- packages/client-config/src/index.ts (new)
- packages/client-config/src/types.ts (new)
- packages/client-config/src/adapters.ts (new)
- packages/client-config/src/paths.ts (new)
- packages/client-config/src/detect.ts (new)
- packages/client-config/src/readers.ts (new)
- packages/client-config/src/status.ts (new)
- packages/client-config/src/diff.ts (new)
- packages/client-config/src/__tests__/helpers.ts (new)
- packages/client-config/src/__tests__/adapters.test.ts (new)
- packages/client-config/src/__tests__/paths.test.ts (new)
- packages/client-config/src/__tests__/detect.test.ts (new)
- packages/client-config/src/__tests__/readers.test.ts (new)
- packages/client-config/src/__tests__/status.test.ts (new)
- packages/client-config/src/__tests__/diff.test.ts (new)
- packages/client-config/src/__tests__/fixtures/ (new — 13 per-client fixtures, 3 malformed fixtures, sandbox-home tree)
- pnpm-lock.yaml (modified — new package deps)
- _bmad-output/implementation-artifacts/33-0-adapter-registry.md (this story)
- _bmad-output/implementation-artifacts/sprint-status.yaml (status sync)

### Change Log

- 2026-07-27: Story 33.0 implemented — new `@iris-mcp/client-config` package: 13-adapter ClientAdapter registry (ADAPTER_DATA_VERSION 2026-07-25.1) + read-only detect/status/diff engine (JSONC/TOML/YAML native readers, client × iris-mcp-server matrix, pure pending-edit renderer executable by Story 33.1). 85 tests / 6 files; turbo 29/29; governance baseline frozen-unchanged; Rule #22 dist smoke 8/8.

### QA Results (2026-07-27, bmad-qa-generate-e2e-tests)

- Added `src/__tests__/e2e.test.ts` (21 tests) + 2-fixture `sandbox-project/` tree — the E2E/edge layer on top of dev's unit suite, discoverable by the default suite (`src/__tests__/**/*.test.ts`, NOT integration-suffixed; runs under `pnpm turbo run test`).
- **E2E chains (real fs, sandbox HOME):** detect → status → read the file at the REPORTED path → diff → execute the rendered edit with exactly 33.1's mechanism (applyEdits / TOML splice / YAML CST op) → re-read proving the status row flips and foreign entries survive — full disable→enable round-trips for claude-code (stash) and cline (native-flag), goose set-flag, codex insert-then-remove, and vscode status-unparseable ⇔ diff-refusal agreement. Plus a mechanical status↔diff mechanism-agreement invariant swept over every ok scope.
- **Project-scope chains (new `sandbox-project/` tree):** kimi-code detected THROUGH its `.mcp.json` fallback (most-specific-wins exercised end-to-end via status, previously only unit-tested at paths level); claude-code project-scope surgical removal leaves iris-LOOKING non-canonical neighbors (`IRIS-DEV-MCP`, `iris-dev-mcp-backup`) byte-intact; vscode mixed per-scope states (user unparseable + project ok); adding a projectDir provably never shifts any user-scope picture.
- **Adversarial edges (all passed — no product defects found):** rootKey collisions that are NOT canonical (case/affix/whitespace lookalikes classify foreign; canonical names under other top-level keys are invisible; lookalike secret values never leak); `[mcp_servers.iris-dev-mcp-extras]` neither owned nor inside the owned TOML removal region; Codex unverified `enabled = false` still reads present-enabled (documented v1 semantics); CRLF JSONC/TOML full diff chains; BOM JSONC/TOML executable removals (jsonc-parser offsets stay consistent); owned-entry-LAST surgical JSON removal (preceding-comma branch — previously uncovered — with and without a trailing comma, no dangling comma); deeply-nested + unicode-named foreign entries surfaced names-only and surviving an owned apply; EACCES-shaped readFile failure ⇒ per-scope `unparseable` with a read reason, never a crash.
- **Rule #54 applied:** dropped a draft test whose fake `readFile` returned a Buffer — the real `REAL_STATUS_FS.readFile` (`readFileSync(path, "utf8")`) can only produce a string, so the branch is unreachable by the real system.
- Gates: package 106 tests / 7 files green; `pnpm turbo run test lint type-check --filter=@iris-mcp/client-config` 4/4; full `pnpm turbo run test` 15/15. No production code changed.

### Review Findings (2026-07-27, bmad-code-review — reviewer-driven pass + 3 background layers)

Reviewer-driven findings (each reproduced LIVE against the built dist before patching; probes deleted after):

- [x] [Review][Patch] **TOML table headers with trailing comments were invisible to the splice region math** [packages/client-config/src/diff.ts — `findTomlEntryRegion`/`findTomlInsertLine`] — HIGH. A trailing comment on a table header (`[mcp_servers.iris-dev-mcp] # managed by iris-mcp`) is legal, idiomatic TOML, but the header regexes required `]` at end-of-line, so the region finders missed the owned table. Proven live pre-patch: `apply` (update) on such an entry rendered an **insert** that, executed with exactly 33.1's mechanism, produced INVALID TOML ("trying to redefine an already defined table") — the AC 33.0.3 "directly executable" contract broken; `disable` rendered a null-region remove descriptor that silently kept the entry. Patch: header regexes accept an optional trailing comment (`\s*(#.*)?$` — the comment belongs to the owned table and stays inside the region), PLUS a fail-safe: a parser-present entry with no locatable header region (dotted-key definitions, quoted table names — forms the splice cannot target) now REFUSES with a named reason for both update and removal, never an insert/no-op guess. 4 new tests; mutation-verified (regex reverted ⇒ the 2 comment-header tests red ⇒ restored); green probe against rebuilt dist.
- [x] [Review][Patch] **`already-in-state` rendered executable-looking descriptors that were destructive if executed** [packages/client-config/src/diff.ts — `DiffResult`, `jsoncEdit`/`tomlEdit`/`yamlEdit`] — MEDIUM. The seam contract says the renderer's output is "directly executable by 33.1's apply path", but the no-op mechanism shipped real descriptors: YAML `{op:"set", value:null}` (proven live: a naive executor running the documented 33.1 mechanics sets the owned entry to `null` — DESTROYS it) and TOML `{op:"insert", all-null}` (splices stray blank lines at file start); only the JSON `edits:[]` form was safe. Patch: `DiffResult.native` is now `NativeEdit | null` — `null` exactly when `mechanism === "already-in-state"`, making the no-op unexecutable by construction and forcing 33.1 to branch on `mechanism` (type-enforced). 2 new tests pin the null for all three format families; purity/refusal behavior otherwise unchanged.
- [x] [Review][Patch] **Pre-existing flake exposed by the new package's added parallel load: `governance-cli-universe.test.ts` heavy render timed out at vitest's 5s default** [packages/shared/src/__tests__/governance-cli-universe.test.ts] — LOW severity, gate-blocking frequency. The "full-universe render over the real built dist" describe legitimately takes ~4–8s (spawns the real CLI over five built dists); with the new package's vitest suite adding a 15th parallel test task, full uncached `pnpm turbo run test` failed `@iris-mcp/shared#test` in 3 of 4 runs ("Test timed out in 5000ms"). Standalone (direct, single-package turbo, concurrency=1): 1300/1300 every time. Patch: describe-level `{ timeout: 60_000 }` with an explanatory comment — scoped, no production code touched; full uncached gate green twice since. (Alternative — defer to a shared-hardening story — rejected: the flake would hit the lead's per-story smoke gate.)

Deferred (added to `deferred-work.md` ledger):

(none — zero defer-bucket findings)

Dismissed as noise (reviewer pass, 4): (a) `readJsonLike` tolerates comments/trailing commas for `"json"`-format clients — deliberate lenient-read design, documented at the reader; (b) `joinScope`'s unused `_scopeDef` parameter — style nit; (c) homeDir `"/"` root edge in `resolvePathTemplate` — unreachable via `os.homedir()` in practice; (d) pre-existing `packages/shared/src/cli/governance.ts:909` unused-eslint-disable warning — in the committed tree, untouched by this story, doesn't fail the gate.

Background review layers: **all three recorded as FAILED LAYERS** (Blind Hunter, Edge Case Hunter, Acceptance Auditor — spawned in parallel at review start; none returned findings within three windows (~45 min) nor replied to status pings; the agents are owned by the lead's session and could not be stopped from here — any LATE return goes to the lead's triage per the 32.3/32.4 precedent). The reviewer-driven pass covered their mandates directly: blind adversarial reads of every source/test/fixture file, live adversarial probes of edge inputs (trailing-comment TOML headers, dotted-key TOML entries, naive descriptor execution — all three producing the defects patched above), and an acceptance audit of the registry data row-by-row against binding spec §3.2 plus every story constraint (Rules #16/#36/#44/#51/#52/#54/#55, the Rule #52 seam, the Integration-AC escape clause, governance/extension/docs non-contact).

Triage totals: 0 decision-needed · 3 patch (ALL APPLIED + verified, listed above) · 0 deferred · 4 dismissed.

Review gate evidence (fresh, this review): package 111 tests / 7 files green (106 QA baseline + 5 review regressions); full `pnpm turbo run build test lint type-check` 29/29 (uncached); package lint + type-check clean; `gen:governance-baseline:check` (:check only) exit 0 — frozen 1e62c5ad5bf7 / 141 / 201 / 60 unchanged; extensions/ + docs/client-config/ + pnpm-workspace.yaml + turbo.json untouched; NUL-byte scan over all 43 untracked package files clean; reviewer Rule #22 dist smoke 9/9 in a fresh Node process (registry count, version stamp, sandbox detection, cline present-disabled, vscode unparseable, no secret leak, stash-remove render, text owns-only; script deleted); 3 consecutive package suite runs 106/106 (pre-patch flake check); story's recorded spec deviation (EnvExpansion `"shell"` for Gemini) verified genuine — spec §3.2 interface lists claude/vscode/none while its own Gemini row says "shell `$VAR` convention".
