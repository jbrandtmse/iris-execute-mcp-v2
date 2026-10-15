---
review: reconcile
target: ../ARCHITECTURE-SPINE.md
inputs:
  - _bmad-output/planning-artifacts/architecture.md
  - .claude/rules/project-rules.md
date: 2026-10-14
mode: read-only (no file other than this one was edited)
---

# Reconcile review: spine vs architecture.md and project-rules.md

**Verdict.** The spine holds up against both sources. Most settled decisions landed, and the AD-1 to AD-29 Rules agree with their sources. Two ADs need a fix before the Epic 38 stories use them:

- AD-4/AD-24 state an `iris_doc_edit` shape that the governance mechanism rejects at registration.
- AD-11 gives the wrong inheritance chain for REST handlers.

The rest of the findings are dropped constraints and weakened rules. The fixes are short.

Line numbers are for `ARCHITECTURE-SPINE.md` ("spine"), `architecture.md` ("arch") and `project-rules.md` ("rules") as of 2026-10-14. I checked code claims in `packages/`, `src/` and `scripts/` where the note says so.

---

## High

### H-1. `iris_doc_edit` as a `defaultEnabled` write does not fit the mechanism the spine adopts (AD-4, AD-24)

- **Source:**
  - arch:433 (F2): the `defaultEnabled` marker "mirror[s] `mutates`'s per-action shape".
  - arch:403 (D4): new governed tools surface mutating operations through an `action` enum.
  - rules #32: registration-time cross-validation.
  - Code: `packages/shared/src/governance.ts:570-605` (`buildDefaultEnabledWrites` throws when `mutates` is scalar: "a scalar `mutates` cannot be addressed by an action-keyed `defaultEnabled`") and `packages/shared/src/tool-types.ts:120-126`.
- **What is wrong:**
  - Spine:91 restates D4 ("A new tool exposes its mutating operations through an `action` enum"), and spine:93 and spine:280 make `iris_doc_edit` a `defaultEnabled` holder. They don't say that the marker only works on a per-action `mutates` record.
  - Story 38.4 (`epics.md:5050-5065`) gives `iris_doc_edit` no `action` enum (inputs are `name`, `edits[]` and `namespace`) and says `mutates: "write"` (scalar). It also says that "registration-time cross-validation accepts it".
  - As written, that tool fails at server construction. It also breaks D4 as the spine states it.
  - The fix is either an `action` enum (for example `action: "apply"`, which makes the key `iris_doc_edit:apply`) or a change to the shared governance foundation. A foundation change would be a new architectural decision, not an adopted one.
- **Suggested spine fix:** add to AD-4: "The `defaultEnabled` marker addresses only `tool:action` keys, so the tool must declare a per-action `mutates` record. A single-operation write that must ship enabled needs an `action` enum or a recorded change to `buildDefaultEnabledWrites`." Then note in AD-24 which of the two Story 38.4 uses.

### H-2. AD-11 gives the wrong inheritance chain for custom REST handlers

- **Source:**
  - arch:257 and arch:270 ("Dispatch extends `%Atelier.REST`, so all custom REST handlers inherit this format").
  - Code: `src/ExecuteMCPv2/REST/Base.cls:56` (`ExecuteMCPv2.REST.Base Extends %Atelier.REST`, Story 34.4). All 15 handlers `Extends ExecuteMCPv2.REST.Base`. Only `Dispatch` extends `%Atelier.REST` directly.
  - `scripts/gen-bootstrap.mjs:9-13` and `:28` place `REST/Base.cls` before every handler.
- **What is misstated:**
  - Spine:159 says handlers "inherit `%Atelier.REST` through `ExecuteMCPv2.REST.Dispatch`". They don't. Dispatch only routes.
  - Handlers get their envelope from `REST.Base`, which overrides `RenderResponseBody` with a serialization pre-flight. That guard is for deferred item 34-2-R3 and covers about 738 call sites.
  - A new handler built from this AD could extend `%Atelier.REST` or `Dispatch` directly and lose the guard without anyone noticing.
  - architecture.md is imprecise here as well. The spine copied it instead of checking the code.
