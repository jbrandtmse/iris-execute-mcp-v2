---
title: 'Story 42.10: Pre-1.0 Tool-Surface Corrections'
type: 'bugfix'
created: '2026-10-21'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-42-context.md'
warnings:
  - multiple-goals
  - oversized
deferred:
  - summary: 'Audit `namespace` for NONE- and BOTH-scoped tools still records the call''s `namespace` argument or the profile default. The 21 ops tools (NONE) run in %SYS server-side but record the profile namespace; `iris_backup_manage`, `iris_database_action` and `iris_process_manage` document their `namespace` argument as having no effect, yet the audit records it; `iris_webapp_list` (BOTH) records its `namespace` filter although the call runs in %SYS. DW-654 (wave-8 decision #31) covers SYS-scoped tools only.'
    evidence: 'Plan probe 2026-10-21: `deriveAuditNamespace` (`packages/shared/src/server-base.ts:2394-2401`) ignores `tool.scope`; `ToolScope` NONE means "no namespace concept" (`packages/shared/src/tool-types.ts:38-46`); `resolveNamespace` returns "" for NONE (`server-base.ts:412-421`). The handler golden records HSCUSTOM for dev `iris_server_info`/`iris_env_promote` and ops `iris_metrics_system`.'
    location: 'packages/shared/src/server-base.ts:2394-2401; packages/iris-ops-mcp/src/tools/*.ts; packages/iris-admin-mcp/src/tools/webapp.ts:263'
    severity: 'low'
---

<intent-contract>

## Intent

**Problem:** Before 1.0 publishes, four wire and audit truths are wrong, and the frozen-goldens machinery cannot record their correction. Thirteen tools that can delete or irreversibly overwrite state declare `destructiveHint: false` (DW-560); `iris_message_resend` says a preview without `confirm` is refused and that an over-cap preview is refused (DW-662); audit entries of %SYS-scoped tools record the profile's namespace instead of `%SYS` (DW-654). The sanctioned-change ledger and its tests accept only Story 43.4 append entries and cannot reach the handler golden's `audit` array.

**Approach:** Widen the ledger loader and its tests to accept later stories, corrections and handler `audit` entries. Then make the three corrections as sanctioned AD-15 changes: one ledger entry per moved golden value, the tools-list snapshot regenerated through its generator, a mechanical `destructiveHint` cross-check, and a CHANGELOG section naming each sanction. DW-652 (Storage guard on three more paths) moves to a proposed Story 42.11 (Design Notes, decision 1).

## Boundaries & Constraints

