---
title: 'Story 38.4: Surgical Line Edit Tool'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_revision: '364be6ded31a8e08f79c8c26137ce2e2f1ac2042'
baseline_commit: '364be6ded31a8e08f79c8c26137ce2e2f1ac2042'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings:
  - oversized
deferred:
  - summary: >-
      Project Rule #53 still states the `core` ceiling as "<=13 runtime tools/server", although Project Lead decision L-4 makes 13 a guideline and dev `core` is now 14.
    evidence: |-
      `.claude/rules/project-rules.md` #53 says "`core` stays the everyday loop (<=13 runtime tools/server - when in doubt, EXCLUDE from `core`)". Story 38.4 ships dev `core` at 14 runtime tools under L-4, pinned by `presets.test.ts`. The fix edits an agent-context file (rules), so it is left to the lead.
    location: >-
      .claude/rules/project-rules.md (#53)
    severity: low
---

<intent-contract>

## Intent

**Problem:** To change a few lines of an existing class or routine, an agent must resend the whole document through `iris_doc_put`. That is expensive for large classes. It is also blind to lines that changed since the agent read them, and one omission away from dropping a Storage block (G2). The governance engine also has no way to say that a new key re-exposes an existing key's capability, so an operator who disabled `iris_doc_put` would still find line edits enabled.

**Approach:** Add the dev tool `iris_doc_edit`. It has two actions:
- `apply`, a guarded write that is enabled by default;
- `regenerateStorage`, a default-disabled override.

The tool reads the document with one GET. It checks every edit's `expected` text against what it read, applies all edits bottom-up, and saves them in one PUT that carries `If-None-Match: <ts>`. It answers from a re-read: a unified diff, an excerpt of each edit, and the new `totalLines`.

It reuses 38.2's line numbering and 38.3's Storage guard and refusal catalog unchanged. It extends `lines.ts` with splitting, joining and a small line diff. It also adds the governance `parent` mechanism (AD-4/AD-6): when an operator explicitly disables `iris_doc_put`, `iris_doc_edit` seeds disabled.

## Boundaries & Constraints

**Always:**
- **Numbering.** Line N is element N-1 of the `GET /doc` `content` array after `documentLines` strips one BOM (38.2). Edits address the document as this tool reads it. The tool reads it with the same request `iris_doc_get` makes without a range: `get(<path>)`, with no query.
- **Parsing `text` and `expected`.** `text` and `expected` are parsed by `textToLines`:
  1. one leading BOM is removed;
  2. one trailing `\r?\n` is dropped;
  3. the rest is split on `\r?\n`.

  So `"a\nb\n"` and `"a\r\nb"` are both `["a","b"]`, and `""` is one empty line. A replace or insert therefore always writes at least one line; `delete` removes lines.
- **Checks before any write.** Every check runs before any write:
  - shape and overlap checks run before any request;
  - the range, `expected` and Storage checks run after the one GET.

  Then there is exactly one PUT. It carries `If-None-Match` equal to the GET's `ts`, and never `ignoreConflict`. A 409 on it is `DOCUMENT_CONFLICT` and is never retried. The success output comes from a re-read GET, never from the locally edited array.
- **Refusals and errors.**
  - A refusal is `isError: true` and writes nothing. It carries a catalog code: `STALE_CONTENT` (new), or `STORAGE_DROPPED` and `DOCUMENT_CONFLICT` (both reused from 38.3).
  - Argument and range errors are `isError: true` with no `structuredContent` and no code.
  - Error text has the form `<what happened>. <what to do about it>.`
- **Line preservation.** Lines that no edit touches are sent byte-identical to the read: tabs, trailing spaces and a trailing `\r` all stay.
- **Governance and back-compat.** With no parent explicitly disabled, every existing key's effective value, `configSource` and denial text are byte-identical to today.
- **Source text.** Source text is ASCII (Rule 14), and comments state the contract.
- **Live checks.** Live checks name their target (the six `IRIS_*` variables). They write only the `ExecuteMCPv2.Temp.QaStory384*` fixtures named under Verification, and remove them before and after the run.

**Never:**
- **Existing document tools.** Do not change the behavior, schema or description of `iris_doc_put`, `iris_doc_get` or `iris_doc_load`. Only the split call sites move, with byte-identical results. Do not change `storage-guard.ts` or 38.3's refusal texts. Do not fix DW-542 or DW-549.
- **Governance baseline and bootstrap.**
  - No `action` enum and no annotation change on any frozen-baseline tool.
  - No edit of `governance-baseline.ts`, `baseline-classifications.ts`, `bootstrap-classes.ts` or `src/ExecuteMCPv2/**`; `BOOTSTRAP_VERSION` stays `3af8ca401e7c`.
  - Never run the bare baseline generator.
- **Scope of `iris_doc_edit`.**
  - No compile inside the tool.
  - No `ts`, `ignoreConflict` or `allowStorageRegeneration` parameter.
  - No new npm dependency: the diff is written by hand.
  - No import of `@iris-mcp/client-config` from shared or any server.
- **Presets and audit.**
  - No other tool's preset rows change, and no tool leaves `core`.
  - No audit-entry schema change: `inheritedFrom` is not copied into the audit log.
- **Release.** No `changeset version`, no publish and no CI wiring (AD-29).

## I/O & Edge-Case Matrix

**Notation.**
- **G** is `get(<path>)`, where `<path>` is `atelierPath(v, ns, "doc/" + encodeURIComponent(name))`, with no query.
- **Pv** is `put(<path>, {enc:false, content:<edited lines>}, {headers:{"If-None-Match":<G ts>}})`.
- **R** is the re-read `get(<path>)` after Pv.
- "Doc" is the G `result`, with fields `{name, db, ts, upd, cat, status:"", enc:false, flags, content}`.
- `<n>` is the document name, `<ns>` the namespace, `<i>` a 1-based edit number, and `T` the read's line count.
- `<desc i>` describes edit `i` in the read's numbering: `insert after line <a>`, `delete lines <s>-<e>` or `replace lines <s>-<e>`.
- `<usage>` depends on the op:
  - insert: `An insert takes afterLine, text and expected`;
  - delete: `A delete takes startLine, endLine and expected`;
  - replace: `A replace takes startLine, endLine, text and expected`.
- An insert's anchor is line `a`, or line 1 when `a` is 0.

**Texts.**
- **ST** (`STALE_CONTENT`):
  - The text starts `Document '<n>' was not changed in namespace '<ns>': the expected text of edit <i> does not match the document now. Nothing was stored. Retry with the current text below as expected, or read the lines again with iris_doc_get.`
    - With several mismatches it reads `edits <i>, <j>` and `do not match`.
  - Then, for each mismatch, a blank line and `Edit <i> (<desc i>), current text:` followed by `formatNumberedLines(current, s)`.
    - An insert's heading is `Edit <i> (<desc i>), current text of line <anchor>:`.
  - `structuredContent` is `{code:"STALE_CONTENT", name, namespace, ts, totalLines, mismatches:[{edit, op, startLine, endLine, current}]}`.
    - `current` is `joinLines` of the current lines.
    - For an insert, `startLine = endLine = anchor`.
- **CF** (`DOCUMENT_CONFLICT`): `Document '<n>' was not changed in namespace '<ns>': it changed on the server after this tool read it. Nothing was stored. Read the lines again with iris_doc_get and retry the edits against the current text.` Its `structuredContent` is `{code, name, namespace}`.
- **SR** (the Storage remedy, passed to `storageDroppedRefusal`): `Keep the Storage definitions in the edited lines, or run the same edits with action regenerateStorage (disabled unless an operator enables it) to let IRIS regenerate the storage.`
- **OK** (success):
  - The text is `Document '<n>' edited in namespace '<ns>': <N> edits applied; it has <T'> lines now (ts <ts'>). It is not compiled: run iris_doc_compile next.`, with `1 edit applied` for a single edit. Then come a blank line and the unified diff, then, for each edit, a blank line, `Edit <i> (<desc i>), now lines <x>-<y>:` and the numbered excerpt.
  - `structuredContent` is `{name, namespace, ts, totalLines, changed:true, unifiedDiff, excerpts:[{edit, op, startLine, endLine, lines}]}`.
- **NC** (no change): `Document '<n>' in namespace '<ns>' already has the edited text, so nothing was saved; it has <T> lines (ts <ts>).` Its `structuredContent` is the OK shape with `changed:false`, `unifiedDiff:""`, the read's `ts`, and excerpts taken from the read.

**Diff and excerpts (AC-5).**
- `unifiedDiff` compares the read (G) with the re-read (R). It starts with `--- <n>\t<G ts>` and `+++ <n>\t<R ts>`.
- It follows the `diff -U3` hunk conventions:
  - 3 context lines;
  - hunks closer than 7 unchanged lines are merged;
  - `@@ -s,c +s,c @@`, with `,c` omitted when c is 1, and an empty range named by the line before it (`diff -U3` form: `@@ -1 +0,0 @@` for a 1-line file emptied, `@@ -0,0 +1 @@` for one line into an empty file; corrected by the lead at dev_complete, see Spec Change Log 2026-10-15).
- Lines are prefixed with a space, `-` or `+`, and joined with `\n`, with no trailing newline.
- Excerpt `i` is the re-read lines that edit `i` produced, plus 3 context lines on each side, clamped to the document. These lines are found as follows:
  1. The edit's lines are located in the locally edited array, which the bottom-up arithmetic makes exact.
  2. They are carried into R through `alignLines(edited, R)`. Their region is bounded by the nearest paired line above them and the nearest paired line below them.
  3. When IRIS stored the text as sent, the pairing is the identity.

  A delete's excerpt is the context around the deletion point.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Replace | doc 10 lines; `replace 4-5`, correct `expected` | G, Pv with lines 4-5 replaced, R; OK; exactly 3 requests | No error expected |
| Several edits | `insert after 2` + `delete 6-7` + `replace 9`, in any input order | bottom-up application against the read numbering; one Pv; the result is independent of input order | No error expected |
| Insert at top | `insert afterLine:0`, `expected` = line 1 | text goes before line 1 | No error expected |
| Last line | class: replace line T (the trailing `""`); routine with no trailing `""`: replace line T | applied; a routine keeps no trailing `""` | No error expected |
| Text forms | `text`/`expected` with CRLF, LF, tabs, a trailing newline or none, a leading BOM, multi-line `expected` | parsed by `textToLines`; untouched lines unchanged | No error expected |
| Empty text | `replace 3-5`, `text:""` | lines 3-5 become one empty line | No error expected |
| IRIS reformats | class: `insert after 5` of a member with no blank line | R has IRIS's added blank line; `unifiedDiff` and excerpt `i` show it (live probe 1) | No error expected |
| No change | edits whose result equals the read | NC; no Pv, no R | No error expected |
| Stale | any `expected` differs from the read (wrong text, or wrong line count) | ST listing every mismatch; G only | `isError` |
| Conflict | Pv answers 409 | CF; exactly one Pv | `isError` |
| Storage drop | `.cls`, `apply`, edits remove a Storage definition | `storageDroppedRefusal(n, ns, dropped, SR)`; G only | `isError` |
| Override | same, `action: regenerateStorage` | G, Pv, R; OK | No error expected |
| Non-class | `.mac`/`.inc`, any action | never scanned for Storage | as the rows above |
| Shape | an edit missing a field its `op` needs, carrying one it does not take, or with `startLine > endLine` | `Edit <i> (<op>) is missing <f>. <usage>.` / `... does not take <f>. <usage>.` / `Edit <i> (<op>): startLine <s> is after endLine <e>. Pass a startLine that is less than or equal to endLine.`; no request | `isError` |
| Overlap | two edits share a line, or one insert's position lies inside a range, or two inserts share a position | `Edits <i> and <j> overlap: <desc i> and <desc j> address the same lines. Combine them into one edit, or address lines that do not overlap.` (the first overlapping pair in read order); no request | `isError` |
| Range | a line past T (or `afterLine > T`) | `Edit <i> (<op>) addresses line <k>, but document '<n>' has <T> lines. Read the lines again with iris_doc_get and address lines 1 to <T>.`; G only | `isError` |
| Missing doc | G 404 | `Document '<n>' not found in namespace '<ns>'. iris_doc_edit changes an existing document; create it with iris_doc_put.` | `isError` |
| Unreadable / binary | G soft error (`status` non-empty) or no array; `enc:true` | `Document '<n>' could not be read in namespace '<ns>': <reason>. Check the document name and namespace, then retry.` (38.2's text); `Document '<n>' is a binary document, and line edits apply only to text. Replace it with iris_doc_put.` | `isError` |
| Soft error on save | Pv returns 200 with non-empty `result.status` (live probe 4) | `Document '<n>' was not saved in namespace '<ns>': <status>. Nothing was stored; correct the edits and retry.`, `structuredContent {name, namespace, status}`; no R | `isError` |
| Re-read fails | Pv saved, R throws or soft-errors | `Document '<n>' was saved in namespace '<ns>', but reading it back failed: <msg>. The edits are applied: do not repeat them. Read the document with iris_doc_get to see the result.`, `structuredContent {name, namespace, saved:true, ts:<Pv result ts>}` | `isError` |
| Other errors | 423, 500 or a network error on G or Pv | propagated as today (`Tool error: ...`) | propagated |

**Governance** (through the real `McpServerBase.handleToolCall`; `D` is a `GOVERNANCE_DISABLED` denial):

| Scenario | Configuration | Expected |
|---|---|---|
| Defaults | none | `apply` runs; `regenerateStorage` gives D without `presetApplied`; `iris_server_profiles` `configSource` is `default` for both |
| Read-only | `IRIS_GOVERNANCE_PRESET=read-only` | `apply` gives D with `presetApplied:"read-only"` |
| Inherited | `IRIS_GOVERNANCE` `{global:{iris_doc_put:false}}`, or the same key at the env profile, file profile or file global layer | both keys give D with `inheritedFrom:"iris_doc_put"`, text `... for server '<s>' (inherited from 'iris_doc_put')`; policy `false` and `configSource` `parent` for both keys; profile-scoped (another profile is unaffected) |
| Child wins | inherited + `{"iris_doc_edit:apply":true}` at any explicit layer | `apply` runs; `configSource` is `env` or `file` |
| Parent enabled higher | env `{iris_doc_put:true}`, file `{iris_doc_put:false}` | the parent's explicit verdict is `true`, so `apply` runs (orchestrator decision 1) |
| Inherited + read-only | both | D with `inheritedFrom` and no `presetApplied` |
| Override enabled | `{"iris_doc_edit:regenerateStorage":true}` | the `regenerateStorage` handler runs |
| Registration | `parent` names a key that is neither a baseline key nor a registered key; equals the tool's own key; names a key that itself has a parent; or is declared by a tool with a baseline key | construction throws, naming the tool and the parent |
| Hidden parent | `IRIS_TOOLS_DISABLE=iris_doc_put` | construction succeeds (a baseline key), and inheritance still applies |

</intent-contract>

## Code Map

- `packages/shared/src/lines.ts` (109 lines) -- the one line utility (AD-24). It exports `stripLeadingBom`, `stripLeadingBomFromLines`, `documentLines`, `linesInRange`, `formatNumberedLines` and `NUMBERED_LINE_WIDTH`. The barrel is at `packages/shared/src/index.ts:31-39`. Its tests are in `src/__tests__/lines.test.ts`.
- `packages/shared/src/refusals.ts:15-22` -- `REFUSAL_CODES` and `refusalResult`. The test at `src/__tests__/refusals.test.ts:46` pins the exact key list.
- `packages/shared/src/storage-guard.ts:24,50,76` -- `isClassDocument`, `droppedStorageDefinitions(current, proposed)` and `storageDroppedRefusal(name, ns, dropped, remedy)`. These are reused unchanged; DW-547/548 limits are inherited.
- `packages/shared/src/governance.ts` -- the engine.
  - `buildDefaultEnabledWrites` (:570-607) is the sibling for `buildParentKeys`.
  - `ownBool`/`ownProfileLayer` are at :239, :787.
  - `effective` is at :827-848 and `hasExplicitOverride` at :872.
  - `GovernanceConfigSource` is at :894, `configSource` at :911-937, `getEffectiveConfigSources` at :957 and `getEffectivePolicy` at :1010.
  - Every engine function takes positional parameters with `fileConfig?` last.
  - It cannot import `governance-baseline-derivation.ts`, which imports it. Derive keys with `unwrapActionOptions` (:146), as `rebuildGovernedKeys` does.
- `packages/shared/src/tool-types.ts:98,128` -- `mutates` and `defaultEnabled`. `parent?` goes after them.
- `packages/shared/src/server-base.ts`:
  - fields at :449-471;
  - the constructor register loop at :636-640, then the discovery tool, `rebuildMutatesLookup` (:668, body :712-718), `rebuildGovernedKeys` (:671, :729-748) and `assertGovernanceClassified` (:675, :797-799);
  - the resource at :842-880;
  - the gate at :1408-1458, with `presetCaused` at :1431-1444 and the denial at :1450-1457;
  - the discovery call at :1478-1490;
  - `addTools`/`removeTools` at :1811-1886, which repeat the rebuilds.

  Hidden tools never enter `this.tools`. The audit copies only `denyReason` and `presetApplied` (:1655-1665).
- `packages/shared/src/server-discovery.ts:236-251` -- `computeServerDiscovery(..., toolVisibility, fileConfig?)`.
  - It calls the engine at :274, :292, :313 and :324.
  - Its JSDoc value list is at :141-148.
- `packages/shared/src/cli/governance.ts`:
  - `cmdUniverse` builds `allTools` from the dists (:1224-1253, :1366) and calls `buildMutatesLookup`/`buildDefaultEnabledWrites` (:1381-1382), then the policy and sources (:1389-1408).
  - The help text lists the sources at :556.
  - `cmdEffective` (:1012-1060) has no tools, and stays unchanged.
- `packages/shared/src/tool-visibility.ts:313-315` -- `TOOL_PAIRS` (env pair only). `packages/shared/README.md:87` lists the pairs, and :114-117 is the engine summary.
- `packages/iris-dev-mcp/src/tools/doc.ts`:
  - `validateDocName` (:40);
  - `readLineRange`'s readable/binary checks (:94-105);
  - the put split (:394-396, `stripLeadingBom(content).split(/\r?\n/)`);
  - the put conflict pattern (:427-439).
- `packages/iris-dev-mcp/src/tools/load.ts:417-418` -- the split site `fileContent.split(/\r?\n/)`. The PUT at :455-456 stays untouched (DW-549).
- `packages/iris-dev-mcp/src/tools/index.ts:47-77` -- the 29-tool array. New tools are appended last (precedent: `testStatusTool`).
- `packages/iris-dev-mcp/src/tools/presets.ts:29-99` -- `core` 12/17 and `developer` 29/0. The header comment (:1-24) states 13-runtime and 29-tool claims.
- `packages/iris-dev-mcp/src/tools/compile.ts:41` -- `iris_doc_compile`.
- `packages/iris-dev-mcp/src/tools/env-promote.ts:528-554,1121` -- Gate 4. `iris_doc_put` is a parent there and never a child, so it is unchanged.
- HTTP:
  - `http-client.ts:75,90` -- `get(path, opts?)` and `put(path, body, {headers})` return `AtelierEnvelope`.
  - A non-2xx response throws `IrisApiError(status, errors, url, msg, result)` (`errors.ts:61-67`).
- Dev tests:
  - `src/__tests__/test-helpers.ts` re-exports shared `createMockHttp` (namespace `USER`), `createMockCtx(http, atelierVersion=7)` and `envelope(result)`.
  - The 409 fake is in `doc-put-storage-guard.test.ts:105-113`, and its nine-key doc builder at :87-101.
- Dev governance precedents: `src/__tests__/test-status-governance.test.ts`; interop `control-governance.test.ts`, which drives the real `McpServerBase` with a fetch stub and a handler spy.
- Live:
  - `live-doc-helpers.ts` provides `docPath`, `readStoredLines`, `removeStored`, `putDocLines(..., headers?)`, `putStatus`, `compileDocs` and `runQuery`.
  - The gate pattern is in `doc-put-storage-guard-live-gate.test.ts:65-92,247-289` (`loadConfig`, then `IrisHttpClient`, `ping`, `negotiateVersion` and `buildToolContext`).
  - The roster is `scripts/prepublish-gate.mjs:73-89` (a two-line comment, then the path). `live-gate-roster.test.ts` enforces it.
- Tests that assert on surfaces this story changes:
  - Counts and order:
    - `index.test.ts:23` (29 tools), :76 (`toolCount` 30) and :85-118 (ordered names);
    - `shared/src/__tests__/pre-feature-tool-snapshot.ts:25-55` and `tool-visibility-backcompat.test.ts:124` (29);
    - `iris-mcp-all/.../tool-visibility-snapshot-drift.test.ts:64-71`.
  - Presets: `presets.test.ts:53-62`, including the `<= 13` bound at :60-62.
  - Roster docs:
    - `iris-mcp-all/.../docs-visibility-roster-sync.test.ts`, which covers README :606-608 and :624, `iris-mcp-all/README.md:43`, `CHANGELOG.md:813-815` and dev `README.md:49`;
    - `docs-prompt-sync.test.ts:125,136-137` ("105 tools").
  - Write paths: `document-write-paths.test.ts:28-110,258-309` (the raw `.put(` count per file, comments included; a `guarded` entry needs both guard calls).
  - 38.3 claims: `story-38-3-qa-doc-claims.test.ts:372-380` (code literals only in `refusals.ts`, `droppedStorage` only in `storage-guard.ts`).
  - Discovery and CLI:
    - `governance-cli-universe.test.ts:107-115` (oracle) and :153 (the source value set);
    - `governance-file-process-gate.test.ts:234` (its fixture disables `iris_doc_put`; it compares only the CLI's keys).
  - Denial: `refusals.test.ts:180-203`, the byte-identical `GOVERNANCE_DISABLED` literals.
- Docs:
  - Root `README.md`: :15 and :21 (counts), the cascade formula and prose at :376-383, the `configSource` list at :421, the default-enabled table at :517-519, and :602-630 (roster and payload).
  - Dev `README.md`: :49, the tool table at :141-150, the put `<details>` at :339-394, and :1569.
  - `tool_support.md`: :25, the dev rows ending at :57, and the rollups at :378/:383/:391/:395/:409.
  - `packages/iris-mcp-all/README.md:31,39,43` and `docs/migration-v1-v2.md:11,29`.
  - `CHANGELOG.md` (top section, format as in 38.3).
  - `.changeset/story-38-3-*.md` (format).

## Tasks & Acceptance

**Execution:**
- `packages/shared/src/lines.ts` -- extend in place (AC-1, AC-7, AC-9). Add:
  - `splitLines(text)`, which is `text.split(/\r?\n/)`;
  - `joinLines(lines)`, which joins with `"\n"`;
  - `textToLines(text)`, as in Always;
  - `alignLines(a, b): Array<[number, number]>`, the ascending 1-based pairs that a minimal line diff keeps unchanged;
  - `unifiedDiff(before, after, {oldLabel, newLabel})`: `""` when the inputs are equal, otherwise the matrix format;
  - `DIFF_CONTEXT_LINES = 3`.

  The algorithm:
  1. Trim the common head and tail.
  2. Run Myers' O(ND) algorithm on the middle.
  3. When more than `MAX_DIFF_DISTANCE = 2000` inserted+deleted lines would be needed, report the middle as one change (still a valid diff).

  JSDoc states each contract, and the barrel exports them.
- `packages/shared/src/refusals.ts` -- add `STALE_CONTENT` ("An edit's expected text does not match the document now"). Update the `refusals.test.ts:46` key list. -- AC-3.
- `packages/shared/src/tool-types.ts` -- add `parent?: string`, with JSDoc: the existing governance key whose capability every key of this tool re-exposes (AD-4/AD-6). -- AC-6.
- `packages/shared/src/governance.ts` -- the parent mechanism. -- AC-6, AC-9.
  - `buildParentKeys(tools, baseline?)` returns a child-key to parent-key map. It throws on:
    - a reserved parent name;
    - a parent that equals one of the tool's own keys;
    - a declaring tool that owns a baseline key;
    - a parent that is itself a child.
  - `assertParentKeysKnown(parentKeys, allKeys)`.
  - `inheritedParentDisable(key, profile, config, parentKeys, fileConfig?)`, which returns the parent key when the parent's first explicit value (env profile, then env global, then file profile, then file global) is `false`.
  - A trailing optional `parentKeys = new Map()` parameter on `effective`, `configSource`, `getEffectivePolicy` and `getEffectiveConfigSources`.
    - The cascade becomes: explicit child layers, then (an inherited disable gives `false`), then `presetSeed`, then `defaultSeed`.
    - `GovernanceConfigSource` gains `"parent"`.
  - Update the module JSDoc cascade formula.
- `packages/shared/src/server-base.ts` -- wire the mechanism. -- AC-6.
  - Add a `parentKeys` field, rebuilt in `rebuildMutatesLookup`, and validated in `assertGovernanceClassified` against `this.governedKeys`.
  - Thread it into the resource, the gate and the discovery call.
  - Gate attribution: when there is no explicit child override and `inheritedParentDisable` returns a parent, the denial carries `inheritedFrom` (after `server`) and the text suffix ` (inherited from '<parent>')`. `presetApplied` is set only when there is no explicit override and no inherited disable. Every other denial stays byte-identical.
- `packages/shared/src/server-discovery.ts`, `packages/shared/src/cli/governance.ts` -- thread a trailing `parentKeys`. -- AC-6.
  - `cmdUniverse` builds it with `buildParentKeys(allTools)` and asserts it against the universe.
  - The help text and JSDoc value lists add `parent`.
- `packages/shared/src/tool-visibility.ts` -- append `["iris_doc_get", "iris_doc_edit"]` to `TOOL_PAIRS`, and update the JSDoc and `packages/shared/README.md:87,114-117`. -- AC-6.
- `packages/iris-dev-mcp/src/tools/doc.ts` -- the shared pieces. -- Rule 2, AC-9.
  - Extract the readable/binary check of `readLineRange` into an exported `readTextDocument(result)` that returns `{lines, ts}` or a failure kind. `readLineRange` keeps its texts byte-identical (pinned by the `doc-get-range` tests).
  - Move the put split onto `splitLines(stripLeadingBom(content))`.
- `packages/iris-dev-mcp/src/tools/load.ts:418` -- `splitLines(fileContent)`, with nothing else touched. -- AC-9.
- `packages/iris-dev-mcp/src/tools/doc-edit.ts` (new) -- `docEditTool`, the whole matrix, as `name: "iris_doc_edit"`. -- AC-2..AC-5, AC-8.
  - Export the pure helpers `validateEdits`, `findStaleEdits` and `applyEdits` (the latter returns the edited lines and each edit's region).
  - **Schema.**
    - `action`: a plain required `z.enum(["apply","regenerateStorage"])`.
    - `name`: a string.
    - `edits`: `z.array(edit).min(1)`. Each edit is a flat object:
      - `op`: `z.enum(["insert","delete","replace"])`;
      - `afterLine`: `z.coerce.number().int().min(0).optional()`;
      - `startLine`/`endLine`: `z.coerce.number().int().min(1).optional()`;
      - `text`: an optional string;
      - `expected`: a required string.
    - `namespace`: optional.

    Every field has a description. `scope: "NS"`.
  - **Classification.**
    - `mutates: {apply:"write", regenerateStorage:"write"}`, `defaultEnabled: ["apply"]`, `parent: "iris_doc_put"`.
    - `annotations: {readOnlyHint:false, destructiveHint:true, idempotentHint:false, openWorldHint:false}`.
  - **Description.** It covers:
    - what the tool does, when to use it (after a ranged `iris_doc_get`), and the three ops with their fields, including the `afterLine: 0` anchor and `textToLines` rules;
    - all-or-nothing, bottom-up application, with overlaps rejected;
    - `STALE_CONTENT`, `DOCUMENT_CONFLICT` (never retried) and `STORAGE_DROPPED`, with `regenerateStorage` as the override;
    - the returns (`unifiedDiff` with 3 context lines, excerpts with 3 lines, `totalLines`, `ts`), never the whole document;
    - that IRIS reformats class source on save;
    - "does not compile: run iris_doc_compile next";
    - to make `expected` distinctive when a line such as `}` is not unique;
    - the governance state: `apply` is a write enabled by default; it is disabled when `iris_doc_put` is explicitly disabled (unless `iris_doc_edit:apply` is set) and under the read-only preset. `regenerateStorage` is disabled by default.

    Name no REST paths.
- `packages/iris-dev-mcp/src/tools/index.ts`, `presets.ts` -- register and classify the tool. -- AC-6.
  - Append `docEditTool` to the tool array.
  - `core` and `developer` include it.
  - The header comment is rewritten to state the current contract: `core` = 13 package tools / 14 runtime (L-4 guideline), developer = 30.
- `packages/iris-dev-mcp/src/__tests__/doc-edit.test.ts` (new) -- every matrix row with mock HTTP, in exact texts, with `toEqual` on `structuredContent` and on the call lists and counts (Stale/Shape/Overlap/Storage: no Pv; Conflict: one Pv; never a second Pv). -- AC-2..AC-5, AC-7, AC-8.
  - **Fakes.** Fakes are real shapes:
    - the nine-key Doc;
    - the Pv 200 result `{..., flags:0, content:[]}`;
    - the soft error `{db:"", ts:"", content:"", status:"ERROR #16021: Illegal Header Line: ..."}` (probe 4);
    - an R that adds a blank line between members (probe 1).

    No fake returns a BOM inside Doc `content` (IRIS refuses BOM text, 38.0; Rule #54).
  - **Rule #58 fixtures:**
    - CRLF and LF;
    - tabs;
    - a trailing newline or none;
    - a BOM in `text` and in `expected`;
    - edits at line 1 (`afterLine:0` and `replace 1`) and at the last line, for a class and for a routine without a trailing `""`;
    - an empty-text replace;
    - multi-line `expected`;
    - several edits in shuffled orders (one result);
    - untouched lines with trailing spaces and a trailing `\r`, sent byte-identical.
  - **Description and parameter cases.** They name `iris_doc_compile`, "enabled by default", `regenerateStorage` and the two context-line counts.
- `packages/shared/src/__tests__/lines.test.ts` -- cover the new exports. -- AC-1, AC-9.
  - `splitLines` equals `split(/\r?\n/)` on CRLF/LF/trailing-newline fixtures.
  - `textToLines`, as in Always.
  - `unifiedDiff`: at least 5 fixtures with distinct lines, pinned to literals captured with `diff -U3 before.txt after.txt` (macOS Apple diff, FreeBSD-based; headers replaced), with the command cited (Rule #36). The fixtures are: an insert at the top, a change in the middle, merged hunks, a pure delete (`@@ -1 +0,0 @@ (`-U3`; corrected by the lead)`), and an append.
  - `alignLines`: pairs are ascending, and applying the hunks of `unifiedDiff` to `before` yields `after` over a seeded random set of edits (a mechanical round trip).
  - The `MAX_DIFF_DISTANCE` fallback.
- `packages/shared/src/__tests__/governance-parent.test.ts` (new) -- the engine and gate matrix with synthetic tools. -- AC-6, AC-9.
  - **Engine.** Each explicit layer, profile scoping, child-wins, parent-enabled-higher, read-only plus inherited, the `"parent"` source, and `buildParentKeys`/`assertParentKeysKnown` throws.
  - **Gate** (through `McpServerBase`). The `inheritedFrom` denial is pinned as a JSON literal, with no `presetApplied`, and the hidden-parent row.
  - **Back-compat.** For the configs {none, read-only, `{global:{iris_doc_put:true}}`, an env and a file config disabling unrelated keys}, every baseline key's policy and source is `toEqual` with and without the parent map.
- `packages/iris-dev-mcp/src/__tests__/doc-edit-governance.test.ts` (new) -- mirror `test-status-governance.test.ts`. Use the real dev `docPutTool` and `docEditTool` with handler spies. -- AC-6.
  - The governance matrix rows against the real tools.
  - Construction with the real dev `tools` and presets succeeds.
  - `buildDefaultEnabledWrites(tools)` contains `iris_doc_edit:apply` and not `:regenerateStorage`.
  - `iris_server_profiles` reports the inherited verdict and source.
- `packages/iris-dev-mcp/src/__tests__/index.test.ts`, `presets.test.ts` -- update the counts. -- AC-6.
  - `index.test.ts`: 30 tools, `toolCount` 31, the new name last.
  - `presets.test.ts`: 13/17/30/0.
  - Replace the `<= 13` assertion with `toBe(14)` runtime, citing L-4 (Project Lead 2026-10-14: a guideline).
  - Add a doc pair co-visibility case.
- `packages/shared/src/__tests__/pre-feature-tool-snapshot.ts`, `tool-visibility-backcompat.test.ts:124`, `tool-visibility.test.ts` -- the new name last, 30, and the new pair. -- AC-6.
- `packages/iris-dev-mcp/src/__tests__/doc-edit-live-gate.test.ts` (new) -- the live gate. -- AC-3, AC-4, AC-5, AC-7.
  - **Setup.** The sibling setup, with its own `process.env.IRIS_REQUIRE_LIVE ===` comparison. Each test first PUTs its fixture's starting text. `beforeAll` and `afterAll` call `removeStored` on every fixture, then assert that `iris_doc_list` (with `generated: true`) and `iris_global_list` are empty for `QaStory384`.
  - **`Edit` fixture.**
    - Replace a method line, insert a member, and delete a line in one call.
    - Then `iris_doc_compile` succeeds.
    - Each excerpt equals the matching ranged `iris_doc_get` slice, and `totalLines`/`ts` equal a fresh read.
    - Every hunk's `-` and context lines equal the read, and its `+` and context lines equal the re-read.
    - IRIS's added blank line shows up.
  - **Stale.** A stale `expected` gives `STALE_CONTENT`, and the stored lines and `ts` are byte-identical afterwards.
  - **Concurrent writer.** A `put` spy saves another version through `putDocLines(..., {"If-None-Match": ts})` before the tool's Pv. The result is `DOCUMENT_CONFLICT` after exactly one tool PUT, and the stored text is the other writer's.
  - **`Store` fixture** (persistent, compiled, so Storage is generated). Deleting the Storage lines with `apply` gives `STORAGE_DROPPED` and leaves the document unchanged. The same edits through the `regenerateStorage` handler save, and the source has no Storage.
  - **`Rtn` fixture** (`.mac`, no trailing `""`). A CRLF `text` edit at the last line is stored exactly as sent.
  - Add the file to `prepublish-gate.mjs` `gateTestFiles`, with a two-line comment naming the fixtures.
- `packages/iris-mcp-all/src/__tests__/document-write-paths.test.ts` -- add the `doc-edit.ts` `put` entry as `guarded`, with the count taken from the scan (Rule #51). -- AC-4.
- `packages/iris-mcp-all/src/__tests__/story-38-3-qa-doc-claims.test.ts:372` -- iterate `Object.keys(REFUSAL_CODES)` from the built shared dist instead of the three literals. -- AC-3.
- `packages/iris-mcp-all/src/__tests__/default-enabled-holders.test.ts` (new) -- three checks over every `SERVER_PACKAGES` dist (AD-4 closed lists). -- AC-6.
  - The `defaultEnabled` holders equal `["iris_doc_edit:apply","iris_production_control:clean"]`.
  - The `parent` declarations equal `{iris_doc_edit: "iris_doc_put"}`.
  - `deriveKeysForTool(docEditTool)` equals `["iris_doc_edit:apply","iris_doc_edit:regenerateStorage"]`.
- `packages/shared/src/__tests__/governance-cli-universe.test.ts` -- thread the parent map into the oracle, and widen the :153 value set with `"parent"`. -- AC-6.
- Docs (Rules #30, #31, #43) -- AC-6, AC-8.
  - Dev `README.md`:
    - a tool-table row that states "enabled by default", why (S-3: guarded by `expected`, the version check and the Storage guard), and how to disable it (`iris_doc_edit:apply: false`, or disable `iris_doc_put`);
    - a `<details>` example with input, output and a `STALE_CONTENT` refusal;
    - the :49 and :1569 counts.
  - Root `README.md`:
    - the cascade formula and prose gain the parent step;
    - the `configSource` list adds `parent`;
    - a default-enabled table row for `iris_doc_edit` / `apply`;
    - a short "Parent keys" subsection;
    - the counts.
  - `tool_support.md`: a new dev row 30 (Atelier `GET /doc/{name}` + `PUT /doc/{name}`) and the rollups, counted mechanically (Rule #51).
  - `packages/iris-mcp-all/README.md` and `docs/migration-v1-v2.md`: the counts, plus the `docs-prompt-sync.test.ts` literals moved to 106.
  - `CHANGELOG.md`:
    - the :813-815 roster line, "as of Story 38.4", reworded from "every core server <= 13";
    - a new top section, `## [Pre-release — 2026-10-15] — Story 38.4: Surgical line edit tool`, with `### Added` (the tool, its keys and default states, the parent mechanism, `inheritedFrom`, the `parent` source, `STALE_CONTENT`, the `lines.ts` exports) and `### Changed` (dev `core` 13 -> 14 runtime, L-4; the new `TOOL_PAIRS` pair).
  - `.changeset/story-38-4-surgical-line-edit-tool.md`: `"@iris-mcp/shared": minor` and `"@iris-mcp/dev": minor`.
  - The root README payload table is re-measured with `pnpm measure:tools-payload`.

**Acceptance Criteria:**
- AC-1 (38.4.1): Given the probe record in Design Notes and the finished tree, when the tests run, then:
  - `unifiedDiff` equals the captured `diff -U3` literals;
  - the round-trip test is green;
  - `grep -rln "@iris-mcp/client-config" packages/shared/src packages/iris-*-mcp/src` prints nothing.
- AC-2 (38.4.2): Given any Shape, Overlap or Range input, when `iris_doc_edit` runs, then it returns the matrix error with the matrix request count. Given valid edits in any input order, then one Pv carries the same bottom-up result.
- AC-3 (38.4.3): Given a mismatched `expected`, when the tool runs, then:
  - `STALE_CONTENT` lists every mismatch with its current text;
  - no PUT is sent;
  - live, the stored lines and `ts` are unchanged.

  Given a writer between the GET and the PUT, then the result is `DOCUMENT_CONFLICT` after exactly one PUT, and the PUT never carries `ignoreConflict`.
- AC-4 (38.4.4): Given a `.cls` edit that removes a Storage definition, when `apply` runs, then the result is `STORAGE_DROPPED` with remedy SR and nothing is written. When `regenerateStorage` runs, the edit is saved. Given the dev schema, then `apply` has no parameter that skips the guard.
- AC-5 (38.4.5): Given a successful edit, when the result returns, then:
  - `unifiedDiff`, `excerpts` and `totalLines` come from the re-read (the reformat row, unit and live);
  - no field carries the whole document;
  - the text mirrors `structuredContent`.
- AC-6 (38.4.6): Given the real dev server, when it is constructed and called, then:
  - **Governance.** The governance matrix holds. `iris_server_profiles` and the resource report the inherited verdict and the `parent` source. The keys are absent from `GOVERNANCE_BASELINE`.
  - **Annotations and closed lists.** The annotations are as specified, and the holder and parent lists equal the closed sets.
  - **Visibility.** `core` holds 13 package / 14 runtime tools and `developer` 30, the doc pair is co-visible, and dev has 30 tools (31 advertised; suite 106/111).
- AC-7 (38.4.7): Given the Rule #58 fixtures and the armed live gate, when they run, then:
  - every fixture row passes;
  - a valid edit compiles;
  - a stale edit leaves the document byte-identical;
  - a concurrent change is a conflict;
  - nothing named `QaStory384` remains.
- AC-8 (38.4.8): Given the tool, when it succeeds, then it sends no compile request, and its description and success text direct the agent to `iris_doc_compile`.
- AC-9 (back-compat, AD-15): Given the existing `iris_doc_put`, `iris_doc_load` and `iris_doc_get` tests and the 38.3 back-compat literals, when they run unmodified, then they pass. With no parent explicitly disabled, every existing key's policy, source and denial is `toEqual` to the run without the parent map.
- AC-10: Given the finished tree, when the gates run, then:
  - per-package build, test, lint and type-check pass;
  - `:check` exits 0 at `1e62c5ad5bf7`/141;
  - there is no diff in `bootstrap-classes.ts`, `governance-baseline.ts`, `baseline-classifications.ts` or `src/`;
  - `BOOTSTRAP_VERSION` is `3af8ca401e7c`.

### Review Findings

Code review 2026-10-15 (`bmad-code-review`, tier full-opus). All four layers delivered: blind-hunter, edge-case-hunter, verification-gap and acceptance-auditor. They reported 21 raw findings, which group into 12 entries: high 1, medium 4, low 7. Seven findings were rejected.

Outcome: all 10 patches were applied and verified, including the high and three of the four mediums. The remaining medium is DW-552, `decision-pending` (owner `burndown`, for the decision sheet), and the low DW-553 is `wontfix-accepted`. DW-551 was re-sighted (occurrence appended).

Checks after the patches, all green:
- The dev set (349) and the shared set (289).
- The `iris-mcp-all` suite (310) and the launcher governance tests (30).
- The full dev suite (1,185).
- The armed live gates: `doc-edit-live-gate` (10) and the wire gate (10).
- Lint (0 errors) and type-check for dev and shared.
- `gen:governance-baseline:check` exits 0.

The review status is `done`, with review outcome CLEAN.

- [x] [Review][Patch] (high, Rule 6 / AD-24) An edit that IRIS stores back unchanged is reported as applied. The tool returns `changed: true`, "1 edit applied" and an empty `unifiedDiff`, because `changed` came from the locally edited array, not from the re-read. Live probe 2026-10-15 (`ExecuteMCPv2.Temp.CrProbe384.cls`, since removed): deleting the blank line between two members saves, and the re-read is byte-identical to the read with `ts` unchanged. Fix: compare the re-read with the read. When they are equal, answer `changed: false`, with a text saying that IRIS stored the text the document already had [packages/iris-dev-mcp/src/tools/doc-edit.ts:633]
- [x] [Review][Patch] (medium, Rule 19 hermeticity) The dev live gate's before and after emptiness checks list every document and global named `QaStory384`. That includes the `iris-mcp-all` wire gate's `QaStory384Wire*` fixtures. `turbo run test` runs the two packages' suites concurrently, so the wire gate's fixtures fail the dev gate's checks. Fix: the dev gate lists, kills and asserts only its own three fixture stems [packages/iris-dev-mcp/src/__tests__/doc-edit-live-gate.test.ts:111]
- [x] [Review][Patch] (medium, Rule 2) The QA wire gate re-implements `resolveSdkEsmDir`, `isIrisReachable` and `staleDistReason` without a stated reason. These are near-copies of the helpers in `governance-file-process-gate.test.ts:102-130` and `epic37-default-outage-gate.test.ts:86-160`. Fix: move the three helpers into `process-gate-helpers.ts`, which the gate already imports, and import them from there. The older copies predate this story and are left alone [packages/iris-mcp-all/src/__tests__/story-38-4-qa-doc-edit-wire-gate.test.ts:103]
- [x] [Review][Patch] (medium, Rule 19 shared surface) The launcher's real-CLI test still pins the old `configSource` value set, without `parent`. The `GovernanceConfigSource` set is on this spec's Shared surfaces line [extensions/iris-mcp-launcher/src/__tests__/governanceEngineRealCli.test.ts:196]
- [x] [Review][Patch] (low) "Parent and child never disagree" overstates the rule. Only a disable is inherited, so under the read-only preset an explicit `iris_doc_put: true` runs while `iris_doc_edit:apply` stays denied [README.md:529, packages/shared/src/governance.ts:926]
- [x] [Review][Patch] (low) Several cascade formula strings omit the inherited-disable step: the `presetSeed` and `loadGovernanceFile` JSDoc, the `governanceFileConfig` field, and the README read-only bullet. The README `effective` row also does not say that the command is baseline-scoped, so no parent applies to it [packages/shared/src/governance.ts:842, README.md:211]
- [x] [Review][Patch] (low) The dev README `iris_doc_edit` example presents itself as a re-read, but shows class source in a layout IRIS never stores (`Class MyApp.Service {` on one line). Fix: rewrite it in IRIS's layout, with the diff re-captured by `diff -U3` [packages/iris-dev-mcp/README.md:436]
- [x] [Review][Patch] (low) "Describes every field" checks only the four top-level fields; the descriptions of the six edit-item fields are unpinned [packages/iris-dev-mcp/src/__tests__/doc-edit.test.ts:1426]
- [x] [Review][Patch] (low) When the server dists predate parent keys, the new universe test's anti-vacuity assertion fails without saying why [packages/shared/src/__tests__/governance-cli-universe.test.ts:263]
- [x] [Review][Patch] (low, Rule 19) AC-10 has no `mutation:` line. Closed in this pass: the line is now under Verification [spec ## Verification]
- [x] [Review][Defer] (medium, spec-bound) A `STALE_CONTENT` retry that uses `mismatches[].current` as `expected` fails again when the addressed range ends in an empty line. `current` is `joinLines` (matrix ST), and `textToLines` drops one trailing line break, so `["}", ""]` becomes `"}\n"`, which parses as `["}"]`. An `expected` built by joining a ranged read with `\n` fails the same way [packages/iris-dev-mcp/src/tools/doc-edit.ts:336] — deferred: DW-552 `decision-pending` (a contract choice on the `current`/`expected` round trip; 38.6's edit prompt depends on it)
- [x] [Review][Defer] (low, Rule #54) The several-edits fake re-read `S2_LINES` is a `.cls` layout IRIS cannot return: it has no blank line after `{` or between members. The PUT-body pins it carries are realistic, and the multi-edit live gate row covers the stored outcome [packages/iris-dev-mcp/src/__tests__/doc-edit.test.ts:116] — deferred: DW-553 `wontfix-accepted`

Rejected:
- `low` The spec still gives the `-U0` literal `@@ -2 +1,0 @@` in the Tasks fixture note and in probe 6. The fix is a spec edit, which the Spec Change Log leaves to the lead. The implementation and `lines.test.ts` follow `diff -U3`.
- `low` The wire gate checks only the shared and dev dists, so a missing admin, interop, ops or data dist fails the CLI row instead of skipping it. Every `iris-mcp-all` test that imports server dists assumes they exist, and turbo builds them before this package's tests.
- `low` `IRIS_TOOLS_DISABLE=iris_doc_get` leaves `iris_doc_edit` visible. `TOOL_PAIRS` guards the named preset rosters (an existing contract); an explicit hide is the operator's choice; and `STALE_CONTENT` still returns the current text.
- `low` With the audit log on, a `STALE_CONTENT` refusal's text, which holds the current lines, is recorded as the entry's `error`. The audit records the first text block of every error by its existing design (AD-19, out of footprint). The text is spec-literal (ST), and the lines are the ones the agent sent as `expected`.
- `false` `expect(stored).toHaveLength(15)` and the `withoutDisable.length` check cannot fail, but they are fixture self-checks beside the real pins and are not offered as evidence.
- `false` AC-4, AC-5 and AC-6 sub-claims lacking their own mutation: each of those ACs already has a recorded mutation, and Rule 19 asks for one per AC, not one per sub-claim.
- `low` An inherited denial names a parent that `IRIS_TOOLS_DISABLE` hides. AD-6 (decision #10) and the matrix row "Hidden parent" fix that shape, and the build review already adjudicated it; changing it is a spec or spine edit. AD-7's "governance surfaces omit hidden tools' keys" could state whether call-time denials are covered.

## Spec Change Log

### 2026-10-15 - Matrix example `@@ -2 +1,0 @@` is a `-U0` form (Rule 5 apply-and-report; no loopback)
- Trigger: the implement pass could not reproduce the matrix's `@@ -2 +1,0 @@` under `-U3`. Re-checked by the review lead against the real `diff` (macOS Apple diff, Rule #36): for `printf 'a\nb\n'` against `printf 'a\n'`, `-U3` prints `@@ -1,2 +1 @@` and `-U0` prints `@@ -2 +1,0 @@`. With context lines an empty range occurs only when a whole side is empty: `@@ -1 +0,0 @@` (every line deleted) and `@@ -0,0 +1 @@` (lines added to an empty document).
- Amended: nothing inside the read-only intent block. The implementation follows `diff -U3` and pins those two literals in `lines.test.ts`. The lead may correct the matrix wording (and the "a pure delete (`@@ -2 +1,0 @@`)" fixture note in Tasks) in a later pass.
- Known-bad state avoided: pinning the `-U0` literal would make `unifiedDiff` disagree with `diff -U3` on every delete.
- KEEP: the hand-written Myers diff, the `diff -U3` captured literals, and the round-trip test.

## Review Triage Log

### 2026-10-15 - Review pass
- verdicts: 33 findings - high 0, medium 0, low 23, false 9, maybe-false 1
- findings:
  - `[low]` `[patch]` Stale counts left by the docs sweep: `README.md:733` diagram `(29)` and `docs/epic-summary.md:3` "105 tools ... 110 advertised" - patched to `(30)` and 106/111, with a sentence naming `iris_doc_edit`.
  - `[low]` `[defer]` `.claude/rules/project-rules.md` #53 still states `core` as "<=13 runtime tools/server" while L-4 makes 13 a guideline and dev `core` is 14 - the fix edits an agent-context file, so it is deferred to the lead.
  - `[low]` `[patch]` CLI `effective` help lists `parent` as a `configSource`, but `effective` has no tool list and never applies an inherited disable - patched: the `effective` list is back to env|file|preset|default with a sentence saying only `universe` applies parent inheritance, and the `universe` help now lists `parent`.
  - `[low]` `[patch]` The launcher's `UniverseJson.configSource` / `KeyRow.source` unions and README list omit `parent`, which `universe --json` now emits - patched in `extensions/iris-mcp-launcher/src/governanceView.ts` and its README; `governanceView.test.ts` 26 pass; the launcher `type-check` errors are the pre-existing missing `vscode`/servermanager modules, none in `governanceView.ts`.
  - `[low]` `[reject]` `z.coerce.number()` turns `null`, `""` and `false` into 0 for `afterLine` - a null `afterLine` becomes "insert before line 1" only when `expected` equals line 1 (the other null-filled optionals, such as `text: null`, fail the schema anyway), `iris_doc_get` uses the same coerce idiom, and the fix adds a preprocess guard for a client behaviour nobody has shown.
  - `[low]` `[patch]` The tool description's "an edit never overwrites lines it has not seen" overstates the guard when another writer shifted lines and `expected` is a non-unique line - reworded in `doc-edit.ts` and the dev README to "a line whose text differs from what you expected"; the distinctive-`expected` advice and the Design Notes residual risk already cover the remainder.
  - `[low]` `[reject]` Response size is uncapped and the `MAX_DIFF_DISTANCE` fallback emits the whole unchanged middle as `-`/`+` - the fallback is the specified behaviour (Tasks: report the middle as one change) and needs more than 1,000 changed lines in one "surgical" call; a region-bounded diff would be a new algorithm. reopen_if an agent is observed sending edits that change more than 1,000 lines.
  - `[low]` `[reject]` `STALE_CONTENT`'s "retry with the current text as expected" fails for a multi-line range whose non-final line ends in `\r` - `textToLines` parsing of `expected` is part of the intent contract, and no code path of ours produces a stored line ending in `\r` (`splitLines` splits on `\r?\n`). reopen_if a stored document with `\r` line ends is edited in practice.
  - `[low]` `[patch]` Root README read-only bullet says `presetApplied` is returned for a denial "not an explicit `false`" without excluding a parent-inherited one - clause added; the "every new write is disabled" bullet's unlisted `iris_production_control:clean` exception is pre-existing and not this story's.
  - `[low]` `[reject]` The tool description repeats rules that the `text` and `expected` field descriptions state (payload +15% for dev `core`) - the spec requires both ("Every field has a description" and the description's content list), and the growth is the new tool's own schema.
  - `[low]` `[reject]` "never the whole document" is not enforced for a replace spanning lines 1..N - an excerpt is by spec the lines the edit produced plus 3 context lines, so replacing a whole document returns it; inherent to the operation.
  - `[low]` `[reject]` `pairs.length === 0` makes every excerpt span the whole re-read document - `alignLines` pairs the common head and tail before the distance cap applies, so it needs more than 2,000 sent-versus-stored differences (an edit of more than 1,000 lines).
  - `[low]` `[reject]` A writer saving between the tool's PUT and its re-read has its change attributed to this call's diff - the diff truthfully describes read-to-current, the window is milliseconds, and detecting it would need a second version compare. reopen_if a user reports a mis-attributed diff.
  - `[false]` `[reject]` `removeTools` of a non-baseline parent tool leaves the registry half-updated - the only parent declared anywhere is the baseline key `iris_doc_put`, which stays in `governedKeys` whatever tools are registered, so the throw is unreachable with real tools (Rule #54).
  - `[low]` `[reject]` An inherited denial's audit entry does not carry `inheritedFrom` - spec Never: "No audit-entry schema change: `inheritedFrom` is not copied into the audit log".
  - `[low]` `[reject]` Same claim as the `afterLine` null finding above (`afterLine` null or `""` becomes 0) - same refutation.
  - `[maybe-false]` `[reject]` An existing document with an empty `content` array cannot be edited (the range error says "lines 1 to 0") - unknown whether Atelier returns `content: []` for an existing document (a class or routine always carries a header line); if it does, the workaround is `iris_doc_put` and the grade is low. Settled by a GET of an empty `.inc`.
  - `[false]` `[reject]` `readTextDocument` accepts a result with no string `ts`, so `If-None-Match: undefined` would be sent and reported as a conflict - every real Atelier document GET carries `ts` (the nine-key Doc in the live probes); no real input reaches it (Rule #54).
  - `[low]` `[reject]` A denial inherited from a parent hidden by `IRIS_TOOLS_DISABLE` names a tool the agent cannot see - the same operator hid and disabled the parent, no secret is exposed, and decision #10 fixes the denial shape.
  - `[low]` `[patch]` CLI `effective` help claim (second sighting) - same patch as the first CLI help finding.
  - `[low]` `[patch]` The `iris_server_profiles` `allProfiles: true` branch is not verified for parent inheritance (dropping `parentKeys` at the two call sites keeps every test green) - added an `allProfiles` row in `governance-parent.test.ts` and `doc-edit-governance.test.ts`; mutation `allProfiles` branch drops `parentKeys` -> both new rows red.
  - `[low]` `[patch]` The gate's "no inheritedFrom when the child has its own explicit setting" guard is unpinned (child `false` with parent `false`) - added gate rows in both files and an engine row; mutation gate ignores `explicitOverride` -> both gate rows red, and mutation `configSource` checks the inherited disable first -> the engine row red (7 rows).
  - `[low]` `[patch]` `tool-types.ts` `parent` JSDoc says a key with an explicit setting reports source `parent` - reworded to the key that inherited the disable.
  - `[low]` `[patch]` CLI `effective` help claim (third sighting, "Other findings") - same patch as the first CLI help finding.
  - `[low]` `[reject]` The live gate's `listFixtureGlobals()` emptiness assertions cannot detect a defect (the `Store` fixture saves no rows) - Tasks mandate the cleanliness assertion and it pins no AC; the `iris_doc_list` half is real (compiling `Store` creates generated routines).
  - `[false]` `[reject]` Intent reading: the Shape row's `is missing expected` text is unreachable through MCP because `expected` is a required schema field - `validateEdits` checks every field of `OP_FIELDS` through one loop (no separate branch), and the SDK rejecting a missing `expected` first is the expected layering.
  - `[false]` `[reject]` Intent reading: tests drive the handler, not the MCP wire - spec Tasks prescribe mock-HTTP handler tests plus a live gate through the real `IrisHttpClient` and Atelier routes.
  - `[false]` `[reject]` Intent reading: the governance tests call the registered callback with handler spies - spec Tasks prescribe mirroring `test-status-governance.test.ts` with the real `docPutTool`/`docEditTool` and spies.
  - `[false]` `[reject]` Intent reading: the hidden-parent tests also set the governance disable - the matrix row says "inheritance still applies", and hiding alone changing the child is not specified.
  - `[low]` `[reject]` Intent reading: no test sends an inherited denial through the audit path - same refusal as the audit finding above (spec Never).
  - `[false]` `[reject]` Intent reading: CLI `effective`/`diff` and the `iris_env_promote` Gate 4 do not use the parent map - Tasks say `cmdEffective` stays unchanged, and Gate 4 treats `iris_doc_put` as a parent only.
  - `[false]` `[reject]` Intent reading: overlap uses position semantics for inserts - Design Notes plan-time interpretation 4 states it and the Overlap rows pin it.
  - `[false]` `[reject]` Intent reading: files outside a literal Never list (`doc.ts` extraction, `prepublish-gate.mjs`, `TOOL_PAIRS`, the 38.3 claims test, the snapshot) - each is named in Tasks & Acceptance.

## Design Notes

**Governing ADs.**
- **AD-24.** One line utility owns numbering, splitting, joining, BOM handling and the numbered format. Versions: the edit's PUT sends the token of the GET its `expected` check ran against. A 409 is never retried, and no `ignoreConflict` is sent. Output comes from a re-read. There is one Storage guard.
- **AD-4.** Per-action `mutates`. `apply` is the closed-list `defaultEnabled` holder. The guard override is a separate default-disabled action, never a parameter. The enum is fixed in this first story. The `parent` key is this tool's. All four annotations are truthful, and `iris_doc_put`'s `destructiveHint:false` is not copied.
- **AD-6.** Parent precedence lands here. An inherited disable is a seed below every explicit child layer and above the preset. Reporting reads the same engine.
- **AD-7.** The `core` guideline (L-4) and `TOOL_PAIRS`.
- **AD-5.** The frozen baseline is untouched.
- **AD-10.** Counts move +1 for dev and the suite.
- **AD-2.** Shared never imports client-config; cross-package checks live in `iris-mcp-all`.
- **AD-3.** Handlers use `ToolContext` only.
- **AD-15.** Back-compat is pinned.
- **AD-12.** The logic is in TypeScript.
- **AD-14.** No bootstrap change.
- **AD-29.** Minor changesets only.
- **Conventions:** Tool descriptions, Tool annotations, Tool results (`unifiedDiff`, not `diff`: `diff` already means the env-diff object in `iris_env_diff`/`iris_env_promote`; grep shows `unifiedDiff`, `excerpts`, `mismatches`, `inheritedFrom` and `changed` absent today), Refusals, Error text, Live gates, Live testing on a shared instance, Probes and references.

**Probe record.** The probes ran at plan time on 2026-10-15 against `default` (localhost:52773, instance id `77DD5053-...`), namespace HSCUSTOM, IRIS 2026.2 build 221U, Atelier v8. They used raw Atelier calls on `ExecuteMCPv2.Temp.QaStory384PlanA.cls`, `...PlanR.mac` and `...PlanI.inc`, all deleted afterwards (the `docnames` filter `QaStory384` with `generated=1` is empty).
1. **Class source is regenerated on every save.** IRIS puts a blank line between members and before the final `}`, and ends the content with a `""` element. A member-level `\t// comment` loses its tab, while trailing spaces and method-body lines are kept. An inserted `Property Beta` directly after `Property Alpha` was stored with a blank line between them: the 16 lines sent became 17 on re-read. A class text missing its body `{` was stored with one.
2. **Routines and include files are stored exactly as sent.** IRIS adds no trailing `""`, and trailing spaces are kept.
3. **Version-checked saves.** `If-None-Match: <GET ts>` saves with 200, and the result carries the new `ts` and `content:[]`. A stale header gives 409.
4. **Soft errors.** An illegal header gives HTTP 200 with `{db:"", ts:"", content:"", status:"ERROR #16021: Illegal Header Line: Property Alpha As %String;"}`, `ts` unchanged and nothing stored. Empty content gives `ERROR #16022: No Class Definition or ROUTINE header found`.
5. **Identical re-save.** A PUT of identical routine content leaves `ts` unchanged.
6. **`diff -U3` conventions.** It is Apple diff, FreeBSD-based, with the GNU hunk conventions: `@@ -1 +0,0 @@` (corrected by the lead: the `-U0` form `@@ -2 +1,0 @@` never appears under `-U3`), and `@@ -1,10 +1,12 @@` for merged hunks.

**AC 38.4.1 probe (`packages/client-config/src/diff.ts`, 1536 lines).** It is not generic. It plans and renders known JSONC/TOML/YAML entry edits (`jsonc-parser` edits, a TOML line lexer, YAML CST operations) as prose ("Replace lines a-b:"). It has no LCS or Myers alignment and emits no hunks. Its only movable helpers are 4 to 7-line string helpers (`detectEol`, `lineIndentAt`), and none of them diffs. No diff library exists in any `package.json` or in the lockfile. Research [57] (`research.md:423`, "Our existing line-span edit and diff engine ... high (verified)") overstates it, and `citecheck-final.md:31` had already flagged [25]. Decision: write a small diff in `lines.ts`.

**Plan-time interpretations (apply-and-report, Rule 5).**
1. **AC 38.4.2's "an enum with the single value apply"** predates the 2026-10-15 amendment of AC 38.4.4. AD-4 fixes the enum in this first story, and AD-24 names both actions. The enum is therefore `apply | regenerateStorage`. The lead may align the epics.md wording.
2. **`parent` is per tool**, so it covers `regenerateStorage` too. That is fail-safe: an explicit child setting still wins, and that key is default-disabled anyway. AD-4 names `iris_doc_edit:apply`; the wider reach only adds a disable.
3. **Text parsing.** `textToLines` drops one trailing line break and makes `""` one empty line. This is AC 38.4.7's "missing final newline" fixture: with or without a final newline, the lines are the same. Removing lines is `delete`.
4. **The anchor of `afterLine: 0`** is line 1, the line the text goes before. Overlap is positional: an insert at `a` lies inside `[s,e]` only when `s <= a < e`.
5. **Edits that change nothing** send no PUT (NC). Probe 5 shows that IRIS would not move `ts` for them anyway.
6. **When the re-read fails after a save**, the result is `isError` with `saved:true` and no code, because something was written. The text forbids a repeat: a repeated insert would pass its anchor check.

**Orchestrator decisions — DECIDED at the spec gate on 2026-10-15, both as recommended (`orchestrator-decisions-wave-6.md` #9 and #10).** The lead wrote both into the spine's AD-6 "Parent keys" Rule (Rule 20) and aligned the AC 38.4.2 enum wording in `epics.md`. The options and evidence considered at planning follow.
1. **What does "the parent is explicitly disabled at any layer" mean?** Recommended: (B) the parent's explicit verdict, that is, the first explicit layer that sets it, in cascade order, sets it `false`.
   - This follows AD-6's "the effective value is the first one found ... the layers never interleave".
   - The alternative (A), any explicit layer holding `false`, would let a stale file-layer `false` disable the child while the parent itself is enabled by env. Parent and child would then disagree, the opposite of inheritance.
   - The matrix row "Parent enabled higher" pins (B).
2. **How should an inherited verdict be reported?** Recommended:
   - `configSource` gains `"parent"`;
   - a denial carries `inheritedFrom:"<parent>"`, plus the text suffix `(inherited from '<parent>')`;
   - `presetApplied` is withheld when the parent caused the denial.

   The reasons: AD-6 "Reporting" and AC 38.4.6 require the inherited verdict to be reported, and without the fix the read-only attribution (`server-base.ts:1431`) would wrongly name the preset. Each value appears only on a key that has a parent, and there is none before this story, so this is additive under AD-15. The alternative is to report the parent's channel (`env`/`file`), which would point an operator at a layer that never mentions the child key.

**`core` size and why (AD-7, L-4).** Dev `core` becomes 13 package tools + `iris_server_profiles` = 14 runtime. `iris_doc_edit` is in the everyday authoring loop: a ranged read, then an edit, then `iris_doc_compile`, then `iris_execute_tests`. It replaces whole-document `iris_doc_put` rewrites, which cost tokens and risk Storage loss. It also pairs with `iris_doc_get`, which is already in `core`.

**Seam (Rule #52).** 38.4 owns applying edits, the diff, the parent mechanism and its reporting. 38.5 adds `parent: "iris_sql_execute"` on `iris_sql_query` with no engine change. 38.6 owns the docs enrichment, the edit prompt and the capstone. Epic 43 binds `iris_doc_edit:regenerateStorage` to its confirmation helper.

**Integration (Rules 1/2).**
- **Integration ACs.**
  - `iris_doc_edit` reads `unifiedDiff`/`alignLines` and returns hunks that reproduce the re-read on real IRIS (AC-5, AC-7 live).
  - `iris_server_profiles` reads the parent map through a real `McpServerBase` built from the real dev tools, and reports `iris_doc_edit:apply` as `false`/`parent` (AC-6; no mocked policy).
- **Consumed-by:**
  - `iris_doc_edit` (this story);
  - 38.5 `iris_sql_query` (parent);
  - the 38.6 prompt and capstone;
  - Epic 43 (`regenerateStorage` confirmation).
- **Consumes:**
  - 38.2 `documentLines`, `formatNumberedLines`, `ts`;
  - 38.3 `isClassDocument`, `droppedStorageDefinitions`, `storageDroppedRefusal`, `REFUSAL_CODES.DOCUMENT_CONFLICT`, `refusalResult`;
  - 38.0 `atelierDocStatusError`, `stripLeadingBom`;
  - `live-doc-helpers.ts`.
- **Extend, don't copy:**
  - `buildParentKeys` follows `buildDefaultEnabledWrites`;
  - inheritance reuses `ownBool`/`ownProfileLayer`;
  - `readTextDocument` is extracted from `readLineRange`, not copied;
  - `validateDocName` is reused;
  - the new `lines.ts` functions extend the one utility; the diff has no sibling (the probe above);
  - the governance test mirrors `test-status-governance.test.ts`;
  - the live gate follows the 38.3 setup, kept per file for roster detection (Rule #59).

**Ledger inbox.** None. Context only:
- DW-547/548 (Storage-scanner limits, inherited by the edit guard);
- DW-549 (`load.ts` is touched only at the split);
- DW-542 (`iris_doc_get` no-range path untouched).

**Residual risks.**
- **A non-unique `expected`.** A line such as `}` can still match after another writer shifted lines before this tool's read. The description advises a distinctive `expected`. An optional caller `ts` would close this; that is an additive parameter for a later story if it is needed.
- **A delete between the GET and the PUT.** If the document is deleted in that window, the PUT recreates it with the edited text (Atelier creates a missing document). This is a rare race, and the result reports success.
- **Inherited scanner limits.** The Storage scanner limits are inherited (DW-547/548).

## Verification

Every command runs in the foreground with `timeout: 600000` from `/Users/jbrandt/git/iris-execute-mcp-v2`. IRIS is reached only through `default` (localhost:52773, HSCUSTOM).
- **Live writes.** They go only to:
  - `ExecuteMCPv2.Temp.QaStory384Edit.cls` (compiled);
  - `ExecuteMCPv2.Temp.QaStory384Store.cls` (persistent, compiled, no rows);
  - `ExecuteMCPv2.Temp.QaStory384Rtn.mac`.

  Each is removed before and after the run.
- **No OS %UnitTest runs.** There are no ObjectScript changes.
- **Build order.** Rebuild shared before dev tests, and dev before `iris-mcp-all` tests and live gates (dist imports, `checkDistFresh`).

**Shared surfaces:**
- the dev tool array, order and counts (`index.test.ts`, `pre-feature-tool-snapshot.ts`, `tool-visibility-backcompat.test.ts`, `tool-visibility-snapshot-drift.test.ts`);
- the dev preset rosters and `TOOL_PAIRS` (`presets.test.ts`, `presets.e2e.test.ts`, `tool-visibility.test.ts`);
- the documented counts (`docs-visibility-roster-sync.test.ts`, `docs-prompt-sync.test.ts`; README, `iris-mcp-all` README, CHANGELOG roster line, dev README, migration doc, `tool_support.md`);
- the `REFUSAL_CODES` key set (`refusals.test.ts`, `story-38-3-qa-doc-claims.test.ts`);
- `DOCUMENT_WRITE_PATHS`;
- the dev `gateTestFiles` (`live-gate-roster.test.ts`);
- the `GovernanceConfigSource` value set and the engine and discovery signatures (`governance-cli-universe.test.ts`, `governance-file.test.ts`, `server-discovery.test.ts`);
- the `GOVERNANCE_DISABLED` denial literals (`refusals.test.ts:180-203`);
- the shared barrel;
- the `CHANGELOG.md` top section (the 38.0-38.3 doc-claims tests locate their sections by regex);
- the root README payload table.

Standing criterion: every test added or changed passes on a fresh environment, in either order.

**Commands:**
- `(loop)` `pnpm --filter @iris-mcp/shared build && pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/lines.test.ts src/__tests__/governance-parent.test.ts src/__tests__/refusals.test.ts src/__tests__/governance-cli-universe.test.ts src/__tests__/server-discovery.test.ts src/__tests__/governance-file.test.ts src/__tests__/tool-visibility.test.ts src/__tests__/tool-visibility-backcompat.test.ts` -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/dev build && pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/doc-edit.test.ts src/__tests__/doc-edit-governance.test.ts src/__tests__/doc-put-storage-guard.test.ts src/__tests__/doc.test.ts src/__tests__/doc-get-range.test.ts src/__tests__/load.test.ts src/__tests__/index.test.ts src/__tests__/presets.test.ts src/__tests__/presets.e2e.test.ts` -- expected: pass.
- `(loop)` `IRIS_HOST=localhost IRIS_PORT=52773 IRIS_NAMESPACE=HSCUSTOM IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=SYS IRIS_HTTPS=false IRIS_REQUIRE_LIVE=1 pnpm --filter @iris-mcp/dev exec vitest run --no-file-parallelism src/__tests__/doc-edit-live-gate.test.ts src/__tests__/doc-put-storage-guard-live-gate.test.ts src/__tests__/doc-get-range-live-gate.test.ts src/__tests__/doc-put-bom-live-gate.test.ts` -- expected: all pass, none skipped.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/document-write-paths.test.ts src/__tests__/default-enabled-holders.test.ts src/__tests__/live-gate-roster.test.ts src/__tests__/story-38-3-qa-doc-claims.test.ts src/__tests__/tool-visibility-snapshot-drift.test.ts src/__tests__/docs-visibility-roster-sync.test.ts src/__tests__/docs-prompt-sync.test.ts` -- expected: pass.
- `(once)` One command per package, each running `build`, then `test`, `lint` and `type-check` where defined. The packages are shared, dev, admin, interop, ops, data and client-config, followed by `pnpm --filter @iris-mcp/all test` (35-1-DEV-1). Expected: green.
- `(once)` `pnpm gen:governance-baseline:check` -- expected: exit 0 at `1e62c5ad5bf7`/141.
- `(once)` `pnpm measure:tools-payload` after the dists are rebuilt -- expected: the numbers pasted into README match.
- `(once)` `git diff --stat 4a54d625d652d38a65d9db1bd19a5619f7680568 -- packages/shared/src/bootstrap-classes.ts packages/shared/src/governance-baseline.ts packages/shared/src/baseline-classifications.ts src/` -- expected: empty.
- `(once)` `iris_doc_list` and `iris_global_list` (`server:"default"`, `namespace:"HSCUSTOM"`, filter `QaStory384`, docs with `generated:true`) -- expected: empty.

**Planned mutations (Rule 19).** For each one, apply it, observe red, revert, rebuild any dist it touched, and check that `git status --short` and `git diff --stat` are unchanged. Record each result as `mutation: ... -> ...`.

| AC | Mutation | Expected red |
|---|---|---|
| AC-1 | `unifiedDiff` always prints `,1` | the `diff -U3` literal pins |
| AC-2 | overlap check removed | unit Overlap rows (no request) |
| AC-2 | edits applied top-down, without offsets | unit several-edits and order rows; live multi-edit |
| AC-3 | `expected` check skipped | unit Stale; live stale byte-identical |
| AC-3 | Pv sends `?ignoreConflict=1` instead of the header | unit Pv call pin; live concurrent-writer conflict |
| AC-3 | a 409 on Pv retried once | unit Conflict (one Pv) |
| AC-4 | Storage guard skipped for `apply` | unit and live `STORAGE_DROPPED` |
| AC-4 | `regenerateStorage` still guarded | unit and live override rows |
| AC-5 | output built from the edited array, not R | unit and live reformat rows |
| AC-5 | excerpt context 2 | unit excerpt pins |
| AC-6 | inheritance removed | `governance-parent`, `doc-edit-governance` inherited and discovery rows |
| AC-6 | inheritance placed above explicit child layers | child-wins rows |
| AC-6 | inheritance on any explicit `false` (reading A) | parent-enabled-higher row |
| AC-6 | `defaultEnabled` removed from `docEditTool` | defaults row, `default-enabled-holders` |
| AC-6 | `iris_doc_edit` dropped from `core` | `presets.test.ts`, pair case |
| AC-7 | `textToLines` keeps a trailing empty line | unit trailing-newline rows |
| AC-7 | BOM not stripped from `text` | unit BOM row |
| AC-8 | handler also calls compile | AC-8 request-list pin |
| AC-9 | `splitLines` splits on `\n` only | 38.3 back-compat CRLF pin, `lines.test` |
| AC-9 | parent map applied when the parent is explicitly `true` | back-compat `toEqual` |

**Mutation results (Rule 19).** Each was applied to the source with a scripted exact-string replacement, the named tests were run, the file was restored from its saved bytes, the dist that the mutation touched was rebuilt (shared for the `lines.ts` and `governance.ts` rows that dev tests use, dev for the `defaultEnabled` row), and the tree was checked byte-identical against a checksum taken before the first mutation. Live rows ran armed against `default` (localhost:52773, HSCUSTOM).
- mutation: AC-1 `hunkRange` always prints `,count` (never omits a count of 1) -> `lines.test.ts` "deleting every line names the empty new range" and "adding lines to an empty document" (the `diff -U3` literals `@@ -1 +0,0 @@` and `@@ -0,0 +1 @@`) went red.
- mutation: AC-2 overlap check removed (`false && overlaps(a, b)`) -> `doc-edit.test.ts` all 8 Overlap rows went red.
- mutation: AC-2 edits applied in read order instead of bottom-up -> `doc-edit.test.ts` "applies insert + delete + replace bottom-up", the six shuffled-order rows, "accepts an insert next to a range" and the two `applyEdits` rows (10) went red; live "saves a replace, an insert and a delete in one call" went red.
- mutation: AC-3 `expected` check skipped (`false && stale.length > 0`) -> `doc-edit.test.ts` the three Stale rows and the carriage-return row (4) went red; live both "a stale expected text" tests went red.
- mutation: AC-3 the save sent as `PUT <path>?ignoreConflict=1` with no `If-None-Match` -> `doc-edit.test.ts` the Replace call pin, the AC-8 path pin, the namespace/encoding row, the routine row and the Conflict row (5) went red; live "saves a replace, an insert and a delete" (the PUT path pin) and "a writer between the tool's read and its save" went red.
- mutation: AC-3 a 409 on the save retried once -> `doc-edit.test.ts` "reports DOCUMENT_CONFLICT after exactly one save" (2 PUTs, expected 1) went red.
- mutation: AC-4 Storage guard skipped for `apply` -> `doc-edit.test.ts` "refuses an apply that drops a Storage definition" went red; live "apply refuses an edit that removes the Storage lines" went red.
- mutation: AC-4 `regenerateStorage` still guarded (guard on for every class) -> `doc-edit.test.ts` "regenerateStorage saves the same edits" went red; the same live test went red.
- mutation: AC-5 answer built from the edited array (`reread.lines = applied.lines`) -> `doc-edit.test.ts` both "IRIS reformats" rows went red; live "saves a replace, an insert and a delete" (re-read 15 lines, sent 14) went red.
- mutation: AC-5 excerpt context 2 instead of 3 -> `doc-edit.test.ts` 7 rows (Replace, Several edits, insert at top, routine, multi-line expected, reformat, No change) went red.
- mutation: AC-6 `inheritedParentDisable` always returns `undefined` (inheritance removed) -> `governance-parent.test.ts` the four-layer, child-wins, first-verdict, read-only and map rows went red, and `doc-edit-governance.test.ts` 11 of 25 went red (shared dist rebuilt for the dev run).
- mutation: AC-6 inherited disable checked before the key's own explicit layers -> `governance-parent.test.ts` 10 rows (child-wins engine rows, the read-only child row and the four gate child-wins rows) and `doc-edit-governance.test.ts` the four child-wins rows went red.
- mutation: AC-6 inheritance on any explicit `false` of the parent (reading A) -> `governance-parent.test.ts` 6 rows (the first-verdict rows, "a parent enabled at a higher layer than the file's disable" and the child-keys back-compat row) and `doc-edit-governance.test.ts` "env enables iris_doc_put and the file disables it: apply runs" went red.
- mutation: AC-6 `defaultEnabled` removed from `docEditTool` -> `doc-edit.test.ts` "is classified" (1), `doc-edit-governance.test.ts` the defaults rows (6) and `default-enabled-holders.test.ts` the holder list and the derived-keys row (2) went red (dev dist rebuilt for the `@iris-mcp/all` run).
- mutation: AC-6 `iris_doc_edit` dropped from the `core` roster -> `presets.test.ts` 7 rows (coverage, sizes, runtime 14, both pair rows) went red.
- mutation: AC-7 `textToLines` keeps a trailing empty line -> `lines.test.ts` 5 `textToLines` rows and `doc-edit.test.ts` 6 rows (Replace, CRLF, trailing newline, empty text, No change, `findStaleEdits`) went red.
- mutation: AC-7 BOM not stripped from `text` -> `lines.test.ts` "removes one leading BOM, and only one" and `doc-edit.test.ts` "strips one leading BOM from text and from expected" went red.
- mutation: AC-8 the handler also POSTs `action/compile` after the save -> `doc-edit.test.ts` "sends no compile request and nothing but the document path" went red; live "saves a replace, an insert and a delete" (`post` not called) and the Storage test went red.
- mutation: AC-9 `splitLines` splits on `\n` only -> `lines.test.ts` 3 rows (`splitLines` against `split(/\r?\n/)`, two `textToLines` rows) and `doc-put-storage-guard.test.ts` "CRLF string content is split as today" (the 38.3 back-compat pin) went red.
- mutation: AC-9 parent map applied when the parent is explicitly `true` (`verdict !== undefined`) -> `governance-parent.test.ts` 7 rows (the first-verdict rows, the gate "parent enabled at a higher layer" row and "the child's own keys are unchanged by the parent map") went red.

Review-pass additions (each applied to the source, the named tests run, the file restored, the shared dist rebuilt, and the tree digest `git diff HEAD | shasum -a 256` checked identical before and after all three):
- mutation: AC-6 the gate attributes a denial to the parent even when the key has its own explicit setting (`explicitOverride` ignored in `server-base.ts`) -> `governance-parent.test.ts` and `doc-edit-governance.test.ts` "an explicit false on apply while the parent is also disabled is the key's own denial, with no inheritedFrom" (1 each) went red.
- mutation: AC-6 the `allProfiles` branch of `computeServerDiscovery` drops `parentKeys` from both engine calls -> `governance-parent.test.ts` and `doc-edit-governance.test.ts` "iris_server_profiles with allProfiles reports the inherited verdict for the profile that disables the parent only" (1 each) went red.
- mutation: AC-6 `configSource` consults the inherited disable before the key's own explicit layers -> `governance-parent.test.ts` 7 rows, including the new "an explicit child false while the parent is also disabled is reported by the child's own layer", went red.

- mutation: AC-10 a frozen baseline key removed from the live surface (`iris_doc_put` renamed `iris_doc_putx` in `doc.ts`, dev dist rebuilt) -> `pnpm gen:governance-baseline:check` exited 1 naming `iris_doc_put` as a vanished frozen key; restored, dev dist rebuilt, the check exits 0 at 141 frozen / 205 live (code review, 2026-10-15).

**QA additions (Rule 3, Rule 19).** The implement stage proves the tool against real Atelier routes (handler called directly) and the governance matrix through the real `McpServerBase` gate with handler spies and a stubbed fetch; no test reached the built server through the MCP protocol with the real tools against the live IRIS. Added:
- `(QA)` `packages/iris-mcp-all/src/__tests__/story-38-4-qa-doc-edit-wire-gate.test.ts` (new, 10 tests). It spawns the built `iris-dev-mcp` dist per session and drives it with the real MCP SDK `Client` over stdio against `default` (localhost:52773, HSCUSTOM). It covers:
  - `tools/list` (schema, annotations, no guard-skipping parameter) and `iris_server_profiles` defaults;
  - an `apply` whose edits omit the fields their op does not take (including `afterLine: 0`), followed by `iris_doc_compile` and excerpt-versus-ranged-read equality;
  - a stale `expected` leaving `{ts, content}` byte-identical;
  - `regenerateStorage` denied by default and `apply` refused with `STORAGE_DROPPED`, each leaving a compiled persistent class unchanged;
  - `iris_doc_put` disabled at `IRIS_GOVERNANCE`: `inheritedFrom` denials, `parent` source, nothing written, and `iris_doc_put`'s own denial unchanged;
  - an explicit `iris_doc_edit:apply: true` winning and writing;
  - `IRIS_TOOLS_DISABLE=iris_doc_put` (hidden parent);
  - `regenerateStorage: true` running;
  - the read-only preset, with and without the inherited disable;
  - the built `iris-mcp-governance universe --json` process agreeing key-for-key with the server's `iris_server_profiles`.
  Fixtures: `ExecuteMCPv2.Temp.QaStory384WireEdit.cls` and `...WireStore.cls`, removed before and after; the gate asserts no document (generated included) and no global named `QaStory384Wire` remains.
- `(QA)` `packages/iris-mcp-all/scripts/prepublish-gate.mjs`: the gate is listed in `gateTestFiles` (Rule 8; `live-gate-roster.test.ts` enforces it).
- `(once)` `IRIS_HOST=localhost IRIS_PORT=52773 IRIS_NAMESPACE=HSCUSTOM IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=SYS IRIS_HTTPS=false IRIS_REQUIRE_LIVE=1 pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-38-4-qa-doc-edit-wire-gate.test.ts` -- expected: 10 pass, none skipped. It also passes unarmed in the default suite.
- Not re-proved on the wire: a concurrent writer between the tool's read and its save. It needs a writer inside that window, which `doc-edit-live-gate.test.ts` provides with a `put` spy against the real 409.

QA mutations (each applied by exact-string replacement, dist rebuilt, the gate run, the file restored, the dist rebuilt; `git diff HEAD | shasum -a 256` identical before and after all of them):
- mutation: AC-3 `expected` check skipped (`false && stale.length > 0`) -> wire gate "a stale expected text is STALE_CONTENT ..." went red.
- mutation: AC-4 Storage guard skipped for `apply` -> wire gate "on a compiled persistent class, regenerateStorage is denied ... apply is STORAGE_DROPPED" went red.
- mutation: AC-5 answer built from the edited array (`reread = { ...reread, lines: applied.lines }`) -> wire gate "apply saves edits whose omitted fields the SDK parses ..." went red.
- mutation: AC-6 `inheritedParentDisable` never returns the parent -> wire gate 4 of 10 went red (both-keys-denied, explicit-child-wins, hidden-parent, read-only plus inherited).
- mutation: AC-6 `defaultEnabled` removed from `docEditTool` -> wire gate 5 of 10 went red (defaults, apply, stale, storage, hidden-parent).
- mutation: AC-6 `defaultEnabled: ["apply", "regenerateStorage"]` -> wire gate "tools/list ... defaults" and the Storage denial test went red.
- mutation: AC-6 inherited disable placed above the explicit child layers (`governance.ts` `effective`) -> wire gate "an explicit iris_doc_edit:apply: true wins and writes" went red.
- mutation: AC-6 CLI `universe` builds an empty parent map (`cli/governance.ts`) -> wire gate "iris-mcp-governance universe --json and iris_server_profiles report the same ..." went red.
- mutation: Rule 8 the gate removed from `gateTestFiles` -> `live-gate-roster.test.ts` "iris-mcp-all: every armed test file is in scripts/prepublish-gate.mjs gateTestFiles" went red.

Code-review additions, 2026-10-15. Each mutation was applied to the source, the named tests were run, and the file was restored; `doc-edit.ts` and `doc.ts` were checked to carry only the review patch afterwards, and the dev dist was rebuilt.
- mutation: AC-5 `changed` hard-coded to `true` again in `doc-edit.ts` -> `doc-edit.test.ts` "a class edit that IRIS stores back as it was is changed: false, and says so" went red (1 of 83). The row's fake is the live probe of 2026-10-15: a class saved without the blank line between two members re-reads byte-identical to the read, with the same `ts`.
- mutation: Tasks "Every field has a description" `expected`'s description blanked (`"" && ...`) -> `doc-edit.test.ts` "describes every field, the edit fields included" went red (`edits[].expected`).
- mutation: Rule 19 hermeticity, with a foreign `ExecuteMCPv2.Temp.QaStory384WireEdit.cls` planted on `default`/HSCUSTOM -> the dev live gate's former `QaStory384` filter failed both `beforeAll` and `afterAll` (10 skipped). With the gate scoped to its own fixture stems, it passed 10/10 with the foreign document present, which was then removed (`QaStory384` listing empty).
- The wire gate's helpers now come from `process-gate-helpers.ts`. The armed run passed 10/10, which exercises `staleDistReason`, `resolveSdkEsmDir` and `isIrisReachable` on the gate's own path (armed, any skip reason throws).

## Auto Run Result

Status: done
Blocking condition: none

**Summary.** Added the dev tool `iris_doc_edit` (`apply` enabled by default, `regenerateStorage` default-disabled; dev 29 -> 30 tools, suite 105 -> 106) and the governance `parent` mechanism. The tool reads a document once, checks every edit's `expected` text, applies the edits bottom-up and saves once with `If-None-Match`; it answers from a re-read (`unifiedDiff`, one excerpt per edit, `totalLines`, `ts`) and never compiles. `iris_doc_edit` declares the parent `iris_doc_put`: when that key's first explicit verdict is `false`, both `iris_doc_edit` keys seed disabled, reported as `configSource: "parent"` and denied with `inheritedFrom`. `BOOTSTRAP_VERSION` is unchanged (`3af8ca401e7c`); the frozen baseline check passes at `1e62c5ad5bf7`/141 (live 205, post-foundation 64).

**Files changed.**
- `packages/shared/src/lines.ts`, `index.ts`: `splitLines`, `joinLines`, `textToLines`, `alignLines`, `unifiedDiff` (hand-written Myers), `DIFF_CONTEXT_LINES`, `MAX_DIFF_DISTANCE`.
- `packages/shared/src/governance.ts`, `tool-types.ts`, `server-base.ts`, `server-discovery.ts`, `cli/governance.ts`: the parent mechanism, the `parent` source and `inheritedFrom`.
- `packages/shared/src/refusals.ts`, `tool-visibility.ts`: `STALE_CONTENT`; the `iris_doc_get` / `iris_doc_edit` pair.
- `packages/iris-dev-mcp/src/tools/doc-edit.ts` (new), `doc.ts`, `load.ts`, `index.ts`, `presets.ts`: the tool, the shared read check and split call sites, registration, `core` 14 / `developer` 31 runtime.
- New tests: `doc-edit.test.ts`, `doc-edit-governance.test.ts`, `doc-edit-live-gate.test.ts`, `governance-parent.test.ts`, `default-enabled-holders.test.ts`; updated counts, rosters, `lines.test.ts`, `refusals.test.ts`, write-paths and 38.3 claims tests, the prepublish gate roster.
- Docs: root, dev, shared, `iris-mcp-all` and launcher READMEs, `tool_support.md`, `CHANGELOG.md`, `docs/migration-v1-v2.md`, `docs/epic-summary.md`, `.changeset/story-38-4-surgical-line-edit-tool.md`, and the re-measured payload table.
- `extensions/iris-mcp-launcher/src/governanceView.ts`: `parent` added to two TypeScript unions (review patch).

**Review.** Four layers (blind, edge-case, verification-gap, intent-alignment) reported 33 findings: high 0, medium 0, low 23, false 9, maybe-false 1 (mechanical count of the triage rows). Routes: 10 patch rows (8 patches), 1 defer, 22 reject.
- Patches applied (all low): stale counts in `README.md:733` and `docs/epic-summary.md`; CLI `effective`/`universe` help; launcher unions and README; the description and dev README claim "never overwrites lines it has not seen"; the root README `presetApplied` clause; `allProfiles` discovery tests; explicit-child-false gate and engine tests; the `parent` JSDoc.
- Deferred: Project Rule #53 text ("<=13") against L-4 (an agent-context file, for the lead).
- Rejected, with reasons: `null`/`""` coerced to 0 for `afterLine` (guarded by `expected`, shared idiom); uncapped response and the `MAX_DIFF_DISTANCE` fallback (specified; needs more than 1,000 changed lines); `\r`-ended lines in multi-line `expected` (parse is in the intent contract); description duplicates field text (spec requires both); whole-document replace returns the document (inherent); `pairs.length === 0` excerpts (needs more than 2,000 differences); change between save and re-read (millisecond window); `removeTools` of a non-baseline parent (unreachable with real tools); audit log omits `inheritedFrom` (spec Never); empty-content document (maybe-false, low if real); missing `ts` (unreachable); hidden parent named in the denial (operator-set); live-gate global emptiness assertion (spec-mandated cleanliness check); eight intent-alignment observations that restate the spec's own prescriptions.
- Follow-up review recommendation: `false` (patched entries by verdict: high 0, medium 0, low 8).

**Verification.**
- Loops (twice: after the implement pass, and after the review patches): the shared set 289 tests, the dev set 348, the `@iris-mcp/all` set 58, all pass; the armed live gates (`doc-edit`, `doc-put-storage-guard`, `doc-get-range`, `doc-put-bom`) 151 tests pass, none skipped, against `default` (localhost:52773, instance `77DD5053-...`, IRIS 2026.2 build 221U, HSCUSTOM).
- Once, after the last patch: shared 1,589, dev 1,184, admin 498, interop 343, ops 350, data 165, client-config 514 tests, with build, lint (0 errors; one pre-existing warning at `cli/governance.ts`) and type-check clean; `@iris-mcp/all` 300 tests; `pnpm gen:governance-baseline:check` exit 0; the protected-file diff (`bootstrap-classes.ts`, `governance-baseline.ts`, `baseline-classifications.ts`, `src/`) is empty; `pnpm measure:tools-payload` re-run and the README table updated (dev full 78,033 bytes, core 37,207); `iris_doc_list` (generated included) and `iris_global_list` for `QaStory384` are empty.
- Mutations (Rule 19): 20 from the implement pass and 3 from the review pass, each red then restored; the tree digest was identical before and after the review-pass mutations.
- The launcher `type-check` fails on missing `vscode`/servermanager modules in this environment (pre-existing, none in the file edited); its `governanceView.test.ts` passes (26).

**Residual risks and notes for the lead.**
- The matrix example `@@ -2 +1,0 @@` is a `-U0` form (see the Spec Change Log); the implementation follows `diff -U3`.
- A non-unique `expected` line can still match after another writer shifted lines before the tool's read (Design Notes residual risk). A stored line ending in `\r` cannot be matched by a multi-line `expected`.
- Outside the spec's doc list: `docs/epic-summary.md` and the launcher's types and README were touched by review patches.
- Spec follow-ups for the lead: correct the matrix wording; Rule #53 text against L-4.
