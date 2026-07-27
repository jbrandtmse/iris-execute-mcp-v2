# Blind Hunter review — Story 32.4 (late findings cleanup)

Scope: `/tmp/324-review.diff` (3,283 lines — `git diff HEAD` since pre-story 78b32ba + two untracked test files appended), read in full. Diff-only review; no repo files, no specs. This is a defect-disposition story — the hunt was for fixes that are themselves wrong or that introduce a new defect batch.

---

## MEDIUM

### M1 — The changeset's new bullet inverts what `test --connect` validates (and the error propagated into the ledger)
- **Severity:** MEDIUM (CONFIRMED from the diff)
- **Evidence:** `.changeset/server-manager-first-file-wins.md` adds (diff line 15):
  > "`test --connect` validates the chain-resolved credential for the named server **rather than the registry password** when the two differ (e.g. keychain vs a stale `IRIS_PASSWORD`)."
  The code does the exact opposite. `cmdTest` (cli/credentials.ts, unchanged here but pinned by the diff's own fixtures) resolves the profile from the REGISTRY and probes THAT: the 32.3 fixture states "The probe exercised the REGISTRY's password, not the chain-resolved one — deep-equality on the exact registry profile object" and asserts `connect.credentialSource: "env"` while `source: "keychain"`. The whole point of item 31-2-1 was that the probe validates the registry password and `connect.credentialSource` now DISCLOSES that. The changeset's own second bullet (diff line 13) even says the field reports "the real credential provenance" — the two bullets contradict each other. The error propagated: the ledger row 32-3-R12 (deferred-work.md, diff line 171) also records "`test --connect` chain-resolved validation".
- **Failure scenario:** an operator with a fresh keychain password and a stale `IRIS_PASSWORD` runs `test --connect`, sees it FAIL (the registry's stale env password was probed), and — trusting the release note that says the chain-resolved (keychain) credential was validated — concludes the keychain entry is broken and deletes/replaces a good password.
- **Fix:** reword the bullet to "reports WHICH credential the probe exercised (`connect.credentialSource`) — the registry profile's, which can differ from the chain-resolved one" and correct the ledger row.

---

## LOW

### L1 — Two collapsed-line edit artifacts (Rule #55-shape damage)
- **Severity:** LOW (CONFIRMED)
- **Evidence:** `activationFlow.test.ts` (diff line 249): the 31-4-3 test's opening line was replaced with `it("31-4-3: …", async () => {    mockState.configStore.set(\`${CONFIG}.servers\`, ["prod"]);` — the statement jammed onto the `it(` line. `tool-visibility-surfacing.test.ts` (diff line 2224): `function makeEnvHarness() {  let fetchMock: ReturnType<typeof vi.fn>;` — same jamming. Both are semantically valid (no statement lost — verified by reading both hunks), but this is exactly the class of silent content-edit damage the project's own Rule #55 exists to catch, and it slipped past the story's own NUL/format verification habit.

### L2 — `effectiveZero` names its own inverse
- **Severity:** LOW (CONFIRMED, cosmetic)
- **Evidence:** selectServers.ts (diff line 1048): `const effectiveZero = registeredCount !== undefined && registeredCount > 0;` — the variable is TRUE when the count is NON-zero; the text it gates is `IRIS MCP: ${registeredCount}`, not "none". Logic is correct (three tests pin it), but the inverted name invites the next editor to "fix" the condition instead of the name.

### L3 — Pre-image test header says "exactly ONE each"; the assertion is 2
- **Severity:** LOW (CONFIRMED doc-vs-assertion mismatch)
- **Evidence:** `governance-cli-preimage.test.ts` header (diff line 3221): "an fs spy counts `readFileSync` calls against the target file for one `set` and one `unset` invocation — **exactly ONE each**." The assertions (diff lines 3273/3281): `expect(readsOf(file)).toBe(2)`. The inline comment reconciles it (one pre-image read + one post-write re-validation read), but the header misstates the contract — a future tightening refactor ("the header says 1") would break a correct test, and a reader auditing the 32-1-R7 claim from the header alone would conclude the pin is wrong.

### L4 — R3's shape-mismatch warning is once-per-session, while the same story's R7 gives every other static warning rising-edge re-warn semantics
- **Severity:** LOW (CONFIRMED inconsistency)
- **Evidence:** extension.ts (diff lines 704-705, 743-750): `let apiShapeWarned = false;` set true on first fire and NEVER cleared on a subsequent successful `getServerManagerApi()` call (success only clears `lastApiFailure`, diff line 754). So a fixed-then-rebroken Server Manager version mismatch (upgrade → downgrade) never re-warns — precisely the class 32-3-R7 fixed in this same story with `warnOnRisingEdge` for the four other static-text warnings (serverDefinitionProvider.ts:1108-1116), whose field doc says "a fix-then-rebreak warns once per occurrence". Either the rising-edge helper should cover the shape warning too, or the divergence should be named in a comment. Related survivor: the message still says "No IRIS MCP servers were registered." when fired from the `resolveEnvForLabel` path (registration already happened) — the wording issue from the original 32.3 finding was not part of the dedupe fix.

### L5 — The coalesced rejection-containment result is not frozen (freeze applied to one branch only)
- **Severity:** LOW (CONFIRMED asymmetry)
- **Evidence:** serverDefinitionProvider.ts (diff lines 1125-1145): the success branch of the new `.then` freezes `result.profile` and `result`; the rejection branch returns a bare `{ status: "unavailable" }` — the SAME shared object handed to every coalesced caller, unfrozen. The freeze rationale written in the success branch ("a future consumer mutating … throws … instead of silently corrupting every other caller's resolution") applies identically. Harmless today (no profile on the unavailable shape, no mutating consumer), but the guard's story is now "frozen except when it isn't".

### L6 — `helpRequested` duplicates the parser's valued-option list as a second hand-maintained source of truth
- **Severity:** LOW (PLAUSIBLE drift risk)
- **Evidence:** cli/governance.ts (diff line 2583): `const valuedOptions = new Set(["--file", "--profile", "--root"]);` — a hand-copied mirror of `parseArgs`'s per-command valued options. A future valued option added to `parseArgs` but not to this set silently re-breaks the dash-value contract the fix exists to protect (`cmd --newopt --help` would print help instead of treating `--help` as the value), and nothing mechanical cross-checks the two lists. The scanner also has no `--opt=value` story if `parseArgs` ever grows one. Fix: derive the set from the parser's own declaration, or add a structural pin.

### L7 — Dangling-symlink rollback removes the LINK and leaks the created target
- **Severity:** LOW (PLAUSIBLE; practically unreachable)
- **Evidence:** cli/governance.ts (diff lines 2334-2343, 2363-2365): for a `set` that CREATES a file through a dangling symlink, `resolveWriteTarget` — `realpathSync` throws ENOENT on the dangling link, the catch falls through to `return path` (the link) — so the write lands through the link, creating the target. On rollback (`preexisting === undefined`), `rmSync(writeTarget)` removes THE LINK, not the created target: the user's symlink is destroyed and the created file leaks — the inverse of the "restore pre-write state byte-for-byte" contract. Reachability is near-nil (the 32.1 review established the post-write validator provably passes on CLI-serialized content, so rollback is defense-in-depth), but the rollback target selection is wrong for exactly the case the symlink branch added. Fix: track whether the create went through a link and, on rollback, remove the created TARGET and keep the link.

---

## Checked and found clean

- **32-3-R1 (parser-drop terminality):** `nameStates.set(drop.name, "invalid")` is inside the `!seenNames.has` guard, so a same-name drop in a LOWER file cannot clobber a valid higher entry's state; the reverse-direction fixture (valid-high/drop-low → imported from high) genuinely pins this. The 31-0-2 no-own-username exception is preserved and the check-3 message now states both halves.
- **32-3-R2:** the recorded probe is correct — `path.win32.isAbsolute("/x")` IS true, so the original finding's mangling mechanism did not reproduce; the added `path.posix.isAbsolute` disjunct is harmless explicitness, and the unpinnable reverse direction (`:` delimiter) is documented.
- **32-3-R8 (refreshSeq guard):** the settings-failure early branch is synchronous (no interleave possible); the only await sits between the seq bump and the single guarded render; either completion order is correct. The race test is genuine — without the guard, refresh #1's stale tooltip ("1 of 3 selected") overwrites and the test goes red.
- **32-3-R13 boundary math:** cap+2 slack accepts a 64 KiB password with `\n` (65,537) or `\r\n` (65,538); post-strip byte measurement rejects 65,537+ passwords with the accurate message (fixtures pin both).
- **32-1-R3 preservation:** null-prototype output + `defineProperty` ordering; unknown keys round-trip at original positions; `global`/`profiles` written back at theirs; layer-shaped typo warn-only; Case J drives the REAL bin including `unset` and `validate` on the preserved file.
- **32-1-R7:** pre-image read once, validated via the loader's own parse half, reused for rollback; read-failure path re-runs through the real loader preserving the EISDIR clean-text contract; the fs-spy pin cannot silently pass (a normalized path would count 0 and fail, not pass).
- **32-1-R4:** `helpRequested` mirrors the `--`-terminator and valued-option semantics; the three fixtures (`get -- -h`, `validate --file --help`, `set -h`) pin the real grammar corners.
- **32-3-R6:** guard moved onto the FINAL host (override + inherited), extended to `\`/`:`; `loadConfig` fails fast on hostile `IRIS_HOST`; no message echoes the received value; the process gate (A/B/C dist-only, D live byte-exact baseUrl) is genuine.
- **32-3-R9/R10/R11/R14, 32-2-R1 async conversion, R5 zero-state:** all consistent with their fixtures; the R14 malformed-session test exercises a real throw path (`session.scopes[1]` TypeError) and the freeze/coalescing test asserts object identity across two coalesced calls.
- No HIGH-severity defects found: no inverted conditions in production logic, no new unhandled error paths, no shell/argv injection, no test-that-cannot-fail identified in the new or modified suites.

---

**Summary: 8 findings — 0 HIGH, 1 MEDIUM (changeset/ledger invert what `test --connect` validates), 7 LOW.**
