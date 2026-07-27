# Story 32.1: `iris-mcp-governance` CLI

Status: done

## Story

As an operator or CI pipeline,
I want a scriptable `iris-mcp-governance` CLI that validates, inspects, and edits a governance file using the SAME engine the servers enforce with,
so that policy management is agent-agnostic and automatable without hand-editing JSON.

## Acceptance Criteria

1. **AC 32.1.1** — Commands over a governance file: `validate` (exit 1 on invalid, printing the same error text the servers would); `get <key>` / `set <key> true|false` / `unset <key>` with `--profile <name>` for the profiles layer; `preset read-only|full` (writes nothing to the file — prints guidance that preset is env-level — OR takes `--file-default` per implementation decision recorded in Dev Notes); `effective [--profile]` rendering the same cascade the servers compute by importing the shared functions (single-sourced — no reimplementation); `diff` (file vs defaults).
2. **AC 32.1.2** — Writes are atomic (temp file + rename), preserve key ordering where feasible, and `validate` runs automatically post-write with rollback on failure; `--json` output mode on read commands.
3. **AC 32.1.3** — Rule #22 dist smoke in a fresh Node process: create file → `set` a write-tool key false → `effective` shows it disabled with `configSource: "file"` → launch a built server with `IRIS_GOVERNANCE_FILE` pointing at it → `iris_server_profiles` reports the same effective policy (live cross-check).
4. **AC 32.1.4** — Docs: CLI reference section + recipes showing the same file path wired into Claude Code (`.mcp.json`), Cursor, and Codex (`config.toml` env table) config snippets.

