---
title: 'Story 43.4: SDK v2 Docs, Smokes and Capstone'
type: 'feature'
created: '2026-10-20'
status: 'done'
baseline_revision: 'b841530ffdd325f74e91762de85717d8f0a014bd'
baseline_commit: 'b841530ffdd325f74e91762de85717d8f0a014bd'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-43-context.md'
warnings:
  - multiple-goals
  - oversized
deferred:
  - summary: 'The README payload table (README.md:778-790) says "Byte counts are not test-pinned", but `story-40-4-doc-claims.test.ts:217` pins the dev row literal, and three 39.x doc-claims tests require the "Last re-measured" story to be 39.x or 40.x. The figures predate the Story 43.4 description sentences (about +1.9 KB across dev, admin and interop), and this story does not re-measure them (decision #28).'
    evidence: 'Plan-stage inventory, 2026-10-20: `story-40-4-doc-claims.test.ts:216-217`, `story-39-4-doc-claims.test.ts:149`, `story-39-1-doc-claims.test.ts:154`, `story-39-5-doc-claims.test.ts:188`.'
    location: 'README.md:778-790'
    severity: 'low'
  - summary: >-
      The `iris_message_resend` tool description, its `maxMessages` schema text and `packages/iris-interop-mcp/README.md` still say that executing needs both `dryRun: false` and `confirm: true` "otherwise the call is refused" and that an over-cap count is refused, although `MessageResend.cls` only refuses when `dryRun` is false and previews when `dryRun` is left out (Story 43.4 fixed the `resend-failed-messages` prompt text only).
    evidence: |-
      Review pass 2026-10-20 (Blind Hunter), verified against the spec's own DW-653 evidence: the over-cap guard runs only when `dryRun` is false, and the tool description says `dryRun` defaults to true. The intent forbids any change to an existing description byte outside the 11 sanctioned entries, so this story cannot take it.
    location: >-
      packages/iris-interop-mcp/src/tools/message-resend.ts:364-369 and :434; packages/iris-interop-mcp/README.md:302
    severity: low
---

<intent-contract>

## Intent

**Problem:** Epic 43 has no epic-done gate. Its human-confirmation dialog is invisible in the five gated tools' descriptions. Its frozen v1 goldens cannot absorb any legitimate change (DW-639), so they also block two known wire defects: the duplicate governance resource (DW-646) and a wrong prompt text (DW-653). Nothing records what real clients do with both protocol eras, the probe process (DW-641) or the dialog. The README, the client docs, the CHANGELOG, the spine and the PRD still describe the epic as unfinished.

**Approach:** Retire both goldens into a sanctioned-change ledger. The frozen files stay byte-unchanged. Each sanctioned change to bytes they hold is one entry, with a JSON pointer and its exact old and new value, and the golden tests apply the entries before comparing. On top of that ledger:
- the five gated descriptions gain one appended sentence, and the duplicate governance resource is removed;
- the DW-653 prompt text is fixed;
- the default-suite capstone drives the built admin server through the real SDK client on three negotiation modes;
- the docs and records are written;
- the lead's live-smoke procedure covers Claude Code and an unattended second client.

## Boundaries & Constraints

