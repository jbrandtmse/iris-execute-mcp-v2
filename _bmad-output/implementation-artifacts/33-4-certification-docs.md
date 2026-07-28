# Story 33.4: Adapter Certification + Docs

Status: done

## Story

As an iris-mcp maintainer,
I want each client adapter live-certified (or honestly dispositioned), a doctor drift guard against config-surface drift, and the docs rolled up around `iris-mcp-clients`,
so that the 13-adapter table is proven rather than plausible and users have one authoritative wiring guide.

## Acceptance Criteria

1. **AC 33.4.1** — Live certification per locally available client (minimum: Claude Code, VS Code/Copilot, Cursor, Cline, Codex, Kimi if installable): scripted or recorded manual pass of add → client lists tools → disable → absent → restore; results in a disposition table (certified-live / fixture-only-with-residual-risk note) in the package README (Rule #34 discipline — no silent certification).
2. **AC 33.4.2** — Config-surface drift guard: `doctor` warns when a client's config file exists but fails adapter expectations (unknown root key/shape), citing the adapter data version; drift fix procedure documented (data patch + fixture update, no engine change).
3. **AC 33.4.3** — Docs rollup (Rule #30): `@iris-mcp/client-config` README (adapter table with per-client paths/formats/disable mechanism/restart hints, certification dispositions); root README section; per-client recipes superseded by `iris-mcp-clients apply` guidance with the old manual snippets retained as fallback; CHANGELOG.
4. **AC 33.4.4** — Kimi Code dual-surface verification: one config written to `~/.kimi-code/mcp.json` is confirmed visible in BOTH the Kimi Code CLI/TUI and its VS Code extension; repo `.mcp.json` sharing between Claude Code and Kimi Code verified and documented (binding-spec claim, proven live per Rule #14/#16).

## Integration ACs

**AC 33.4-I1** — The drift guard consumes the 33.0 readers + 33.2 doctor surface: a config that parses but lacks the adapter's expected root key (or has an unexpected shape at that key) produces a doctor finding naming the client, the path, the expectation, and `ADAPTER_DATA_VERSION` — verified end-to-end through the built CLI's `--json` envelope, not only unit tests.

## Tasks / Subtasks

- [x] Task 1: Drift guard (AC: 2, I1)
  - [x] New doctor check: for each detected config that parses OK, verify the adapter's `rootKey` exists and holds the expected shape (object of entries for JSON/JSONC/TOML; map for YAML); parse-OK-but-wrong-root/shape ⇒ warning finding `{check: "config-drift", client, path, expected, found, adapterDataVersion}` — distinct from `unparseable`
  - [x] A config where the rootKey is absent entirely is NOT drift when the file has other content (a client config that simply has no MCP section yet is normal) — drift = rootKey present with wrong shape, OR file parses but every expectation fails (document the exact rule chosen); empty file / missing file ⇒ no finding
  - [x] `--json` envelope carries the finding; exit code 1 (finding present) consistent with existing doctor semantics
  - [x] Docs: drift-fix procedure in the package README (bump adapter data + fixture update; no engine change; cite `ADAPTER_DATA_VERSION`)
  - [x] Tests: wrong-shape fixtures per format family through the built CLI envelope (AC 33.4-I1)
- [x] Task 2: Certification harness + locally-available passes (AC: 1, 4)
  - [x] Scripted certification where the client exposes a verifiable surface: **Claude Code** (`claude mcp list` after add; disable → absent from list; restore), **Kimi Code CLI** (`~/.kimi-code/bin/kimi` exists locally — probe `kimi mcp list` or equivalent read surface; AC 33.4.4's CLI/TUI half), **VS Code/Copilot** (file-level + any automatable surface; the agent-side tool listing is manual — record honestly), **Cline** (file-level round-trip; agent-side listing manual)
  - [x] AC 33.4.4: with the entry in `~/.kimi-code/mcp.json`, verify visibility in the Kimi CLI/TUI AND the Kimi Code VS Code extension (if the extension is not installed locally, record fixture-only-with-residual-risk for the extension half — never claim); repo `.mcp.json` sharing: write via the manager at project scope, verify BOTH Claude Code and Kimi Code read it (Claude side verifiable via `claude mcp list`; Kimi side via its CLI), document
  - [x] **Safety**: certification writes touch REAL client configs — always through the engine (backup-on-write) and ALWAYS restore the pre-pass state (byte-exact) at the end, pass or fail; the 33.3 lead-smoke incident (real-config overwrite) is the cautionary precedent — sandbox-first, real-config only for the certification step itself, restore immediately
  - [x] Cursor / Codex / others not installed locally: fixture-only-with-residual-risk dispositions (do NOT install clients without Project Lead approval — surface the choice)
  - [x] Disposition table (mechanically derived from the certification results, Rule #51) into the package README
- [x] Task 3: Docs rollup (AC: 3)
  - [x] Package README: full adapter table (per-client paths per OS, format, root key, disable mechanism, restart hint, certification disposition) — generated or mechanically cross-checked against `CLIENT_ADAPTERS` (Rule #51/#44 discipline)
  - [x] Root README section: the zero-secrets end state (server-manager + governance-file + manager wiring) + command quickstart
  - [x] `docs/client-config/`: supersede the per-client recipes — each page's header points to `iris-mcp-clients apply`; the old manual snippets retained below as fallback
  - [x] CHANGELOG/changeset rows for the story
- [x] Task 4: Gates
  - [x] `pnpm turbo run build test lint type-check`; `gen:governance-baseline:check` (`:check` ONLY) exit 0; NUL scan; extension suite untouched unless a docs link changes

## Dev Notes

### Verified context (lead-verified 2026-07-28)

- Locally available clients: **Claude Code** (config `~/.claude.json`, `claude` CLI on PATH), **VS Code** (`%APPDATA%\Code\User\mcp.json` exists), **Cline** (globalStorage settings exist), **Kimi Code** (`~/.kimi-code/` with `bin/kimi`, `mcp.json`, `config.toml`). NOT installed: Cursor, Codex, Roo, Windsurf, Gemini, Zed, Goose, Kimi CLI, Claude Desktop (per lead smoke detect output 2026-07-28).
- `~/.kimi-code/mcp.json.bak-20260726` exists — a prior manual experiment; leave it untouched.
- Doctor currently lives in `packages/client-config/src/cli/clients.ts` (cmdDoctor) with checks: parseability, env-ref resolvability, stale backups, orphaned stashes, R5 unrecorded entries. The drift guard is a new check in the same structure.
- `docs/client-config/` holds the old recipes: `README.md`, `claude-code.md`, `claude-desktop.md`, `cursor.md`.
- AC 33.3.4's GUI smoke is STILL OPEN (Project Lead) — VS Code/Copilot certification's agent-side half coordinates with it; do not claim it here.
- The 33.3 lead-smoke incident (real-config overwrite via a mis-built spawn env, fully restored from the engine's own backups) is recorded in the 33.3 story + cycle log — certification procedure must state the sandbox/restore discipline (Task 2).

### Constraints

- **No silent certification** (Rule #34): every client gets an explicit disposition — certified-live (evidence: command/output + date) or fixture-only-with-residual-risk (what the fixtures prove, what stays unproven).
- **Rule #56**: the certification table's client enumeration derives from `CLIENT_ADAPTERS`, and its verdicts from recorded runs — never hand-authored claims.
- **Rule #36/#49**: certification evidence is captured from real runs (commands + outputs quoted in the story/README), never edited to match.
- **Real-config writes** only via the engine (backups) with immediate restore; state.json side effects cleaned up after passes.
- **Rules #28/#31/#53 untriggered**; frozen baseline untouched.

### Project Structure Notes

- Drift guard: `packages/client-config/src/cli/clients.ts` (+ maybe `doctor.ts` if that's where checks live — follow the existing structure) + tests.
- Certification evidence: recorded in this story's Completion Notes + summarized in `packages/client-config/README.md`.
- Docs: `packages/client-config/README.md`, root `README.md`, `docs/client-config/*.md`, `.changeset/`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 33.4 (ACs 33.4.1–33.4.4)]
- [Source: _bmad-output/planning-artifacts/research/technical-iris-server-manager-mcp-connections-research-2026-07-25.md#§3.7 (certification discipline)]
- [Source: _bmad-output/implementation-artifacts/33-3-clients-ui.md (lead-smoke incident record)]

## Dev Agent Record

### Agent Model Used

Claude Code (k3[1m]) — bmad-dev-story, 2026-07-28.

### Debug Log References

- Real-machine certification evidence: `packages/client-config/scripts/certification-results.json` (commands + outputs per client, dates, hosts).
- Pre-pass snapshots + independent byte-exact verification: `%TEMP%/iris-334-cert-snapshot/` (six md5-verified restores after every pass; final sweep green).

### Completion Notes List

**Task 1 — drift guard (AC 33.4.2, 33.4-I1).** `readers.ts` gained `diagnoseConfigSurface(adapter, content)` on ONE shared parse path with `readConfigEntries` (reader + diagnoser can never disagree; the pre-existing reader tests pin the refactor). Doctor check 1 now re-diagnoses every status-matrix `unparseable` file: a syntax error stays `parseability`; a file that PARSES but fails the shape expectation becomes `config-drift` `{check, client, scope, path, expected, found, adapterDataVersion, detail}` — expected/found describe shapes only, never content. **The exact drift rule (story-licensed, documented in the package README):** drift = root key PRESENT with the wrong shape, OR top level not the format's object form (every expectation fails); root key ABSENT with other content = NOT drift (a normal no-MCP-section config — this adjudicates AC 33.4-I1's "lacks the expected root key" phrasing in favor of the more specific Task-1 subtask 2); empty/missing file = no finding. Exit code 1 with the finding in the `--json` envelope, consistent with existing doctor semantics. Restart hints include the drifted client. Drift-fix procedure documented in the package README (data patch + `ADAPTER_DATA_VERSION` bump + fixture update; no engine change).

**Task 2 — certification (AC 33.4.1, 33.4.4).** Committed harness `packages/client-config/scripts/certify.mjs`: per-client scripted pass against the REAL config — snapshot (config bytes, state.json, backup listing, Kimi session index) → engine apply → client-surface verification → engine disable → inactive verify → engine remove → byte-exact VERIFIED restore (ladder: remove round-trip → engine `restore --backup <earliest pass backup>` → loudly-reported raw-snapshot write-back) → side-effect cleanup (state.json restored, pass-created backups deleted, Kimi session artifacts removed). Bare invocation is a no-op plan; a pass requires `run` + `--real-config`. Live passes 2026-07-28 (win32/x64), each independently md5-verified byte-exact afterwards:
- **claude-code — certified-live.** `claude mcp list` (2.1.220) listed the manager-written `iris-mcp-all` (`× Failed to connect` — expected: the npx target is unpublished; sibling node-dist entries at the same path/rootKey showed `√ Connected` in the same run). First run FAILED the surface check because `spawnSync("claude")` cannot execute the npm `claude.cmd` shim on Windows (ENOENT — the 32.2 lesson); harness fixed to route via `cmd.exe /d /s /c`, re-run green, restore verified byte-exact after BOTH runs.
- **vscode — certified-live (file-level).** explicit mode with a DUMMY password (single write — env-reference would merge an inputs[] descriptor remove doesn't roll back); the restore ladder correctly engaged the engine restore for the zero-byte original. Agent-side tool listing stays OPEN as AC 33.3.4 (Project Lead GUI smoke) — not claimed.
- **cline — certified-live (file-level).** The native `disabled` flag leg genuinely exercised (present-disabled after disable).
- **kimi-code — certified-live (user scope).** File-level lifecycle + agent-surface probe: `kimi -p` (0.29.0) listed exactly the user-scope servers and called `iris_server_info` LIVE through the existing entries of the same `~/.kimi-code/mcp.json` the manager writes (returned IRIS 2026.1 Build 235U). Kimi has NO `mcp list` command and its log records startup lines only — the print-mode agent surface is the read surface.
- **AC 33.4.4 dual-surface.** CLI/TUI half verified live (above). VS Code extension half: `code --list-extensions` shows NO Kimi extension → fixture-only-with-residual-risk, never claimed. Repo `.mcp.json` sharing: Claude side verified live (`claude mcp list` in a scratch project dir showed the manager-written entry Pending approval, naming the exact file); **Kimi side FALSIFIED** — official docs document ONLY `.kimi-code/mcp.json` as the project path, and live print-mode probes loaded NO project-scope server: a distinctive WORKING probe server (`iris-sharing-probe`, node dist + literals) answered `TOOL-NOT-LOADED` to `mcp__iris-sharing-probe__iris_server_info` from BOTH `.mcp.json` and `.kimi-code/mcp.json`, even in a TUI-registered workspace. **Consequence (Rule #42/#16):** the adapter-data `.mcp.json` fallback was REMOVED (`ADAPTER_DATA_VERSION` 2026-07-25.2 → 2026-07-28.1; drift-fix data patch + test/fixture updates incl. a falsification pin: a co-located `.mcp.json` is never consulted for kimi-code), `epics.md` AC 33.4.4 amended in place with the dated falsification record, and the falsified claim corrected in `docs/client-config/README.md`. Project-scope loading may be TUI-only — recorded residual risk.
- **Not installed (fixture-only-with-residual-risk, explicit per Rule #34):** claude-desktop, cursor, roo-code, windsurf, codex, gemini, zed, goose, kimi. Installing clients is a Project Lead choice — surfaced, not done.
- Dispositions live in `scripts/certification-results.json` (real runs, never edited to match); the README tables are GENERATED from it ⨝ `CLIENT_ADAPTERS` by `scripts/render-certification-table.mjs` and kept in sync by `certification-docs.test.ts` (Rule #51/#56).
- Machine-state hygiene: all six real-config md5s verified byte-exact after every pass; manager state.json byte-exact; pass-created backups deleted (2 pre-existing backups untouched); Kimi session dirs + `session_index.jsonl` lines + `workspaces.json` scratch entries from the passes removed; `~/.kimi-code/mcp.json.bak-20260726` untouched.

**Task 3 — docs rollup (AC 33.4.3).** Package README: generated adapter table (per-OS paths, format, root key, disable, restart hint, certification) + generated certification dispositions + drift-fix procedure. Root README: "The manager: iris-mcp-clients (recommended)" section with the zero-secrets end state (server-manager + keychain; governance file; VS Code native inputs) + command quickstart. `docs/client-config/`: index header now points to the manager (snippets retained as manual fallback), the three per-client pages carry superseded-by-the-manager headers with per-client disposition pointers, and the falsified Kimi Code `.mcp.json` claim corrected (also the no-`${VAR}`-expansion caveat). Changeset `.changeset/clients-certification-drift.md` (minor; the wave's changelog convention is changesets — no root CHANGELOG entry, matching Epics 32/33).

**Task 4 — gates.** `pnpm turbo run build test lint type-check` 29/29 green [client-config 17 files/350 tests — +22 over the post-33.3 16/328, mechanically derived: readers +7, clients-cli +7, process e2e +5 (4 wrong-shape families + absent-root), certification-docs +3]; `gen:governance-baseline:check` (`:check` ONLY) exit 0 — frozen 1e62c5ad5bf7 / 141 / 201 / 60 unchanged (no new MCP tool/governance key; Rules #28/#31/#53 untriggered); NUL scan clean over every changed/new file; no extension files touched (no docs links changed); no `bootstrap-classes.ts`/`BOOTSTRAP_VERSION`/`src/ExecuteMCPv2/**` change. Changes left UNCOMMITTED for the lead's per-story smoke gate + commit.

### File List

- `packages/client-config/src/readers.ts` — shared parse path + new `diagnoseConfigSurface` (drift diagnosis).
- `packages/client-config/src/cli/clients.ts` — doctor config-drift check (check-1 reclassification), `DoctorFinding` gained expected/found/adapterDataVersion, doctor help text.
- `packages/client-config/src/index.ts` — export `diagnoseConfigSurface` + `ConfigSurfaceDiagnosis`.
- `packages/client-config/src/adapters.ts` — kimi-code `.mcp.json` fallback REMOVED (falsified live); `ADAPTER_DATA_VERSION` 2026-07-25.2 → 2026-07-28.1.
- `packages/client-config/src/types.ts` — `fallbacks` field doc updated (machinery kept, falsified example removed).
- `packages/client-config/scripts/certify.mjs` — NEW: the certification harness (real-config passes, snapshot/restore ladder, side-effect cleanup, results writer).
- `packages/client-config/scripts/render-certification-table.mjs` — NEW: README table/disposition generator (+ `--check`).
- `packages/client-config/scripts/certification-results.json` — NEW: per-client certification records (real runs + fixture-only dispositions).
- `packages/client-config/README.md` — drift-fix procedure, generated adapter table + certification dispositions (marker sections), status line.
- `packages/client-config/src/__tests__/readers.test.ts` — +7 `diagnoseConfigSurface` tests.
- `packages/client-config/src/__tests__/clients-cli.test.ts` — +7 doctor config-drift tests.
- `packages/client-config/src/__tests__/clients-cli-process.test.ts` — +5 process-level drift e2e (AC 33.4-I1; vscode configPath added).
- `packages/client-config/src/__tests__/certification-docs.test.ts` — NEW: +3 generated-docs sync/roster guards.
- `packages/client-config/src/__tests__/fixtures/drift/` — NEW: 6 drift fixtures (wrong-shape ×4 families, top-array, no-mcp-section).
- `packages/client-config/src/__tests__/fixtures/sandbox-project/.kimi-code/mcp.json` — NEW: kimi-code project fixture (falsification pin).
- `packages/client-config/src/__tests__/paths.test.ts`, `adapters.test.ts`, `e2e.test.ts` — fallback pins rewritten to the falsification record.
- `README.md` — "The manager: iris-mcp-clients (recommended)" section (zero-secrets end state + quickstart).
- `docs/client-config/README.md` — manager-first header, certification matrix update, Kimi Code falsification correction.
- `docs/client-config/claude-code.md`, `claude-desktop.md`, `cursor.md` — superseded-by-the-manager headers (manual fallback retained).
- `.changeset/clients-certification-drift.md` — NEW: changeset (minor).
- `_bmad-output/planning-artifacts/epics.md` — AC 33.4.4 amended in place (dated falsification record, Rule #42).
- `_bmad-output/implementation-artifacts/33-4-certification-docs.md` — this story file.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status bookkeeping.

## Change Log

- 2026-07-28 (dev): Story 33.4 implemented — doctor config-drift guard (AC 33.4.2/I1), certification harness + 4 certified-live passes + Kimi dual-surface verification with the `.mcp.json`-fallback falsification and adapter-data correction (AC 33.4.1/33.4.4), generated adapter/certification docs + docs rollup (AC 33.4.3). All gates green; changes uncommitted for the lead smoke gate.
- 2026-07-28 (review): bmad-code-review — all three spawned layers (bh-33-4, eh-33-4, aa-33-4) failed to return (FIFTH consecutive Epic-33 story); executed reviewer-direct per the 32.3 precedent. 0 decision-needed / 5 patch (1 MEDIUM + 4 LOW, all applied + verified) / 0 defer / 4 dismissed / 0 HIGH. Suite 18 files / 372 tests green post-patch (+1 R1 pin); render --check in sync; lint + type-check clean; NUL scan clean. Findings below.

### Review Findings

- [x] [Review][Patch] 33-4-R1 (MEDIUM) Renderer relabeled an unknown disposition [packages/client-config/scripts/render-certification-table.mjs] — a `certification-failed-see-story` record (certify.mjs's own failed-pass disposition) rendered as `**fixture-only-with-residual-risk** (date) — undefined` (sandbox-confirmed): a dishonest label + literal undefined (Rule #34/#51). Fixed: roster validation refuses any disposition outside {certified-live, fixture-only-with-residual-risk} with exit 2 naming the id. Regression pin added to certification-process.test.ts (unknown-disposition refusal + README untouched, --check AND bare-run legs); mutation-verified (pre-fix misrender → post-fix exit 2).
- [x] [Review][Patch] 33-4-R2 (LOW) certify.mjs "byte-exact" restore used utf8 string reads/writes [packages/client-config/scripts/certify.mjs] — lossy for a non-UTF-8 config: the raw write-back could re-encode while the equally lossy comparison reported byte-exact. Fixed: config snapshot/compare/write-back are Buffer-based (`Buffer.compare` via a null-safe `bytesEqual`).
- [x] [Review][Patch] 33-4-R3 (LOW) claude-code surface check was a bare substring [packages/client-config/scripts/certify.mjs] — `stdout.includes("iris-mcp-all")` also matches `iris-mcp-all-2`. Fixed: line-anchored match (`name:` at line start or a bare-name line).
- [x] [Review][Patch] 33-4-R4 (LOW) pass-created `session_index.jsonl` never removed [packages/client-config/scripts/certify.mjs] — restore only handled the pre-existing-index case. Fixed: `preKimiIndex === null` ⇒ `rmSync(force)`.
- [x] [Review][Patch] 33-4-R5 (LOW) docs prescribed unpublished npx form with no caveat [docs/client-config/README.md, claude-code.md, claude-desktop.md, cursor.md] — root README carries the not-yet-published caveat + node-dist invocation; these four pages didn't. Fixed: pre-publish parenthetical added to each.
- Dismissed (4): Set-expando flag storage in certify.mjs (functional, stylistic); 2026-07-28 evidence dates vs 2026-07-27 system date (UTC/local, cycle-log consistent); AC 33.4.1 minimum incl. Cursor/Codex vs fixture-only dispositions (story Task-2 subtask explicitly licensed no-install, lead choice surfaced); verifyPresent running in repo cwd (user-scope entry, harmless).
- Review layers failed: blind, edge, auditor (no return within the window; nudged once). Reviewer-direct covered: certify.mjs write gates + restore ladder adversarially, drift-rule semantics vs AC 33.4-I1, roster exhaustiveness (13 adapters = 13 records, mechanically verified), epics.md amendment quality (original wording + dated falsification evidence preserved, Rule #42), evidence honesty (npx-unpublished caveat recorded per Rule 3), docs-vs-data sync (render --check live exit 0), full suite + lint + type-check + NUL scan.