**Plus carried Epic-32-own item `32-0-1`** (deferred from Story 32.0's review, assigned here): `iris_env_promote` Gate 4 re-reads the governance file on every `execute` call while all other surfaces use the startup snapshot — contradicting the documented restart-only semantics at one enforcement point. Resolve via the design choice recorded in deferred-work.md (ToolContext snapshot threading vs. memoized accessor with a CLI no-cache mode); terminal disposition required (this is the first gate for an Epic-32-own item, re-deferral count 0 → a single considered carry is permissible per the AC-22.1.7 shape, but prefer terminal here).

## Integration ACs

AC 32.1.3 IS this story's Integration AC (consumer produces observable effect): a BUILT server launched with the CLI-written file reports the identical effective policy via `iris_server_profiles` — the CLI → file → server round-trip is verified live over a real MCP handshake, not only asserted unit-level. The CLI imports the SAME exported loader/cascade/`configSource` functions from `@iris-mcp/shared` that the servers use (single-sourced, Rule #45 spirit — no reimplemented cascade).

## Tasks / Subtasks

- [x] Task 1: CLI skeleton + `validate` (AC: 1)
  - [x] `packages/shared/src/cli/governance.ts` + `governance-cli.ts` bin entry (mirroring `credentials-cli.ts` wiring: shebang, `bin` field in `packages/shared/package.json`, packaging test that EXECUTES the bin from dist — the 31-2 review's lesson)
  - [x] `validate [--file <path>]` — default file resolution: `--file` flag > `IRIS_GOVERNANCE_FILE` env; exit 1 printing the server's exact `loadGovernanceFile` error text
- [x] Task 2: Read commands (AC: 1, 2)
  - [x] `get <key> [--profile <name>] [--json]`, `effective [--profile <name>] [--json]` (imports `effective`/`configSource`/seed functions from shared — NO reimplemented cascade), `diff [--json]` (file vs defaults)
- [x] Task 3: Write commands (AC: 1, 2)
  - [x] `set <key> true|false [--profile <name>]`, `unset <key> [--profile <name>]` — atomic write (temp + rename), key-order preservation where feasible, auto-`validate` post-write with rollback on failure
  - [x] `preset read-only|full` — print env-level guidance OR `--file-default` per the Dev Notes decision; record the choice in the story
  - [x] Key validation on writes: reject reserved keys (same rule as the parser) and warn-or-reject unknown keys (decide + document; unknown keys are inert-but-confusing in a file)
- [x] Task 4: Item 32-0-1 (Gate-4 snapshot semantics)
  - [x] Terminal disposition per deferred-work.md's design options; regression test
- [x] Task 5: Docs (AC: 4)
  - [x] CLI reference (commands, exit codes, `--json`) in root README + `packages/shared/README.md` (the 31-3-9 lesson: the shared README must mention suite CLIs)
  - [x] Recipes: same file path in Claude Code `.mcp.json`, Cursor, Codex `config.toml` env snippets
- [x] Task 6: Rule #22 dist smoke (AC: 3) — full round-trip from the AC, in a fresh Node process against BUILT dist, recorded in Completion Notes (disposable script deleted after)

### Review Findings

Code review 2026-07-27 (bmad-code-review, story key `32-1-governance-cli`; diff = uncommitted working tree vs `ddaf389`). All three spawned review layers (blind-hunter, edge-case-hunter, acceptance-auditor) failed to return findings within the review window (third consecutive story — see cycle-log); their mandates were executed reviewer-direct per the carried retro directive. Reviewer-direct verification: single-sourcing confirmed (no reimplemented cascade anywhere in the CLI — `effective`/`diff` compose the shared `effective()`/`configSource()`/`defaultSeed()` with `GOVERNANCE_BASELINE`/`BASELINE_ACTION_CLASSIFICATIONS`; every parse via `loadGovernanceFile`); atomic-write discipline confirmed (temp same-dir + rename, `finally` cleanup, rollback restores original bytes or removes a just-created file; QA's "post-write rollback unreachable through the real CLI" claim verified ACCURATE — the production validator provably passes on CLI-serialized content, so rollback is defense-in-depth against external interference, pinned by the injectable-validator unit tests — not a defect); 32-0-1 threading confirmed complete (the ONLY production `buildToolContext` caller is `handleToolCall`, which passes the startup snapshot; `loadGovernanceFile` has exactly one production call site — `McpServerBase.start()`; conditional spread keeps direct-caller shape byte-identical; the regression test is mutation-sensitive per dev's red-check); `__proto__`/`constructor`/`prototype` rejected on keys AND profile names before any write, all mutation via `Object.defineProperty`; exit-code/`--json` conventions match the credentials CLI (0/1/2, JSON on operational outcomes for read commands, usage errors plain text); unknown-key warn text honest about inertness; docs recipes syntactically plausible and pinned by the QA guard; ADR D4 untriggered, D7 fail-fast parity confirmed, J1 explicit-path confirmed; Integration AC 32.1.3 honored durably (Case G + H + I in the DEFAULT suite, verified GENUINE — real spawnSync of the built bin + real MCP handshake + live IRIS, 8/8 process-gate executed not skipped); frozen baseline `1e62c5ad5bf7` byte-unchanged (`gen:governance-baseline:check` exit 0 — 141 frozen / 201 live / 60 post-foundation); NUL/binary scan clean; tallies mechanically recounted (Rule #51): shared 63 files/1252 (52+5 dev, +7 QA e2e, +2 review-added), dev 37/609 (+1), iris-mcp-all 16/105 (+3 process-gate, +5 docs guard, +1 file).

- [x] [Review][Patch] `set --file <directory>` surfaced `unexpected error — EISDIR` [packages/shared/src/cli/governance.ts cmdSet] — cmdSet read the raw file bytes BEFORE the loader, so a directory target escaped to the bin's catch-all instead of failing with the loader's clean text. Fixed: loader first, then raw read (the cmdUnset discipline); unit pin added (`governance-cli.test.ts` — clean `could not read the file` text) and QA's e2e directory test now pins the message (was deliberately unpinned).
- [x] [Review][Patch] `--file ""` reported a phantom-VALID empty path [packages/shared/src/cli/governance.ts resolveFilePath] — an empty `--file` value fell through to the loader's empty-means-unset rule, so `validate --file ""` exited 0 ("valid, 0 keys") instead of the usage error an empty env value correctly gets. Fixed: empty flag value treated as unset → exit 2; unit pin added.

Dismissed as noise (reviewer-direct): (1) key-order preservation pinned at the global layer only — the profile-layer path uses the identical `defineProperty`/null-prototype mechanism (`defineLayerValue` is the single mutation primitive) and profile round-trips are covered by `toEqual`; (2) `get --json` error payload omits the success-path `layer` field — matches the documented contract ("carries an error field"); (3) `set` on a symlinked governance file replaces the symlink (standard atomic-rename semantics, shared with mainstream tooling); (4) `--profile` consuming a following dash-token as its value — identical convention to the credentials CLI parser, `--` terminator documented in `--help`.

## Dev Notes

### Verified current-state pointers (lead-verified 2026-07-27, Rule #47)

- 32.0 exports available from `@iris-mcp/shared` (`packages/shared/src/index.ts`): `loadGovernanceFile` (L69), `configSource` (L78), plus the pre-existing `effective`, `getEffectivePolicy`, `presetSeed`, `defaultSeed`, `parseGovernanceConfig`, `hasExplicitOverride`.
- CLI precedent: `packages/shared/src/cli/credentials-cli.ts` (bin entry, shebang) + `credentials.ts` (commands); `packages/shared/package.json` `"bin": { "iris-mcp-credentials": "./dist/cli/credentials-cli.js" }` — add `iris-mcp-governance` alongside. Packaging test must EXECUTE the bin via `spawnSync` from dist (31-2 review finding: a packaging test that never ran the bin was a HIGH).
- 32-0-1 full text: `deferred-work.md` section "Deferred from: code review of 32-0-governance-file-loader" — design options: (a) thread the startup snapshot through ToolContext to Gate 4, or (b) memoized file accessor with a CLI no-cache mode.
- Secret discipline precedent (31-2): the CLI never prints env `IRIS_GOVERNANCE` values beyond what the file holds — a governance file is NOT a credential, but keep error text free of file contents (32.0 convention).
- Binding spec: F2-D2 (research doc L343) — `validate`, `get/set/unset [--profile]`, `preset`, `effective` (reusing shared functions — single-sourced per rule #45 spirit), `diff`.

### Constraints

- **Single-sourcing is the point of this story.** Any cascade logic reimplemented in the CLI (rather than imported) is a HIGH at review. The CLI composes shared exports; it does not duplicate them.
- **Exit codes**: mirror the credentials CLI convention (0 success, 1 operational failure/invalid, 2 usage error) — verify against `credentials-cli.ts` and follow it exactly.
- **Atomic writes**: temp file in the SAME directory (rename is only atomic same-volume) + `fs.renameSync`; rollback = the original file restored if post-write validate fails; error path must not leave a `.tmp` behind (the CR 10.2 `.manifest.json.tmp` lesson — clean up in `finally`).
- **Key ordering preservation**: JSON round-trips key insertion order for own string keys — parse → mutate → stringify preserving existing key order; new keys append. `__proto__`-safety: never `obj[key] =` with an arbitrary key (use `Object.defineProperty` or `Object.fromEntries` rebuild, mirroring governance.ts's discipline).
- **No new governance keys/tools** (Rules #28/#31/#53 untriggered); frozen baseline `1e62c5ad5bf7` byte-unchanged (`gen:governance-baseline:check`, the `:check` ONLY, Rule #25).
- **Rule #54/#36**: bin-shape tests must reflect the real CLI's actual output (capture expected values by RUNNING the built bin, not by reasoning).
- **Rule #55**: file-writing tools only; NUL-scan your diff.
- **Default file resolution** (`--file` > `IRIS_GOVERNANCE_FILE`): state it in `--help` and docs. J1 consistency: the CLI never discovers/searches for a file — explicit path only.
- Docs default state at point of use (Rules #30/#43): the CLI is opt-in; with no file configured, servers are unaffected.

### Previous-story intelligence

- 32.0 (just landed): loader/cascade/configSource in `governance.ts`; process-gate harness in `packages/iris-mcp-all/src/__tests__/governance-file-process-gate.test.ts` is the pattern for any process-level CLI test you add; dev's own smoke pattern (disposable script, real stdio handshake) is what AC 32.1.3 formalizes.
- 31.2 (credentials CLI): stdin/prompt/exit-code/redaction conventions and the review lessons (bin must be executed in tests; server-name validation; `--json` emits JSON on failure too — apply the same discipline here: `validate --json` on an invalid file still emits parseable JSON to stdout and exits 1).

### Project Structure Notes

- Code: `packages/shared/src/cli/governance.ts`, `packages/shared/src/cli/governance-cli.ts`, `packages/shared/package.json` (bin), possibly `packages/iris-dev-mcp/src/tools/env-promote.ts` + `packages/shared/src/server-base.ts` (32-0-1 fix). Tests: `packages/shared/src/__tests__/governance-cli*.test.ts`, packaging test, optionally a process-level round-trip in `packages/iris-mcp-all/src/__tests__/` (Rule #45).
- Docs: root `README.md`, `packages/shared/README.md`, `docs/client-config/*.md` (recipes home — verify which file fits, Claude Code/Cursor/Codex snippets).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 32.1]
- [Source: _bmad-output/planning-artifacts/research/technical-iris-server-manager-mcp-connections-research-2026-07-25.md#F2-D2]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#32-0-1]
- [Source: packages/shared/src/cli/credentials-cli.ts / credentials.ts (CLI conventions)]
- [Source: .claude/rules/project-rules.md#22 / #25 / #30 / #31 / #45 / #54]

## Dev Agent Record

### Agent Model Used

k3[1m] (dev stage, 2026-07-27)

### Debug Log References

None — no live-IRIS debugging required; the AC 32.1.3 smoke and the durable Case G process gate were the live surfaces (both green on first green run; one unit-test fix during dev, one TS `exactOptionalPropertyTypes` fix, one smoke-script SDK-resolution fix — all below).

### Completion Notes List

**Task 1/2/3 — the CLI (AC 32.1.1/32.1.2).** New `packages/shared/src/cli/governance.ts` (commands module, `runCli(argv, deps)` pure/injectable — mirrors `credentials.ts` conventions: manual argv parser with `--` terminator, exit codes 0/1/2, `--json` emits exactly one parseable JSON object on every OPERATIONAL outcome incl. failures, usage errors plain-text on stderr) + `governance-cli.ts` (shebang bin entry mirroring `credentials-cli.ts`) + `"iris-mcp-governance": "./dist/cli/governance-cli.js"` bin in `packages/shared/package.json`. Commands: `validate`, `get`, `set`, `unset`, `preset`, `effective`, `diff`. **Single-sourcing is structural:** every file parse goes through `loadGovernanceFile` (validate prints the server's exact startup error text — pinned by tests against the literal `IRIS_GOVERNANCE_FILE is invalid: … (path: …)` shape); `effective` composes the shared `effective()`/`configSource()` with `GOVERNANCE_BASELINE`/`BASELINE_ACTION_CLASSIFICATIONS`; `diff` uses the shared `defaultSeed()`. One test computes the expected render via a DIRECT shared-engine call and asserts the CLI's `--json` output matches key-for-key — the no-drift proof. `RESERVED_KEYS` was promoted from module-private to exported in `governance.ts` (additive; single-sourced reserved-key rule for write commands). Default file resolution `--file` > `IRIS_GOVERNANCE_FILE`, explicit path only (J1), stated in `--help` + READMEs. **Writes:** temp file in the SAME directory + `fs.renameSync`, temp removed in `finally` on every path (readdir-pinned: no stray `.tmp-` on success or rollback); post-write re-validation through the real loader with rollback to the original bytes (or removal of a just-created file) on failure — the rollback contract is pinned by `writeGovernanceFileAtomic` unit tests with a synthetic failing validator, and the production validator is proven to PASS on CLI-serialized content by a separate round-trip test. Key order preserved (existing keys keep position, new keys append — Object.keys order pinned); all mutation via `Object.defineProperty`, reserved keys rejected exit 2 before any write. **Recorded decisions (the two the story asked to decide + document):** (a) `preset` prints env-level guidance and writes NOTHING — the servers source the preset exclusively from `IRIS_GOVERNANCE_PRESET` env (`parseGovernancePreset` has no file slot in the cascade), so a file write would be inert-and-confusing; no `--file-default` form. (b) Unknown keys: WARN-not-reject on `set` for keys outside the frozen baseline (stderr, non-fatal, write proceeds) — post-foundation keys (e.g. `iris_env_promote:execute`) are legitimate but unenumerable by a standalone CLI (importing a server package would be a Rule #45 circular dependency); rejecting would block real keys, silence would hide typos. `unset` of an absent key exits 1 (mirrors `iris-mcp-credentials delete` not-found convention) which covers typo'd names there. **Post-foundation caveat:** `effective`/`diff` render over baseline ∪ keys mentioned in any config layer; a post-foundation key mentioned nowhere renders with the read-default seed — stated in `--help`, the output `note`/footer, and both READMEs; `iris_server_profiles` named as the authoritative full-universe render.

**Task 4 — item 32-0-1 TERMINAL (design option (a), ToolContext snapshot threading).** Chose ToolContext threading OVER the ledger's "preferred" memoized accessor; rationale (also mirrored into deferred-work.md): hermetic (no module-level mutable cache / no reset-for-tests API / no cross-test poisoning when two servers in one process use different `IRIS_GOVERNANCE_FILE` values); snapshot semantics become part of the type contract; the regression test is structural; the CLI needs no "no-cache mode" (a one-shot process calling `loadGovernanceFile` directly IS the correct fresh-read semantics). Changes: `ToolContext.governanceFileConfig?` (optional, absent-by-default; type-only import of `GovernanceConfig` — both directions of the tool-types↔governance import are `import type`, zero runtime cycle); `buildToolContext` 7th optional param with conditional spread (direct-caller shape byte-for-byte pre-32.1); `McpServerBase.handleToolCall` passes `this.governanceFileConfig` (the startup snapshot); `env-promote.ts` Gate 4 reads `ctx.governanceFileConfig` and the `loadGovernanceFile` import is removed. Regression test: snapshot disables `iris_config_manage:set`, the on-disk file is then rewritten to re-enable it, the verdict STILL refuses with zero client resolution — **mutation-verified** (temporarily restored `loadGovernanceFile()` in Gate 4 ⇒ the new test went RED; reverted ⇒ 37/37 green). The pre-existing file-channel test was updated to build its snapshot via the REAL loader (file → snapshot → Gate 4 wiring stays in the loop). Re-deferral count stays 0.

**Task 5 — docs (AC 32.1.4).** Root README: new `#### iris-mcp-governance CLI` subsection (command table, exit codes, `--json` contract, file resolution, atomic-write note, preset-is-env note, post-foundation caveat, opt-in default state) + a cross-link from the `Governance file (IRIS_GOVERNANCE_FILE)` section. `packages/shared/README.md`: new `## Governance File & the iris-mcp-governance CLI` section (31-3-9 lesson — shared README names both suite CLIs). Recipes wiring the SAME file path: `docs/client-config/claude-code.md` + `cursor.md` (new "Governance File (optional)" subsection with `.mcp.json` env block + CLI maintain commands) and `docs/client-config/README.md` Codex CLI section (`config.toml` env-table row).

**Task 6 — Rule #22 dist smoke (AC 32.1.3), fresh Node process against BUILT dist.** Disposable script `packages/iris-mcp-all/tmp-32-1-smoke.mjs` (deleted after): CLI `set iris_doc_put false --file <tmp>` CREATED the file (exit 0) → `validate` exit 0 → `effective --json` rendered `policy.iris_doc_put === false` with `configSource === "file"` → built `iris-dev-mcp` launched over real stdio with `IRIS_GOVERNANCE_FILE` → real MCP handshake → `iris_server_profiles` reported the IDENTICAL `false`/`"file"` pair (control key `iris_doc_get` stayed `true`/`"default"`). **11/11 PASS lines, `SMOKE 32.1 (AC 32.1.3): ALL CHECKS PASSED`.** Additionally made the round-trip DURABLE: new Case G in `packages/iris-mcp-all/src/__tests__/governance-file-process-gate.test.ts` (default suite, Rule #21 shape) drives the BUILT bin via `spawnSync` (set → validate → effective) then asserts the built server reports the identical policy over a real handshake — 6/6 executed (not skipped) against live IRIS HSCUSTOM.

**Gates.** `pnpm turbo run build test lint type-check`: 25/25 green. Counts (mechanically derived from vitest output): `@iris-mcp/shared` 62 files / 1243 tests (+2 files, +57: 52 CLI unit + 5 packaging — was 60/1186); `@iris-mcp/dev` 37/609 (+1: the 32-0-1 snapshot regression — was 608); `iris-mcp-all` 15/98 (+1: Case G — was 97). `pnpm gen:governance-baseline:check` (`:check` ONLY, Rule #25) exit 0 — frozen `1e62c5ad5bf7` / 141 frozen / 201 live / 60 post-foundation UNCHANGED (no new governance keys/tools; Rules #28/#31/#53 untriggered — a CLI is not an MCP tool). No `bootstrap-classes.ts`/`BOOTSTRAP_VERSION`/`src/ExecuteMCPv2/**` change. NUL-byte scan + binary-diff scan clean (Rule #55). Deferred-work.md: 32-0-1 annotated RESOLVED with the design-choice rationale. Changes left UNCOMMITTED for the lead's per-story smoke gate + commit.

### File List

- `packages/shared/src/cli/governance.ts` (new — CLI commands module)
- `packages/shared/src/cli/governance-cli.ts` (new — shebang bin entry)
- `packages/shared/package.json` (bin entry `iris-mcp-governance`)
- `packages/shared/src/governance.ts` (`RESERVED_KEYS` promoted to exported; comment)
- `packages/shared/src/tool-types.ts` (`ToolContext.governanceFileConfig?` — 32-0-1)
- `packages/shared/src/server-base.ts` (`buildToolContext` 7th param + `handleToolCall` threads the startup snapshot)
- `packages/shared/src/__tests__/governance-cli.test.ts` (new — 52 unit tests)
- `packages/shared/src/__tests__/governance-cli-dist-packaging.test.ts` (new — 5 packaging tests, executes the built bin)
- `packages/iris-dev-mcp/src/tools/env-promote.ts` (Gate 4 reads `ctx.governanceFileConfig`; `loadGovernanceFile` import removed)
- `packages/iris-dev-mcp/src/__tests__/env-promote-execute.test.ts` (file-channel test updated to snapshot threading; new 32-0-1 regression test)
- `packages/iris-mcp-all/src/__tests__/governance-file-process-gate.test.ts` (new Case G: CLI → file → server round-trip)
- `README.md` (new `iris-mcp-governance CLI` section + governance-file cross-link)
- `packages/shared/README.md` (new Governance File & CLI section)
- `docs/client-config/claude-code.md` (Governance File recipe)
- `docs/client-config/cursor.md` (Governance File recipe)
- `docs/client-config/README.md` (Codex `config.toml` env-table recipe)
- `_bmad-output/implementation-artifacts/deferred-work.md` (32-0-1 → RESOLVED with rationale)

## Change Log

- 2026-07-27: Story 32.1 implemented — `iris-mcp-governance` CLI (validate/get/set/unset/preset/effective/diff) shipped as a bin in `@iris-mcp/shared`, single-sourced on the shared governance engine; atomic writes with post-write validate + rollback; deferred item 32-0-1 resolved TERMINALLY via ToolContext snapshot threading (mutation-verified); durable Case G process-gate round-trip + AC 32.1.3 dist smoke green (11/11); docs on 5 surfaces; baseline frozen `1e62c5ad5bf7` unchanged; 59 new tests (52 + 5 + 1 + 1).
- 2026-07-27: Code review complete — review → done. All three spawned layers failed to return (third consecutive story); mandates covered reviewer-direct. 2 LOW patches applied (cmdSet EISDIR message path; empty `--file ""` phantom-validate) each with unit + e2e pins; 0 deferred; 4 dismissed. Post-patch gates: shared 63/1252, dev 37/609, iris-mcp-all 16/105, process-gate 8/8 executed live, lint + type-check green, baseline `1e62c5ad5bf7` unchanged, NUL scan clean. Details in "Review Findings" above.