- **Suggested spine fix:** in AD-11, replace the first bullet's opening with "Every custom REST handler extends `ExecuteMCPv2.REST.Base` (which extends `%Atelier.REST` and pre-flights the envelope); `Dispatch` extends `%Atelier.REST` and only routes." Add `REST/Base.cls` to the AD-14 class-order note (see M-7).

---

## Medium

### M-1. MCP tool annotations are not in the spine at all

- **Sources:**
  - arch:89 (cross-cutting concern #4): accurate `readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint` on every tool, and `*_manage` tools that create and delete are `destructiveHint: true`.
  - arch:301 and arch:308 (annotations are part of `ToolDefinition`; the base enforces patterns).
  - rules #32 (`annotations.destructiveHint` stays truthful on a `defaultEnabled` write).
  - rules #44 (a hand-curated classification is cross-checked mechanically against `readOnlyHint`). Code: `packages/iris-mcp-all/src/__tests__/readonly-hint-crosscheck.test.ts`.
- **What is missing:**
  - No AD or Conventions row mentions annotations. AD-4 governs `mutates` only.
  - The two signals are separate. Annotations are per tool and `mutates` is per action. A Rule #44 test ties them together for baseline reads.
  - New tools in Epics 38–42 need both, and Story 38.4 already requires "annotations truthful and consistent with `iris_doc_put`".
- **Suggested spine fix:** add a Conventions row "Tool annotations": every tool declares all four hints truthfully; a tool with any destructive action is `destructiveHint: true`; `mutates` and `defaultEnabled` never change annotations; a hand-curated classification is cross-checked mechanically against `readOnlyHint`, and any divergence carries a justification (Rule #44).

### M-2. AD-4 leaves the `defaultEnabled` gate open-ended

- **Sources:**
  - rules #32: the marker exists for recovery tooling.
  - arch:461 (H6): resend and promote are "deliberately NOT F2 `defaultEnabled`".
  - arch:505 (N2) and S-3: `iris_doc_edit` is an exception "by Lead decision", which extends Rule #32 "beyond its original recovery-tooling purpose".
- **What is weakened:**
  - Spine:93 says "A write that must ship enabled uses the `defaultEnabled` marker". It doesn't say who decides that a write "must" ship enabled.
  - The sources treat the holder list as closed. A new holder takes a Project Lead decision, and bulk or data-flow writes are excluded by name.
  - A story agent reading AD-4 could add itself as a holder.
- **Suggested spine fix:** add to AD-4: "The holder list is closed. Adding a `defaultEnabled` holder requires a recorded Project Lead decision. Bulk and data-flow writes (resend, promote) are never holders (H6)."

### M-3. AD-7 drops the Rule #53 and L-4 roster discipline

- **Sources:**
  - rules #53: "when in doubt, EXCLUDE from `core`"; tools designed as a unit go in `TOOL_PAIRS`; "any roster change beyond the new tool's own rows (or any doubt) is re-flagged to the lead, never silently adjusted"; the disposition is a product decision.
  - L-4 as restated in `epics.md:4972`: "No existing `core` tool is removed".
- **What is missing:**
  - Spine:124 keeps only the relaxed half of L-4: "a tool in the everyday loop belongs in `core`".
  - It drops the default toward exclusion, the ban on touching other tools' rows, the escalation to the Lead, and the rule that keeps existing `core` tools in place.
  - Spine:123 also states that `TOOL_PAIRS` members are co-visible, but not that a new tool designed with a partner must be declared in `TOOL_PAIRS`. Story 38.4 does declare an `iris_doc_get` pair.
- **Suggested spine fix:** add to AD-7: "When in doubt, exclude from `core`. No story removes an existing `core` tool or changes another tool's preset rows; any such change goes to the Project Lead. A tool designed with a partner is declared in `TOOL_PAIRS` in the same story."

### M-4. AD-7 leaves out the visibility resolution order and its failure split (I1)

- **Source:**
  - arch:467 (I1): resolution is `ENABLE > DISABLE > preset > default-visible`, with trailing-`*` wildcards.
  - A malformed preset, or a literal disable of the reserved discovery tool, fails fast. Unknown tool names only WARN, "because the env block is shared across all 5 servers".
  - `iris_server_profiles` reports `toolVisibility` counts only, "never hidden names". The governance report and resource omit hidden tools' keys. `IRIS_GOVERNANCE` keys naming hidden tools are legal and inert.
  - Code: `packages/shared/src/tool-visibility.ts:18-25`.
- **What is missing:**
  - AD-6 gives a precedence order for governance, but AD-7 gives none for visibility.
  - The WARN-not-fail rule for names another server owns also qualifies the Conventions rule that "a malformed value fails fast" (spine:343). Without it, a story could make an unknown name fatal and break the shared env block.
- **Suggested spine fix:** add to AD-7: "Resolution is `IRIS_TOOLS_ENABLE` > `IRIS_TOOLS_DISABLE` > preset > visible. A malformed value fails fast, but an unknown tool name only warns, because the env block is shared by all five servers. Discovery reports hidden counts, never hidden names, and governance surfaces omit hidden tools' keys."

### M-5. AD-6 can be read as allowing the env and file layers to interleave

- **Source:**
  - arch:451 (H1) gives the four-layer formula from before the file channel.
  - The file channel came later (J1, Epic 32). Code `packages/shared/src/governance.ts:27-33` gives the cascade as `env.profile ?? env.global ?? file.profile ?? file.global ?? presetSeed ?? defaultSeed`, with "ALL env layers above ALL file layers (no interleaving; Project Lead decision 2026-07-26)".
- **What is ambiguous:**
  - Spine:111 ("profile explicit, else global explicit, else preset, else default") and spine:112 ("`IRIS_GOVERNANCE` over `IRIS_GOVERNANCE_FILE`") read together could mean that `file.profile` beats `env.global`. The code does the opposite.
  - AD-6 also leaves out three H1 details: an unknown preset fails fast, a denial caused by the preset carries `presetApplied`, and `IRIS_GOVERNANCE_FILE` is read once at startup with no hot reload (`tool-types.ts:254-275`).
- **Suggested spine fix:** replace the first two bullets of AD-6 with the explicit six-layer chain and the words "no interleaving: every env layer outranks every file layer". Add "the file is read once at startup; every surface reads that snapshot".

### M-6. AD-9 drops the profile-definition contract (D7, J1)

- **Sources:**
  - arch:409 (D7): "a profile may omit fields to inherit the default's".
  - arch:475 (J1): env and `IRIS_PROFILES` definitions "always win name collisions". `IRIS_SM_WORKSPACE` and `IRIS_SM_SERVERS` are the documented mitigations. Every roster entry carries `source`/`sourceFile` provenance.
  - Code: `packages/shared/src/credential-chain.ts:9-14` ("environment definitions always win").
- **What is missing:**
  - AD-9 covers where configuration comes from, but not how definitions from several sources combine or how a profile is attributed to its source.
  - Two things depend on that contract: Story 39.2's per-profile `dataPolicy` precedence, and any new profile field. A new source with different precedence would break the J1 mitigation.
  - Also, the claim at spine:141 that configuration comes from "environment variables … and from file paths the operator supplies explicitly" leaves out the OS keychain and `IRIS_CREDENTIAL_HELPER` links in the Server Manager credential chain (`credential-chain.ts:16-28`). architecture.md doesn't record these either.
- **Suggested spine fix:** add to AD-9: "A profile inherits omitted fields from `default`. When sources define the same name, `IRIS_PROFILES`/env always wins. Every roster entry carries `source`/`sourceFile`. A new per-profile field follows the same precedence." Add "OS keychain and `IRIS_CREDENTIAL_HELPER` (Server Manager credentials only)" to the channel list.

### M-7. AD-14 drops the bootstrap roster rules and the test-class exclusion, and the Structural Seed contradicts the exclusion

- **Source:**
  - rules #39: `REST/Dispatch.cls` stays last in `classes[]`; "`ExecuteMCPv2.Tests.*` test/fixture classes stay OUT of the manifest"; a new class is added to both rosters.
  - Code: `scripts/gen-bootstrap.mjs:9-44`, an explicit ordered list: Utils, then Setup, then the libraries, then `REST/Base`, then the handlers, with Dispatch last. `src/ExecuteMCPv2/Tests/` and `QAFixtures/` are absent from the list.
- **What is missing or misstated:**
  - Spine:188 keeps "both rosters" but leaves out the ordering rule and the exclusion.
  - Spine:393 describes `src/ExecuteMCPv2/` as "IRIS-side REST service, libraries and tests (bootstrapped)". That says the tests are bootstrapped, which is the reverse of Rule #39.
  - From Story 42.4, the IPM manifest is generated from the same list (spine:191), so the exclusion also decides what IPM installs.
- **Suggested spine fix:** add to AD-14: "`classes[]` is in compile order: Utils, then Setup, then libraries, then `REST/Base`, then handlers, with `Dispatch` last. `ExecuteMCPv2.Tests.*` and fixture classes are never in the manifest, and so never in IPM." Change spine:393 to "IRIS-side REST service and libraries (bootstrapped); tests and fixtures (not bootstrapped)".

### M-8. AD-14 drops D8's failure semantics for lazy bootstrap

- **Source:** arch:413 (D8):
  - bootstrap runs at most once per profile;
  - a failed attempt returns the structured "which steps succeeded / which failed + manual remediation" report (FR12/FR13), "**not** a silent no-op";
  - Atelier-only tools never trigger bootstrap;
  - the bootstrap mutation "is part of establishing the profile's connection, not a separately-governed tool action".
- **What is missing:**
  - Spine:187 covers only the trigger.
  - Two of the dropped points matter to new work. A story that adds a governed step to bootstrap, or makes an Atelier-only tool depend on bootstrap, would contradict D8. The remediation report is the contract FR12/FR13 promise.
- **Suggested spine fix:** add to AD-14: "Bootstrap runs at most once per profile and only for custom-REST servers. A failure returns the structured per-step report with manual remediation, never a silent no-op. Bootstrap is part of establishing a connection and is never a governed action."

### M-9. AD-3's handler contract omits `scope` and most of `ToolContext`

- **Sources:**
  - arch:302 and arch:307 (`scope: "NS" | "SYS" | "BOTH" | "NONE"` drives namespace injection).
  - arch:85 (the per-call `namespace` override) and arch:379 (`server` picks the instance, `namespace` picks the namespace within it).
  - arch:95 (cross-cutting concern #7: a tool that needs a newer Atelier version degrades with a clear minimum-version error).
  - rules #40 (refers to `scope:"NONE"` tools).
  - Code: `tool-types.ts:45`, `:69` and `:197-275`; `atelier.ts:115-136` (`requireMinVersion`, used in `format.ts:167` and `intelligence.ts:142` and `:226`).
- **What is misstated:**
  - Spine:84 says handlers "use only `ToolContext`: `ctx.http`, `ctx.resolveNamespace`, `ctx.resolveProfileClient`". That list is incomplete. `ctx.atelierVersion`, `ctx.paginate`, `ctx.config` and `ctx.governanceFileConfig` are all part of the contract.
  - The required `scope` field, and how it governs `resolveNamespace` (SYS is always `%SYS`; NONE has no namespace), appears nowhere in the spine.
  - Neither does the rule that version-dependent features gate on `requireMinVersion` against the profile's negotiated version. That matters because profiles can run different IRIS versions (D1).
- **Suggested spine fix:** reword the last AD-3 bullet as "Handlers use only `ToolContext` (`http`, `resolveNamespace`, `resolveProfileClient`, `atelierVersion`, `paginate`, `config`, `governanceFileConfig`) and never read environment variables. Every tool declares `scope`, which decides namespace resolution. A feature that needs a newer Atelier version calls `requireMinVersion` against the calling profile's negotiated version."

### M-10. "Privilege enforcement is IRIS-side" did not land

- **Source:** arch:234-237 ("No client-side privilege checks — IRIS's own permission model is authoritative"; a permission failure surfaces as an actionable error naming the required resource; bootstrap privilege-tier detection is the only exception). Also arch:1071.
- **What is missing:**
  - No AD separates authorization (IRIS) from governance (the operator's per-action enable/disable) and visibility (ergonomics).
  - Epic 39 adds a third gate on the MCP side, the per-profile `dataPolicy`. Without the separation written down, a story could build client-side privilege prediction into it or into governance.
- **Suggested spine fix:** add a bullet to AD-12 or AD-3: "Authorization is IRIS's. The servers never pre-check IRIS privileges. A permission failure surfaces as an actionable error naming the required resource. Governance, visibility and `dataPolicy` are operator policy, never a substitute for IRIS authorization."

---

## Low

### L-1. Read-only reference directories are missing

- **Source:** arch:739-748 and arch:967-970 (Boundary 5, marked "CRITICAL"): agents never modify `sources/` or `irislib/`. Rules #16 also cites `irissys/`.
- **What is missing:** all three directories are gitignored (`.gitignore:35-37`) and absent from this checkout, so the risk is low. Still, the rule is a settled boundary, and the Probes row (spine:344) sends agents to "source".
- **Suggested spine fix:** add to the Probes row: "`sources/`, `irislib/` and `irissys/` are read-only references, never edited."

### L-2. "Only three error classes" is stale in both the spine and architecture.md

- **Source:** arch:325-328 and arch:732.
- **Code:** `packages/shared/src/profiles.ts:128` (`ProfileResolutionError`, which `ToolContext.resolveProfileClient` documents as a throw) and `packages/shared/src/cli/credentials.ts:107` (`KeyringUnavailableError`).
- **What is stale:** spine:162 says "TypeScript uses only three error classes", but the code has five.
- **Suggested spine fix:** "IRIS and protocol failures use `IrisConnectionError`, `IrisApiError` and `McpProtocolError`; `ProfileResolutionError` is the framework's profile-lookup error. A new error class needs a recorded reason."

### L-3. The kebab-case file convention disagrees with the code

- **Source:** arch:544.
- **Code:** every file in `packages/*/src/prompts/` is camelCase (`checkSystemHealth.ts`, `deployAndTestClass.ts`, …), as are `tools/sqlAdvisor.ts`, `tools/sqlAnalyze.ts` and `tools/defaultSettings.ts`.
- **What is stale:** spine:338 states plain `kebab-case.ts`, so Epic 38 and 41 prompts would mix styles.
- **Suggested spine fix:** "`kebab-case.ts`, except `src/prompts/`, which uses camelCase to match the existing files."

### L-4. AD-12's exception list is incomplete, and its redaction wording goes beyond H5

- **Source:** arch:459 (H5) puts "thresholds→verdicts, advisory heuristics→findings" in TypeScript, and arch:441 (G1) records the Diagram exception.
- **Code:** `src/ExecuteMCPv2/Loc/Classifier.cls` is a second IRIS-side logic library (a line-classifier state machine, Epic 22). architecture.md doesn't record it, and the spine lists it at spine:34 without a decision.
- **What is unclear:**
  - Spine:171 adds "redaction policy decisions" to the TypeScript-only list.
  - Rules #9 puts field-specific secret redaction on the IRIS side (`SanitizeError`, the minimum-length-gated `$Replace`), and that stays.
- **Suggested spine fix:** "Recorded IRIS-side exceptions: `ExecuteMCPv2.Diagram.*` (G1) and `ExecuteMCPv2.Loc.*` (mechanical counting). Secret redaction of submitted values in IRIS error text stays IRIS-side (Rule #9)."

### L-5. M1's "discovery is connection-agnostic" is dropped

- **Source:** arch:493 (M1, point 4): `iris_server_profiles` never touches the network, and reachability is learned per call.
- **What is missing:** AD-8 doesn't say this, and AD-9/AD-10 don't say it about discovery. A story adding a reachability field to discovery would contradict M1. M1 records that idea only as a ledger candidate.
- **Suggested spine fix:** add to AD-8: "Discovery is connection-agnostic; reachability is learned per call."

### L-6. The G2 clean-room and provenance boundary is dropped

- **Source:** arch:443 (G2): the Diagram reference is a functional spec only; no ObjectScript is ported, no `MALIB.*` naming is used, no reference sample data (real HIE config names) is committed, test fixtures are synthetic, and review verifies provenance.
- **What is missing:** AD-12 names the Diagram exception, and AD-28 covers adapted agent content. Neither covers code provenance or the ban on real sample data. Epic 39 relies on synthetic PHI fixtures in the same way (AC 39.5.5).
- **Suggested spine fix:** add to AD-12 or AD-26: "Reference implementations are functional specs only, never copied. Committed fixtures are synthetic, with no real configuration names or PHI."

### L-7. AD-25 doesn't mention the existing SQL clamps (H1)

- **Source:** arch:451 (H1): `IRIS_SQL_MAX_ROWS` and `IRIS_SQL_TIMEOUT` clamp `iris_sql_execute` at the TypeScript layer. The response notes the clamp, and leaving them unset is a no-op.
- **What is missing:** Story 38.5 adds rows-affected caps to the same tool. AD-25 doesn't say that the new caps must sit alongside the H1 clamps instead of replacing them.
- **Suggested spine fix:** add to AD-25: "The existing H1 clamps (`IRIS_SQL_MAX_ROWS`, `IRIS_SQL_TIMEOUT`) stay; the new caps add to them."

### L-8. The prompt and tool-count rules are only partly stated (H2, Rule #31)

- **Source:**
  - arch:453 (H2): prompts "execute nothing, … carry no governance keys and change no tool counts", and gated prompts ship inside their feature epics.
  - rules #31: "a new ACTION on an existing tool changes NO tool count".
- **What is missing:** AD-10 covers the +1 counting for framework tools only.
- **Suggested spine fix:** add to AD-10: "Prompts carry no governance keys and change no tool counts. A new action on an existing tool changes no tool count."

### L-9. Rule #20's general pattern is reduced to its one instance

- **Source:** rules #20: when gating EXISTING capability, encode the existing set as a generated, output-only artifact, and derive "is this new?" from membership.
- **What is missing:** AD-5 records the governance baseline instance only. Any future gating of existing surface (a new policy dimension, say) would have no rule to follow.
- **Suggested spine fix:** add to AD-5: "Any future gate over existing capability follows the same pattern: a generated membership artifact, never a hand-maintained flag (Rule #20)."

### L-10. Narrow behavior contracts from the rules are missing from Conventions

- **Sources:**
  - rules #9: redaction of a submitted secret is field-specific, with a minimum-length gate.
  - rules #41: a branch for a feature that isn't configured returns its own `notApplicable` contract, not an error.
  - rules #12: REST-app listing tools expose `scope: "spec-first"` (the default) and `scope: "all"`.
- **What is missing:** each one constrains a family of tools across stories.
- **Suggested spine fix:** add the first two to the "Error text" and "Tool results" rows ("Feature not configured ⇒ `notApplicable`, not an error"). Rule #12 can stay in the rules.

### L-11. The shared MCP `instructions` string is a framework surface but isn't listed

- **Source:**
  - arch:423 (E1): "call-first" guidance goes in the server `instructions` field.
  - arch:431 (F1): recover before clean, in the description and in `instructions`.
  - Code: `server-base.ts:551` (`SERVER_DISCOVERY_INSTRUCTIONS`), the same string on all five servers.
- **What is missing:** AD-10 lists the discovery tool, the governance resource and prompts, but not `instructions`. Epic 38–39 guidance would land there and reach all five servers.
- **Suggested spine fix:** add `instructions` to the AD-10 Binds line: "one shared string, and any change reaches all five servers."

### L-12. AD-17 drops two H6 execute-time guards

- **Source:** arch:461 (H6): execute runs only allowlisted plan steps, and every refusal returns the standard envelope and changes nothing. `epics.md:4122` adds halt-on-first-error.
- **Suggested spine fix:** add to AD-17: "Execute accepts only allowlisted plan steps and halts on the first error. A refusal returns the standard envelope and changes nothing."

### L-13. AD-14's generated-files bullet misses installer-managed files (Rule #57)

- **Source:** rules #57: never edit `.claude/skills/bmad-*`, the kit-generated `.claude/commands/epic-cycle.md` or `_bmad/custom/bmad-*.toml` in place; project behavior goes in `_bmad/custom/` overlay files.
- **What is missing:** spine:189 covers only files with a DO-NOT-EDIT header, and these files may not carry one. The `/epic-cycle` agents reading the spine are the ones most likely to edit them.
- **Suggested spine fix:** add to AD-14: "Installer-managed BMAD files are changed only through `_bmad/custom/` overlays (Rule #57)."

### L-14. AD-2 leaves out Rule #45's single-source requirement

- **Source:** rules #45: cross-package checks enumerate through `SERVER_PACKAGES` and `deriveKeysForTool` over built dist, and a CLI script and its vitest test share one implementation.
- **Suggested spine fix:** add to AD-2: "A cross-package check shares one implementation between its CLI script and its test."

---

## Stale text in architecture.md where the spine follows the code (no spine change needed)

These are architecture.md statements beyond the known stale items (dot-notation names, `%CSP.REST`, `/v1`, the Atelier/custom mixing rule). Each one conflicts with the spine, and the code supports the spine:

| architecture.md | Conflict | Code supports |
| --- | --- | --- |
| arch:965, Boundary 4: "Bootstrap never runs during tool execution" | AD-14 and D8 say bootstrap runs lazily on the first custom-REST call | Spine. `server-base.ts:1521-1530` runs the one-time per-profile bootstrap inside the call path |
| arch:946 and arch:989: transport is "stdio/HTTP", configured in each `index.ts` | AD-23 (stdio only, `resolveTransport`) | Spine. `packages/iris-dev-mcp/src/index.ts:12,30` calls shared `resolveTransport()` |
| arch:331 and arch:782: handlers return `{status, code, message, detail}`; `json-envelope.ts` helpers | AD-11 (the three-part `status`/`console`/`result` envelope) | Spine. No `json-envelope.ts` exists in `packages/shared/src/` |
| arch:646-680: the REST handler example calls `RenderResponseBody` in both `Try` and `Catch` | AD-11 and Rule #7 (exactly one render per request) | Spine. Rule #7 names this exact double-render as a defect, so the example is an anti-pattern |
| arch:441, G1: classes "picked up by `gen-bootstrap.mjs`'s `src/ExecuteMCPv2/**/*.cls` glob" | AD-14 (both hand-maintained rosters) | Spine. `gen-bootstrap.mjs:14-44` is an explicit ordered list |
| arch:76: "Custom REST service must live in %SYS namespace" | The spine is silent, so there is no conflict | Neither. `Setup.cls:33-42` registers the web app for the install namespace and switches to `%SYS` only to create it |

---

## Checked and not reported

These were checked against the spine and found adequately covered, or are process-only:

- **Covered:** D1–D3, D5 and D6 (AD-3, AD-5, AD-6, AD-8); E1 allow-list (AD-9); F1 confirm gate (AD-17); H3 (AD-19); H4 (AD-18); K1 (AD-21); L1 (AD-16); N1–N7 (AD-23 to AD-29).
- **Covered:** rules #2–#6, #8, #10, #11, #13, #15, #21, #33 and #35 (Conventions); #7 and #9 (AD-11); #18, #23–#25, #27–#29, #38 and #50 (their ADs).
- **Process-only, correctly left out:** #1, #14/#16/#42/#47 beyond the Probes row, #17, #19 procedure, #22, #26, #30, #34, #36, #37, #40, #43, #46, #48, #49, #51, #52, #54–#56, #58 and #59.