**Always:**
- **Frozen goldens stay frozen.** `sdk-wire-golden.json` and `sdk-handler-golden.json` are never edited or recaptured (their SHA-256 pins stay). Every moved golden value is exactly one entry in `sdk-golden-sanctioned-changes.json`, appended after the 43.4 entries in landing order.
- **Generated files change only through their generators.** `tools-list-snapshot.json` is regenerated with `pnpm gen:tools-list-snapshot --force` after rebuilding every package; never hand-edited.
- **Only the named values move.** The three other annotation hints of every tool, every tool name, title, input-schema key, governance key and `mutates` classification stay unchanged. The governance baseline stays `1e62c5ad5bf7`/141 (`pnpm gen:governance-baseline:check` only).
- **Audit:** only the `namespace` value of SYS-scoped tools changes; NS, BOTH and NONE tools record exactly what they record today.
- **Texts come from this spec.** The corrected resend texts and the flipped-tool set are the ones in Design Notes; independent test oracles are written from them, never read back from the ledger or the sources.
- **Cross-package checks live in `packages/iris-mcp-all`** (AD-2, Rule #45). Each widened or new check is proven red once on the path it guards (Rule #59).
- **Rule 14.** Non-ASCII in rewritten code lines uses escapes (`—`); comments state the contract, never the history.
- **No IRIS traffic is needed.** This story's checks never write the shared instance and run no OS %UnitTest class.
- **Never publish or version** (`npm`/`pnpm`/`changeset publish`, `changeset version`, `vsce`/`ovsx publish`, `npm login`, `npm stage publish`, `git tag`). Changesets stay `patch`.

**Never:**
- No Storage-guard change and no new parameter on `iris_doc_load`, `iris_doc_xml_export` or `iris_env_promote` (DW-652 → proposed Story 42.11).
- No `action` enum added to any tool, no new tool, key, preset row or refusal code.
- No edit of the architecture spine by the implement stage (the lead writes the drafted amendments at the spec gate, decision 3).
- No change to `iris_execute_tests` hints (Story 40.4's decision #63), and no ObjectScript change (`BOOTSTRAP_VERSION` unchanged).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Ledger: a later story | The 11 Story 43.4 entries, then the Story 42.10 entries | Loader and ledger test accept them; ids pinned per story, in ledger order | An entry whose sanction has no registered shape, or whose sanction id is missing in backticks from its story's CHANGELOG section, fails naming the id |
| Ledger: a correction | `S-42.10-resend-text` `replace` without `appendOnly`; the description entry's `old` is the 43.4 entry's `new` | Accepted; the sanctioned description is the corrected text | A correction under an append-only sanction (`S-43.4-descriptions`), or a 43.4 description entry that is not an append, fails |
| Ledger: handler `audit` array | Handler entry for `iris-admin-mcp` `audit[1]` `/namespace`, `"HSCUSTOM"` → `"%SYS"` | The sanctioned handler golden differs from the frozen one in exactly that member; every row `line` and every other audit element is frozen | A pointer into the `sessionStart` element, an index with no element, or a wrong `old` throws naming the entry id; nothing is applied |
| Annotations (DW-560) | `tools/list` of the built servers (every server's `main`, dev `core-preset`) | The 13 verdict-table tools declare `destructiveHint: true`; every other member of every tool equals the sanctioned golden; 49 of the 110 package tools are destructive | A non-read-only tool declaring `destructiveHint: false` that is not on the justified list, or a tool with a `delete`/`remove`/`purge`/`kill`/`clean` action declaring false, fails the cross-check naming the tool |
| Resend text (DW-662) | Interop `tools/list` | The description passage, `maxMessages` and `confirm` texts equal Design Notes exactly; `dryRun`'s text and the 43.4 dialog passage are unchanged | none |
| Audit namespace (DW-654) | `IRIS_AUDIT_LOG` set; a SYS-scoped call with and without a `namespace` argument, denied, schema-invalid and ok; NS, BOTH and NONE calls | Every SYS-scoped entry records `"%SYS"`; NS, BOTH and NONE entries record the non-empty `namespace` argument, else the profile default, as today | none |
| Snapshot (AC 42.10.2) | All packages built, then `pnpm gen:tools-list-snapshot --force` | Every snapshot entry of a tool the frozen golden lists equals the sanctioned golden's entry; `:check` is clean; only the header's `capturedAt` moves besides the named values | A moved value without an entry, or an entry the snapshot does not show, fails the parity test naming server, tool and field |
| Integration: handler-golden consumer | `story-43-1-qa-handler-golden.test.ts` drives the built admin server against its fake upstream | The live `iris_namespace_list` audit entry records `"%SYS"` and equals the sanctioned handler golden | Without the audit ledger entry, or without the fix, the test is red |

</intent-contract>

## Code Map

All paths are from the repo root; `T/` is `packages/iris-mcp-all/src/__tests__/`.

- **Loader** `scripts/lib/golden-sanctioned-changes.mjs`:
  - schema comment :18-24; `CHANGE_KEYS` :38; `validateSanctionedChanges` :147 (`sanction` `^S-\d+\.\d+-[a-z-]+$` :112, `story` `^\d+\.\d+$` :113, `label` required :118, `appendOnly` rules :129-136);
  - `rowsOf`/`rowOf` :173-187; `applySanctionedChanges` :212 rewrites only `row.line` (:216-231); `readSanctionedGolden` :242.
  - The loader has no story restriction and already accepts a `replace` without `appendOnly`; only the tests restrict both. It cannot address `servers.<srv>.audit[]` (parsed objects, no `label`, a sibling of `rows`). There is no `add` op.
- **Goldens** `T/fixtures/`: `sdk-wire-golden.json` (six `tools-list` rows: dev `main` 33 tools, dev `core-preset` 15, admin 27, interop 25, ops 22, data 8; every tool carries `annotations`; no row holds audit data); `sdk-handler-golden.json` (per server `startup`, `rows`, `audit`; admin `audit[1]` is `{seq:1, tool:"iris_namespace_list", namespace:"HSCUSTOM", …}`); `sdk-golden-sanctioned-changes.json` (11 entries, all 43.4; the resend append is `43.4/description/iris_message_resend@interop-main` at :75-86).
- **Golden tool indices** (`/result/tools/<i>`):

  | Server | Tool | `main` | `core-preset` |
  |---|---|---|---|
  | dev | `iris_doc_put` | 1 | 1 |
  | dev | `iris_sql_execute` | 10 | 4 |
  | dev | `iris_global_set` | 15 | 6 |
  | dev | `iris_execute_command` | 18 | 8 |
  | dev | `iris_execute_classmethod` | 19 | 9 |
  | dev | `iris_doc_load` | 21 | 11 |
  | dev | `iris_doc_export` | 22 | - |
  | dev | `iris_env_promote` | 27 | - |
  | admin | `iris_service_manage`, `iris_ldap_manage`, `iris_x509_manage` | 22, 23, 24 | - |
  | interop | `iris_production_item`, `iris_message_resend` | 4, 21 | - |
  | ops | `iris_task_run` | 17 | - |

- **Ledger consumers** (registry `T/story-43-4-qa-gate-guards.test.ts:30-37`, frozen-file readers :40, enforced :69-73):
  - `T/story-43-4-sanctioned-golden-changes.test.ts` -- 43.4-only lines: :42-54 and :145-151 (ids, `story === "43.4"`), :153-160 (wire rows only), :162-184 (append rule keyed on the 43.4 sanction), :212-215 ("handler has no entry"), :217-232 (restores only 43.4 descriptions), :247-249 (exactly two story/sanction pairs). Generic and kept: SHA pins :36-39, :188-210, loader refusal tests :257-366.
  - `T/story-43-4-qa-sanctioned-wire.test.ts` -- independent oracle over the raw frozen golden plus a hard-coded 43.4 `SANCTIONED` map (:84-111); :217-228 require every other tool to equal frozen and a gated description to be frozen + separator + sentence.
  - `T/story-43-1-qa-handler-golden.test.ts:65,152,164` -- compares live `audit` with the sanctioned golden (`diffHandlerSession`, `scripts/lib/sdk-handler-golden-core.mjs:211-218`); `T/story-43-1-sdk-wire-golden.test.ts:66,233,262`; `T/story-43-2-cross-era-pin.test.ts:88,277-300`; `T/epic43-capstone-gate.test.ts:106-107,180,192-196` -- all load through the ledger and need no change beyond the entries.
- **Tools-list snapshot**: generator `scripts/gen-tools-list-snapshot.mjs` (bare run refuses; `--force` writes; `--check`), core `scripts/lib/tools-list-snapshot-core.mjs` (`ENTRY_FIELDS` :41); 115 entries `{annotations, description, inputSchema, title}`; header `capturedAt` moves on every regeneration. Nothing links it to the ledger today; today it equals the sanctioned golden's `main` entries.
- **Annotations to flip** (`destructiveHint: false` → `true`; the other three hints stay): `packages/iris-dev-mcp/src/tools/sql.ts:330` (`iris_sql_execute`), `execute.ts:87` (`iris_execute_command`), `execute.ts:1480` (`iris_execute_classmethod`), `doc.ts:400` (`iris_doc_put`), `load.ts:370`, `global.ts:117` (`iris_global_set`), `export.ts:290`, `env-promote.ts:1459`; `packages/iris-admin-mcp/src/tools/ldap.ts:147`, `x509.ts:117`, `service.ts:89`; `packages/iris-interop-mcp/src/tools/item.ts:89` (`iris_production_item`); `packages/iris-ops-mcp/src/tools/task.ts:233` (`iris_task_run`).
- **Annotation pins that move** (search the test trees for each flipped tool; known): `packages/iris-dev-mcp/src/__tests__/sql.test.ts:159-165`, `sql-safety.test.ts:856-862` (titled "keeps its frozen annotations"), `execute.test.ts:220-226,449-455`, `doc-put-storage-guard.test.ts:716-723`, `load.test.ts:546-552`, `global.test.ts:202-208`, `export.test.ts:650`; `packages/iris-interop-mcp/src/__tests__/item.test.ts:200-206`; `packages/iris-ops-mcp/src/__tests__/task.test.ts:375-376`; `T/story-43-3-confirmation-both-eras.test.ts:438-447` ("110 package tools of which 36 are destructive"); `T/story-38-5-qa-sql-wire-gate.test.ts:314-320` (live gate, `toMatchObject` destructive false). Admin tests pin only `readOnlyHint`.
- **Rule #44 cross-check** `T/readonly-hint-crosscheck.test.ts` -- `readOnlyHint` only (:61-158, reverse pin :170-197), via `loadAllTools` (`scripts/lib/tool-catalog.mjs`) and `deriveKeysForTool`. No test checks `destructiveHint` against any independent signal.
- **README Annotations cells**: `packages/iris-dev-mcp/README.md` `iris_doc_put` :146, `iris_doc_load` :150, `iris_doc_export` :151 (`idempotent`), `iris_sql_execute` :185 (`--`), `iris_global_set` :213 (`idempotent`), `iris_execute_command` :221, `iris_execute_classmethod` :222, `iris_env_promote` :238 (`--`); `packages/iris-interop-mcp/README.md:165` (`--`); `packages/iris-ops-mcp/README.md:179` (`--`). The admin README already says `destructive` for service :224, LDAP :230 and X.509 :236. `T/story-38-5-qa-doc-claims.test.ts:224-237` derives the dev `iris_sql_execute`/`iris_sql_query` cells from the real hints.
- **Resend text**: `packages/iris-interop-mcp/src/tools/message-resend.ts` description :364-369, `maxMessages` :433-434, `confirm` :447-448 (`dryRun` :440-441 is accurate). Behavior: `src/ExecuteMCPv2/REST/MessageResend.cls` refuses only `If 'tDryRun && 'tConfirm` (:592-597); over-cap is refused only when executing (:628-636); a preview returns the full `matchCount` (:668-697). The handler asks the dialog only for `dryRun===false && confirm===true` and 1 ≤ matches ≤ cap (message-resend.ts:620-645). Docs: `packages/iris-interop-mcp/README.md:302`. Reference wording (43.4, DW-653): `packages/iris-interop-mcp/src/prompts/resendFailedMessages.ts:70-71`. `README.md:677` ends "No other byte of any description changed.", pinned by `T/story-43-4-doc-claims.test.ts:72`.
- **Audit namespace**: `packages/shared/src/server-base.ts` `recordAuditEntry` :2267 (namespace at :2289; `tool` in scope), `deriveAuditNamespace` :2394-2401 (override else profile namespace); `ToolScope` `packages/shared/src/tool-types.ts:38-46` (SYS "always executes in %SYS regardless of any namespace parameter"). SYS-scoped: 25 tools, all in `@iris-mcp/admin`. Tests asserting HSCUSTOM for SYS-scoped `iris_audit_manage`: `T/story-43-3-confirmation-both-eras.test.ts:101-110` (`base()`; checks at :491, :524-531, :546, :575, :593, :751, :775, :845) and `T/story-43-3-qa-gates.ts:41-54` (`expectedEntry`; callers `story-43-3-qa-hand-gates.test.ts`, `story-43-3-qa-fallback.test.ts`). Shared audit tests use NS tools only (`packages/shared/src/__tests__/audit-interceptor.test.ts:205`, `sdk-wire-compat.test.ts:651-694`).
- **Docs and records**: `CHANGELOG.md` (newest first; 42.1 section at :5 with `### Changed (AD-15 sanctioned)` at :13; the ledger test's `entryOf` finds `## …Story 42.10:`); `.changeset/` (59 files, patch/minor only); `tool_support.md` per-story notes (:218-224); `README.md` Compliance & Auditability (field prose; no `namespace` semantics today); `docs/tool-annotation-audit.md` (2026-04-07, historical, already stale at :48).

## Tasks & Acceptance

**Execution:**

*Machinery (AC 42.10.1):*
- `scripts/lib/golden-sanctioned-changes.mjs` -- Extend the schema so a `handler` entry can address the server's `audit` array (for example `section: "audit"`, `pointer: "/1/namespace"`, no `label`); apply it to `clone.servers[server].audit` with the same `old` check and refusals naming the id; refuse an audit pointer whose element is not a call entry (`seq` present). Keep every existing refusal and the `line` path unchanged. Update the schema comment. -- DW-654 needs it; the loader is the only applier.
- `T/story-43-4-sanctioned-golden-changes.test.ts` -- Widen in place: per-story id lists in ledger order (43.4 then 42.10); a per-sanction shape table for all five sanctions (Design Notes) that fails on an unregistered sanction; `old` checked against wire rows, handler rows and audit elements; the exact-rows check extended to handler rows and audit elements (replacing :212-215); the :217-232 restore generalized to every entry on a row; the CHANGELOG check over every (story, sanction) pair; loader refusal tests for audit entries. Corrections are allowed only under a sanction the table registers as a correction. -- AC 42.10.1.
- `T/story-43-4-qa-sanctioned-wire.test.ts` -- Add independent 42.10 expectations written from this spec (the 13-tool set and the three resend texts) beside the 43.4 map, so each live tool equals frozen + its 43.4 sentence + its 42.10 corrections; a member no entry names still fails; "no other tool names the dialog" stays. -- AC 42.10.1, keeps a second oracle off the loader.
- `T/fixtures/sdk-golden-sanctioned-changes.json` -- Append the 23 entries of Design Notes after the 43.4 entries (19 annotation, 3 resend, 1 audit); update its `description` member to say it holds 43.4 and later stories. -- One entry per moved value.
- `T/story-43-4-qa-gate-guards.test.ts` -- Register the new parity test as a ledger consumer (:30-37). -- The guard requires every loader consumer listed.

*DW-560:*
- `packages/iris-dev-mcp/src/tools/{sql,execute,doc,load,global,export,env-promote}.ts`, `packages/iris-admin-mcp/src/tools/{ldap,x509,service}.ts`, `packages/iris-interop-mcp/src/tools/item.ts`, `packages/iris-ops-mcp/src/tools/task.ts` -- `destructiveHint: true` on exactly the 13 tools at the Code Map lines (`execute.ts` twice: command and classmethod); nothing else in any annotations object moves. -- The Design Notes verdict table.
- `T/readonly-hint-crosscheck.test.ts` -- Add a `destructiveHint` describe (Rule #44 extended): every tool with `readOnlyHint: false` and `destructiveHint: false` is on a `JUSTIFIED_NON_DESTRUCTIVE_WRITES` list with a reason (the five of Design Notes; a stale entry fails); no tool owning an action named `delete`, `remove`, `purge`, `kill` or `clean` declares `destructiveHint: false` (no allowlist); the sweep proves it is not vacuous. -- Mechanical cross-check against declared action names.
- The annotation pins in the Code Map (and any other found by searching the test trees for each flipped tool) -- Expect `destructiveHint: true`; retitle tests that say "frozen"/"unchanged"; the destructive count 36 → 49. -- Rule 19 shared surface.
- `packages/iris-dev-mcp/README.md`, `packages/iris-interop-mcp/README.md:165`, `packages/iris-ops-mcp/README.md:179` -- Annotations cells of the flipped tools gain `destructive` (`destructive, idempotent` where idempotent). -- Docs match the code.
- `docs/tool-annotation-audit.md` -- One-line banner: historical audit of 2026-04-07; current hints live in each tool's source and the tools-list snapshot. -- Stops a stale table reading as current.

*DW-662:*
- `packages/iris-interop-mcp/src/tools/message-resend.ts` -- Description passage, `maxMessages` and `confirm` texts become exactly the Design Notes texts. -- The IRIS handler's real behavior.
- `packages/iris-interop-mcp/README.md:302` -- The same correction in prose (Design Notes). -- Same claim.
- `README.md:677` and `T/story-43-4-doc-claims.test.ts:72` -- Replace "No other byte of any description changed." with "Story 43.4 changed no other byte of any description; Story 42.10 later corrected the dry-run and cap wording of `iris_message_resend` (see the CHANGELOG)." and pin that. -- The old sentence becomes false.

*DW-654:*
- `packages/shared/src/server-base.ts:2289,2394-2401` -- `deriveAuditNamespace` receives the tool; a `SYS`-scoped tool records `"%SYS"`; every other scope keeps today's derivation; the doc comment states the contract. -- AD-19: the trail says where the call ran.
- `packages/shared/src/__tests__/audit-interceptor.test.ts` -- Per-scope tests: SYS with and without a `namespace` argument, a denied SYS call and a schema-invalid SYS call record `"%SYS"`; NS, BOTH and NONE record today's values. -- Matrix row "Audit namespace".
- `T/story-43-3-confirmation-both-eras.test.ts:101-110` and `T/story-43-3-qa-gates.ts:41-54` -- `iris_audit_manage` entries expect `"%SYS"` (`expectedEntry` derives the namespace from the tool's scope). -- They hard-code the old value.
- `README.md` Compliance & Auditability -- One sentence: `namespace` is `%SYS` for a tool that always runs there (the SYS-scoped tools of `@iris-mcp/admin`), otherwise the call's `namespace` argument or the profile's default. -- Rule #43.

*AC 42.10.2:*
- `T/fixtures/tools-list-snapshot.json` -- After `pnpm --filter "./packages/*" build`, regenerate with `pnpm gen:tools-list-snapshot --force`; never hand-edit. -- AD-14.
- `T/story-42-10-snapshot-ledger-parity.test.ts` (new) -- Docs only, no dist: for every server, each tool the frozen golden's `main` `tools-list` lists has a snapshot entry whose `title`, `description`, `inputSchema` and `annotations` deep-equal the sanctioned golden's tool; each dev `core-preset` tool equals its `main` entry; every (row, pointer) chain of ledger entries ends at a value different from the frozen one, with at most one entry per sanction. -- "Each byte that moved has exactly one sanctioned entry", pinned without a build.

*Records:*
- `CHANGELOG.md` -- New top section `## [Pre-release — 2026-10-21] — Story 42.10: Pre-1.0 Tool-Surface Corrections` with `### Changed (AD-15 sanctioned)` naming `` `S-42.10-annotations` `` (the 13 tools), `` `S-42.10-resend-text` `` and `` `S-42.10-audit-namespace` ``; say the snapshot was regenerated, the goldens are byte-unchanged with 23 new ledger entries, no tool, key, schema key or class changed, the baseline stays `1e62c5ad5bf7` (141 keys), and DW-652 is not in this story. -- AD-15.
- `.changeset/story-42-10-pre-1-0-tool-surface-corrections.md` -- `patch` for `@iris-mcp/shared`, `dev`, `admin`, `interop`, `ops`. -- AD-29.
- `tool_support.md` -- One Story 42.10 note: no tool count moves (110 package tools, 115 advertised); 13 hints corrected; SYS-scoped audit namespace. -- Precedent of Story 40.4's note.
- `T/story-42-10-doc-claims.test.ts` (new) -- Pins each flipped tool's README Annotations cell contains `destructive`; the interop README bullet and the resend tool text carry the corrected clauses and not "otherwise the call is refused"; the root README audit sentence and the scoped 43.4 sentence; the CHANGELOG section's sanctioned heading names the 13 tools. -- Rule #43 doc claims.

**Acceptance Criteria:**
- Given the ledger with the 43.4 and 42.10 entries, when `story-43-4-sanctioned-golden-changes.test.ts`, `story-43-4-qa-sanctioned-wire.test.ts` and the Epic 43 golden tests run against freshly built servers, then all are green, both frozen files keep their SHA-256, and each widened check is shown red by its recorded mutation.
- Given every package built, when `pnpm gen:tools-list-snapshot:check` and `story-42-10-snapshot-ledger-parity.test.ts` run, then both pass, and `git diff` of the snapshot shows only the 13 `destructiveHint` values, the three resend texts and the header's `capturedAt`.
- Given the built servers, when `tools/list` is read on every server, then exactly the 13 verdict-table tools changed `destructiveHint` from `false` to `true`, and the `destructiveHint` cross-check is green with five justified non-destructive writes.
- Given an `iris_message_resend` client, when it reads the tool description and the `maxMessages`/`confirm` schema texts, then they say that only `dryRun: false` without `confirm: true` is refused, that omitting `dryRun` previews, and that an over-cap count is refused only when executing.
- Given `IRIS_AUDIT_LOG` and a SYS-scoped admin call (with or without a `namespace` argument), when the call ends ok, denied or schema-invalid, then its entry records `"namespace":"%SYS"`, and NS/BOTH/NONE entries are byte-identical to before.
- Given the default suite, when `pnpm gen:governance-baseline:check` runs, then it is clean, and no input-schema key, tool, action or governance key was added or removed.

## Spec Change Log

## Review Triage Log

## Design Notes

**Governing ADs (Rule 6):** AD-4 (annotations follow the MCP definitions; an existing hint changes only through AD-15; no `action` enum on a frozen-baseline tool; Rule #44 cross-check), AD-15 (sanctioned changes, named in the CHANGELOG), AD-19 (one entry per call; schema stays additive), AD-3 (scope decides namespace resolution), AD-17 (the resend bounds the text must describe), AD-34 (the 43.4 dialog passage stays byte-identical), AD-2 (cross-package tests in `iris-mcp-all`), AD-14 (generated artifacts only via generators). Conventions: Frozen goldens, Tool annotations, Tool descriptions, Live testing on a shared instance (no IRIS writes). AD-24 is not touched here (DW-652 is split out).

**Rule 2 (extend, don't copy):**
- The audit section extends `applySanctionedChanges`; it is not a second loader.
- The `destructiveHint` cross-check is a new describe in `readonly-hint-crosscheck.test.ts`, reusing its `loadAllTools`/`deriveKeysForTool` setup.
- The 43.4 ledger and QA tests are widened in place, not copied per story.
- The parity test reuses `readSanctionedGolden` and the snapshot file; it is a sibling of `tools-list-snapshot.test.ts` because it needs no dist.
- `expectedEntry` in `story-43-3-qa-gates.ts` is made scope-aware rather than duplicated.

**Integration ACs:** the matrix row "Integration: handler-golden consumer" (the handler-golden test consumes the widened loader and the real admin server's audit entry).
- **Consumed-by:** Story 42.11 (proposed; its `allowStorageRegeneration` parameters move `inputSchema` bytes through this ledger: with no `add` op, it replaces the parent `properties` object, or adds an `add` op as its own machinery change); Story 42.6 (publishes only with every golden test green); every later sanctioned change.
- **Consumes:** the Story 43.4 ledger and goldens (frozen), the Story 43.3 audit `confirmation` behavior (unchanged).

**Sanctions and ledger entries.** Ids follow `<story>/<sanction-tail>/<subject>@<server-short>-<session>`. The 23 entries, appended in this order:
- `S-42.10-annotations` (19, wire, `tools-list`, `replace`, pointer `/result/tools/<i>/annotations/destructiveHint`, `old: false`, `new: true`): dev `main` and `core-preset` for `iris_doc_put`, `iris_sql_execute`, `iris_global_set`, `iris_execute_command`, `iris_execute_classmethod`, `iris_doc_load` (12); dev `main` for `iris_doc_export`, `iris_env_promote` (2); admin `main` for `iris_service_manage`, `iris_ldap_manage`, `iris_x509_manage` (3); interop `main` for `iris_production_item` (1); ops `main` for `iris_task_run` (1).
- `S-42.10-resend-text` (3, wire, interop `main` `tools-list`, `replace`, a correction, no `appendOnly`): `/result/tools/21/description` (`old` = the 43.4 entry's `new`), `/result/tools/21/inputSchema/properties/maxMessages/description`, `/result/tools/21/inputSchema/properties/confirm/description`.
- `S-42.10-audit-namespace` (1, handler, audit section): `iris-admin-mcp`, pointer `/1/namespace`, `old: "HSCUSTOM"`, `new: "%SYS"`; the audited tool is SYS-scoped.

The ledger test's shape table registers exactly these five sanctions: the two 43.4 shapes as today; `S-42.10-annotations` as above, with the tool at the pointer in the verdict table's flipped set; `S-42.10-resend-text` as a correction on tool 21 of interop `main` at those three pointers only; `S-42.10-audit-namespace` as above.

**`destructiveHint` verdicts** (AD-4: destructive = can delete, or irreversibly overwrite, existing state; Rule #56 sweep of all 18 tools with `readOnlyHint: false` and `destructiveHint: false`, 2026-10-21):

| Tool | Verdict | Why |
|---|---|---|
| `iris_sql_execute` | true | DELETE, UPDATE, DROP, TRUNCATE |
| `iris_execute_command` | true | arbitrary ObjectScript (Kill) |
| `iris_execute_classmethod` | true | calls any class method |
| `iris_doc_put` | true | replaces an existing document's content |
| `iris_doc_load` | true | default `ignoreConflict: true` overwrites server copies unconditionally |
| `iris_global_set` | true | overwrites a node's value; the old value is not returned |
| `iris_env_promote` | true | `execute` overwrites target documents, settings, webapps, config; a mapping is replaced by delete+create |
| `iris_doc_export` | true | `overwrite` `ifDifferent` (default) and `always` rewrite existing local files (Rule #56 addition) |
| `iris_ldap_manage` | true | `delete` |
| `iris_x509_manage` | true | `delete` |
| `iris_service_manage` | true | `disable` can switch off the service the tool itself reaches IRIS through (for example `%Service_WebGateway`), which the tool cannot undo; `set` overwrites the auth bitmask and client list. Fail-safe side (Rule #44); the admin README and the 43.3 occurrence already call it destructive |
| `iris_production_item` | true | `remove` deletes the item; `set` rewrites the production XData |
| `iris_task_run` | true | runs any configured task, including IRIS's default purge tasks (Rule #56 addition) |
| `iris_analytics_cubes` | false (justified) | `build`/`sync` replace derived cube data, rebuildable from the source class |
| `iris_doc_compile` | false (justified) | regenerates derived code from unchanged source |
| `iris_execute_tests` | false (justified) | runs `/noload/nodelete`; kept by Story 40.4 decision #63 |
| `iris_production_autostart` | false (justified) | sets one setting that `get` returns and `set` restores |
| `iris_transform_test` | false (justified) | runs a transform in memory and persists nothing |

**Corrected resend texts (DW-662; the `—` is the existing em dash):**
- Description, replacing the passage from "executing requires" to "and retry.": `executing requires BOTH dryRun:false AND confirm:true: dryRun:false without confirm:true is refused with no changes made, and leaving dryRun out previews again. maxMessages caps the batch (default 100, HARD CAP 500) — an executing call whose match count is over the cap is refused (not truncated-and-executed), while a preview reports the full count; narrow the window or item filter and retry.`
- `maxMessages`: `(resendFiltered) Cap on matched/resent messages (default: 100, HARD CAP: 500). An executing call whose match count is over this cap is refused, not truncated-and-executed; a preview reports the full count.`
- `confirm`: `(resendFiltered) Must be true together with dryRun:false to execute the resend; dryRun:false without confirm:true is refused with no changes made. Ignored while dryRun is true or omitted (the call previews).`
- Interop README :302, replacing the text from "executing requires **both**" to "(not truncated-and-executed).", in the README's own Markdown (code spans around `dryRun:false`, `confirm:true`, `dryRun` and `maxMessages`, bold on "both"):

  > executing requires **both** `dryRun:false` AND `confirm:true` — `dryRun:false` without `confirm:true` is refused with no changes made, and leaving `dryRun` out previews again. `maxMessages` caps the batch (default 100, hard cap 500) — an executing call whose match count is over the cap is refused (not truncated-and-executed), while a preview reports the full count.

**Audit namespace rule (DW-654):** a `SYS`-scoped tool records `"%SYS"` (where it always runs, `tool-types.ts:41`), whatever its `namespace` argument says; the argument still appears in `paramKeys` and, under `IRIS_AUDIT_LOG_PARAMS=true`, in `params`. NS, BOTH and NONE keep today's derivation (see `deferred:`).

**Spine amendments (drafted for the lead, decision 3; Rule 20):**
- Frozen goldens convention, last sentence → "The tests apply the entries and compare every other byte unchanged. An entry may come from any story after the capture; a description change appends unless its sanction is a recorded correction, which replaces the text; a handler entry can address the server's `audit` array (Story 43.4, wave-8 decision #23; Story 42.10)."
- AD-4 Annotations → replace the "Known divergences" sentence with "Story 42.10 corrected 13 existing tools to `destructiveHint: true` (DW-560); a non-read-only tool that declares `destructiveHint: false` is on a justified list, and no tool with a delete, remove, purge, kill or clean action may declare it, both checked mechanically."
- AD-19 Schema → add "`namespace` is the namespace the call ran in: `%SYS` for a `SYS`-scoped tool, otherwise the call's override or the profile's default (Story 42.10, DW-654)."
- AD-15 sanctioned list → add a **Story 42.10** bullet naming `S-42.10-annotations`, `S-42.10-resend-text` and `S-42.10-audit-namespace`.
- `## Deferred` → remove "Annotation divergences of existing tools".

**Decided at the spec gate (2026-10-21):** all three recommendations were accepted as written. They are wave-8 orchestrator decisions #38 (DW-652 moves to Story 42.11, `42-11-storage-guard-on-every-document-write`, which runs right after this story), #39 (the 13-tool `destructiveHint` verdict table) and #40 (the lead wrote the drafted spine amendments: the Frozen goldens convention, AD-4, AD-19, AD-15's Story 42.10 bullet, and the Deferred entry removed; `lint_spine.py` is clean). The implement stage does not edit the spine; it only checks that `lint_spine.py` stays clean.

**Orchestrator decisions needed (as planned):**
1. **Orchestrator decision needed: split DW-652 out of 42.10 into a new Story 42.11, run after 42.10 and done before 42.6 — recommended: split, proposed key `42-11-storage-guard-on-every-document-write`, because** DW-652 alone is a 38.3-sized feature: three distinct guard designs (below), a sanctioned default-behavior change of `iris_doc_load`, a new parameter on three tools moving `inputSchema` bytes, rewrites of `document-write-paths.test.ts` and `story-38-3-qa-doc-claims.test.ts`, existing fakes that break (`env-promote-execute.test.ts:919-922`, `load.test.ts:448-456`, `story-38-7-qa-live-gate.test.ts:338-355`), a new live gate on the shared instance, DW-544/545/546 adjudication and the AD-24 amendment. The rest of 42.10 is already about 45 files (23 ledger entries, 13 tool sources, about 15 test files, 6 docs). A split also keeps the data-safety review apart from mechanical text work, and 42.11 consumes this story's machinery (a clean seam, Rule #52). Alternative: keep DW-652 here (about 65 files and one review over both risk domains).
2. **Orchestrator decision needed: the `destructiveHint` set is 13 tools — recommended: accept the verdict table, because** it applies AD-4's own definition to every one of the 18 candidates (Rule #56): the three DW-560 names, seven of the eight occurrence candidates (`iris_service_manage` included, on the fail-safe side), and two the sweep found (`iris_doc_export`, `iris_task_run`). Decision #18 sanctioned "the destructiveHint correction before 1.0"; the two additions and `iris_service_manage` are this plan's verdicts. Alternative: flip only the 3 + 7 listed tools (10), leaving `iris_doc_export` and `iris_task_run` as recorded divergences.
3. **Orchestrator decision needed: who writes the spine amendments AC 42.10.1 requires — recommended: the lead, at the spec gate, using the drafted text above, because** Rule 20 writes a decision into the spine at the moment it is made and the implement stage never edits planning artifacts; the implement stage only verifies them (`lint_spine.py`). The AD-24 amendment moves to 42.11 with DW-652.

**Declined DW-652:** moved to proposed Story 42.11 (decision 1). An inputSchema change on three tools plus three guard designs; not part of this story's text and audit corrections.

**DW-652 handoff for Story 42.11** (plan probe 2026-10-21; corrects the 42.1 notes: the PUT is `env-promote.ts:853-854` and the dialog `:1187-1193`, not :869/:853; `iris_env_promote` is post-foundation, not frozen-baseline, but a parameter is still right because AD-4 fixes the enum in a tool's first story):
- **Shared guard** `packages/shared/src/storage-guard.ts`: `storageDefinitionNames` (UDL and XML, :38), `droppedStorageDefinitions` (:50-60), `storageDroppedRefusal` (one document, :76-95); `iris_doc_put`'s 409 flow `doc.ts:433-474` with `currentDocument` `:348-355` (already imported by `load.ts:26`); the override is `allowStorageRegeneration` (`doc.ts:389-396`).
- **`iris_doc_load`**: a per-file guard for classes between the identity check (`load.ts:463`) and the PUT (`:477`), copying the doc.ts 409 flow; a drop is a `failures[]` entry with `code: STORAGE_DROPPED` and `droppedStorage`, other files continue; an `allowStorageRegeneration` parameter; the default single-PUT pins need sanctioning.
- **`iris_doc_xml_export` import** (`format.ts:197-271`, one `action/xml/load` POST for all classes): a per-class XML Storage map extending `xmlStorageNames` (`storage-guard.ts:130-158`, which ignores class boundaries), a GET of each class's current copy (404 = new), and a whole-import refusal before the POST; an `allowStorageRegeneration` parameter.
- **`iris_env_promote` execute**: a GET-only preflight after `:1185` and before the dialog (`:1188`), reusing the checked source text in `runDocumentsBatch` (`:838-854`, no TOCTOU); a probe PUT would create a new document before the dialog; with the override, the dialog `scope` names the drops (as `doc-edit.ts:580-587`).
- **Rosters**: `T/document-write-paths.test.ts:72-160` (three `excluded` entries become `guarded`; :291-316), `T/story-38-3-qa-doc-claims.test.ts:303-336`, `packages/iris-dev-mcp/README.md:380`; live gate roster `packages/iris-dev-mcp/scripts/prepublish-gate.mjs:73-102`; fixtures `ExecuteMCPv2.Temp.*` as in `doc-put-storage-guard-live-gate.test.ts:28-123`.

**AC reinterpretations:**
- AC 42.10.1's "AD-24 … amended" moves to 42.11 with DW-652 (decision 1).
- "The loader reaches the handler golden's `audit` array" is planned as an audit-section addressing mode of the existing loader.
- "A sanctioned entry can correct text it replaces" is planned as a `replace` without `appendOnly` under a sanction the ledger test registers as a correction; `S-42.10-resend-text` is the first.
- AC 42.10.2's "each byte that moved" is read over the tool entries; the snapshot header's `capturedAt` moves with every regeneration and is metadata.

**Ledger inbox:** DW-560 → the DW-560 tasks and the annotation matrix row; DW-662 → the DW-662 tasks and the resend matrix row; DW-654 → the DW-654 tasks, the audit matrix rows and the loader task; DW-652 → declined above.

## Verification

Build first, once per source change: `pnpm --filter "./packages/*" build` (timeout 600000). Run every command from `/Users/jbrandt/git/iris-execute-mcp-v2`, each in its own foreground call with `timeout: 600000`.

**Commands:**
- `(loop)` `pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/audit-interceptor.test.ts src/__tests__/server-base.test.ts src/__tests__/sdk-wire-compat.test.ts` -- expected: green.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-43-4-sanctioned-golden-changes.test.ts src/__tests__/story-43-4-qa-sanctioned-wire.test.ts src/__tests__/story-43-4-qa-gate-guards.test.ts src/__tests__/story-43-4-doc-claims.test.ts src/__tests__/story-42-10-snapshot-ledger-parity.test.ts src/__tests__/story-42-10-doc-claims.test.ts src/__tests__/readonly-hint-crosscheck.test.ts src/__tests__/tools-list-snapshot.test.ts` -- expected: green.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-43-1-qa-handler-golden.test.ts src/__tests__/story-43-1-sdk-wire-golden.test.ts src/__tests__/story-43-2-cross-era-pin.test.ts src/__tests__/epic43-capstone-gate.test.ts src/__tests__/story-43-3-confirmation-both-eras.test.ts src/__tests__/story-43-3-qa-hand-gates.test.ts src/__tests__/story-43-3-qa-fallback.test.ts src/__tests__/story-38-5-qa-doc-claims.test.ts` -- expected: green.
- `(loop)` `pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/sql.test.ts src/__tests__/sql-safety.test.ts src/__tests__/execute.test.ts src/__tests__/doc-put-storage-guard.test.ts src/__tests__/load.test.ts src/__tests__/global.test.ts src/__tests__/export.test.ts` -- expected: green.
- `(loop)` `pnpm --filter @iris-mcp/admin test`, `pnpm --filter @iris-mcp/interop test`, `pnpm --filter @iris-mcp/ops test` (three calls) -- expected: green.
- `(loop)` `pnpm gen:tools-list-snapshot:check` -- expected: clean.
- `(once)` `pnpm --filter <pkg> test` for each of `@iris-mcp/shared`, `dev`, `data`, `client-config` and `all` (one call each; split `@iris-mcp/all` by file globs if it would pass 10 minutes) -- expected: green.
- `(once)` `pnpm --filter <pkg> type-check` and `pnpm --filter <pkg> lint` for the 7 TypeScript packages -- expected: green.
- `(once)` `pnpm gen:governance-baseline:check`, `pnpm gen:skills:check`, `pnpm gen:pack:check`, `pnpm check:provenance`, `pnpm validate:prompts` -- expected: all clean.
- `(once)` `git diff --stat -- packages/iris-mcp-all/src/__tests__/fixtures/sdk-wire-golden.json packages/iris-mcp-all/src/__tests__/fixtures/sdk-handler-golden.json` -- expected: empty.
- `(once)` `uv run --no-cache .claude/skills/bmad-architecture/scripts/lint_spine.py --workspace _bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14` -- expected: clean, and the spine carries the lead's amendments (decision 3).

**Mutations to apply and record** (`mutation: <change> → <red test>`, one per AC and per widened check; apply to the real file, observe red on the path it guards, restore from a scratchpad copy, compare byte-identical with `cmp`, `git status --short` unchanged):
- Loader audit section: the apply branch skips audit entries → red: the ledger test's handler/audit exact-diff row and `story-43-1-qa-handler-golden.test.ts` (admin).
- Later stories: restore `changes.every((c) => c.story === "43.4")` → red; an unregistered sanction id on one 42.10 entry → red, naming it.
- Corrections: mark the resend description entry `appendOnly: true` → red (loader); register `S-42.10-resend-text` as append-only in the shape table → red.
- QA sanctioned-wire: drop one tool from its 42.10 flipped set → red for that tool.
- DW-560: `iris_task_run` back to `destructiveHint: false` (ops rebuilt) → red: the cross-check, the wire-golden test and the snapshot check; add `iris_ldap_manage` to the justified list → red (delete action).
- DW-662: the old `confirm` text restored (interop rebuilt) → red: the wire-golden test, the QA sanctioned-wire test and `gen:tools-list-snapshot:check`.
- DW-654: `deriveAuditNamespace` ignores the scope again (shared rebuilt) → red: the new per-scope tests and the admin handler-golden row.
- AC 42.10.2: delete one `S-42.10-annotations` entry → red: the parity test, naming server, tool and field.

**Shared surfaces:** `tools-list-snapshot.json`, `sdk-golden-sanctioned-changes.json` (and the ledger consumer registry in `story-43-4-qa-gate-guards.test.ts`), the 13 tools' annotations and every test pinning them, the destructive count (36 → 49), the SYS-scoped audit `namespace` asserted by the 43.3 tests, the README Annotations cells, the root README :677 sentence pinned by `story-43-4-doc-claims.test.ts`, and the `CHANGELOG.md` top section.

**Standing criterion:** every test added or changed passes on a fresh environment, in either order; the new tests read only committed files and built dists, and create no state.

**IRIS:** no check of this story touches IRIS, writes the shared instance, or runs an OS %UnitTest class, so no `ExecuteMCPv2.Temp.*` fixture is used. The live gate `story-38-5-qa-sql-wire-gate.test.ts` changes statically and is not armed here. Pre-existing live legs in full suites may answer from localhost:52773 (DW-627) and write only their own disposable fixtures; run each suite in its own call, never re-submitted.

## Auto Run Result

Status: ready-for-dev
Blocking condition: none
