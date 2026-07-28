# Story 31.6: Local Package Path Option (`iris-mcp-launcher`)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **developer running the IRIS MCP suite from a local checkout**,
I want **the launcher extension to spawn servers from my monorepo build instead of `npx`**,
so that **the extension actually works before the packages are published, and I can test local changes without publishing anything**.

## Context: why this story exists

The Story 31.5 smoke established that **no `@iris-mcp/*` package is published to npm**:

```
@iris-mcp/dev|admin|ops|interop|data  ->  NOT PUBLISHED
```

The extension spawns `npx -y @iris-mcp/<pkg>` ([definitions.ts:9-14](../../extensions/iris-mcp-launcher/src/definitions.ts), `NPX_COMMAND` at [serverDefinitionProvider.ts:47](../../extensions/iris-mcp-launcher/src/serverDefinitionProvider.ts)). So **every definition it registers currently fails to start on every machine.** The credential flow, env synthesis, QuickPick and status bar all work — the spawn target simply does not exist.

This story makes the extension usable before publication, and matches the workflow already in use: the Project Lead's own Claude Code config runs the servers as `node <repo>/packages/iris-<pkg>-mcp/dist/index.js`.

## Acceptance Criteria

Verbatim from [epics.md](../planning-artifacts/epics.md) — "### Story 31.6: Local Package Path Option".

