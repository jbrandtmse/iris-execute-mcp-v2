# Edge Case Hunter — Story 32.4 (late-findings cleanup) findings

Diff reviewed: `/tmp/324-review.diff` (3,283 lines, read fully) plus repo context (`server-manager-source.ts` full resolve loop, `profiles.ts`/`config.ts` guard sites, `cli/governance.ts` write path, `governanceEngine.ts`, `governancePanel.ts`, `extension.ts`). URL composition behavior verified empirically with Node's WHATWG parser (capture below). Every fix walked against the finding it dispositions; the four mandated checks ((a), (b), (c), (h)) were each traced end-to-end.

## MEDIUM

### M1. The extended host guard rejects bracketed IPv6 literals — a configuration that WORKED pre-story, contradicting the comment's "never usable" justification
- **Location:** `packages/shared/src/config.ts:69-83` (`loadConfig`), `packages/shared/src/profiles.ts:2712-2721` (`mergeProfile`)
- **Concrete input:** `IRIS_HOST=[::1]` (or an `IRIS_PROFILES` / Server Manager `webServer.host` of `"[::1]"` / `"[fe80::1]"`).
- **Wrong behavior:** the new `/[@/\s\\:]/` guard rejects the value at startup (`:` member). But pre-story, `deriveBaseUrl("[::1]", 52773, false)` produced `http://[::1]:52773` — verified with the WHATWG parser: `new URL("http://[::1]:52773")` → valid, href `http://[::1]:52773/`. The justification written into BOTH code comments — "IPv6 literals were never usable here anyway (`baseUrl` derivation does not bracket them), so no working configuration changes behavior" — is only true for UNbracketed input (`::1`); a user-supplied BRACKETED host passed through intact and worked. This is a back-compat regression on a working configuration (Rule #19 territory), not a documented non-change. The back-compat fixture matrices (`config.test.ts`, the AC 31.0.4 matrix) carry no bracketed-IPv6 fixture, so nothing pinned the regression. Either carve out `/^\[.*\]$/` or record the break as deliberate with a corrected comment.

### M2. `?` and `#` still slip past the host guard and silently break baseUrl composition — the same malformed-composition class the fix set out to close
- **Location:** `packages/shared/src/config.ts:69` and `packages/shared/src/profiles.ts:2712` (guard charset `[@/\s\\:]`)
- **Concrete input:** `IRIS_HOST=example.com?x=1` or `IRIS_HOST=example.com#frag`.
- **Wrong behavior:** passes the guard; `deriveBaseUrl` composes `http://example.com?x=1:52773` — verified: the WHATWG parser accepts it with `port === ""`, so the port is silently swallowed and every subsequent request path is swallowed by the query/fragment (every call 404s with nothing pointing at the host as the cause). This is exactly the failure mode 31-0-5 fixed for `pathPrefix` (`?`/`#` rejected there) and that 32-3-R6's `:`/`\` extension addresses for composition — the charset is incomplete against its own stated purpose. No test covers a query/fragment host at either layer.

## LOW

### L1. Over-cap password WITH its newline still gets the misdiagnosing file-pipe message (the 32-3-R13 slack covers only the at-cap case)
- **Location:** `packages/shared/src/cli/credentials.ts:368-372` (`STREAM_CAP_BYTES = STDIN_PASSWORD_CAP_BYTES + 2`)
- **Concrete input:** a 64 KiB+1 password piped with its trailing newline (65,539 wire bytes), or a 64 KiB password with a UTF-8 BOM + newline (65,539 wire bytes).
- **Wrong behavior:** wire > 65,538 throws "a file was probably piped in by mistake" — but the real cause is an over-cap password (or a BOM), which the new post-strip check would have named accurately. The R13 fix moved the boundary without closing the misdiagnosis class for inputs 1–2 bytes past it; the new test pins 64 KiB+1 with NO newline only.

### L2. `apiShapeWarned` is set BEFORE the warning sink is invoked — a pre-activation mismatch call would consume the session's only warning without showing it
- **Location:** `extensions/iris-mcp-launcher/src/extension.ts:743-750`
- **Concrete input:** `getServerManagerApi()` reaching the shape-mismatch branch while `apiShapeWarningSink` is still `undefined` (any call before `activate()` registers the sink).
- **Wrong behavior:** `apiShapeWarned = true` is set, `apiShapeWarningSink?.(message)` no-ops, and the once-per-session guarantee then suppresses the post-activation re-fire — the user never sees the version-mismatch message at all. Today unreachable per the module comment (activation registers the sink first), but the ordering makes the invariant load-bearing on call order rather than structure: set the flag only when the sink actually receives the message.

### L3. `refresh()`'s getSettings-failure early return leaves `emptyStateDescribeError` stale
- **Location:** `extensions/iris-mcp-launcher/src/governancePanel.ts` (`refresh()` — the `try { settings = deps.getSettings() } catch { … return; }` precedes `emptyStateDescribeError`'s only assignment)
- **Concrete input:** a settings read that transiently throws (hand-edited settings.json saved mid-write) while the panel is in the empty state with a previous engine-resolution error — or after a resolution error has cleared.
- **Wrong behavior:** the early return skips `await deps.engine.describe()`, so the empty state keeps rendering the PREVIOUS refresh's describe error (stale), or keeps showing none while a real resolution error now exists. Self-heals on the next successful refresh; the 32-2-R1 refactor moved this value from always-current (sync describe at render) to last-refresh snapshot without covering the failure branch.

### L4. The 32-3-R14 rejection handler swallows the underlying error with no diagnostic breadcrumb
- **Location:** `extensions/iris-mcp-launcher/src/serverDefinitionProvider.ts:1136-1145` (`() => ({ status: "unavailable" })`)
- **Concrete input:** any unexpected throw inside `resolveServerCredentials` (a bug, or a new provider rejection mode).
- **Wrong behavior:** every coalesced caller now degrades cleanly to the ordinary "unavailable" warning (the fix's intent), but the original exception message/stack is dropped entirely — not even a debug/output-channel line. Every other failure class in the extension leaves a diagnostic; a real bug here now presents identically to "Server Manager couldn't provide a connection," making the next 31-4-style incident undiagnosable from user reports. (The PII-redaction bar applies to user-facing text, not to a debug-channel crumb.)

### L5. `helpRequested`'s valued-option set is a second hand-maintained mirror of `parseArgs`' per-command options — silent divergence rot
- **Location:** `packages/shared/src/cli/governance.ts:2582-2599`
- **Concrete input:** a future command adding a valued option (e.g. `--format`) to its `parseArgs` allow-list without updating the scanner's `valuedOptions` set.
- **Wrong behavior:** `--format --help` then prints help (exit 0) instead of treating `--help` as the option's value — re-introducing the exact 32-1-R4 bug the scanner exists to fix, green suite included: no test pins the scanner's set against each command's declared options. The comment links the two; nothing mechanical does.

### L6. A BROKEN symlink (link exists, target missing) is still severed — `realpathSync` throws inside the guard and the fallback replaces the link with a regular file
- **Location:** `packages/shared/src/cli/governance.ts:3334-3343` (`resolveWriteTarget`)
- **Concrete input:** `--file` pointing at a symlink whose target does not exist (a config-managed link whose target was moved away), then `set <key> true`.
- **Wrong behavior:** `lstatSync` succeeds (the link exists) so the `isSymbolicLink()` branch runs; `realpathSync` throws ENOENT for the broken target; the catch falls through to `return path`; `writeFileAtomic(path)` then renames a temp OVER the link — replacing the broken symlink with a regular file, the exact 32-1-R6 failure class for live links. Arguably acceptable (creating the target through a broken link has its own surprises), but it is unrecorded: the new symlink test covers only the live-link case and silently skips on Windows-without-privileges, so nothing documents the broken-link disposition.

### L7. Two mangled joined lines in edited test files (edit-tool artifacts)
- **Location:** `extensions/iris-mcp-launcher/src/__tests__/activationFlow.test.ts:249` (`async () => {    mockState.configStore.set(...)` on one line) and `packages/shared/src/__tests__/tool-visibility-surfacing.test.ts:2224` (`function makeEnvHarness() {  let fetchMock = ...` on one line).
- **Wrong behavior:** none at runtime — both are syntactically valid — but they are exactly the shape a botched in-place edit produces (Rule #55's verification habit), and they sit in hunks this story touched. Worth a formatting fix pass; lint may or may not flag them depending on the config.

## Mandated checks — traced clean

**(a) 32-3-R1 parser-drop terminality.** The full `resolveServerManagerProfiles` loop walked: parser drops now set `nameStates "invalid"` at first sighting only (`!seenNames.has` guard — a later-sighting drop cannot clobber a resolved/invalid first sighting, verified both directions). Every `continue`/early-exit path in the entries loop either goes through `nameStates` ("resolved"/"invalid" terminal) or is the documented 31-0-2 no-own-username exception, which still sets NO state (seenNames is claimed only for counting) — verified it remains the sole exception. The check-3 message now states both halves verbatim. One consistent-by-design interleaving noted (not a finding): no-username-skip in file 1, parser drop in file 2, valid entry in file 3 → the file-3 entry IS imported, because the first sighting was the non-terminal exception — matches the message's "skipped SOLELY for lacking username yields" wording.

**(b) 32-3-R6 host hardening.** Error text names the source label and never echoes the value (both layers, asserted in unit + process-gate tests); localhost/hostname/dotted-dashed forms pass; empty `IRIS_HOST` behavior unchanged (pre-existing pass-through, not a regression); whitespace hosts now rejected (never usable). Two findings above (M1, M2).

**(c) 32-1-R3 unknown-key preservation.** `serializeConfigPreservingUnknown` preserves unknown keys verbatim at original positions with mutated layers substituted in place and new layers appended (order pinned by test). Prototype safety: `__proto__`/`constructor`/`prototype` as unknown top-level keys survive as own properties on a null-prototype output via `defineProperty` — no pollution path (JSON.parse own-property semantics + null-proto `out` verified). Write→read→validate loop: a preserved malformed unknown key (e.g. `"globals": "not-an-object"`) still validates (the loader ignores unknown keys by design) — no fix-loop trap. Layer-shaped detector correctly skips only exact-case `global`/`profiles` and warns on case variants (`Global`, `PROFILES`), which the loader genuinely ignores.

**(h) 32-2-R1 async fs refactor.** `governanceEngine.ts` and `extension.ts` no longer import `node:fs`'s sync stat in the touched flow (`statSync` import removed from both; `tsc` would fail on a leftover). Every caller of `resolveGovernanceCli`/`fileExists`/`describe` awaits (extension.ts describe+run, governancePanel refresh; all test harnesses converted). `render()`'s sync describe was correctly replaced by a refresh-captured snapshot — with the one stale-branch gap in L3.

**(i) new test files.** `host-guard-process-gate.test.ts` spawns the BUILT dist and asserts real startup failure/roster bytes against live IRIS (Case D) — real runtime surface, no impossible fakes. `governance-cli-preimage.test.ts` wraps the REAL `readFileSync` in a spy (profiles-bootstrap pattern) and counts real calls — genuine. The 32-3-R14 containment test's scopeless-session fake is self-documented as a bug-guard (NOT a shape the real API is known to produce), stated in the test itself — consistent with Rule #54's "can the real thing return this" lens for a third-party-provider data passthrough.

## Severity tally

- HIGH: 0
- MEDIUM: 2 (M1 bracketed-IPv6 regression, M2 `?`/`#` guard-charset gap)
- LOW: 7 (L1–L7)