**Always:**
- **Frozen goldens (Rule #36, AD-15).**
  - `fixtures/sdk-wire-golden.json` and `fixtures/sdk-handler-golden.json` stay byte-unchanged; a SHA-256 pin proves it.
  - Every change to bytes they hold is one entry in `fixtures/sdk-golden-sanctioned-changes.json`. The tests compare every other byte unchanged.
  - The goldens are never recaptured, and `capture-sdk-*-golden.mjs` is never run.
- **The sanctioned set is exactly decision #24's.** It has 11 ledger entries (6 description, 5 resource) plus the DW-653 prompt-text fix, which no golden holds.
  - Each description change only APPENDS its sentence. No existing description byte changes.
  - Prompt names, titles, descriptions and arguments stay unchanged.
- **Counts and keys stay fixed:**
  - 110 package tools and 115 advertised (33/27/25/22/8);
  - governance baseline `1e62c5ad5bf7`, 141 keys;
  - no new tool, action, governance key, preset row, annotation, refusal code or environment variable;
  - `BOOTSTRAP_VERSION` stays `d51856f74d6a` (unchanged since the epic base `9a2f515`), and no ObjectScript changes.
- **SDK confinement (AD-2, AD-32).** No new SDK import outside `server-base.ts` and `sdk-wire-compat.ts`. The new `.mjs` loader imports no SDK.
- **Closed port only.** Every spawned server runs on `127.0.0.1` with `IRIS_PORT=1` or a fake-listener port; launcher runs also set `IRIS_TEST_HOST`/`IRIS_TEST_PORT`. No live gate is armed.
- **Generated files are regenerated, never hand-edited (Rule #18):** the two `resend-failed-messages/SKILL.md` copies and `fixtures/tools-list-snapshot.json`.
- **Docs ship with the change (Rule #43).** Source and test comments state the contract, never the history (Rule 14). New source text is ASCII.

**Never:**
- No `claude`, MCP Inspector or other client run in the implement, QA or review stages. The live smoke is the lead's (decision #26).
- No edit under `_bmad-output/planning-artifacts/`. The spine and PRD texts are lead actions at the spec gate (decision #28).
- No dependency, manifest or lockfile change, and no re-measure of the README payload table (decision #28).
- No bare `gen:governance-baseline`.
- No change to any `ctx.confirm` call site, the confirmation helper, `serveStdio` options or the era factory.
- No new log line on the call path.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Golden comparison, sanctioned | A golden test loads the golden through the ledger | Each row named by an entry is the frozen line, with that entry's value replaced or removed at its pointer, re-serialized (`JSON.stringify`; the 112 wire rows round-trip byte for byte). Every other row is the frozen line. The live built server's line equals it byte for byte. | none |
| Entry `old` mismatch | An entry whose `old` is not deep-equal to the frozen value at its pointer, or whose row or pointer does not exist | The loader throws an `Error` naming the entry `id`, so every golden test that loads it fails. | fail, never skip |
| No-op or non-append entry | `replace` with `new` deep-equal to `old`; or `appendOnly` with `new` not starting with `old`, or not longer | The ledger validation throws, naming the `id`. | fail |
| Unlisted change | A built server's line differs from the frozen golden where no entry names it | The 43.1/43.2 golden rows go red at that row. | today's red |
| Governance resources, one profile | Default profile only, either era | `resources/list` has exactly one governance entry: `iris-governance://default`, named `iris-governance-default` | none |
| Governance resources, two profiles | `IRIS_PROFILES` adds `prod` | Static `iris-governance://default`, plus `iris-governance://prod` named `iris-governance-profile-prod`. No URI is listed twice. `resources/read` of both URIs is unchanged. | none |
| Gated description | `tools/list` from any client, either era | The five descriptions are the frozen ones plus the decision #24 sentence, appended with that tool's separator. Every other tool's description is unchanged. | none |
| Capstone, a mode | Built admin dist, fake listener, client declares `{elicitation: {form: {}}}`, mode `legacy`, `{pin: "2026-07-28"}` or `auto` | The era and version match the mode. Listing equals the sanctioned golden. The read equals the handler golden. The denial and the validation error equal the wire golden. The accept asks once and writes 1 purge POST; the decline asks once and writes nothing. Five audit entries. | fail, never skip, on a stale dist or a missing client |

</intent-contract>

## Code Map

Line numbers are at HEAD `d14aa50`.

**The goldens and their five loaders.** Each loader replaces its load line with the sanctioned loader.
- **The frozen fixtures, never edited.** Both are in `packages/iris-mcp-all/src/__tests__/fixtures/`:
  - `sdk-wire-golden.json`: 112 rows (5 servers; sessions `main`, `newer-era`, and dev `core-preset`), SHA-256 `602231cca4abe8a01af7eb04ac7acb852a16f1b841408d3b8dc2c1c3a08edbc9`, committed once in `5892022`;
  - `sdk-handler-golden.json`: 22 `tools/call` rows plus `startup`, `upstream` and `audit`, SHA-256 `6abbd4b30794cec908312ed2dc007a2319da2c020144bc738bfe7fd91665c869`, committed once in `5d3d9e1`.
  - Every wire row satisfies `JSON.stringify(JSON.parse(line)) === line` (112 of 112, plan-stage check).
- **The loaders:**
  - `story-43-1-sdk-wire-golden.test.ts:66` is the raw byte compare at `:224-235` and the v2-client compare at `:237-263`. Its header comment (`:1-18`) is restated for the ledger.
  - `story-43-2-cross-era-pin.test.ts:89`: row (a) is `:278-292` and row (d) is `:348-358`. Its header comment is `:1-24`.
  - `story-43-1-qa-handler-golden.test.ts:65`.
  - `story-43-1-sanctioned-wire-changes.test.ts:39`, which uses only the `call:server-profiles` row.
  - `story-43-2-chokepoint-both-eras.test.ts:324`, which uses only the `core-preset` names.
- **The capture constants:** `GOLDEN_RELATIVE_PATH` is at `scripts/lib/sdk-wire-golden-core.mjs:26` and `HANDLER_GOLDEN_RELATIVE_PATH` at `scripts/lib/sdk-handler-golden-core.mjs:33`. `golden-capture-cli.mjs:70` refuses to overwrite without `--force`.
- **The rows the ledger names (plan-stage dump):**
  - `tools-list` descriptions:
    - dev `main` `/result/tools/27` (`iris_env_promote`) and `/result/tools/29` (`iris_doc_edit`);
    - dev `core-preset` `/result/tools/12` (`iris_doc_edit`);
    - admin `main` `/result/tools/25` (`iris_audit_manage`);
    - interop `main` `/result/tools/1` (`iris_production_control`) and `/result/tools/21` (`iris_message_resend`).
  - `resources-list` in each server's `main` session: `/result/resources/1` is `{"title":"IRIS governance policy (per profile)","description":"Advisory governance policy for the \"default\" server profile.","mimeType":"application/json","uri":"iris-governance://default","name":"iris-governance-profile-default"}`.
  - The interop `prompts-list` row holds the `resend-failed-messages` metadata only. No `prompts-get` row is that prompt, so DW-653 needs no entry.

**Source**
- `packages/shared/src/server-base.ts:1267-1332` `registerGovernanceResource`. The static `default` reader is at `:1271-1284`. The `{profile}` template's `list` at `:1297-1310` maps every `this.profiles` key, including `DEFAULT_PROFILE_NAME`; that is DW-646. The comment at `:1286-1296` is restated.
- The five descriptions. Each sentence is appended at the end of the concatenation:
  - `packages/iris-admin-mcp/src/tools/audit.ts:52-68`, ending `"...log lifecycle management."`;
  - `packages/iris-dev-mcp/src/tools/env-promote.ts:1340-1392`, ending `"...in any version."`;
  - `packages/iris-interop-mcp/src/tools/production.ts:102-118`, ending `"...explicit IRIS_GOVERNANCE override."`;
  - `packages/iris-interop-mcp/src/tools/message-resend.ts:347-378`, ending `"...not a completed one)."`;
  - `packages/iris-dev-mcp/src/tools/doc-edit.ts:446-469`, ending `"...is disabled by default."`.
- `packages/iris-interop-mcp/src/prompts/resendFailedMessages.ts:70-71`: steps 3 and 4 (DW-653).
- The generated copies are `skills/resend-failed-messages/SKILL.md` and `packages/client-config/skills-pack/skills/resend-failed-messages/SKILL.md`. They are regenerated with `pnpm gen:skills`, then `pnpm gen:pack`.

**Pins that move with the sanctioned set** (each the only change to its file)
- **The tools-list snapshot** (`fixtures/tools-list-snapshot.json`): regenerate it with `pnpm gen:tools-list-snapshot --force` after rebuilding every package. It is checked by:
  - `tools-list-snapshot.test.ts:172` and `:206`;
  - `story-39-6-qa-snapshot-cli.test.ts:203`, `:286`, `:344` and `:357-362`;
  - `scripts/gen-tools-list-snapshot.mjs:113-123`.
- **Prompt hash constants** for `resend-failed-messages`, each re-pinned from the rebuilt output:
  - `story-41-5-qa-dist-consumer.test.ts:49` (body, `c4518b57…`);
  - `story-41-2-qa-prompts-stdio-wire.test.ts:302` (get, `af4ac020…`);
  - `skills-generated-frontmatter.test.ts:116` (file, `b9e38324…`).
- **Prompt constraints that stay green:**
  - `prompt-safety-invariants.test.ts:104-121`: the first `dryRun: true` comes before the first `dryRun: false`, which comes before the first `confirm: true`; the body keeps DUPLICATION HAZARD, DEFAULT-DISABLED, GOVERNANCE_DISABLED and IRIS_GOVERNANCE;
  - `story-39-6-qa-forensics-prompts-sdk-wire.test.ts:446-450` (no `AD-`, `DW-`, `Rule #`, paths);
  - `validate-prompts.test.ts`.
- **Description pins** stay green under an append, all `toContain`:
  - `audit.test.ts:381`;
  - `production.test.ts:337`;
  - `message-resend.test.ts:75-80`;
  - `message-resend-policy.test.ts:89-94`;
  - `doc-edit.test.ts:1608-1626`, including `not.toMatch(/\/api\/|atelier|\/doc\//i)`.
- **`story-43-3-doc-claims.test.ts`**:
  - `:102` pins README `:688` "Tool descriptions are not changed in this release", which becomes false;
  - `:153-156` asserts the CHANGELOG's top entry is 43.3;
  - its section regex (`:38`) runs to the next `### `, so add no `###` heading inside "Human confirmation (elicitation)".
- **CHANGELOG scanners:**
  - `changelog-bootstrap-move.test.ts`: write "stays at", never "moves";
  - `docs-visibility-roster-sync.test.ts:316`: write no "`full` N/N/N/N/N" line;
  - `qa-41-7-doc-links.test.ts:109-112`: every relative link and anchor in README and CHANGELOG resolves.
- **README pin:** `story-38-1-qa-doc-claims.test.ts:120-122` pins the **stdio** sentence of README `:934`; keep it intact.

**The rig to lift (Rule 2)**
- `story-43-3-confirmation-both-eras.test.ts:399-540` holds:
  - `Exchange`, `Rig`, `cleanups` plus `afterEach` (`:432-436`);
  - `isWrite`, `writeLine`, `withoutMeta`;
  - `openRig(pkg, negotiation, {capabilities?, governed?, promote?})` (`:450`).
  
  It uses `TICKED`, `governanceOf` and `GATE_GOVERNANCE` (`:392-397`) from the same file. `openRig` is file-local, and a `.test.ts` cannot be imported without loading its suites.
- **Helpers it composes:**
  - from `process-gate-helpers.ts`: `connectSdkClient` (`:317`; `versionNegotiation` `{mode: "legacy" | "auto" | {pin}}` at `:269`, default `{mode: "legacy"}`, `clientCapabilities`, `onElicitation`, `onStderr`), `pollAuditEntries` (`:901`), `distEntry`, `staleDistReason` and `resolveSdkEsmDir`;
  - `startFakeIris` (`scripts/lib/fake-iris-listener.mjs:87`);
  - `readBootstrapVersion` and `normalizeAuditEntry` (`sdk-handler-golden-core.mjs`).

**Capstone oracles (existing, frozen)**
- **Wire golden admin `main`** (sanctioned): `tools-list`, `prompts-list`, `resources-list`, `prompts-get:empty:audit-security-posture` (for the omitted-arguments call, DW-617), `call:denial` (`iris_resource_manage {action: "grant"}`, GOVERNANCE_DISABLED) and `call:invalid-type` (`iris_namespace_manage {action: "create", name: 12345}`).
- **Handler golden admin** `namespace-list` (`iris_namespace_list {}`): its result, and its upstream `GET /api/executemcp/v2/config/namespace`.
- **The purge success** is `BASELINE["admin: purge ok"]` (`story-43-3-qa-baseline.ts:87-88`, captured at `0a5a3f8`): its result, and the write `POST /api/executemcp/v2/security/audit {"action":"purge","confirm":true,"end":"2026-01-01 00:00:00"}`.
- **The dialog** is the five-line template (43.3 decision #13): `Confirm: permanently delete audit-log records.` / `Target: the IRIS audit log` / `Scope: records matching end=2026-01-01 00:00:00` / `Server: default (127.0.0.1:<port>)` / `Tick Confirm and accept to run it now. Decline or cancel to change nothing.` Its schema is `CONFIRMATION_SCHEMA`.
- **The decline text** is `The person declined the confirmation for: permanently delete audit-log records. Nothing was changed. Do not repeat this call unless the person asks for it again.`, with `structuredContent` `{code: "CONFIRMATION_DECLINED", action: "purge", response: "decline"}`.
- **Era lines** (`server-base.ts:941-953`): `[INFO] Serving MCP protocol revision 2026-07-28 (server/discover)` and `[INFO] Serving the 2025-era MCP handshake (initialize)`.
- **Strippers to reuse:** `withoutMandatedFields(method, message)` and `withoutExecution(message)` (`sdk-wire-golden-core.mjs:533`, `:553`).

**Mutation targets (do not change; mutate only for Rule #59 proofs)**
- `server-base.ts:2914-2917` `serveStdio(this.serverFactory, {legacy: "serve", transport: new StdioServerTransport()})`. Per `stdio.d.mts:7-38`, `legacy` is `'serve' | 'reject'`, and `McpServer.connect(transport)` exists.
- `confirmation.ts:225` `if (view.action === "decline") return "decline";`.

**Docs**
- **`README.md`:**
  - `:644-689` "Human confirmation (elicitation)": the intro at `:646` says "adds no … description"; `:678` (hooks) says the no-hook case "is not documented"; `:688` says the descriptions are unchanged;
  - `:565-566` governance resources;
  - `:934` Architecture (protocol revisions);
  - `:778-790` payload table, not touched.
- `docs/client-config/README.md`: the matrix is at `:65-90` (in this folder, "2026-07-28" is a certification date) and "The env block" at `:92`.
- `docs/client-config/claude-code.md`: "Setting Environment Variables" at `:417` and "Verification" at `:449`.
- **`CHANGELOG.md:5`**: the top entry is 43.3. Follow its format: a lead paragraph, then Added / Unchanged / Known limits.
- **`.changeset/story-43-3-human-confirmation.md`**: the format to follow.

## Tasks & Acceptance

**Execution** (in this order; tasks 12 and 13 pin the docs of tasks 14 and 15, so they go green only once those are written):
1. **The ledger loader.** NEW `scripts/lib/golden-sanctioned-changes.mjs` (ESM, `node:fs`/`node:path` only). Exports:
   - **`SANCTIONED_CHANGES_RELATIVE_PATH`** = `packages/iris-mcp-all/src/__tests__/fixtures/sdk-golden-sanctioned-changes.json`.
   - **`readSanctionedChanges(root)`.** It validates the schema in Design Notes and throws naming the `id`.
   - **`valueAt(message, pointer)`** (RFC 6901).
   - **`applySanctionedChanges(golden, kind, changes)`**, where `kind` is `"wire" | "handler"`.
     - It returns a deep clone in which each named row's `line` is `JSON.stringify` of the parsed line with the changes applied in file order.
     - It throws naming the `id` when a row is missing, a pointer does not resolve, or the current value is not deep-equal to `old`.
     - It touches no field other than `line`.
   - **`readSanctionedGolden(root, kind)`**, which reads the frozen file and applies the ledger.

   This is the DW-639 mechanism (decision #23).
2. **The ledger.** NEW `packages/iris-mcp-all/src/__tests__/fixtures/sdk-golden-sanctioned-changes.json`, hand-authored. It holds the 11 entries of decision #24, in that order.
   - `old` is copied from the frozen golden at the pointer, never from a live run.
   - `new` is the frozen value plus the decided sentence, built by the rule in decision #24.
   - Remove entries carry `old` only.
3. **The five golden loaders.** Replace the `JSON.parse(readFileSync(...GOLDEN...))` load line with `readSanctionedGolden(REPO_ROOT, "wire" | "handler")` in each of the five files under Code Map. Restate the headers of `story-43-1-sdk-wire-golden.test.ts`, `story-43-2-cross-era-pin.test.ts` and `story-43-1-qa-handler-golden.test.ts`: the golden is the frozen v1 capture plus the sanctioned changes of the ledger. No `expect` line changes.
4. **The dedupe.** `packages/shared/src/server-base.ts` `registerGovernanceResource`: the template's `list` omits `DEFAULT_PROFILE_NAME`, because the static resource already lists it, so each governance URI is listed once (DW-646). Restate the comment, which states the contract. `resources/read` and `resources/templates/list` are unchanged.
5. **The descriptions.** Append the decision #24 sentence to each of the five descriptions, with that tool's separator.
6. **DW-653.** `packages/iris-interop-mcp/src/prompts/resendFailedMessages.ts`: replace steps 3 and 4 with the decision #24 text. Nothing else in the file changes. Then run `pnpm gen:skills` and `pnpm gen:pack`; never hand-edit the two `SKILL.md` copies.
7. **Rebuild every package, then regenerate:**
   - `pnpm gen:tools-list-snapshot --force`, which re-pins only the five descriptions;
   - the three prompt hash constants (Code Map), set to the values the rebuilt output produces, after reading the regenerated text (Rule #36).
8. **Unit pins:**
   - `packages/shared/src/__tests__/server-discovery.test.ts`: append `describe("Story 43.4: resources/list names each governance URI once (DW-646)")` with the two profile rows of the matrix. It reuses that file's `callRequest`, `setDefaultEnv` and `stageDefaultStartup`; additive only.
   - `packages/iris-interop-mcp/src/__tests__/prompts.test.ts`: append `describe("Story 43.4: resend-failed-messages states what IRIS refuses (DW-653)")`. It asserts that `build({item: "X", since: "2026-01-01"})` contains the two new sentences, and no longer contains `omitting either is refused` or `the call is refused rather than truncated-and-executed`.
9. **The rig lift (Rule 2).** NEW `packages/iris-mcp-all/src/__tests__/sdk-confirmation-rig.ts` takes over 43.3's `Exchange`, `Rig`, `isWrite`, `writeLine`, `withoutMeta` and `openRig`, as `openSdkRig`.
   - `openSdkRig(pkg, negotiation, {capabilities?, governance?: string, secondListener?: boolean, clientName: string, firstAnswer?: ElicitationAnswer})`; `governance` undefined means no `IRIS_GOVERNANCE`, and the default first answer is the ticked accept.
   - The rig gains `stderr(): string` (through `onStderr`).
   - `closeSdkRigs()` is the cleanup.

   `story-43-3-confirmation-both-eras.test.ts` keeps a local `openRig` wrapper that calls `openSdkRig` with `governanceOf(promote)`, `secondListener: promote` and `clientName: "story-43-3"`, plus `afterEach(closeSdkRigs)`. The move removes definitions and adds an import; no row or `expect` line changes.
10. **The ledger test.** NEW `packages/iris-mcp-all/src/__tests__/story-43-4-sanctioned-golden-changes.test.ts` (default suite; documents only, no dist). Rows:
    - both frozen goldens equal their SHA-256 constants (Code Map);
    - the ledger's Story 43.4 ids equal the 11 ids of decision #24, in order;
    - every entry's `old` deep-equals the frozen value at its pointer;
    - no entry is a no-op, every `appendOnly` entry only appends, and each appended suffix contains `form elicitation` and `CONFIRMATION_DECLINED`;
    - the rows that differ between the frozen and the sanctioned golden are exactly the rows the entries name, every other row's `line` is string-identical, and each changed line is canonical JSON;
    - every `sanction` id appears, in backticks, in the CHANGELOG entry whose heading names `Story <story>:`;
    - mechanism refusals on in-memory clones: a wrong `old`, an unresolvable pointer, an unknown row and a duplicate `id` each throw naming the id; a `remove` deletes one array element; a `handler` entry rewrites only its row's `line`.
11. **The capstone.** NEW `packages/iris-mcp-all/src/__tests__/epic43-capstone-gate.test.ts`: the epic-done gate (Rule #21), in the default suite, never in `gateTestFiles`. It fails, never skips, on a stale dist or a missing client.
    - **Modes:** `legacy` `{mode: "legacy"}`, `pinned` `{mode: {pin: "2026-07-28"}}` and `auto` `{mode: "auto"}`, each ONE `it`.
    - **Rig:** `openSdkRig("iris-admin-mcp", mode, {capabilities: {elicitation: {form: {}}}, governance: '{"global":{"iris_audit_manage:purge":true}}', clientName: "epic43-capstone"})`.
    - **The walk** is in Design Notes (decision #27). Its header names the oracles, the four mutations and their paths, and how it differs from the 43.1–43.3 files.
12. **The docs pins.** NEW `packages/iris-mcp-all/src/__tests__/story-43-4-doc-claims.test.ts` (documents only). It pins one sentence per fact of task 14 and the CHANGELOG and changeset facts of task 15.
13. **`story-43-3-doc-claims.test.ts`:**
    - `:102`, the pin of the sentence task 14 removes, is deleted;
    - "is the top entry" (`:153-156`) becomes "sits directly below the Story 43.4 entry": the first `## ` heading names Story 43.4 and the second names Story 43.3.

    No other line changes.
14. **Docs:**
    - **`README.md` "Human confirmation (elicitation)":**
      - The intro scopes its "adds no …" list to Story 43.3.
      - `:688` becomes: since Story 43.4 the five gated tools' descriptions name the dialog in one sentence.
      - `:678` keeps every phrase 43.3 pins and replaces "does not document the behavior, so check it before relying on it" with what was observed: with no hook and no flag, Claude Code 2.1.296 cancels the dialog too (`response: "cancel"`).
      - "Which clients are asked" adds what was observed: Claude Code 2.1.296 declares form elicitation on both eras; MCP Inspector CLI 2.9.0 declares none, so it gets the `confirm: true` contract; other clients are not verified here.
    - **`README.md:566`:** the template lists every profile except `default`, which the static entry lists, so each URI appears once.
    - **`README.md:934`:** keep the stdio sentence, and add a link to the client-docs section below.
    - **`docs/client-config/README.md`:** a new `## Protocol revisions and confirmation dialogs` section before `## The env block`. It states:
      - both revisions are served by one stdio process, and the client's first message chooses;
      - Claude Code 2.1.292+ negotiates 2026-07-28 by default, and `MCP_PROTOCOL_NEGOTIATION=legacy` in Claude Code's own environment keeps 2025-11-25;
      - DW-641 as observed: a client on the TypeScript MCP SDK v2 client in `auto` or a pinned revision (for example MCP Inspector 2.x with `--protocol-era auto|modern`) first starts a short-lived probe copy of the server. The probe runs the whole startup (configuration load, connection check, bootstrap version query), answers `server/discover`, and is ended by the client with SIGTERM. So the server starts twice per connect, `IRIS_AUDIT_LOG` gains a second `sessionStart` line with no `shutdown`, and the probe's stderr is discarded, so its log lines are not shown. Claude Code probes on the same connection and starts the server once;
      - a v2 SDK client on `auto` whose probe times out (the request timeout, 60 s by default) treats the server as 2025-11-25;
      - the confirmation behavior: clients that declare form elicitation are asked, any other client keeps the `confirm: true` contract;
      - the per-client facts of the README bullet, and that the matrix's certification covers the configuration lifecycle, not protocol or dialog behavior.
    - **`docs/client-config/claude-code.md`:** a new `## Protocol revision and confirmation dialogs` section before `## Verification`. It covers `MCP_PROTOCOL_NEGOTIATION=legacy`, where to set it, the `hooks.Elicitation` example from the README with the warning that an auto-answering hook removes the person, headless `claude -p` (a hook answers, with no hook the dialog is cancelled), and the single server start.
15. **Records:**
    - **`CHANGELOG.md`:** a new top entry, `## [Pre-release — <YYYY-MM-DD of the implement run>] — Story 43.4: SDK v2 docs, smokes and capstone` (the date is the day the implement stage writes it; the doc-claims tests match the date with `[^\]]*`, as 43.3's does), with these sections:
      - **Changed (AD-15 sanctioned):** each sanction id in backticks (`S-43.4-descriptions`, `S-43.4-governance-resource`, `S-43.4-prompt-text`) with one sentence each, plus the ledger (DW-639);
      - **Added:** the capstone and the docs;
      - **Unchanged:** the counts, the baseline, and `BOOTSTRAP_VERSION` "stays at `d51856f74d6a`";
      - **Epic 43 at close:** the enumeration from Design Notes;
      - **Known limits:** DW-641, the probe timeout, the unverified clients.
    - **NEW `.changeset/story-43-4-sdk-v2-close.md`:** `patch` for `@iris-mcp/shared`, `@iris-mcp/client-config`, `@iris-mcp/dev`, `@iris-mcp/admin`, `@iris-mcp/interop`, `@iris-mcp/ops` and `@iris-mcp/data` (AD-29; the 41.5 precedent for a regenerated pack).

**Acceptance Criteria:**
- **AC 43.4.1 (live smokes; the lead, at smoke).** **Given** decision #26's procedure on the rebuilt dists and the local fake listener, **when** the lead runs it, **then** the record shows:
  - each of the five servers answered one `iris_server_profiles` call through Claude Code on `auto` (`server/discover` 2026-07-28) and on `MCP_PROTOCOL_NEGOTIATION=legacy` (`initialize` 2025-11-25);
  - a purge accept (1 hook event, 1 POST, `ok`/`accepted`) and a decline (1 hook event, 0 POSTs, `denied`/`declined`) on each era;
  - the same five servers answered `tools/list` and `iris_server_profiles` through MCP Inspector CLI 2.9.0 on both eras, and its purge with `confirm: true` executed with no dialog (`ok`, no `confirmation` field);
  - DW-641 as observed: one start per Claude Code connection, two per Inspector modern call, and no process left behind.
  
  A failed oracle takes the failed-smoke path.
- **AC 43.4.2 (capstone).** **Given** `epic43-capstone-gate.test.ts` in the default suite, **when** it runs on fresh dists, **then** each of the three modes passes decision #27's walk. **When** each mutation of decision #27 is applied and the affected dist rebuilt, **then** the named mode goes red on the named path. **When** a source file is touched without a rebuild, **then** the file fails with "Build the packages first" and skips nothing.
- **AC 43.4.3 (docs).** **Given** the finished docs, **when** `story-43-4-doc-claims.test.ts` runs, **then** every fact of task 14 and the CHANGELOG/changeset facts of task 15 are pinned. Removing any one pinned sentence turns its row red.
- **AC 43.4.3 (records; lead, at the spec gate).** **Given** the Rule 20 drafts in decision #28, **when** the lead applies them before implement, **then** `grep` finds the new AD-15 bullet, the Conventions row, the AD-32/AD-34 edits, the Stack rows and the PRD `:88` line, and `lint_spine.py` reports no `ad_id`/`ad_fields`/`placeholder` finding.
- **DW-639 (golden retirement).** **Given** the ledger and the five loaders, **when** the 43.1 and 43.2 golden tests and the ledger test run, **then**:
  - both frozen files match their SHA-256;
  - every live line equals its sanctioned golden line byte for byte;
  - removing any one entry, corrupting any one `old`, or adding a no-op entry turns a named test red.
- **Descriptions (wave-8 decision #17).** **Given** the built servers, **when** `tools/list` runs on either era, **then** the five descriptions end with their decision #24 sentence, `pnpm gen:tools-list-snapshot:check` reports OK, and no other tool's entry moved.
- **DW-646.** **Given** one or two profiles, **when** `resources/list` runs on either era, **then** no URI is listed twice, and the static default entry is unchanged.
- **DW-653.** **Given** the prompt, **when** it is built, **then** steps 3 and 4 carry the decision #24 text, the generated copies match (`gen:skills:check`, `gen:pack:check`), and the prompt invariants hold.
- **DW-641.** **Given** the client docs, **when** a reader opens them, **then** they state the probe behavior as observed (task 14). The lead's smoke confirms it.
- **Integration (Rule 1).** **Given** the ledger loader (the shared module), **when** its five consumers load the sanctioned golden, **then** the built dev, admin and interop `tools-list` rows and all five `resources-list` rows compare equal to the live lines byte for byte. **And when** the capstone consumes `openSdkRig` and the sanctioned golden, **then** its walk passes on all three modes.
- **Back-compat (Rule #19).** **Given** the finished story, **when** `git diff <baseline>` runs over `packages/*/src/__tests__`, `packages/iris-mcp-all/src/__tests__` (including `fixtures/`), `extensions/iris-mcp-launcher/src/__tests__` and `scripts/lib`, **then**:
  - the only pre-existing files that change are the twelve test files of decision #28c, plus the regenerated `fixtures/tools-list-snapshot.json`;
  - their only removed or changed assertion lines are the three hash constants and the two `story-43-3-doc-claims` rows of task 13;
  - `sdk-wire-golden.json` and `sdk-handler-golden.json` are byte-unchanged.
- **Epic close.** **Given** the finished story, **when** the (once) commands run, **then**:
  - tools stay 110/115;
  - `gen:governance-baseline:check` reports 141 keys and `1e62c5ad5bf7`;
  - `BOOTSTRAP_VERSION` is `d51856f74d6a`, and `git diff 9a2f515 -- src/ packages/shared/src/bootstrap-classes.ts` is empty;
  - the CHANGELOG's "Epic 43 at close" enumerates every sanctioned wire change of Stories 43.1–43.4.

## Spec Change Log

- 2026-10-21 (lead spec gate): decisions #23–#28 were taken as recommended. The lead applied #28(a)'s Rule-20 actions to the spine and PRD: AD-15's Story 43.4 bullet, the Frozen goldens conventions row, AD-32, AD-34, the Stack rows, the Deferred entry, `prd.md:88` and the spine's `updated:` field.
  - **One wording change:** "the `{profile}` template's list" became "the per-profile resource template's list", because the spine lint reads a literal `{profile}` as a template token. Lint passes.
  - **Decision #25's VS Code dialog run** becomes a user action item at the epic decision sheet.
  - **The plan-stage `deferred:` LOW** (the README payload table) is harvested at dev complete.

## Review Triage Log

### 2026-10-20 — Review pass
- verdicts: 33 findings — high 0, medium 5, low 25, false 3, maybe-false 0
- findings (Blind Hunter B1-B10, Edge Case Hunter E1-E9, Verification Gap V1-V6, Intent Alignment IA1-IA8):
  - `[medium]` `[patch]` B1 "exactly the bytes it always saw" in `docs/client-config/README.md` (new) and `README.md:934` overclaims 2025-11-25 byte-identity — this story's own sanctioned changes alter five descriptions and `resources/list`; both sentences now say "apart from the sanctioned changes the CHANGELOG lists". No test pinned either sentence.
  - `[low]` `[defer]` B2 the `iris_message_resend` description (`message-resend.ts` about 364-369), its `maxMessages` schema text and `packages/iris-interop-mcp/README.md:302` keep the pre-DW-653 wording — pre-existing text; the intent forbids changing any existing description byte, so the sanctioned set cannot take it. Deferred (frontmatter).
  - `[medium]` `[patch]` B3 the new docs say a client that cannot be asked "gets the `confirm: true` contract", but `resend` and `regenerateStorage` have no `confirm: true` (governance alone) — a reader could believe those two are stopped by `confirm: true`. Reworded in `README.md` and `docs/client-config/README.md`; the two pins in `story-43-4-doc-claims.test.ts` follow. (`claude-code.md` carries no such sentence.)
  - `[low]` `[reject]` B4 "one appended sentence" is two sentences — the intent contract itself says "one appended sentence"; cosmetic, and the fix is a wording change across README, CHANGELOG, changeset and pins with no named harm.
  - `[low]` `[patch]` B5 four ledger lines held raw U+2014 (Rule 14) — replaced by `—` escapes (14 occurrences; file is ASCII, still parses, loader compares parsed values; the sibling goldens and snapshot use escapes).
  - `[low]` `[reject]` B6 nothing ties gated tools to description sentences — `story-43-3-confirmation-both-eras` ("exactly six call sites ask the person") fails on any new `ctx.confirm` site, and the snapshot and golden rows fail on any removed sentence, so a sixth gate cannot ship silently; the residual (an action added to an existing site) is theoretical.
  - `[low]` `[reject]` B7 the capstone never connects a client without form elicitation, and omits the cancel path — decision #27 fixes the walk (a form-declaring client); the fallback and the cancel are pinned by the 43.3 files on both eras, and `auto` lands on the same modern path as `pinned`.
  - `[low]` `[reject]` B8 the ledger test's "old is the frozen value" row looks entries up in the wire golden only — no handler entry exists, and the first one fails that row loudly (naming the cause) in the same change that adds it; the handler path is exercised by the in-memory entry.
  - `[low]` `[reject]` B9 unused rig API (`firstAnswer`, three exports), a second `isWrite` in `story-43-3-qa-wire.ts`, and `readResource` next to `callRequest` — `firstAnswer` is in the spec's task 9 signature; the unused exports are lifted helpers; `story-43-3-qa-wire.ts` is outside the twelve files the diff guard allows; `readResource` needs `mcpReq.requestState`, which `callRequest` does not supply, and task 8 says additive only.
  - `[low]` `[reject]` B10 prompts and skills that drive gated actions do not mention the dialog — decision #24: "The prompt does not gain a dialog sentence: the refusal text already tells the agent not to repeat a declined call."
  - `[low]` `[reject]` E1 `story-43-4-doc-claims` pins "Story 43.4 is the top CHANGELOG entry" and breaks when the next story prepends one — task 12 and the mutation table prescribe this pin, as 43.3's own pin was; the red is immediate and names the cause.
  - `[low]` `[reject]` E2 `story-43-3-doc-claims` "directly below the Story 43.4 entry" has the same property — prescribed verbatim by task 13.
  - `[low]` `[reject]` E3 `indexOf` of a renamed reference heading returns -1 and the ordering row passes vacuously — the section's own presence is asserted by `between()`, and the other bound (the env block) still pins; the fix adds a guard for an unlikely rename.
  - `[low]` `[reject]` E4 the rig's setup does not close a first listener if the second fails to start — a bind failure on 127.0.0.1 port 0 is theoretical, and the vitest worker ends the process.
  - `[medium]` `[patch]` E5 the capstone reads `rig.stderr()` right after `listTools()` resolves, and stderr and stdout are separate pipes — on `pinned` and `auto` the era line is written when the first request arrives, so the gate could read 0 lines. Step 1 now waits (25 ms steps, 5 s deadline) for the expected era line before counting.
  - `[medium]` `[patch]` E7 duplicate of B1 (the 2025-11-25 byte-identity sentence in `docs/client-config/README.md:96`) — fixed with B1.
  - `[low]` `[reject]` E6 `applySanctionedChanges` called directly with an unknown `op` deletes the value — every production path goes through `readSanctionedGolden`, which validates; the tests call it with entries that carry a valid `op`.
  - `[low]` `[reject]` E8 the loader imports the two golden cores, so it is not a `node:fs`/`node:path`-only leaf — Design Notes "Extend, don't copy" says the loader reuses their constants; the cores import no SDK.
  - `[false]` `[reject]` E9 `gen:tools-list-snapshot --force` moved the header (`capturedAt`, `sdkVersion`) — the generator stamps both; it re-pinned exactly the five descriptions (`gen:tools-list-snapshot:check` OK), and `sdkVersion` 2.3.1 is now true.
  - `[medium]` `[patch]` V1 same root cause as E5 (capstone step 1 reads stderr without waiting) — fixed with E5. The race has no deterministic mutation; M2 was re-run after the patch and `legacy` still fails at step 1 (see Verification).
  - `[low]` `[reject]` V2 ACs and legs with no `mutation:` line — Rule 19 asks one demonstrated mutation per AC; AC 43.4.1 and the records AC have no pinning test (lead-run), and each other AC has at least one line.
  - `[low]` `[reject]` V3 the two top-entry pins are time-fragile — duplicate of E1/E2.
  - `[false]` `[reject]` V4 the capstone and rig depend on built dists and the installed SDK client — they fail, never skip, which is the AC (M4 proves it).
  - `[low]` `[reject]` V5 the ledger-test row with `old = new = "abc"` and `appendOnly` reaches the no-op guard first, and the `length <=` half of the append guard is unreachable — a throw naming the id happens either way, and the spec lists "not longer" literally.
  - `[low]` `[reject]` V6 the ledger-test row comparing `readSanctionedChanges` with a raw parse cannot catch a dropped entry — the ids row (`STORY_43_4_IDS`) does.
  - `[low]` `[reject]` IA1 two-profile `resources/list` is unit-tested in process, not over a built dist on each era — both eras register through `registerResourceOn` and the same `list` closure; task 8 prescribes the unit rows.
  - `[low]` `[reject]` IA2 before `start()` the template `list` now returns nothing — the static resource lists `default`, so no URI is missing or doubled.
  - `[low]` `[reject]` IA3 the "112 rows round-trip" property is not asserted for unnamed rows — only named rows are re-serialized, and the loader refuses a non-canonical named row.
  - `[low]` `[reject]` IA4 the three prompt hash pins are not ledger entries — no golden holds the prompt body; the pins are re-pinned from rebuilt output as the spec says (Rule #36).
  - `[false]` `[reject]` IA5 the snapshot header moved as a side effect — duplicate of E9.
  - `[low]` `[reject]` IA6 agent comprehension of the new sentences is checked as text presence only — comprehension is not deterministic; the append, `form elicitation` and `CONFIRMATION_DECLINED` are pinned.
  - `[low]` `[reject]` IA7 the live-smoke procedure, the spine and the PRD are not in the diff — lead actions by the Boundaries.
  - `[low]` `[reject]` IA8 the docs record facts taken from the spec, not from the diff — they are observations of Claude Code 2.1.296 and Inspector 2.9.0 from the 43.2/43.3 live checks, and the lead's smoke confirms them.

## Design Notes

**Governing architecture (Rule 6):**
- **AD-15:** the sanctioned list and the mechanical proof. Every 43.4 change to an existing name, parameter, description or output is a recorded decision (#24).
- **AD-32:** confinement, the protocol revisions, the cross-era pin. Its text is amended by the lead.
- **AD-34:** the gates, hooks and descriptions. Its text is amended by the lead.
- **AD-3:** the chokepoint is unchanged.
- **AD-19:** the capstone's audit oracle, one entry per logical call.
- **AD-2:** cross-package tests live in `iris-mcp-all`.
- **AD-4/AD-5/AD-7:** no key, no baseline change, no visibility change.
- **AD-23:** stdio only.
- **AD-29:** `patch`, no publish.
- **Conventions:** Tool descriptions (an append), Live gates ("An epic's capstone runs in the default suite"), Logging.

No AC contradicts an AD Rule.

**Plan-stage evidence (2026-10-20).** No IRIS was contacted, and no repo file was written except this spec.
- **The wire golden:**
  - all 112 rows round-trip `JSON.stringify(JSON.parse(line))`;
  - the gated descriptions and the duplicate resource sit at the pointers in the Code Map;
  - both golden files were committed once and match the SHA-256 values above.
- **SDK client 2.3.1** (`client/dist`):
  - `auto` and `{pin}` probe on a sibling process "spawned from the same parameters (its stderr is discarded)" (`index.d.mts:1847-1852`);
  - `_dispose` reaps the sibling with `stdin.end()` plus an immediate SIGTERM, then SIGKILL after 1 s (`stdio.mjs:153-176`);
  - the probe timeout defaults to `DEFAULT_REQUEST_TIMEOUT_MSEC` = 60000 (`index.mjs:3397`, `src-WCy6ifGf.mjs:5536`), and on stdio a timeout falls back to `initialize`;
  - our `start()` answers stdin only after its startup (`server-base.ts:2910-2917`).
- **DW-641's ledger premise is wrong for Claude Code.** The 43.2 live check (decision #9) found that 2.1.296 probes on the SAME connection.
- **MCP Inspector** (`npm view` plus the `npm pack` tarball, read only, never executed; temp dir deleted):
  - 2.9.0 was published 2026-09-30, 20 days ago (2.10.x and 2.11.0 are under 2 weeks old);
  - it is built on `@modelcontextprotocol/client`/`core` 2.2.0;
  - its CLI default is legacy (`initialize` 2025-11-25), and `--protocol-era auto|modern` does the probe;
  - the CLI builds its client with `elicit: false` (`clients/cli/build/index.js:19360`), so it declares no elicitation and registers no `elicitation/create` handler (`:11565-11579`, `:12106`);
  - it accepts `--method tools/list|tools/call|initialize|…`, `--tool-name`, `--tool-args-json`, `-e KEY=VALUE` (the server gets no other environment) and `--format json`;
  - a `postinstall` exits early under `node_modules`, and `npm_config_ignore_scripts=true` blocks every script.

**Orchestrator decisions (wave 8, numbered from #23).** The plan is built on each recommendation.

- **Orchestrator decision needed #23: how the frozen goldens retire (DW-639 and its handler-golden occurrence).** Recommended: a sanctioned-change ledger over both goldens.
  - **The mechanism.** The frozen files are never edited or recaptured. `fixtures/sdk-golden-sanctioned-changes.json` lists each sanctioned change to bytes they hold, and all five golden loaders read through `readSanctionedGolden`.
  - **How it stays honest** (task 10):
    - SHA-256 pins on both frozen files;
    - `old` must equal the frozen value at its pointer, and an entry may not be a no-op;
    - `appendOnly` descriptions may only append;
    - the changed rows equal exactly the named rows;
    - every sanction id is named in its story's CHANGELOG entry;
    - the Story 43.4 ids are pinned in the test, so adding an entry is a visible test change;
    - and the existing 43.1/43.2 rows prove the live bytes equal the sanctioned lines.

    The cross-check reads the CHANGELOG, not the spine, because AD-15 says its list is pruned into the CHANGELOG at the Epic 42 retro.
  - **Future changes.** Each later change to bytes the goldens hold is one entry. A new tool is a `replace` of the smallest enclosing value, such as a row's `tools` array or a policy map. More ops (an array insert) are added when a story needs them.
  - **Lead action (Rule 20):** the AD-15 bullet and a Conventions row ("Frozen goldens"); drafts under #28.
  - **Alternatives:**
    - (B) hand the `tools-list` rows to the tools-list snapshot. Rejected: the snapshot is re-pinned with `--force`, which is the blind recapture, and it does not pin wire framing. It also loses the v1 oracle that an SDK bump (42.1, the DW-637 residual) needs.
    - (C) compare only what a migration can change (project out catalogue fields). Rejected: that set is a judgment that drifts, and it hides catalogue regressions inside the frozen rows.
    - (D) recapture from v2. Forbidden (Rule #36, and the header tests).

- **Orchestrator decision needed #24: the Story 43.4 sanctioned set (AD-15).** Recommended: the entries below.
  - **`S-43.4-descriptions`** (decision #17 follow-through).
    - Six ledger entries, all `replace` + `appendOnly`, with `new = old + separator + sentence`, in this order:
      1. `43.4/description/iris_env_promote@dev-main`;
      2. `43.4/description/iris_doc_edit@dev-main`;
      3. `43.4/description/iris_doc_edit@dev-core-preset`;
      4. `43.4/description/iris_audit_manage@admin-main`;
      5. `43.4/description/iris_production_control@interop-main`;
      6. `43.4/description/iris_message_resend@interop-main`.
    - The sentences (ASCII; `Q` stands for the shared tail ` also asks the person in a confirmation dialog`):
      - **`iris_audit_manage`**, separator `" "`: `HUMAN CONFIRMATION: when the MCP client supports form elicitation, 'purge'` + Q + `, after every check above and right before any record is deleted; only an accept with Confirm ticked proceeds, and a decline or a dismissal returns CONFIRMATION_DECLINED with nothing changed (do not repeat the call unless the person asks). A client without elicitation is not asked, and the call works as described above.`
      - **`iris_env_promote`**, separator `"\n\n"`: `HUMAN CONFIRMATION -- when the MCP client supports form elicitation, 'execute'` + Q + `, after all four gates pass and right before the first write to 'target'; only an accept with Confirm ticked proceeds, and a decline or a dismissal returns CONFIRMATION_DECLINED with nothing changed (do not repeat the call unless the person asks). A client without elicitation is not asked, and the call works as described above.`
      - **`iris_production_control`**, separator `"\n\n"`: `HUMAN CONFIRMATION: when the MCP client supports form elicitation, 'clean' with killAppData:true and confirm:true` + Q + ` right before the production is cleaned; only an accept with Confirm ticked proceeds, and a decline or a dismissal returns CONFIRMATION_DECLINED with nothing changed (do not repeat the call unless the person asks). A client without elicitation is not asked, and the call works as described above.`
      - **`iris_message_resend`**, separator `"\n\n"`: `HUMAN CONFIRMATION: when the MCP client supports form elicitation, 'resend' and an executing 'resendFiltered' (when its read-only preview matches 1 to maxMessages messages) also ask the person in a confirmation dialog, after every check above and right before anything is resent; only an accept with Confirm ticked proceeds, and a decline or a dismissal returns CONFIRMATION_DECLINED with nothing changed (do not repeat the call unless the person asks). A client without elicitation is not asked, and the call works as described above.`
      - **`iris_doc_edit`**, separator `" "`: `Human confirmation: when the MCP client supports form elicitation, \`regenerateStorage\`` + Q + `, after every check above and right before the document is saved; only an accept with Confirm ticked proceeds, and a decline or a dismissal returns CONFIRMATION_DECLINED with nothing changed (do not repeat the call unless the person asks). A client without elicitation is not asked, and the call works as described above.`
    - **Evidence.** The appends keep every existing `toContain` pin green, and the doc-edit path guard. The descriptions convention ("default state of any governed write, and the operator controls") gains the dialog as behavior the agent must expect.
  - **`S-43.4-governance-resource` (DW-646): dedupe.**
    - Five `remove` entries, `43.4/governance-resource/<server>` for dev, admin, interop, ops and data, at `/result/resources/1` of `main/resources-list`.
    - **Evidence:**
      - the duplicate repeats the same URI under a second name;
      - AC 14.5.2 meant a single governance entry (`governance-resource-coverage.test.ts:17-18`), and AC 19.0.7 means one entry per profile, which the static entry already gives `default`;
      - no test asserts the duplicate (plan-stage sweep);
      - a resource-listing client shows it twice.
    - **Alternative:** keep it, and close DW-646 `wontfix-accepted` with `reopen_if` = a client shows the duplicate.
  - **`S-43.4-prompt-text` (DW-653).** No ledger entry: no golden holds that body (the epic context's premise check holds). The fix replaces:
    - **Step 3:** `3. The preview always reports the full match count. If it exceeds \`maxMessages\` (default 100, hard cap 500), the executing call in step 4 would be refused rather than truncated-and-executed — narrow the \`from\`/\`to\` window or the \`item\` filter and repeat step 1; do not raise \`maxMessages\` past what the user has reviewed.` The dash and the text after it are the existing bytes.
    - **Step 4:** the parenthetical `(both are required together — omitting either is refused with no changes made)` becomes `(\`dryRun: false\` without \`confirm: true\` is refused with no changes made; leaving \`dryRun\` out only previews again, because it defaults to \`true\`)`.
    - **Evidence:** `MessageResend.cls` runs the cap guard only when `dryRun` is false (43.3 plan research), and the tool description says `dryRun` defaults to true.
    - The prompt does not gain a dialog sentence: the refusal text already tells the agent not to repeat a declined call.
  - **Lead action (Rule 20):** the AD-15 bullet; drafted under #28.

- **Orchestrator decision needed #25: the second-client requirement (AC 43.4.1, "plus one other certified client").** Recommended: both of the following.
  - **(a)** MCP Inspector CLI `@modelcontextprotocol/inspector@2.9.0` as the unattended second real client, run by the lead at smoke (decision #26). It is a third-party MCP client from the MCP organization, 20 days old, and installed with scripts disabled into the smoke's temp dir; it is not a repo dependency.
  - **(b)** A human action item for a certified client's dialog, dated 2026-10-21, owner the Project Lead: a VS Code (Copilot) GUI run against the fake listener, with one purge accept and one decline. The lead ledgers it `decision-pending note=human=` at harvest, so the decision sheet moves it to `action_items`. If the Lead prefers, it folds into Story 42.9's client re-certification.
  - **Evidence:**
    - Inspector is in no certification registry (`packages/client-config/scripts/certification-results.json`), and it shares the SDK family, so it cannot catch a bug common to the SDK;
    - in CLI mode it declares no elicitation, so it proves the fallback on a real non-eliciting client, not a dialog;
    - the certified clients other than Claude Code are GUI-only ("agent-side GUI stays manual"), and Kimi Code is not installed.
  - **Alternative:** (b) alone, with the second-client leg recorded as residual risk.

- **Orchestrator decision needed #26: the live-smoke procedure (AC 43.4.1, DW-641).** Recommended: extend decision #20's procedure.
  - **Setup.**
    - Record `claude --version` (2.1.292 or later; 2.1.296 expected) and rebuild every dist. `<S>` is a lead scratch directory, and every file in it is written with the file tools.
    - Recreate #20's `tap.mjs`, `hook.mjs` and `leg.mjs` (their contract is decision #20 in the Story 43.3 spec; the 43.3 copies were deleted). Start each server through a path unique to `<S>` (a wrapper checked to start the server), so `pgrep -f <S>` matches only this smoke's processes.
    - Use one `startFakeIris` per leg; `IRIS_AUDIT_LOG` is per server and per leg. Never touch the shared instance.
  - **Claude Code reads (2 legs, haiku, USD 1 cap each).**
    - `cc-read-modern` (`MCP_PROTOCOL_NEGOTIATION` unset) and `cc-read-legacy` (`=legacy`).
    - Each uses a throwaway `mcp-<leg>.json` with the five servers, each through the tap, and `IRIS_PORT` set to the fake port.
    - The prompt: `Call the iris_server_profiles tool of each of the five MCP servers iris-dev, iris-admin, iris-interop, iris-ops and iris-data exactly once, with no arguments. Do not call any other tool. Then reply DONE.` It runs with `--allowedTools` the five `mcp__iris-<srv>__iris_server_profiles` names, plus #20's flags.
    - **Oracle, per server:**
      - the opening is `server/discover` 2026-07-28 (modern) or `initialize` 2025-11-25 (legacy);
      - `tools/list` lengths are 33/27/25/22/8, and there is exactly one `tools/call` `iris_server_profiles` without `isError`;
      - the stderr era line is present;
      - the audit file has exactly one `sessionStart` (DW-641: one start) and one `ok` entry.
  - **Claude Code confirmations (4 legs).** `modern-accept`, `modern-decline`, `legacy-accept` and `legacy-decline`, exactly as #20, with #20's oracles 5 and 6, plus one `sessionStart` per leg.
  - **MCP Inspector (no model).**
    - **Install:** `npm_config_ignore_scripts=true npm install --ignore-scripts --no-audit --no-fund --prefix <S>/inspector @modelcontextprotocol/inspector@2.9.0`, recording the installed version. Set `MCP_INSPECTOR_SECRET_STORE=memory` and `MCP_CLIENT_CONFIG_PATH=<S>/client.json`.
    - **For each of the five servers and each era** (legacy: pass the CLI's legacy value of `--protocol-era` if it has one, or omit the flag, and record which; modern: `--protocol-era modern`):
      - `--method tools/list --format json` gives the length 33/27/25/22/8;
      - `--method tools/call --tool-name iris_server_profiles --format json` exits 0 with no `isError`;
      - the environment goes through `-e IRIS_HOST=127.0.0.1 -e IRIS_PORT=<fake> -e IRIS_USERNAME=qa -e IRIS_PASSWORD=qa -e IRIS_NAMESPACE=HSCUSTOM -e IRIS_AUDIT_LOG=<file>`.
    - **Admin, per era:** with `-e IRIS_GOVERNANCE={"global":{"iris_audit_manage:purge":true}}` and `--tool-args-json '{"action":"purge","end":"2026-01-01 00:00:00","confirm":true}'`, the purge gives exactly 1 purge POST, the purge success, and an `ok` entry with no `confirmation` field.
    - **Admin, per era, through the tap:** `--method initialize`, which records the negotiated version and the client's capabilities (expected: no `elicitation`).
    - **DW-641:**
      - every modern call's audit file has 2 `sessionStart` lines and the listener saw two startup sequences; every legacy call's has 1;
      - after each CLI exit, `pgrep -f <S>` prints nothing;
      - record whether the probe's session has a `shutdown` line (SIGTERM-reaped: expected none).
  - **What fails a leg:**
    - a wrong opening or era line;
    - a tool count off;
    - any `isError` on a read;
    - any hook-count, POST-count or audit mismatch of #20;
    - an Inspector purge with a dialog or a `confirmation` field;
    - a process left after exit.

    A Claude Code behavior the server cannot change is recorded, stated in the docs, and becomes a finding, never a silent pass.
  - **Teardown.** Close every listener and delete `<S>`, the Inspector install included. Record `total_cost_usd` per leg.

- **Orchestrator decision needed #27: the capstone (AC 43.4.2, Rule #21, Rule #59).** Recommended: one built server, three negotiation modes, one `it` per mode. Modern is pinned so that a broken negotiation fails loudly, and `auto` is Claude Code's default; it must land on modern.
  - **The walk, per mode, in one session.** Each step is asserted with a message naming the step:
    1. **Era.** `getProtocolEra()` is `legacy`/`modern`/`modern` and `getNegotiatedProtocolVersion()` is `2025-11-25`/`2026-07-28`/`2026-07-28`. The rig's stderr holds exactly one era line, of that era.
    2. **Listing.** On every mode, each live answer goes through `withoutMandatedFields(method, {result})` (which also drops `execution`), and each golden frame through `withoutExecution`; steps 3 to 5 compare the same way:
       - `listTools()`, `listPrompts()` and `listResources()` equal the sanctioned golden's admin `main` `tools-list`, `prompts-list` and `resources-list` results;
       - `getPrompt({name: "audit-security-posture"})`, with NO `arguments` key (Rule #46), equals `prompts-get:empty:audit-security-posture`.
    3. **Read.** `iris_namespace_list {}` equals the handler golden's `namespace-list` result (without `_meta`), and the listener saw `GET /api/executemcp/v2/config/namespace`.
    4. **Denial.** `iris_resource_manage {action: "grant"}` equals `call:denial`'s result; no dialog, no write.
    5. **Validation.** `iris_namespace_manage {action: "create", name: 12345}` equals `call:invalid-type`'s result; no dialog, no write.
    6. **Accept.** The purge, answered with the ticked accept:
       - exactly one form request, whose `message` is the template with the rig's port and whose `requestedSchema` is `CONFIRMATION_SCHEMA`;
       - the result equals `BASELINE["admin: purge ok"].result`, and the writes equal its `a`.
    7. **Decline.** The same purge, answered `{action: "decline"}`: exactly one form request (no re-ask), the result is the decline literal, and no write.
    8. **Audit.** Exactly five tool entries, in order: `iris_namespace_list` `ok`; `iris_resource_manage` `denied` `GOVERNANCE_DISABLED`; `iris_namespace_manage` `error`; `iris_audit_manage` `ok` `accepted`; `iris_audit_manage` `denied` `CONFIRMATION_DECLINED` `declined`.
  - **Mutations (Rule #59)** — each mutated in source, run against the rebuilt dist, then reverted and rebuilt (delete `tsconfig.tsbuildinfo`):
    - **M1, era negotiation, 2025.** In `server-base.ts` `start()`, `legacy: "serve"` becomes `legacy: "reject"`. Rebuild shared: `legacy` goes red at connect, while `pinned` and `auto` stay green. The path is `serveStdio` in the admin server process, over real stdio, under the SDK client's `{mode: "legacy"}` handshake.
    - **M2, era negotiation, 2026-07-28.** The `serveStdio(...)` statement becomes a plain `this.mcpServer.connect(new StdioServerTransport())`, which serves 2025 only. `pinned` goes red at connect (`EraNegotiationFailed`), `auto` goes red at step 1 (it fell back to legacy), and `legacy` stays green. Same path.
    - **M3, decline handling.** `confirmation.ts:225` returns `"accepted"` for a decline. Rebuild shared: step 7 goes red on all three modes (a purge POST is sent, and the result is the success). The path is `confirmOnWire` → `classifyConfirmationResponse` in the shared dist loaded by the admin process, reached on 2025 through the SDK shim's re-entry and on 2026-07-28 through the client's retry.
    - **M4, stale dist.** Touch `packages/shared/src/confirmation.ts` without rebuilding: the file fails with "Build the packages first" and skips nothing.
  - **How it differs from the 43.1–43.3 tests.**
    - 43.1 pins the 2025 bytes on a closed port.
    - 43.2 pins era equivalence on a closed port, without a write path.
    - 43.3 pins each gate in isolation, on `legacy`/`pin` only.
    - The capstone is the one test that walks the epic's whole promise in ONE session per mode on the same built server: the sanctioned golden as the listing oracle, the v1 handler golden for a real read, governance, validation, an accept and a decline, and one audit trail. It adds `auto` (Claude Code's default) with its era asserted, and it is the named epic-done gate.
  - **Not pinned in the suite:** DW-641's `sessionStart` count. The sibling is SIGTERM-reaped, so its lines race; the lead's smoke records it.

- **Orchestrator decision needed #28: records, and who writes what.** Recommended:
  - **(a) Spine and PRD.** These are lead actions at the spec gate, before implement, in the bookkeeping commit, with the drafts below. The implement stage writes nothing under `_bmad-output/planning-artifacts/` (Rule 5: build-auto does not amend planning artifacts), and AC 43.4.3 (records) is checked by `grep` plus `lint_spine.py`.
  - **(b) The README payload table is not re-measured.** It is labelled as Story 40.4's measurement, and re-measuring moves four pre-existing doc-claims pins. Its "not test-pinned" claim is a `deferred:` LOW.
  - **(c) The pre-existing test files that change**, the diff guard of the back-compat AC:
    1. `story-43-1-sdk-wire-golden.test.ts`;
    2. `story-43-2-cross-era-pin.test.ts`;
    3. `story-43-1-qa-handler-golden.test.ts`;
    4. `story-43-1-sanctioned-wire-changes.test.ts`;
    5. `story-43-2-chokepoint-both-eras.test.ts`;
    6. `story-43-3-confirmation-both-eras.test.ts` (the rig move);
    7. `story-43-3-doc-claims.test.ts` (task 13);
    8. `story-41-5-qa-dist-consumer.test.ts`, `story-41-2-qa-prompts-stdio-wire.test.ts` and `skills-generated-frontmatter.test.ts` (one hash each);
    9. `server-discovery.test.ts` and interop `prompts.test.ts` (additive describes).

    That is twelve files (counted per item: 5 + 1 + 1 + 3 + 2), the count the back-compat AC uses, plus the regenerated `fixtures/tools-list-snapshot.json`.

**Lead actions (Rule 20), drafted for the spec gate.** Apply them in the spine's grammar, then run `memlog.py append --type decision`, `lint_spine.py`, and refresh `updated:`.
- **AD-15, a new bullet after "Story 43.1":** "**Story 43.4** (wave-8 decisions #23 and #24):
  - `S-43.4-descriptions`: the descriptions of `iris_audit_manage`, `iris_env_promote`, `iris_production_control`, `iris_message_resend` and `iris_doc_edit` gain one appended sentence that names the confirmation dialog; no other byte of any description changes.
  - `S-43.4-governance-resource`: `resources/list` lists `iris-governance://default` once, as the static resource, where the `{profile}` template's list repeated it (DW-646).
  - `S-43.4-prompt-text`: the `resend-failed-messages` prompt's steps 3 and 4 say that an over-cap count is refused when the resend executes, and that leaving out `dryRun` previews again (DW-653); its name, title, description and arguments are unchanged.
  
  The frozen Story 43.1 goldens stay byte-unchanged: each change to bytes they hold is one entry of `fixtures/sdk-golden-sanctioned-changes.json` (DW-639)."
- **Conventions, a new row "Frozen goldens":** "A frozen golden is never edited or recaptured. A sanctioned change to bytes it holds is one entry in `fixtures/sdk-golden-sanctioned-changes.json`: the golden, the row, a JSON pointer, the exact frozen value, the exact new value, and the sanction id its CHANGELOG entry names. The tests apply the entries and compare every other byte unchanged; a description change only appends (Story 43.4, DW-639)."
- **AD-32:**
  - the header becomes "*(landed in Epic 43, Stories 43.1 to 43.4)*";
  - "through `serveStdio(factory)` with the default `legacy: 'serve'`" becomes "with `legacy: 'serve'`, passed explicitly";
  - replace "**Until Epic 43.** The v1 floor is `>=1.31.0`, out of the known high advisory range." with "**v1.** `@modelcontextprotocol/sdk` was removed in Story 43.1. Its 1.29.0 build survives only as the provenance of the frozen goldens, which retire through the sanctioned-change ledger (Conventions, Frozen goldens).";
  - add "**Clients** *(Story 43.4)*. Claude Code 2.1.292 and later negotiate 2026-07-28 by default and probe on the same connection; `MCP_PROTOCOL_NEGOTIATION=legacy` in Claude Code's environment keeps 2025-11-25. A TypeScript SDK v2 client on `auto` or a pinned revision probes in a short-lived sibling process, so the server starts twice per connect and the probe is ended by SIGTERM (DW-641, documented in the client docs). The epic gate is `epic43-capstone-gate.test.ts`."
- **AD-34:**
  - the header becomes "*(landed in Story 43.3; descriptions in Story 43.4)*";
  - add to "As built": "**Descriptions** *(Story 43.4, wave-8 decision #24)*. Each gated tool's description names the dialog in one appended sentence. **Hooks, as observed** (Claude Code 2.1.296, decision #20): the `Elicitation` hook fires on both eras; headless `claude -p` with no hook, or with `--permission-prompts none`, cancels the dialog (`CONFIRMATION_DECLINED`, `response: \"cancel\"`). **Clients, as observed:** Claude Code declares form elicitation on both eras; MCP Inspector CLI 2.9.0 declares none and gets the fallback."
- **Stack rows:**
  - "@modelcontextprotocol/sdk (v1)": "Removed in Story 43.1; 1.29.0 is only the provenance of the frozen goldens";
  - "@modelcontextprotocol/server (runtime, `@iris-mcp/shared` only) and client (tests: shared, dev, `iris-mcp-all`)": "2.3.1, pinned exactly (Story 43.1); `core` is not a direct dependency; the next bump waits for a release that pins fast-uri 3.1.8 or later (DW-637, Story 42.1)";
  - "MCP specification": "2025-11-25 and 2026-07-28, both served over stdio by one process (Story 43.2); form elicitation for the confirmation gates on both (Story 43.3)".
- **Deferred:** "The SDK `extra` argument" becomes "**Progress notifications** through the SDK `extra` argument: no handler sends progress until a target client honors it (L1). The cancellation signal is forwarded since Story 43.3 (DW-642)."
- **PRD `prd.md:88`:** "MCP specification compliance: revisions 2025-11-25 (pagination, tool annotations, listChanged, structured output) and 2026-07-28, both served over stdio by one process on the MCP TypeScript SDK v2 (FR161), with form elicitation for the confirmation gates on clients that declare it (FR162; Epic 43)".

**Ledger schema** (`readSanctionedChanges` enforces it). The top level is exactly `{"description": string, "changes": [...]}`. Each change has:
- `id`: a unique non-empty string;
- `sanction`: matches `^S-\d+\.\d+-[a-z-]+$`;
- `story`: matches `^\d+\.\d+$`;
- `golden`: `"wire"` or `"handler"`;
- `server`: one of the golden's servers;
- `session`: required for `wire`, absent for `handler`;
- `label`;
- `pointer`: RFC 6901, inside the row's parsed `line`;
- `op`: `"replace"` or `"remove"`;
- `old`: required;
- `new`: required for `replace`, absent for `remove`;
- `appendOnly`: optional; when it is true, `old` and `new` are strings and `new` starts with `old` and is longer.

Changes to one row apply in file order. Unknown keys are refused.

**Epic 43 at close** (the CHANGELOG enumeration, and the epic's back-compat proof):
- **Counts.** 110 package tools and 115 advertised (33/27/25/22/8): `docs-visibility-roster-sync` and `gen:tools-list-snapshot:check` (115 entries).
- **Governance.** The baseline is `1e62c5ad5bf7`, 141 keys: `gen:governance-baseline:check`.
- **Bootstrap.** `BOOTSTRAP_VERSION` is `d51856f74d6a`, and `git diff 9a2f515 -- src/ packages/shared/src/bootstrap-classes.ts` is empty.
- **Sanctioned wire changes.** These are AD-15's Epic 43 entries:
  - **43.1:**
    - an omitted-`arguments` `prompts/get` renders like `{}` (DW-617; the golden's seven DW-617 rows);
    - a schema-invalid call is audited (DW-579; the handler golden);
    - `addTools` sends one `list_changed`;
    - a malformed `tools/call` gets `-32602 Invalid tools/call request`;
    - a `task` parameter runs a plain call (`story-43-1-sanctioned-wire-changes`).
  - **43.2:** revision 2026-07-28 is additive; the 2025 wire is unchanged (`story-43-2-cross-era-pin`).
  - **43.3:**
    - the dialog for clients that declare form elicitation (AD-34);
    - a cancelled call aborts its IRIS request and is audited `error` (DW-642);
    - clients without the capability are byte-identical (`story-43-3-qa-fallback`).
  - **43.4:** the three sanction ids of decision #24 (the ledger plus `story-43-4-sanctioned-golden-changes`).

**Rules 1 and 2.**
- **Consumed-by:**
  - `golden-sanctioned-changes.mjs`: the five golden tests, the ledger test and the capstone, plus every later story that changes bytes the goldens hold;
  - `sdk-confirmation-rig.ts`: `story-43-3-confirmation-both-eras.test.ts` and the capstone.
- **Consumes:**
  - 43.1's goldens, raw driver and `withoutMandatedFields`/`withoutExecution`;
  - 43.2's `serveStdio` era paths and era lines;
  - 43.3's `connectSdkClient` elicitation options, the fake gate routes, `BASELINE` and the dialog template.
  
  All are used against real built servers over stdio.
- **Extend, don't copy:**
  - the rig is lifted, not copied;
  - the dedupe rows extend `server-discovery.test.ts` and its file-local `callRequest`;
  - the DW-653 rows extend interop `prompts.test.ts`;
  - the loader reuses the golden constants from `sdk-wire-golden-core.mjs`/`sdk-handler-golden-core.mjs`;
  - the capstone reuses `withoutMandatedFields`, `withoutExecution`, `BASELINE` and the goldens as oracles.

**Ledger inbox (Rule 17):**
- **DW-639:** addressed by decision #23, tasks 1–3 and 10, and AC "DW-639". The handler-golden occurrence is covered by the same loader, with zero entries.
- **DW-641:** addressed by task 14 (the client docs, as observed; the ledger's Claude Code premise is corrected), decision #26's smoke check and AC "DW-641".
- **DW-646:** addressed by decision #24 (dedupe), tasks 4 and 8, and AC "DW-646".
- **DW-653:** addressed by decision #24, tasks 6–8, and AC "DW-653". Its premise that a golden pins the body is false; the fix is still an AD-15 prompt-text sanction.
- **The `epics.md` bullet (decision #17):** addressed by decision #24, tasks 5 and 7, and AC "Descriptions".

**AC interpretations (apply and report):**
- **AC 43.4.1 "one other certified client":** met per decision #25, by Inspector (uncertified, unattended) plus a dated human action item.
- **AC 43.4.1 "each server":** covered by the five servers in one Claude Code session per era, plus Inspector per server.
- **AC 43.4.2 "drives a server":** the admin server, with three modes for the two eras.
- **AC 43.4.3 "the spine ... and the PRD line are updated":** lead actions at the spec gate (#28a), so the implement stage does not edit planning artifacts.

**Risks for the implementer:**
- **The rig move.** It must be byte-neutral for the 43.3 rows. Run that file before and after, and compare the test count.
- **The ledger's `old`.** Copy each `old` from the frozen golden (`valueAt`), never from a live run.
- **The description separators.** `"\n\n"` must be real newlines in the concatenation, matching the neighbouring paragraphs.
- **The tools-list snapshot.** `gen:tools-list-snapshot --force` must report re-pinning exactly the five descriptions; anything else is a regression to fix, not to pin.
- **The capstone's sibling probe.** On `pinned`/`auto` it also starts against the fake listener: count tool entries only, and treat writes as `isWrite`.
- **README edits.** Keep every phrase `story-43-3-doc-claims` pins (Code Map) except `:102`'s, and add no `###` heading inside the confirmation section.
- **Builds.** `checkDistFresh` is mtime-based, so rebuild every package after the last source edit, before any stdio test or generator.

**Mutations (Rule 19).** Apply each, observe red, revert, confirm `shasum` and `git status --short`, rebuild where a dist is involved, and record a `mutation:` line under Verification.

| Mutation | Must go red | AC |
|---|---|---|
| M1–M4 of decision #27 | the named capstone mode or step | 43.4.2 |
| one description entry removed from the ledger | `story-43-1-sdk-wire-golden` (that row, raw and client), cross-era (a)/(d) | DW-639 |
| one entry's `old` changed by one character | every loader consumer fails, and the ledger test's `old` row | DW-639 |
| a no-op entry added | the ledger test's validation row | DW-639 |
| one byte of `sdk-wire-golden.json` changed (then restored, `shasum` checked) | the SHA-256 row | DW-639 |
| `S-43.4-governance-resource` removed from the CHANGELOG | the sanction-id row | DW-639, records |
| the template list including `default` again (rebuild shared) | the `server-discovery` DW-646 rows, plus the five `resources-list` golden rows | DW-646 |
| one word of a description sentence changed (rebuild) | the golden row, and `gen:tools-list-snapshot:check` | Descriptions |
| step 4's old parenthetical restored | the interop DW-653 row and the three hash pins | DW-653 |
| the probe paragraph removed from `docs/client-config/README.md` | its `story-43-4-doc-claims` row | DW-641, 43.4.3 |
| the CHANGELOG's 43.4 heading moved below 43.3 | `story-43-3-doc-claims` "sits directly below", and the 43.4 top-entry row | 43.4.3 |

## Verification

**Commands.** Each runs from `/Users/jbrandt/git/iris-execute-mcp-v2`, in the foreground, with `timeout: 600000`. `CP` stands for `IRIS_HOST=127.0.0.1 IRIS_PORT=1`, set on EVERY command. `<B>` is the `baseline_revision` the implement stage records.

- **(loop) Builds.** `CP pnpm --filter @iris-mcp/shared build`, then `@iris-mcp/dev`, `@iris-mcp/admin`, `@iris-mcp/interop`, `@iris-mcp/ops`, `@iris-mcp/data` and `@iris-mcp/client-config`, one per call. Expected: exit 0.
- **(loop) Generators, check mode.** `pnpm gen:skills:check`, `pnpm gen:pack:check`, `pnpm gen:tools-list-snapshot:check` and `pnpm validate:prompts`. Expected: OK.
- **(loop) Units.** One call each; expected: pass.
  - `CP pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/server-discovery.test.ts src/__tests__/governance-resource.test.ts src/__tests__/governance-resource-coverage.test.ts src/__tests__/prompts-guardrails.test.ts src/__tests__/sdk-wire-compat.test.ts`
  - `CP pnpm --filter @iris-mcp/admin exec vitest run src/__tests__/audit.test.ts`
  - `CP pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/doc-edit.test.ts src/__tests__/env-promote.test.ts src/__tests__/env-promote-execute.test.ts`
  - `CP pnpm --filter @iris-mcp/interop exec vitest run src/__tests__/production.test.ts src/__tests__/message-resend.test.ts src/__tests__/message-resend-policy.test.ts src/__tests__/prompts.test.ts`
- **(loop) New and lifted.** `CP pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-43-4-sanctioned-golden-changes.test.ts src/__tests__/epic43-capstone-gate.test.ts src/__tests__/story-43-4-doc-claims.test.ts src/__tests__/story-43-3-confirmation-both-eras.test.ts src/__tests__/story-43-3-doc-claims.test.ts`. Expected: pass, no skip. The 43.3 file's test count is unchanged from `<B>`.
- **(loop) Golden pins.** `CP pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-43-1-sdk-wire-golden.test.ts src/__tests__/story-43-1-qa-handler-golden.test.ts src/__tests__/story-43-1-sanctioned-wire-changes.test.ts src/__tests__/story-43-2-cross-era-pin.test.ts src/__tests__/story-43-2-chokepoint-both-eras.test.ts`. Expected: pass, no skip.
- **(loop) Catalogue, prompt and doc pins.** `CP pnpm --filter @iris-mcp/all exec vitest run src/__tests__/tools-list-snapshot.test.ts src/__tests__/story-39-6-qa-snapshot-cli.test.ts src/__tests__/story-41-5-qa-dist-consumer.test.ts src/__tests__/story-41-2-qa-prompts-stdio-wire.test.ts src/__tests__/skills-generated-frontmatter.test.ts src/__tests__/story-41-5-qa-preset-oracle.test.ts src/__tests__/skills-pack.test.ts src/__tests__/prompt-safety-invariants.test.ts src/__tests__/validate-prompts.test.ts src/__tests__/story-39-6-qa-forensics-prompts-sdk-wire.test.ts src/__tests__/changelog-bootstrap-move.test.ts src/__tests__/docs-visibility-roster-sync.test.ts src/__tests__/qa-41-7-doc-links.test.ts src/__tests__/story-38-1-qa-doc-claims.test.ts src/__tests__/story-40-4-doc-claims.test.ts src/__tests__/startup-env-roster.test.ts src/__tests__/story-43-1-sdk-confinement.test.ts src/__tests__/story-43-1-qa-pack-confinement.test.ts src/__tests__/story-43-3-validator-unreachable.test.ts`. Expected: pass.
- **(loop) Diff guard.** Run `git diff <B> -U0 -- packages/*/src/__tests__ packages/iris-mcp-all/src/__tests__ extensions/iris-mcp-launcher/src/__tests__ scripts/lib` and read it for removed or changed `expect(`/`assert` lines in pre-existing files. Expected: only the twelve files of decision #28c plus `fixtures/tools-list-snapshot.json`, and only the task 13 rows and three hash constants changed.
- **(once) Package suites.** `CP pnpm --filter <pkg> test`, then `type-check`, then `lint`, for shared, dev, admin, interop, ops, data and client-config, one per call. Also `type-check` and `lint` for `@iris-mcp/all`. Expected: green, with only the pre-existing `cli/governance.ts` lint warning.
- **(once) `iris-mcp-all` sweep.** `cd packages/iris-mcp-all && CP pnpm exec vitest run $(ls src/__tests__/*.test.ts | awk 'NR%3==0')`, then `NR%3==1`, then `NR%3==2`. Expected: green, with the live gates skipped. If a third nears 10 minutes, split it into sixths.
- **(once) Launcher.** `IRIS_TEST_HOST=127.0.0.1 IRIS_TEST_PORT=1 CP npm --prefix extensions/iris-mcp-launcher test`. Expected: the failures equal the DW-532 set exactly.
- **(once) Governance.** `CP pnpm gen:governance-baseline:check`. Expected: 141 keys, `1e62c5ad5bf7`, OK.
- **(once) Diff checks.**
  - `git diff --name-only <B>` lists no `bootstrap-classes.ts`, `src/ExecuteMCPv2/`, `package.json`, `pnpm-lock.yaml`, `fixtures/sdk-wire-golden.json`, `fixtures/sdk-handler-golden.json` or `_bmad-output/planning-artifacts/`.
  - `shasum -a 256` of both goldens equals the Code Map values.
  - `git diff 9a2f515 -- src/ packages/shared/src/bootstrap-classes.ts` is empty.
- **(once) Shuffled runs.** The added and changed tests with `--sequence.shuffle` at seeds 11 and 22. Expected: green.

**Shared surfaces:**
- **The two goldens' comparison path:** every loader now reads through the ledger, in the five files listed.
- **The ledger file.**
- **The tools-list snapshot** (`tools-list-snapshot.test.ts`, `story-39-6-qa-snapshot-cli`).
- **The five tool descriptions:** unit `toContain` pins, and the README payload table, which is not re-measured.
- **`resources/list`:** the governance resource tests, and the golden `resources-list` rows.
- **The `resend-failed-messages` body:** three hash pins, the skills `--check` scripts, and the prompt invariants.
- **The two generated `SKILL.md` copies.**
- **The CHANGELOG top entry:** `story-43-3-doc-claims` and the CHANGELOG scanners.
- **The README confirmation section:** the `story-43-3-doc-claims` pins.
- **The 43.3 SDK rig:** now `sdk-confirmation-rig.ts`.

Every test added or changed passes on a fresh environment, in either order. No IRIS instance is touched, and no `ExecuteMCPv2.Temp.*` fixture is used.

**Manual checks:**
- After the lead's spec-gate edits: `grep -n 'S-43.4-descriptions' <spine>`, `grep -n 'Frozen goldens' <spine>`, `grep -n 'landed in Epic 43' <spine>` and `grep -n 'both served over stdio by one process' _bmad-output/planning-artifacts/prd.md` each find a line, and `uv run --no-cache .claude/skills/bmad-architecture/scripts/lint_spine.py --workspace <spine-dir>` reports no blocking finding.
- `git status --short` shows nothing under `irislib/`, `irissys/` or `extensions/iris-mcp-launcher/package-lock.json`, and no temp script.

**Rule 19 evidence (implement stage, 2026-10-20).** `BOOTSTRAP_VERSION` is unchanged: `d51856f74d6a` -> `d51856f74d6a` (`git diff 9a2f515 -- src/ packages/shared/src/bootstrap-classes.ts` is empty). Each mutation below was applied with the file tools, run, then reverted, and the file's SHA-256 was checked against its value before the mutation (a generated skill copy was regenerated instead); every dist involved was rebuilt after the revert (`tsconfig.tsbuildinfo` deleted where the compiler would otherwise not re-emit).

- mutation: `epic43-capstone-gate` M1, `legacy: "serve"` -> `"reject"` in `McpServerBase.start()`'s `serveStdio` call (shared rebuilt) -> `legacy` red at connect ("Unsupported protocol version: 2025-11-25"); `pinned` and `auto` stayed green.
- mutation: `epic43-capstone-gate` M2, the `serveStdio(...)` statement replaced by `this.mcpServer.connect(new StdioServerTransport())` (shared rebuilt) -> `pinned` red at connect ("did not offer pinned protocol version 2026-07-28"), `auto` red at step 1 (era `legacy`, not `modern`), and `legacy` ALSO red at step 1 ("one legacy era line on stderr: expected 0 to be 1"), because a plain connect never builds an instance through the factory and so writes no era line; the spec predicted `legacy` green, which conflicts with its own step 1 (the era line), so the header of the file states the observed result.
- mutation: `epic43-capstone-gate` M3, `classifyConfirmationResponse` returning `"accepted"` for a decline (`confirmation.ts`, shared rebuilt) -> step 7 red on `legacy`, `pinned` and `auto` ("the decline result").
- mutation: `epic43-capstone-gate` M4, `touch packages/shared/src/confirmation.ts` with no rebuild -> all three modes fail with "Build the packages first: shared: ... STALE"; none skipped. Shared was rebuilt with `tsconfig.tsbuildinfo` deleted, and the capstone was green again.
- mutation: `story-43-4-sanctioned-golden-changes` SHA-256 rows, one byte of `sdk-wire-golden.json` (`zodVersion` 4.3.6 -> 4.3.7) -> "sdk-wire-golden.json is byte-unchanged" red; restored, `shasum -a 256` is `602231cc...edbc9` again and `git status` does not list the file.
- mutation: ledger and loader consumers, the `43.4/description/iris_production_control@interop-main` entry removed from the ledger -> `story-43-1-sdk-wire-golden` interop `tools-list` (raw line and v2 client), `story-43-2-cross-era-pin` interop (a) and (d) `main`, and the ledger test's ids row went red (5 failures); the ledger's SHA-256 was identical after the restore.
- mutation: ledger and loader consumers, one character of `old` in `43.4/governance-resource/dev` -> the loader threw "Sanctioned change '43.4/governance-resource/dev': old is not the value ..." at import of `story-43-1-sdk-wire-golden`, `story-43-1-sanctioned-wire-changes`, `story-43-2-cross-era-pin` and `epic43-capstone-gate`, in the two `call 7` rows of `story-43-2-chokepoint-both-eras`, and in the ledger test's `old`, "sanctioned descriptions" and "differs in exactly the rows" rows; `story-43-1-qa-handler-golden` stayed green, because it applies only handler entries and the handler golden has none.
- mutation: `story-43-4-sanctioned-golden-changes` validation rows, a no-op entry (`old` equal to `new`) appended to the ledger -> the "passes the loader's own validation", ids, `old`, "no entry is a no-op", "differs in exactly the rows", "handler golden has no entry" and "sanctioned descriptions" rows red (7 failures), each naming `43.4/noop`.
- mutation: `story-43-4-sanctioned-golden-changes` sanction-id row and `story-43-4-doc-claims`, both `S-43.4-governance-resource` mentions removed from the CHANGELOG entry -> "each sanction id appears, in backticks, in the entry of its story", "names each sanction id in backticks" and "enumerates every sanctioned wire change" red.
- mutation: `story-43-3-doc-claims` "sits directly below the Story 43.4 entry" and `story-43-4-doc-claims` "is the top entry", a copy of the Story 43.3 heading placed above the Story 43.4 heading -> both rows red.
- mutation: `story-43-4-doc-claims` probe row, the DW-641 bullet removed from `docs/client-config/README.md` -> "describes the probe copy of an SDK v2 client as observed" red.
- mutation: `story-43-4-doc-claims` README and Claude Code page rows, "No other byte of any description changed." removed from `README.md` and the headless sentence of `docs/client-config/claude-code.md` reworded -> "says that the five gated tools' descriptions name the dialog" and "covers headless claude -p" red.
- mutation: `server-discovery` DW-646 rows and the five `resources-list` golden rows, the template `list` without the `default` filter (shared rebuilt) -> both `Story 43.4: resources/list names each governance URI once` rows red; `story-43-1-sdk-wire-golden` `resources-list` (raw line and v2 client) red for all five servers; `story-43-2-cross-era-pin` (a) and (d) `main` red for all five servers; all three capstone modes red (23 failures in the two golden files and the capstone).
- mutation: description rows and the tools-list snapshot, `HUMAN CONFIRMATION:` -> `HUMAN CONFIRMATIONS:` in the `iris_audit_manage` description (admin rebuilt) -> `story-43-1-sdk-wire-golden` admin `tools-list` (raw line and v2 client), `tools-list-snapshot.test.ts` (3 rows), `gen:tools-list-snapshot:check` ("DIFFERS ... 1 problem") and all three capstone modes red.
- mutation: the DW-653 prompt text and the three hash pins, step 4's old parenthetical restored in `resendFailedMessages.ts` (interop rebuilt, `pnpm gen:skills` and `pnpm gen:pack` run on the mutated source) -> interop `prompts.test.ts` "dryRun:false without confirm:true is refused" and "no longer says ... omitting either parameter is refused" red; `story-41-5-qa-dist-consumer` body hash, `story-41-2-qa-prompts-stdio-wire` `prompts/get` hash and `skills-generated-frontmatter` file hash red. After the revert, interop was rebuilt, both generators were run again, and the source and both `SKILL.md` copies matched their pre-mutation SHA-256.
- mutation: `epic43-capstone-gate` step 1 after the review patch (it waits up to 5 s for the expected era line before counting), M2 re-run: the `serveStdio(...)` statement replaced by a plain `connect(new StdioServerTransport())` (shared rebuilt) -> `legacy` red at step 1 after the wait ("one legacy era line on stderr: expected +0 to be 1"), `pinned` red at connect ("did not offer pinned protocol version 2026-07-28"), `auto` red at step 1 ("the client's era: expected 'legacy' to be 'modern'"); `server-base.ts` SHA-256 `1a1b50ef...ad329` before and after the revert, shared rebuilt, capstone green. The stderr/stdout ordering race itself is non-deterministic and has no mutation.
- mutation: `story-43-4-doc-claims` fallback-contract rows after the review patch, the root README Inspector sentence and the client-docs bullet restored to "gets the `confirm: true` contract" -> "states what Claude Code and MCP Inspector were observed to declare" and "states the dialog per client as observed" red (2 failures); both files byte-identical after the revert (SHA-256 `6488fd70...` and `efc2f6a8...`).
- mutation: `golden-sanctioned-changes.mjs` guards, the `old` comparison, the canonical-JSON check and the append-only check each disabled in turn (`false &&`) -> "a wrong old" and "changes to one row apply in file order", "a frozen line that is not canonical JSON", and "a duplicate id, a no-op, an append that is not an append ..." red, one mutation at a time; the file was restored (no `false &&` left).

## Auto Run Result

Status: done
Blocking condition: none

**Summary of the change.**
- The two frozen SDK v1 goldens retire into a sanctioned-change ledger. `scripts/lib/golden-sanctioned-changes.mjs` applies the 11 entries of `fixtures/sdk-golden-sanctioned-changes.json`, all five golden tests load through it, and `story-43-4-sanctioned-golden-changes.test.ts` pins both frozen files by SHA-256 and keeps the ledger honest. The frozen files are byte-unchanged.
- The five gated tool descriptions gain their decision #24 appended passage, the duplicate governance resource is gone (the template `list` omits `default`, DW-646), and steps 3 and 4 of `resend-failed-messages` are corrected (DW-653). The two `SKILL.md` copies, `tools-list-snapshot.json` (the five descriptions) and the three prompt hash constants are regenerated from rebuilt output.
- The default-suite epic gate `epic43-capstone-gate.test.ts` walks the built admin server through the real SDK client on `legacy`, a pinned `2026-07-28` and `auto`, on the lifted `sdk-confirmation-rig.ts`.
- Docs and records: the README confirmation section, `docs/client-config/README.md` and `claude-code.md` (protocol revisions, the DW-641 probe copy as observed, the hook, headless runs), the CHANGELOG entry (2026-10-20) and `.changeset/story-43-4-sdk-v2-close.md`.
- `BOOTSTRAP_VERSION` is unchanged: `d51856f74d6a` -> `d51856f74d6a`. Tools stay 110/115, the baseline stays 141 keys.

**Files changed.**
- New: `scripts/lib/golden-sanctioned-changes.mjs` (the loader), `packages/iris-mcp-all/src/__tests__/fixtures/sdk-golden-sanctioned-changes.json` (the ledger), `sdk-confirmation-rig.ts` (the lifted rig), `epic43-capstone-gate.test.ts`, `story-43-4-sanctioned-golden-changes.test.ts`, `story-43-4-doc-claims.test.ts`, `.changeset/story-43-4-sdk-v2-close.md`.
- Source: `packages/shared/src/server-base.ts` (the template `list`), `audit.ts`, `env-promote.ts`, `doc-edit.ts`, `production.ts`, `message-resend.ts` (descriptions), `resendFailedMessages.ts` (prompt).
- Generated: both `resend-failed-messages/SKILL.md` copies, `fixtures/tools-list-snapshot.json` (also its `capturedAt` and `sdkVersion` header, which the generator stamps).
- Existing tests, the twelve of decision #28c: the five golden loaders, `story-43-3-confirmation-both-eras` (the rig move; 104 tests before and after), `story-43-3-doc-claims` (two rows), three hash constants, and the additive describes in `server-discovery.test.ts` and interop `prompts.test.ts`.
- Docs: `README.md`, `CHANGELOG.md`, `docs/client-config/README.md`, `docs/client-config/claude-code.md`.

**Review findings.** 33 findings from four layers: high 0, medium 5, low 25, false 3.
- Patched (4 entries): the 2025-11-25 byte-identity overclaim in `README.md:934` and `docs/client-config/README.md` (B1/E7); the "gets the `confirm: true` contract" wording for clients that cannot be asked, which is wrong for `resend` and `regenerateStorage` (B3); raw U+2014 in the ledger, now `—` escapes (B5); the capstone's step 1 read of stderr, which now waits up to 5 s for the era line (E5/V1).
- Deferred (1): the `iris_message_resend` description, its `maxMessages` text and the interop README keep pre-DW-653 wording (B2); the intent forbids touching an existing description byte outside the 11 sanctioned entries.
- Rejected (28), each with its reason in the Review Triage Log: spec-prescribed pins and wording (the top-entry CHANGELOG pins, "one sentence", no dialog sentence in prompts, the capstone walk), theoretical or loud-failing latent cases, and Rule 19's one-mutation-per-AC bar.

**Follow-up review recommendation: true.** Three medium entries were patched (the byte-identity wording, the fallback-contract wording, the stderr wait). The named unverified risk is the stderr wait: the pipe-ordering race it guards is non-deterministic and cannot be mutated, so only its "still fails when the line is absent" half is demonstrated (M2 re-run). Patched counts by verdict: high 0, medium 3 entries (5 findings), low 1.

**Verification performed** (every command with `IRIS_HOST=127.0.0.1 IRIS_PORT=1`; no IRIS instance, `claude` or Inspector contacted; no live gate armed).
- Loop lines, on the final tree: seven builds exit 0; `gen:skills:check`, `gen:pack:check`, `gen:tools-list-snapshot:check` (115 entries) and `validate:prompts` OK; units shared 166, admin 38, dev 208, interop 221; new and lifted files 165 tests; golden pins 464; catalogue, prompt and doc pins 525. All pass, nothing skipped in them.
- Diff guard: only the twelve files plus `tools-list-snapshot.json`; the only changed assertion lines are the three hash constants and the two `story-43-3-doc-claims` rows.
- Once lines, after the last patch: shared 2289 tests, dev 1408 (307 live skips), admin 506 (8 skips), interop 751, ops 350, data 163 (2 skips), client-config 1008, each with `type-check` and `lint` exit 0 (only the pre-existing `cli/governance.ts` warning). `iris-mcp-all` sweep in thirds: 159 files pass (live gates skipped). Launcher: 5 tests in 3 files and 2 unloadable files fail, exactly the DW-532 set. `gen:governance-baseline:check` OK (141 frozen keys). Goldens match their SHA-256; `git diff 9a2f515 -- src/ packages/shared/src/bootstrap-classes.ts` is empty; nothing forbidden in `git diff --name-only`. Shuffled seeds 11 and 22: 726 tests in the 13 iris-mcp-all files, plus `server-discovery` (24) and interop `prompts` (28), all green. The spine greps find their lines and `lint_spine.py` reports 0 findings.
- Mutation evidence for every pinning test is under Verification (M1 to M4 of decision #27, the ledger, docs, resource, description and prompt mutations, plus the two review patches).
- `@iris-mcp/all` has no `type-check` or `lint` script, so the spec's line for it cannot run; a strict `tsc` over the new and changed test files reports 0 errors.

**Residual risks and notes for the lead.**
- AC 43.4.1 (live smokes: Claude Code and Inspector on both eras, DW-641 start counts) is the lead's and is not run here. The docs state the observed facts from the 43.2/43.3 live checks; the smoke confirms them.
- M2 differs from decision #27's prediction: with a plain 2025-only connect, `legacy` also goes red (at step 1, since no era line is written without the factory), not green. The capstone header records it.
- The appended description text is about 2.3 KB across dev, admin and interop, not the spec's 1.9 KB. The README payload table is not re-measured (decision #28b; the `deferred:` LOW).
- The capstone's walk uses a form-declaring client only. The no-capability fallback and the cancel path are pinned on `legacy` and a pinned revision by the 43.3 files.
- The pre-DW-653 wording in `iris_message_resend`'s own description is deferred (frontmatter), so the tool description and the corrected prompt still disagree on what a `dryRun`-less `confirm: true` call does.
