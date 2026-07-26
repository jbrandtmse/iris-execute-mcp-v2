# Story 31.6: Local Package Path Option (`iris-mcp-launcher`)

Status: ready-for-dev

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

- [ ] **Task 1 — Setting + explicit directory map (AC: 31.6.1, 31.6.2)**
  - [ ] Add `irisMcpLauncher.developmentRepoPath` to `contributes.configuration` (type string, default `""`, description stating it is development-only and what it changes).
  - [ ] Read it in `readSettings()` via the existing `toSettingString` coercion; `.trim()` it.
  - [ ] Add an explicit `PACKAGE_DIR_NAME` map beside `PACKAGE_NPM_NAME` in `definitions.ts`. **Do NOT derive it** — see the naming trap in Dev Notes.
  - [ ] Test: every `PACKAGE_DIR_NAME` value exists as a real directory under `packages/` (read the directory from disk).
- [ ] **Task 2 — Spawn selection + fail-closed validation (AC: 31.6.1, 31.6.3)**
  - [ ] In `planDefinitions` (or its caller), choose `npx` vs `node <path>` based on the trimmed setting.
  - [ ] Validate: repo dir exists AND the per-package `dist/index.js` exists. Missing ⇒ drop THAT package's definitions only, collect the reason.
  - [ ] Emit exactly ONE aggregated warning naming the setting and the offending path(s) — not one per package, not one per server (the 31.4 review's toast-storm bar).
  - [ ] Guard every `fs` call; a throw degrades to the same single warning, never a raw error string to the user.
- [ ] **Task 3 — Remove the `all` key (AC: 31.6.5)**
  - [ ] Drop `all` from `SuitePackageKey`, `ALL_PACKAGE_KEYS`, `PACKAGE_NPM_NAME`, and the `contributes.configuration` `packages` enum.
  - [ ] A stale `all` in existing settings ⇒ one warning naming the five valid keys; the other selected packages still plan normally.
  - [ ] Confirm `DEFAULT_PACKAGES` is unaffected (it already excludes `all`).
- [ ] **Task 4 — Status bar tooltip (AC: 31.6.7)**
  - [ ] Add a dev-mode line to the tooltip when the setting is non-empty. Do not change `text`, the count, or the zero-state — those are pinned by 31.5 tests.
- [ ] **Task 5 — Docs (AC: 31.6.4)**
  - [ ] README: new setting row, a short "Development mode" subsection stating the security posture (arbitrary local path execution, opt-in, user-trusted), and that `@iris-mcp/*` is not yet published so this is currently the only way to start a server.
  - [ ] Note the `all` removal in `CHANGELOG.md`.
- [ ] **Task 6 — Tests (AC: all, especially 31.6.6, 31.6.8)**
  - [ ] Unit: unset ⇒ npx args unchanged; set ⇒ node+path args; per-package missing build; repo path missing; hostile non-string setting; stale `all` key.
  - [ ] **Rule #19 whole-object proof** — unset ⇒ command/args/env deep-equal to the pre-story output. Not a spot-check.
  - [ ] **Integration AC 31.6.8 real-runtime test** — see Dev Notes for a known-working harness.
- [ ] **Task 7 — Verification**
  - [ ] `npx tsc --noEmit`, `npx vitest run` (report the count mechanically, Rule #51), `npm run build`, `npx vsce package`.
  - [ ] `git status` shows ZERO files under `packages/**`.

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

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