1. **AC 31.6.1** — New setting `irisMcpLauncher.developmentRepoPath` (string, default `""`). Empty ⇒ spawn is **byte-identical to today** (`npx -y @iris-mcp/<pkg>`). Non-empty ⇒ each definition spawns `node <repoPath>/packages/<dir>/dist/index.js` instead. The setting is read through `readSettings()` like every other key (so `packaging.test.ts`'s mechanical `contributes.configuration` ↔ `readSettings()` key-parity test keeps passing) and coerced with the same hostile-input discipline (non-string ⇒ fallback, whitespace trimmed).
2. **AC 31.6.2** — The package-key→directory mapping is an **explicit map, never a derived transformation**. Five packages follow `iris-<key>-mcp`, but the meta-package directory is `iris-mcp-all` — any rule-based derivation silently produces a wrong path. A test cross-checks every entry against the REAL `packages/` directory listing on disk (Rule #51: derive from disk, never a hand-maintained roster asserted against itself).
3. **AC 31.6.3** — **Fail closed on a bad path.** If `developmentRepoPath` does not exist, is not a directory, or the derived `dist/index.js` for a selected package is missing, that package registers **no definition** and the user gets **exactly one** actionable warning naming the offending path AND the setting that produced it. Never spawn a guessed or partially-resolved path; never forward a raw `fs` error string to a user surface. A missing build for ONE package must not suppress the others.
4. **AC 31.6.4** — **Security posture stated, not implied.** This setting makes the extension execute an arbitrary local file path. It defaults to empty (opt-in), and the README documents it as a development-only setting whose path the user is trusting, in the same section as the client-coverage boundary. No credential handling changes.
5. **AC 31.6.5** — **Remove the `all` package key.** `@iris-mcp/all` declares no `main`, no `bin`, no `files` and ships no `dist` — its own README states it "contains no source code of its own... simply declares all five IRIS MCP servers as dependencies". `npx -y @iris-mcp/all` therefore has no executable to run and can never start an MCP server, and local mode has no entry point to target. This is a latent Story 31.4 defect masked only by non-publication. Remove `all` from `contributes.configuration`'s `packages` enum and from `PACKAGE_NPM_NAME`/`SuitePackageKey`. A user whose settings already list `all` gets **one** warning naming the removal and the five individual keys, and the remaining selected packages still register (never drop the whole plan over one stale key). `DEFAULT_PACKAGES` already excludes `all`, so the default path is unchanged.
6. **AC 31.6.6** — **Back-compat (Rule #19).** With `developmentRepoPath` unset, every registered definition's `command`, `args` and synthesized `env` are byte-identical to Story 31.5's output. Proven mechanically — an assertion that fails on drift, not a prose claim — including a whole-object comparison rather than a spot-check of selected keys (the 31.5 review's lesson: a 5-key spot-check hid a wrong `IRIS_HTTPS` encoding).
7. **AC 31.6.7** — The status bar tooltip surfaces when development mode is active (so a user cannot forget the extension is running local builds rather than published packages), without changing the zero-state or count semantics AC 31.5.3 pinned.
8. **Integration AC 31.6.8** — **A local-path definition must actually start.** Drive the REAL planned `command`/`args` (from `planDefinitions` with `developmentRepoPath` set to this repo) plus the REAL synthesized env into a genuine child process, complete an MCP `initialize` handshake over stdio with the real SDK `Client`, call `tools/list`, and call one tool that reaches live IRIS. Not mocked: this is the first real-runtime evidence in the extension's suite and directly narrows deferred item `31-5-1` (skill Rule 3 gap). Skip (with a recorded reason), never fail, when the monorepo `dist/` is unbuilt or IRIS is unreachable, so the suite stays green on a pristine checkout.

## Tasks / Subtasks

- [x] **Task 1 — Setting + explicit directory map (AC: 31.6.1, 31.6.2)**
  - [x] Add `irisMcpLauncher.developmentRepoPath` to `contributes.configuration` (type string, default `""`, description stating it is development-only and what it changes).
  - [x] Read it in `readSettings()` via the existing `toSettingString` coercion; `.trim()` it.
  - [x] Add an explicit `PACKAGE_DIR_NAME` map beside `PACKAGE_NPM_NAME` in `definitions.ts`. **Do NOT derive it** — see the naming trap in Dev Notes.
  - [x] Test: every `PACKAGE_DIR_NAME` value exists as a real directory under `packages/` (read the directory from disk).
- [x] **Task 2 — Spawn selection + fail-closed validation (AC: 31.6.1, 31.6.3)**
  - [x] In `planDefinitions` (or its caller), choose `npx` vs `node <path>` based on the trimmed setting.
  - [x] Validate: repo dir exists AND the per-package `dist/index.js` exists. Missing ⇒ drop THAT package's definitions only, collect the reason.
  - [x] Emit exactly ONE aggregated warning naming the setting and the offending path(s) — not one per package, not one per server (the 31.4 review's toast-storm bar).
  - [x] Guard every `fs` call; a throw degrades to the same single warning, never a raw error string to the user.
- [x] **Task 3 — Remove the `all` key (AC: 31.6.5)**
  - [x] Drop `all` from `SuitePackageKey`, `ALL_PACKAGE_KEYS`, `PACKAGE_NPM_NAME`, and the `contributes.configuration` `packages` enum.
  - [x] A stale `all` in existing settings ⇒ one warning naming the five valid keys; the other selected packages still plan normally.
  - [x] Confirm `DEFAULT_PACKAGES` is unaffected (it already excludes `all`).
- [x] **Task 4 — Status bar tooltip (AC: 31.6.7)**
  - [x] Add a dev-mode line to the tooltip when the setting is non-empty. Do not change `text`, the count, or the zero-state — those are pinned by 31.5 tests.
- [x] **Task 5 — Docs (AC: 31.6.4)**
  - [x] README: new setting row, a short "Development mode" subsection stating the security posture (arbitrary local path execution, opt-in, user-trusted), and that `@iris-mcp/*` is not yet published so this is currently the only way to start a server.
  - [x] Note the `all` removal in `CHANGELOG.md`.
- [x] **Task 6 — Tests (AC: all, especially 31.6.6, 31.6.8)**
  - [x] Unit: unset ⇒ npx args unchanged; set ⇒ node+path args; per-package missing build; repo path missing; hostile non-string setting; stale `all` key.
  - [x] **Rule #19 whole-object proof** — unset ⇒ command/args/env deep-equal to the pre-story output. Not a spot-check.
  - [x] **Integration AC 31.6.8 real-runtime test** — see Dev Notes for a known-working harness.
- [x] **Task 7 — Verification**
  - [x] `npx tsc --noEmit`, `npx vitest run` (report the count mechanically, Rule #51), `npm run build`, `npx vsce package`.
  - [x] `git status` shows ZERO files under `packages/**`.

### Review Findings

Three-layer adversarial review (Blind Hunter / Edge Case Hunter / Acceptance Auditor), 2026-07-26. 40 raw findings → 31 after dedupe: **17 patched in-story, 6 deferred, 8 dismissed**. All three HIGHs were independently reproduced (two of them mutation-verified) before being fixed, and each fix was re-verified against the same reproduction.

- [x] [Review][Patch] **HIGH — AC 31.6.2's disk cross-check verified existence, not correspondence: a wrong-but-existing mapping passed the entire suite green.** Mutation-verified three times independently: setting `ops: "iris-data-mcp"` (a real directory) kept all 200 tests passing, so a user selecting `ops` would silently get the **data** server — wrong toolset, wrong governance surface, no warning. The disk test only asserted `realDirectories.has(dirName)`; the source-grep test hand-pinned only `admin` and `dev`, leaving `data`/`interop`/`ops` unpinned in every direction. Fixed by pairing each key against its directory's own `package.json` `name` (both sides read from disk, neither derived from the map under test), plus a `bin`-target check pinning the `dist/index.js` entry-point assumption, and a guarded `readdirSync` so a missing `packages/` reports itself instead of throwing ENOENT. Mutation re-verified: the same swap now fails. [extensions/iris-mcp-launcher/src/__tests__/definitions.test.ts:119]
- [x] [Review][Patch] **HIGH — a relative `developmentRepoPath` was fail-OPEN.** Verified live: with a relative path that resolves, `providePlannedDefinitions()` returned `{command:"node", args:["..\\..\\packages\\iris-dev-mcp\\dist\\index.js"]}` and **zero warnings**. `isExistingDirectory`/`join()` resolve against the extension host's `process.cwd()`, but `extension.ts` hands the args to `vscode.McpStdioServerDefinition`, whose constructor takes no `cwd` — so the child resolves the same relative string against VS Code's MCP spawner cwd. Validation proved one file existed while the spawn targeted another (or none): exactly the "guessed or partially-resolved path" AC 31.6.3 forbids. Relative paths are now rejected with their own reason; re-verified live (0 definitions, 1 actionable warning). [extensions/iris-mcp-launcher/src/serverDefinitionProvider.ts:201]
- [x] [Review][Patch] **HIGH — the setting declared no `scope`, so a workspace could choose which local binary the extension executes.** VS Code defaults a setting to `window` scope, which a workspace's own `.vscode/settings.json` can set. Opening a cloned repository that shipped a settings file plus a checked-in `packages/iris-dev-mcp/dist/index.js` would hand this extension an attacker-chosen executable with no prompt — and AC 31.6.4's stated posture ("a checkout you trust") assumes the *user* set it. This is the only `irisMcpLauncher.*` setting that names something executed; every other is inert env pass-through. Now `"scope": "machine"` (User/Machine settings only), pinned by a new packaging test and documented. [extensions/iris-mcp-launcher/package.json:96]
- [x] [Review][Patch] MEDIUM — the dev-repo warning fired when zero definitions would have registered anyway, contradicting the adjacent comment's documented "everything disabled stays silent" policy and regressing Story 31.5's silent zero-state. Verified live: `packages: []` + a bad path produced a warning where 31.5 produced none; a non-matching `servers` list produced two toasts. Now returns early when there are no plans; re-verified (silent, and the no-match case is down to its one actionable warning). [extensions/iris-mcp-launcher/src/serverDefinitionProvider.ts:192]
- [x] [Review][Patch] MEDIUM — no mechanical parity between `contributes.configuration`'s `packages` enum/default and the `SuitePackageKey` set the code accepts (Rule #51). This story hand-edited both sides to remove `"all"`; nothing pinned that they agree, so a key in the enum but not the union would be offered by the Settings UI and silently filtered at read time — the exact `"all"` situation this story had to clean up. Parity test added, deriving both sides from source. [extensions/iris-mcp-launcher/src/__tests__/packaging.test.ts:98]
- [x] [Review][Patch] MEDIUM — an absolute path that is a real directory but not a checkout produced one "no built dist/index.js at &lt;absolute path&gt;" clause **per selected package** (five for the default selection), far past what a VS Code notification renders, while never naming the actual problem. A `packages/` existence check now short-circuits with one actionable reason. [extensions/iris-mcp-launcher/src/serverDefinitionProvider.ts:221]
- [x] [Review][Patch] MEDIUM — "Four of five packages follow `iris-<key>-mcp`" is factually wrong (all five do; the real counterexample `iris-mcp-all` was removed in this story), and the error was propagated into the user-facing README. A maintainer would hunt for the non-conforming entry, find none, and "simplify" the map to the derivation the comment exists to prevent. Corrected in all three places; `epics.md` had it right. [extensions/iris-mcp-launcher/src/definitions.ts:23]
- [x] [Review][Patch] MEDIUM — `expect(tools.length).toBe(29)` coupled an `extensions/**` test to `packages/iris-dev-mcp`'s tool roster. Rule #31 says one new *framework* tool moves the advertised count on every server, so a `packages/**`-only change would turn this extension's suite red — contradicting its documented "depends on nothing in `packages/**`" boundary. Loosened to `toBeGreaterThan(0)` plus the existing `iris_server_info` presence check (what Integration AC 31.6.8 actually requires); the observed 29 is recorded in a comment. [extensions/iris-mcp-launcher/src/__tests__/localSpawnIntegration.test.ts:265]
- [x] [Review][Patch] MEDIUM — the story's Dev Agent Record reported **188** tests; the delivered tree runs **200** (Rule #51: tallies counted mechanically). The QA pass's +12 tests were never re-derived into the record. Also corrected: "`dependencies` stays `{}`" — the key has never existed at HEAD or after (the constraint is met; the phrasing was wrong). [_bmad-output/implementation-artifacts/31-6-local-package-path.md:156]
- [x] [Review][Patch] MEDIUM — `resolveSdkEsmDir()` took `find()`'s first `.pnpm` match and gave up if that one lacked `dist/esm`, silently skipping the only real-runtime test in the suite — and a skip is indistinguishable from "IRIS is not running", so the rot would never be noticed. Now filters, sorts for determinism, and tries every candidate. [extensions/iris-mcp-launcher/src/__tests__/localSpawnIntegration.test.ts:85]
- [x] [Review][Patch] LOW — `rawPackages.includes("all")` was case/whitespace-exact, so `"All"` or `" all "` was dropped by the key filter **and** missed by the stale-key detector: total silence, the one outcome AC 31.6.5 exists to prevent. Now normalized. [extensions/iris-mcp-launcher/src/settings.ts:64]
- [x] [Review][Patch] LOW — `expect(warnings[0]).toContain("admin")` passed on the embedded path `.../iris-admin-mcp/dist/index.js`, so it would still pass with the `package "admin"` clause removed entirely. Tightened to `'package "admin"'`, matching its sibling assertions. [extensions/iris-mcp-launcher/src/__tests__/serverDefinitionProvider.test.ts:672]
- [x] [Review][Patch] LOW — the test billed as "mechanical corroboration (Rule #51)" of the 20-key env fixture is self-referential: `resolveEnvForLabel` *calls* `withOwnedVarsCleared`, so "no owned key is missing" holds by construction and cannot fail. It does genuinely catch an EXTRA (unowned, never-cleared) key. Docstring and title corrected to claim only that, so it is not banked as the fixture's independent check. [extensions/iris-mcp-launcher/src/__tests__/serverDefinitionProvider.test.ts:1010]
- [x] [Review][Patch] LOW — a test forced `fs.existsSync` to throw, a state the real filesystem cannot produce: Node's `existsSync` is contractually total (probed on Node v24.16.0 with NUL-byte paths, 70 000-char paths, `C:\<>|?*`, `""` and non-string args — every case returned `false`, none threw). The pinned behavior is correct, so this is over-coverage rather than a wrong-branch pin, but the suite was reporting two independent "guard every fs call" proofs when only the `statSync` one is reachable. Relabelled explicitly. [extensions/iris-mcp-launcher/src/__tests__/serverDefinitionProvider.test.ts:714]
- [x] [Review][Patch] LOW — `mockClear()` does not drain an unconsumed `mockImplementationOnce`, and no global mock reset is configured, so a queued `EACCES`/`EIO` throw could leak into the next test that touches `fs`. (The `isAbsolute` short-circuit added above is exactly the kind of change that breaks the current accident of every once-impl being consumed.) Replaced with a file-level `afterEach` that resets **and** reinstates the real implementations — note `mockReset()` alone is worse under vitest 2.1.9: it clears the base implementation, which turned six passing tests red during this review. [extensions/iris-mcp-launcher/src/__tests__/serverDefinitionProvider.test.ts:33]
- [x] [Review][Patch] LOW — no `combineProfiles: true` coverage under `developmentRepoPath`: that is the branch where `planDefinitions` emits one plan per package, so the per-package entry-point cache is *not* exercised and the two features' interaction was entirely unasserted. Test added. [extensions/iris-mcp-launcher/src/__tests__/serverDefinitionProvider.test.ts:975]
- [x] [Review][Patch] LOW — two `## [Unreleased]` headings in the same CHANGELOG (the new block sat directly above `## [0.1.0] — Unreleased (not yet published)`), so a reader could not tell which unreleased section a change belonged to. Since 0.1.0 has never published, the Story 31.6 entries were folded into it. [extensions/iris-mcp-launcher/CHANGELOG.md:5]
- [x] [Review][Patch] LOW — two doc claims falsified by this change: `settings.ts`'s "Excludes the `all` meta-package (opt-in, heavier)" (there is no longer an `all` key, and "heavier" was never the reason), and `containment.test.ts`'s title "only `.servers`/`.packages` ever reach the text or tooltip" (`developmentRepoPath` now does, by design). Both corrected. [extensions/iris-mcp-launcher/src/settings.ts:13]
- [x] [Review][Defer] MEDIUM — the dev-repo and stale-`all` warnings re-fire on every `providePlannedDefinitions()` call (verified: 6 warnings across 3 calls), unlike the deduped `warnedPathPrefixes` right beside them; the pre-existing "no servers match" warning behaves the same way — deferred, a consistency gap across all three warnings, best fixed in one pass. Ledger `31-6-1`.
- [x] [Review][Defer] MEDIUM — synchronous `existsSync`/`statSync` on a network path blocks the single-threaded VS Code extension host (measured 1281 ms for a dead UNC host; a hung SMB share is far worse) — deferred, making the validation async is a real refactor. Ledger `31-6-2`.
- [x] [Review][Defer] MEDIUM — `command: "node"` is resolved from the extension host's PATH and never validated, so nvm/Volta shim setups fail at spawn with an opaque ENOENT instead of this story's legible warning — deferred, AC 31.6.1 pins the command as `node`, so `process.execPath` + `ELECTRON_RUN_AS_NODE` needs a spec amendment. Ledger `31-6-3`.
- [x] [Review][Defer] LOW — the status bar tooltip asserts "spawning from local build at &lt;path&gt;" even when that path registered nothing; `buildStatusBarState` receives only `LauncherSettings` and has no access to the provider's verdict — deferred, needs state plumbing. Ledger `31-6-4`.
- [x] [Review][Defer] LOW — live IRIS credentials (`_SYSTEM`/`SYS`) hardcoded in `localSpawnIntegration.test.ts`, which `containment.test.ts`'s roster deliberately excludes — deferred, a repo-wide convention question (these are the documented local dev defaults). Ledger `31-6-5`.
- [x] [Review][Defer] LOW — `definitions.test.ts` and `localSpawnIntegration.test.ts` hard-require the monorepo `packages/` tree on disk, so the extension folder is no longer testable standalone (partially mitigated by the guarded read added above). Ledger `31-6-6`.

**Dismissed (8):** AC 31.6.6 pinning only `IRIS_HTTPS: "true"` (the `"false"` case *is* pinned by Story 31.5's whole-object test, which consumes the updated `settings()` helper — verified); README "Development mode" being an adjacent section rather than literally the same one as the client-coverage boundary (all AC 31.6.4 content requirements met); `hadStaleAllPackage` living on `LauncherSettings` (design critique of working, tested code); the `existsSync` + `statSync` double syscall (intentional, harmless); the source-grep test enforcing formatting over semantics (belt-and-braces — the new correspondence check is the real guard); `toSpawnEnv`'s comment overstating equivalence with VS Code's `null`-means-delete contract; trailing-space trimming and `"`-in-path warning mangling (pathological inputs); and "the integration test skips on essentially every machine" — falsified, it ran live in all four full-suite runs during this review.

## Dev Notes

### Hard boundaries

- **Extension-only.** Zero changes under `packages/**`. No new MCP tool, governance key, or tool-count change (Rule #31).
- **Do not re-touch Stories 31.0–31.5.** Their tests are the regression net for this change.
- **Do NOT `git commit` or `git push`.** The lead commits after the smoke gate.
- **No new runtime dependency.** `dependencies` must stay `{}` and the VSIX self-contained.

### ⚠️ The directory naming trap (AC 31.6.2)

Verified on disk 2026-07-26:

| key | npm name | **directory** | `dist/index.js` |
|---|---|---|---|
| `admin` | `@iris-mcp/admin` | `iris-admin-mcp` | ✅ |
| `data` | `@iris-mcp/data` | `iris-data-mcp` | ✅ |
| `dev` | `@iris-mcp/dev` | `iris-dev-mcp` | ✅ |
| `interop` | `@iris-mcp/interop` | `iris-interop-mcp` | ✅ |
| `ops` | `@iris-mcp/ops` | `iris-ops-mcp` | ✅ |
| `all` | `@iris-mcp/all` | **`iris-mcp-all`** | ❌ **none** |

Four of five follow `iris-<key>-mcp`; the meta-package is `iris-mcp-all`. A transformation rule looks like it works, passes a test written against the same rule, and silently produces `iris-all-mcp` — a path that does not exist. Use an explicit map and cross-check it against the real directory listing.

### Why `all` is being removed, not fixed (AC 31.6.5)

`packages/iris-mcp-all/package.json` has keys `name, version, description, type, scripts, dependencies` — **no `main`, no `bin`, no `files`** — its only script is `test`, and `src/` contains only `__tests__`. Its README: *"Meta-package that installs all five IRIS MCP server packages... It contains no source code of its own."*

`npx` needs a `bin` to execute. There is none, so `npx -y @iris-mcp/all` can never start a server, published or not. It is unspawnable by construction, not by a bug that could be fixed in the extension. Selecting five individual packages (already the default) gives the user everything `all` appeared to promise.

### Reuse — do NOT reinvent

| Need | Already exists | Location |
|---|---|---|
| Setting read + hostile-input coercion | `readSettings`, `toSettingString` | `src/settings.ts` |
| Package key → npm name | `PACKAGE_NPM_NAME` | `src/definitions.ts:9` |
| Spawn command constant | `NPX_COMMAND` | `src/serverDefinitionProvider.ts:47` |
| One-warning helper | `showWarning` | `src/extension.ts` |
| Status bar text/tooltip | `buildStatusBarState` | `src/selectServers.ts` |
| Disk-derived roster pattern | `containment.test.ts` `SOURCE_FILES` | `src/__tests__/` |
| package.json ↔ source parity checks | `packaging.test.ts` | `src/__tests__/` |

### Integration AC 31.6.8 — a known-working harness

The lead already drove real MCP sessions this way during the 31.5 smoke (10/10 passing against both servers). Shape that worked:

- SDK lives at `node_modules/.pnpm/@modelcontextprotocol+sdk@1.29.0_zod@4.3.6/node_modules/@modelcontextprotocol/sdk/dist/esm/` — **pnpm store layout**, NOT `node_modules/@modelcontextprotocol/sdk`. Resolve it dynamically; do not hardcode a version-pinned path that will rot.
- `StdioClientTransport({ command, args, env, stderr: "ignore" })` → `client.connect()` → `listTools()` → `callTool()`.
- `synthesizeIrisEnv(profiles, namespaceDefault, options)` takes an **array** plus a namespace argument — a single-profile call is `synthesizeIrisEnv([profile], ns, {...})`. Getting this wrong throws `profiles is not iterable`.
- `withOwnedVarsCleared()` returns `null` for variables to REMOVE; apply it by deleting those keys from the spawn env, not by setting them to the string `"null"`.
- Live IRIS on this machine: `localhost:52773`, `_SYSTEM`, namespace `HSCUSTOM`. `iris_dev` advertises 29 tools.
- Make the test SKIP (recorded reason), never fail, when `packages/iris-dev-mcp/dist/index.js` is absent or IRIS is unreachable.

### Previous-story intelligence (Story 31.5)

Its review found one HIGH plus 12 patches. Directly relevant:

- **A branch the real API can never reach is worse than a missing branch** — 31.5's `workspaceFolder` write target had six tests pinning it as correct, using fakes returning a shape the real API cannot produce. Before adding a code path here, confirm the real system can reach it.
- **Spot-check assertions hide wrong values** — a 5-key env comparison missed that `IRIS_HTTPS` is the string `"false"`, not a `null` clear. AC 31.6.6 requires whole-object comparison for exactly this reason.
- **Silent data loss is a HIGH** — 31.5 originally deleted configured servers that Server Manager wasn't currently reporting. Here, the analogue: a missing local build must not silently drop a package the user explicitly selected. Warn, name it, and keep the others.
- **Exactly one warning** — never one per package or per server.

### Repo hazard

A generation script wrote literal NUL bytes into a source file making it binary (fixed in `640c38e`), and two separate heredocs silently mangled content. **Write source with the Write/Edit tools directly.** If you generate anything via a script, verify with `git diff --stat` that files are still text.

### Project Structure Notes

- All work under `extensions/iris-mcp-launcher/` — NOT an npm workspace member; run `npx vitest run` / `npx tsc --noEmit` / `npm run build` from that directory, never root `pnpm turbo`.
- Expected touches: `package.json` (setting + enum), `src/settings.ts`, `src/definitions.ts`, `src/serverDefinitionProvider.ts`, `src/types.ts` (drop `all` from `SuitePackageKey`), `src/selectServers.ts` (tooltip), README, CHANGELOG, and tests.
- Baseline before this story: **162 tests / 11 files**, all passing.

### References

- [epics.md — Story 31.6](../planning-artifacts/epics.md) — ACs, source of truth
- [31-5-launcher-selection-ui.md](31-5-launcher-selection-ui.md) — previous story, review findings
- [31-4-broker-extension.md](31-4-broker-extension.md) — credential contract, client-coverage boundary
- [deferred-work.md](deferred-work.md) — `31-5-1` (Rule 3 real-runtime gap, narrowed by AC 31.6.8)
- `.claude/rules/project-rules.md` — #19 (back-compat proof), #31 (no tool-count change), #36 (oracle discipline), #51 (mechanical rosters)

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `npx tsc --noEmit` — clean, no errors.
- `npx vitest run` — **CORRECTED IN CODE REVIEW (Rule #51):** this record originally claimed "188 tests / 12 files", which was the count at the END OF DEV and was never re-derived after the QA pass added 12 more. The delivered tree ran **200 tests / 12 files** at review entry (baseline 162/11), and **208 tests / 12 files** after the review's own patches. Read mechanically from the runner's summary line each time, not hand-tallied.
- `npm run build` — clean (`tsc --project tsconfig.build.json`).
- `npx vsce package --allow-missing-repository` — produced `iris-mcp-launcher-0.1.0.vsix` (16 files, 38.7 KB), no `node_modules` bundled (`dependencies` stays `{}`).
- `git status --porcelain -- packages/` — zero output (confirmed no `packages/**` files touched).
- Verified live: Integration AC 31.6.8's test actually ran (not skipped) against the local IRIS instance (`localhost:52773`, `_SYSTEM`/`SYS`, `HSCUSTOM`) — real `node <repo>/packages/iris-dev-mcp/dist/index.js` child process, real MCP `initialize` handshake, `listTools()` returned exactly 29 tools (cross-checked mechanically: 28 package-defined in `packages/iris-dev-mcp/src/tools/*.ts` + 1 framework-provided `iris_server_profiles` from `packages/shared/src/server-base.ts`, matching Rule #31), and `callTool({name:"iris_server_info"})` returned a non-error result with `structuredContent` populated.

### Completion Notes List

- AC 31.6.1/31.6.2: added `irisMcpLauncher.developmentRepoPath` (string, default `""`) to `contributes.configuration`, read through `readSettings()` with the same `toSettingString` hostile-input coercion plus `.trim()` (mirrors `namespace`'s own trim). Added an EXPLICIT `PACKAGE_DIR_NAME` map in `definitions.ts` (never a derived `iris-${key}-mcp` template) — cross-checked against the real `packages/` directory listing on disk in `definitions.test.ts`, plus a source-grep test proving the declaration itself contains no template-literal derivation.
- AC 31.6.1/31.6.3: `LauncherProvider.resolveSpawnTargets` (new private method in `serverDefinitionProvider.ts`) chooses `npx -y @iris-mcp/<pkg>` when `developmentRepoPath === ""` (untouched filesystem, byte-identical to Story 31.5) or `node <path>/packages/<dir>/dist/index.js` otherwise. Fail-closed: an invalid repo path or a missing per-package `dist/index.js` drops only the affected definition(s); every `fs` call is wrapped in try/catch helpers (`isExistingDirectory`/`isExistingFile`) that return `false` rather than throw, and all skip reasons are collected into exactly ONE aggregated `showWarning` call per `providePlannedDefinitions()` invocation (never one per package/server).
- AC 31.6.5: removed `"all"` from `SuitePackageKey`, `ALL_PACKAGE_KEYS`, `PACKAGE_NPM_NAME`, `PACKAGE_LABEL`, and `package.json`'s `packages` enum. A settings.json that still lists `"all"` is detected via a new `LauncherSettings.hadStaleAllPackage` boolean (computed in `readSettings()` from the RAW pre-filter array, since the existing invalid-key filter already silently drops "all" the same as any typo) and surfaces exactly one warning naming the five valid replacement keys; other selected packages still register. `DEFAULT_PACKAGES` was already `all`-free and needed no change.
- AC 31.6.7: `buildStatusBarState` (`selectServers.ts`) now appends a "Development mode: spawning from local build at `<path>`" tooltip line when `developmentRepoPath` is non-empty. `text`, the count, and the zero-state shape (pinned by Story 31.5 tests) are untouched — verified by both the existing 31.5 tests staying green and new dedicated tests.
- AC 31.6.6 (Rule #19): added a dedicated whole-object `toEqual` test in `serverDefinitionProvider.test.ts` covering a combineProfiles/multi-server/governance-bearing definition's full `PlannedDefinition` array AND the FULL resolved env record (every key `synthesizeIrisEnv`/`buildGovernanceEnv`/`withOwnedVarsCleared` can emit) with `developmentRepoPath` left at its default `""` — not a subset/`toMatchObject` spot-check, directly closing the Story 31.5 review's "5-key spot-check hid a wrong `IRIS_HTTPS` encoding" gap for this story's own new fields.
- Integration AC 31.6.8: new file `src/__tests__/localSpawnIntegration.test.ts`. Drives the REAL `LauncherProvider` (not a hand-built literal) with `developmentRepoPath` set to this repo, spawns the resulting `node <repo>/packages/iris-dev-mcp/dist/index.js` command with the REAL synthesized env via the real SDK `StdioClientTransport`/`Client` (resolved dynamically from `node_modules/.pnpm/@modelcontextprotocol+sdk@*/...` — no hardcoded version), completes a real `initialize` handshake, calls `listTools()`, and calls the real, zero-argument, read-only `iris_server_info` tool against live IRIS. Skips (via the Vitest `TaskContext.skip()` API, with a logged reason) rather than failing when the monorepo build is absent, the SDK can't be resolved, or IRIS is unreachable (probed via a real `fetch` with a 3s timeout before the child process is ever spawned) — verified this SKIP path is reachable by construction (three independent guard checks in `beforeAll`), and verified the RUN path is reachable by actually running it against this machine's live IRIS instance.
- Repo hazard note (Dev Notes item, project rule): an `Edit` call while writing `serverDefinitionProvider.test.ts` introduced a single stray NUL byte into the file (mid-word, inside a comment string) — caught immediately by a `Grep` "binary file matches" warning before it could reach a commit. Stripped with a one-off Node script (`Buffer.from([...data].filter(b => b !== 0))`) and re-verified with a repo-wide NUL-byte scan across every `.ts`/`.json`/`.md` file under `extensions/iris-mcp-launcher/` (clean) plus `git diff --stat` (confirmed all files show as text diffs, not binary).
- `vi.spyOn(fs, "statSync")` does not work against `node:fs`'s built-in module namespace (`TypeError: Cannot redefine property`); switched the one test needing a forced `fs` throw to `vi.mock("node:fs", ...)` with an `importOriginal` passthrough (scoped to `serverDefinitionProvider.test.ts` only, real implementations preserved for every export except a spyable `statSync` wrapper).
- Zero changes under `packages/**` (confirmed via `git status --porcelain -- packages/`). No new runtime dependency — note the review corrected the phrasing "`dependencies` stays `{}`": `package.json` has no `dependencies` key at all, at HEAD or after (verified with `git show HEAD:extensions/iris-mcp-launcher/package.json`). The constraint is met; the original wording implied an empty object that was never there.

### File List

- `extensions/iris-mcp-launcher/package.json` — added `irisMcpLauncher.developmentRepoPath` setting; removed `"all"` from the `packages` enum.
- `extensions/iris-mcp-launcher/src/types.ts` — removed `"all"` from `SuitePackageKey`; added `developmentRepoPath`/`hadStaleAllPackage` to `LauncherSettings`.
- `extensions/iris-mcp-launcher/src/settings.ts` — removed `"all"` from `ALL_PACKAGE_KEYS`; read `developmentRepoPath`; compute `hadStaleAllPackage`.
- `extensions/iris-mcp-launcher/src/definitions.ts` — removed `"all"` from `PACKAGE_NPM_NAME`/`PACKAGE_LABEL`; added the explicit `PACKAGE_DIR_NAME` map.
- `extensions/iris-mcp-launcher/src/serverDefinitionProvider.ts` — local-path spawn selection (`resolveSpawnTargets`), fail-closed `fs` validation, stale-`"all"` warning.
- `extensions/iris-mcp-launcher/src/selectServers.ts` — status bar tooltip dev-mode line (`buildStatusBarState`).
- `extensions/iris-mcp-launcher/README.md` — new setting row, "Development mode" section (with "Removed: the `all` package key" subsection), updated status note.
- `extensions/iris-mcp-launcher/CHANGELOG.md` — new `[Unreleased]` entry documenting the `developmentRepoPath` addition and the `"all"` key removal.
- `extensions/iris-mcp-launcher/src/__tests__/settings.test.ts` — `developmentRepoPath`/`hadStaleAllPackage` coverage; updated the removed-`"all"`-key expectations.
- `extensions/iris-mcp-launcher/src/__tests__/definitions.test.ts` — `PACKAGE_DIR_NAME` disk cross-check + source-derivation guard; updated `PACKAGE_NPM_NAME` expectation.
- `extensions/iris-mcp-launcher/src/__tests__/serverDefinitionProvider.test.ts` — Task 1/2/3 unit tests (local-spawn selection, fail-closed validation, fs-guard, stale-`"all"` warning) and the AC 31.6.6 whole-object Rule #19 test.
- `extensions/iris-mcp-launcher/src/__tests__/selectServers.test.ts` — AC 31.6.7 status bar dev-mode tooltip tests.
- `extensions/iris-mcp-launcher/src/__tests__/containment.test.ts` — `settings()` test helper updated for the two new `LauncherSettings` fields (no behavioral change).
- `extensions/iris-mcp-launcher/src/__tests__/env.test.ts` — `settings()` test helper updated for the two new `LauncherSettings` fields (no behavioral change).
- `extensions/iris-mcp-launcher/src/__tests__/localSpawnIntegration.test.ts` — new file; Integration AC 31.6.8 real child-process/MCP-handshake test.
