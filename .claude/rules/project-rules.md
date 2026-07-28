# Project Rules

Durable rules for AI dev + code-review agents on this project, accumulated from epic retrospectives. Consolidated 2026-07-11 (post-Epic-28) from 50 individually-numbered rules into thematic sections; **original rule numbers are preserved in headings and bullets** so references in stories/retros/deferred-work.md still resolve. Next new rule: **#59**.

## #1 — Meta-rule: codify retrospective lessons

Every retrospective ends with a "Rules to codify" step. Codify a lesson ONLY if it has general-pattern shape (prevents a CLASS of future bugs); narrow one-off fixes stay in the retro doc. New rules take the next number (#51+), terse Context/Rule/one-line-why, committed in the same commit as the retro doc. Keep this file LEAN:
- **Never append per-epic audit notes or history here** — that record lives in `_bmad-output/implementation-artifacts/epic-N-retro-*.md` and this file's git history. This file loads into every agent's context; every token is paid on every session.
- Prefer folding a new lesson into an existing section (keeping its number visible) over a new standalone rule.

## #14 / #16 / #42 / #47 — Verify every claim live before building on it

Specs, story files, and plans are fallible about what exists and how it behaves. Before coding against any of these, verify empirically:
- **IRIS API shape** (#16): "method X exists / takes Y" — read the class in `irislib/`/`irissys/` or call it from a disposable `ExecuteMCPv2.Temp.*` probe (delete probes before commit). Methods named Create/Delete/Get/Modify are idiomatic and often DON'T exist on a given class. If a spec claim is wrong, widen scope to fix it AND flag the spec error for the retro.
- **The spec's own semantic claims** (#42): threshold directions, defaults, applicability — and whether a proposed DATA SOURCE is actually LIVE (a plausible dictionary surface can be declarative-only/dead; Epic 28's ExtentSize-vs-EXPLAIN-warning). Amend the spec in place.
- **"Reuse the existing X" internal-code claims** (#47): open X's source and confirm it exists with the claimed shape before building on it.
- **Prefer live probe over web search** (#14) for IRIS-idiosyncratic APIs: `iris_doc_list` prefix filter → `iris_doc_get`/local export → Temp probe class → `iris_execute_classmethod`. Perplexity for concepts; probes for exact shapes.

## #2 / #3 / #4 / #5 — IRIS system-class discipline

- (#2) Before wrapping an IRIS class, read its source: a `:List` query's ROWSPEC is usually NARROWER than the property list (`Security.Roles:List` has no Resources column — use `ListAll` or per-row `.Get(name,.props)`).
- (#3) `Config.*` = persistent CPF config; `SYS.*` = live runtime state; `Security.*` = authz (always %SYS). Handlers often must JOIN them (database list = `Config.Databases` for config + `SYS.Database` for Size/Mounted).
- (#4) Check `[Deprecated]` before reading/writing a property — deprecated ones can be SELECT-able but stale/disconnected from the live replacement (`Security.SSLConfigs.Protocols` → `TLSMinVersion`/`TLSMaxVersion`). Use and note the replacement.
- (#5) `$ZU(...)` counters are per-PROCESS. Instance-wide: `SYS.Stats.Global.Sample()` (RefLocal+RefPrivate+RefRemote), `SYS.Stats.Routine.Sample().RtnCommands`; cross-check the Mgmt Portal dashboard; system totals must be monotonically increasing.

## #6 — `%All` super-role short-circuit

`%All` grants everything but encodes NO explicit resource:permission pairs. Any permission check walking `Resources` must short-circuit when the target IS `%All` or is a user whose role list contains it — matched by EXACT `$Piece` equality over the comma list, never substring `[` (false-positives on names like `%AllCustom`). Return `granted:true` with a reason field explaining the short-circuit.

## #7 — I/O redirect + single-response dispatch (REST handlers)

When capturing Write output via `ReDirectIO(1)`:
- **Fully restore before rendering:** `Do ##class(%Library.Device).ReDirectIO(0)` then bare `Use tInitIO` — note `Use tInitIO::("")` is a NO-OP that does not clear the mnemonic. A still-active redirect sends the JSON envelope into the capture buffer ("non-JSON response").
- **Exactly ONE `RenderResponseBody` per request:** never render inside a Catch AND on the success path — argumentless `Quit` inside `Catch {}` exits only the catch body, falls through, and the success render clobbers the error envelope. Pattern: set an error flag in Catch (no render), restore I/O unconditionally after Try/Catch, then a single If/Else dispatch.

## #8 / #9 / #13 / #33 — Error-text / SanitizeError discipline

- (#8) `GetErrorText()` output already carries an `ERROR #N: ` prefix (or a locale variant like `خطأ #N: `). Strip ONE leading prefix before re-wrapping in `$$$ERROR($$$GeneralError,…)` or the text double-wraps. Never strip `<TOKEN>`-style items (`<UNDEFINED>`) — legitimate diagnostics.
- (#9) Propagate the REAL `%Status` text through `##class(ExecuteMCPv2.Utils).SanitizeError(tSC)` instead of a generic "Failed to X" — the IRIS text carries the actionable reason. If it could echo a sensitive submitted value, redact field-specifically with a MINIMUM-LENGTH gate on the `$Replace` (a 1-char password must not corrupt every occurrence of that letter).
- (#13) Don't infer instance locale from error-prefix language: instance locale (`%SYS.NLS.Locale`; this instance `enuw`) and NLS message tables are independent — strippers handle both English and localized prefixes.
- (#33) `SanitizeError` STRIPS caret-global tokens (`^Name`) from message text. When an error must name a global, write it WITHOUT the caret (`Ens.AppData`); the caret form belongs only on never-sanitized surfaces (TS descriptions, docs).

## #15 — Never wrap a method call in `$Get()`

`$Get(tBody.%Get("x"), d)` parses as multi-dimensional access on the receiver → `<INVALID CLASS>` on a %DynamicObject (or silent wrong values on locals). Use:
```objectscript
If tBody.%IsDefined("timeout") Set tTimeout = +tBody.%Get("timeout")   ; explicit presence check
Set tTimeout = +tBody.%Get("timeout")  If tTimeout=0 Set tTimeout=120   ; coercion + default
```
Review grep: `\$Get\([a-zA-Z_]+\.` — any hit is suspect.

## #27 — `Ens.Config`: class XData is source of truth; the SQL extent is a cache

`SaveToClass()`/`RemoveItem()` write the production class XData, NOT the `Ens.Config.Item` extent; `LoadFromClass(pClassName)` (single arg) re-syncs the extent from the class. Therefore: call `##class(Ens.Config.Production).LoadFromClass(prod)` BEFORE `%OpenId(prod)` in add/remove flows (else you operate on a stale item list); a just-added item is invisible to extent-based reads (`NameExists`, raw `Ens_Config.Item` SQL) until a sync/compile — expected, document it; `Ens.Config.Item`'s `Name` index is composite `(Production, Name)`, so one-arg `NameExists(name)` doesn't uniquely resolve an item.

## #29 / #50 — Key construction

- (#29) Reject the delimiter in user-supplied slots of a composite IdKey (`||` for `Ens.Config.DefaultSettings`) BEFORE assembly — a slot containing the delimiter silently targets a DIFFERENT row. Clear error, no write.
- (#50) A cross-side match/join/diff key contains ONLY item-identity dimensions — NEVER a per-side dimension (namespace, profile, host, environment, path, timestamp). Litmus test per component: "would two genuinely-identical items on the two sides differ here?" — if yes it's a side dimension; move it into the compared VALUE (where a mismatch correctly reports `differs`). A side dimension in the key makes cross-side matches structurally impossible — everything degenerates to onlyInSource/onlyInTarget (Epic 27's mappings-key HIGH).

## #10 / #11 / #12 — MCP tool wire discipline (TypeScript layer)

- (#10) Send documented defaults EXPLICITLY on the wire (`params.set("files", files ?? "*.cls,*.mac,*.int,*.inc")`) — server-side defaults may differ from what the tool description advertises; never conflate "caller omitted" with "documented default".
- (#11) IRIS `$HOROLOG` (`days,seconds`; day 0 = 1840-12-31) is opaque to clients: convert to ISO 8601 in the TS response mapping, preserve the raw value in a `<field>Raw` sibling, return `""` (never throw) on malformed input, and round-trip one known value against `$ZDATETIME` in tests.
- (#12) The Mgmnt API (`%REST.API.GetAllRESTApps`) lists SPEC-FIRST REST apps only — hand-written `%CSP.REST` dispatch classes are excluded by design. Tools listing REST apps expose both modes: `scope:"spec-first"` (default) and `scope:"all"` (webapp list filtered to non-empty `dispatchClass`), stated in the description.

## #17 — `iris_doc_load` requires a glob-prefixed path

The class name is derived from the directory prefix BEFORE the first glob metacharacter. Always `c:/git/iris-execute-mcp-v2/src/**/Name.cls` (or `src/**/*.cls`); a bare file path collapses the class to `User.<stem>`.

## #18 / #24 / #39 — Bootstrap & generated artifacts

- (#18) Generated files are OUTPUT-ONLY (`bootstrap-classes.ts`, any `*.generated.*`): fix the SOURCE and re-run the generator; hand-edits die at the next regen. Checked-in ≠ editable — the DO-NOT-EDIT header is the signal.
- (#24) Editing a bootstrapped class regenerates the embed IN THE SAME STORY (`pnpm run gen:bootstrap`; record `BOOTSTRAP_VERSION` from→to — it is a content hash and moves per change). "Defer the bump to a closing story" is incompatible with the drift test; the closing story verifies IDEMPOTENCE (regen produces no diff), it never performs a deferred bump.
- (#39) A NEW bootstrapped `.cls` goes into BOTH hand-maintained rosters: `scripts/gen-bootstrap.mjs` `classes[]` (ordered; `REST/Dispatch.cls` stays last) AND `packages/shared/src/__tests__/bootstrap.test.ts` (classPaths roster + expected-names + count). `gen:bootstrap` regenerates content only — it does NOT update rosters. `ExecuteMCPv2.Tests.*` test/fixture classes stay OUT of the manifest.

## #20 / #23 / #25 — Frozen governance baseline

- (#23) `GOVERNANCE_BASELINE` is a FROZEN foundation snapshot (Epic 14: 141 keys, hash `1e62c5ad5bf7`). The drift test is ONE-DIRECTIONAL: every frozen key must still exist live (removal = real regression); NEW live keys are expected and are governed by their `mutates` classification, NOT baseline membership. NEVER regenerate the baseline to absorb new keys — that would grandfather new writes as enabled.
- (#25) Verify with `pnpm gen:governance-baseline:check` (no-write). NEVER run the bare generator — it regrows the frozen file; if tripped, `git checkout --` the file immediately. Derive counts/membership from tests and source, never by running a generator.
- (#20) General pattern: when gating EXISTING capability, encode the "existing set" as a generated, output-only artifact and derive "is this new?" from MEMBERSHIP (never a hand-maintained flag), with an all-preserved test under empty/default config.

## #28 / #32 / #44 / #53 — Governance & visibility classification

- (#28) EVERY new (post-foundation) tool/action key MUST carry `mutates: "read" | "write"` — reads included (`assertGovernanceClassification` throws at registration otherwise). read → default-enabled; write → default-disabled.
- (#32) A new write that must ship ENABLED (recovery tooling) uses the orthogonal `defaultEnabled` marker — NEVER misclassify it as read and NEVER add it to the frozen baseline. The marker flips only the default seed; `mutates:"write"` + `annotations.destructiveHint` stay truthful; registration-time cross-validation rejects the marker on a non-write.
- (#44) A hand-curated safety classification over an existing surface (e.g. `BASELINE_ACTION_CLASSIFICATIONS`) needs a MECHANICAL cross-check against an independent declared signal (each tool's `readOnlyHint`), flagging divergences for a justification comment — completeness tests + human review are blind to wrong-SIDE entries. Fail-safe direction: classify the stricter side.
- (#53) EVERY new tool also carries an explicit VISIBILITY disposition (Epic 30 layer, spec 11): `include` or `exclude` in EACH named preset of the owning package's `presets.ts`, in the SAME story that adds the tool — `assertPresetCoverage` throws at construction; there is no default bucket. The disposition is a product decision, not assert-appeasement: `core` stays the everyday loop (≤13 runtime tools/server — when in doubt, EXCLUDE from `core`); `developer` excludes security/enterprise admin; tools designed as a unit go in `TOOL_PAIRS` and stay co-visible; any roster change beyond the new tool's own rows (or any doubt) is re-flagged to the lead, never silently adjusted. Visibility is orthogonal to `mutates` — a new tool needs BOTH classifications; hiding is ergonomics, never a substitute for write-gating.

## #19 / #21 — Additive back-compat proofs & the epic capstone

- (#19) On a strictly-additive epic, each story carries a back-compat AC with a MECHANICAL proof — an assertion that fails on drift (`toEqual` against pre-feature output; all-enabled sweep under empty config; no-extra-side-effect spy; byte-identical source check). "Off = today's behavior" is never a prose claim.
- (#21) A cross-cutting epic names ONE capstone integration test as the epic-done gate, running in the DEFAULT suite (never an excluded `*.integration.test.ts` suffix), and review verifies it is GENUINE — it drives real surfaces and would actually fail if the property broke.

## #36 / #49 — Oracle discipline (expected values come from reality)

- (#36) When porting/matching an executable reference, pin EVERY expected test value by RUNNING the reference on the exact fixture (cite the capture command + version in the test comment). Hand-reasoned expectations fail precisely where the port's mental model is wrong — adversarial/boundary fixtures especially. Same for live captures: fixtures are captured from the live system, never edited to match the implementation.
- (#49) For diff/sync/promote-shaped features, the epic gate is a LIVE round-trip capstone: seed drift on genuinely different sides → diff → plan → execute → **re-diff must be CLEAN**. Convergence is a self-validating oracle; mocked fixtures whose expectations were derived from the implementation ENCODE its bugs and stay green forever (Epic 27's mappings-key HIGH). On a capstone-found defect: fix → regression pinned from live behavior → mutation-verify → re-run capstone clean.

## #22 / #26 / #46 — Lead per-story smoke, matched to the deliverable

- (#22) Library/TS story: smoke the BUILT dist in a fresh real Node process as a real consumer would (rebuild first; delete the disposable script before staging). Note: `process.exit` with open sockets on Windows emits a benign `UV_HANDLE_CLOSING` assertion AFTER the pass line — teardown noise, not a failure.
- (#26) Endpoint-backed story: drive the LIVE deployed route over real HTTP — read paths PLUS at least one destructive-path REFUSAL asserting nothing changed. A direct REST smoke bypasses MCP-layer governance, so it tests the handler's OWN guards — which is exactly the point.
- (#46) New MCP protocol capability (prompts/resources/…): real SDK `Client` over `InMemoryTransport.createLinkedPair()` against the dist server — `getServerCapabilities()` for empty-pack back-compat, list/get for rendering, and ALWAYS one call with an optional field entirely OMITTED (e.g. `getPrompt({name})` with no `arguments`) — the SDK arg-parsing edge that `arguments: {}` tests structurally miss.

## #34 / #40 / #41 — Second-environment & not-configured coverage

- (#34) A tool whose output depends on namespace/locale/schema state smokes a SECOND, genuinely-different namespace (or records an explicit residual risk). Epic 21 shipped three defects invisible to a green suite + single-namespace smoke.
- (#40) For `scope:"NONE"` tools with no namespace knob: stand up a disposable `%CSP.REST` webapp bound to the second namespace, drive the tool through it, confirm the namespace-sensitive area actually DIFFERS (proving the smoke is real), then DELETE the webapp.
- (#41) Unit-test the NOT-CONFIGURED branch that the fully-configured default namespace masks (e.g. `%SYS` has no `Ens.Director`; non-mirror member) — that branch usually carries its own contract (`notApplicable`, not error) and otherwise ships untested behind a green suite.

## #35 — `iris_execute_tests`: verify total vs expected

Always compare the returned `total` against the number of `Test*` methods expected; rerun (prefer per-class) if short. The historical partial-snapshot defect in our poll loop was root-caused and fixed 2026-07-09; the count check stays as cheap defense-in-depth.

## #37 / #48 — Deferred-work ledger

- (#37) Re-deferral is a valid per-epic decision but an invalid steady state: at ≥3 CONSECUTIVE re-deferrals of a batch, the next planned epic MUST include a dedicated burn-down story with TERMINAL disposition for every carried item — resolved / closed-with-evidence / closed-by-decision; re-deferral not an allowed outcome. Probe-first (#16) any item whose suggested fix embeds an unverified claim; mirror the disposition table into the ledger.
- (#48) A burn-down "resolved" code fix carries a HIGHER bar: prove it LIVE on the real surface or MUTATION-verify (revert → red → restore). The item was deferred because the suite was blind there — a green suite is not evidence (Epic 26: a burn-down "fix" was itself defective; only live HTTP caught it).

## #30 / #31 / #43 — Docs rollup

- (#30) Documenting a new governed tool/action includes its DEFAULT STATE (write ⇒ default-disabled; read ⇒ enabled — mechanical from `mutates`) at the point of use: per-server README + `tool_support.md`, not only the abstract governance section.
- (#31) A FRAMEWORK-provided tool (registered centrally in `server-base.ts`, appears on all 5 servers) is in NO package tool array: package-array length tests DON'T move; advertised/suite counts move +1 per server; cross-server constructed-server expectations DO move; document it as a framework surface with no home package. Conversely, a new ACTION on an existing tool changes NO tool count.
- (#43) A story introducing a user-facing/safety capability ships at least MINIMAL docs itself (env-var row + one-line capability + default state); the closing rollup ENRICHES — it never first-documents.

## #38 — Enumerating tools: scope filter required; output caps are not scan caps

A tool whose work scales with the documents/rows it enumerates requires a caller-supplied scope filter, documents the ~60s Web-Gateway timeout risk of unscoped runs, and makes a whole-namespace scan an explicit opt-in. A topN/output cap truncates the OUTPUT only — the scan work already happened; never advertise it as timeout protection.

## #45 — Cross-package validation tests live in `iris-mcp-all`

`@iris-mcp/shared` cannot import leaf packages (circular dependency); the only package depending on all five servers is `packages/iris-mcp-all` — cross-package checks (annotation sweeps, prompt/tool-name validation, doc-rot guards) live there, enumerating via `SERVER_PACKAGES` + `deriveKeysForTool` over each package's built dist. Single-source the check logic between the CLI script and the vitest test so they never diverge.

## #51 — A tally over a table is counted mechanically, never hand-authored

Context: any summary count over a list/table — a burn-down disposition tally, an audit rollup, a "N of M" doc claim. Rule: derive the count mechanically (grep/awk the disposition or category column) and cross-check any prose tally against it BEFORE the story closes; never hand-author the number. Why: Story 29.3's dev hand-counted "20 resolved" over a 41-row disposition table when the real column count was 14 (off by 6); QA's mechanical recount caught it. (Extends #25/#44 mechanical-derivation discipline from generators/classifications to summary tallies.)

## #52 — Scope-seam: basic-then-rigorous across two stories, seam documented

Context: a feature that naturally splits into a load-bearing skeleton + rigorous hardening (e.g. an interceptor's basic outcome derivation vs. its denyReason/action/seq-concurrency/shutdown fidelity). Rule: story N ships a BASIC-but-complete-SHAPE implementation and documents the deferred-fidelity SEAM explicitly in Dev Notes (naming the exact functions/guarantees story N+1 owns); story N+1 closes exactly that seam and does NOT re-touch story N's done work. Why: Epic 29's 29.0→29.1 split kept scope clean with zero rework — the documented seam stopped 29.0 over-building 29.1's concurrency/denyReason work and stopped 29.1 re-opening the finished writer/rotation code.

## #54 — A branch the real system cannot reach is worse than a missing one

Context: any code path handling a state that a third-party API, OS, or framework produces. Rule: before adding the branch, confirm the real system can actually produce that state — and every test fake must return a shape the real API can genuinely return, pinned to the installed type declaration or live probe as its oracle (#36). A fake that manufactures an impossible state makes the suite green over a path that can never execute, while the path that DOES execute stays untested. Review lens: for each branch, ask "what real input reaches this?"; for each fake, ask "can the real thing return this?" Why: three instances in Epic 31 alone — `getSession({createIfNone:true})` REJECTS on cancel but every test faked it resolving `undefined` (31.4 HIGH, the AC-required warning was unreachable code); a `workspaceFolder` config-write target that an unscoped `WorkspaceConfiguration` can never reach, pinned as correct by six tests (31.5 HIGH, found independently by all three review layers); and a package-key→directory map whose disk check verified EXISTENCE but not CORRESPONDENCE, so pointing `ops` at the real `iris-data-mcp` directory left all 200 tests green while silently handing users the wrong server (31.6 HIGH).

## #55 — Never generate file content through a shell heredoc

Context: writing or appending source, docs, or ledger entries from an agent. Rule: use the file-writing tools directly. If a script must generate content, (a) parse-check before writing, and (b) verify afterwards with `git diff --stat` that the file is still text and the write actually landed. Never chain a generation step and a `git commit` such that the commit can succeed after the generation aborted. Why: five occurrences in Epic 31 — a script wrote literal NUL bytes making `serverDefinitionProvider.ts` a binary file; a Python heredoc parsed `\User` in a Windows path as a `\U` unicode escape and aborted, silently dropping a ledger entry while the chained `git commit` still succeeded; bare apostrophes inside a single-quoted YAML scalar broke `sprint-status.yaml` parsing; and two further heredoc quoting failures. Every one was caught by verification, never by the tooling.

## #56 — Enumeration completeness is a review question, not an implementation detail

Context: any feature that enumerates a candidate set — settings-file paths, client adapters, product variants, OS scopes, governed keys. Rule: the ACs state the enumeration is EXHAUSTIVE-as-of-a-named-date with its source, and review asks "what is MISSING from this list?" as a distinct question from "does the code handle the listed entries correctly?". A list that is wrong by omission passes every test written against it, and `auto`-style modes that do not fail on zero results make the omission silent. Why: Epic 31 shipped Story 31.0 through three adversarial review layers, all of which verified the code did exactly what the ACs said — and none asked whether the AC's own candidate list was complete. The Project Lead subsequently found two omissions by inspection: `.code-workspace` files were never a discovery candidate (a multi-root user imported nothing, silently), and Linux user scope ignored both `XDG_CONFIG_HOME` and Flatpak's `~/.var/app` sandbox.

## #57 — Review layers: bounded-close, frozen diff, delivery receipts

Context: bmad-code-review's three adversarial layers (Blind/Edge/Auditor) failed to return before review close on 3 stories in Epic 32 and all 6 in Epic 33, then delivered post-commit with real findings (~40% stale because they reviewed a mutated tree). Rule: (a) BOUNDED-CLOSE — a review may not close while its layers are outstanding: the lead blocks on layer return or a hard documented timeout, and a timeout close is recorded as degraded, not normal; (b) FROZEN-DIFF — layers review a frozen diff snapshot captured at review start, so a late return can never be stale against a patched tree; (c) DELIVERY RECEIPTS — no findings file = the layer FAILED, never "found nothing"; "found nothing" requires an explicit empty-findings payload. Why: silent-layer reviews shipped 2 confirmed HIGHs + 4 MEDIUMs past close in Epic 33 (caught only by lead triage of the late returns + a gate-created cleanup story); the Epic-32 retro set the recurrence trigger and it fired 6/6.

## #58 — Byte-preservation and behavior guarantees require fixture diversity

Context: any test pinning a byte-preservation, format-preservation, or round-trip guarantee. Rule: the fixture set must include NON-canonical variants — compact single-line formatting, 4-space indentation, CRLF, comment-bearing (incl. comments inside owned spans), BOM — not only canonically-formatted files; a canonical-only fixture set is blind by construction because an implementation that re-serializes through its own formatter passes every canonical fixture. Why: Epic 33's worst defect (jsonc-parser `modify()` reformatting foreign entries on insert, AC-level byte-preservation violation) passed dev + QA + review because all ~40 fixtures were canonically formatted; only the lead smoke's hand-written compact fixture caught it. Same class recurred in 33.5 (interior comments, multiline TOML strings, comment-only documents).

---

Codification history (which epic produced which rule, incident details, commit hashes) lives in `_bmad-output/implementation-artifacts/epic-N-retro-*.md` and this file's git history — deliberately not duplicated here.
