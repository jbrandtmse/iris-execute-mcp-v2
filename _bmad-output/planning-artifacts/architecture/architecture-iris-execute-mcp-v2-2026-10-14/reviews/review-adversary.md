# Adversarial Review: Architecture Spine Seam Attack

- **Target:** `ARCHITECTURE-SPINE.md` (AD-1 to AD-31 and the Consistency Conventions), as of 2026-10-14T20:15.
- **Level below:** Epics 38–42 in `_bmad-output/planning-artifacts/epics.md` (lines 4963–5700).
- **Lens:** For each named seam, the review builds two units one level down (two stories, two epics, or a story and existing code). Each unit follows every AD to the letter, but the two still build incompatibly. Each hole gets a proposed new or tightened AD Rule.
- **Method:** Every claim about existing behaviour was checked in source, and the file and line are cited. The one claim about Atelier behaviour that could not be checked in source is marked *probe*. The only file changed is this one.

## Verdict

**The spine is not yet safe to build Epics 38–42 against.** The review found 39 holes:

| Tier | Count |
| --- | --- |
| Critical | 2 |
| High | 13 |
| Medium | 19 |
| Low | 5 |

The two critical holes are:

- **PHI leak under the default policy.** Under the default `redact` policy, PHI can leak through a body that was truncated or sanitized before it reached the redaction engine.
- **AD-16 and AD-27 contradict each other for coverage runs.** Any implementation of Story 40.1 violates one of them, and two failure paths leave a monitor running that no tool is allowed to stop.

Most high holes share one shape. A rule is written for a single unit, such as one key, one profile or one field, and is silent about the relationship between that unit and its sibling: the parent key, the `default` profile, an existing field of the same name, IPM versus bootstrap, or the extension's other `npx` call sites.

## Summary

| ID | Tier | Seam | Hole |
| --- | --- | --- | --- |
| C1 | critical | 39.2 × `BodySummary` / 39.5 size cap | Redaction runs on a body that was already truncated, flattened or classified by sniffing |
| C2 | critical | 40.1 × AD-16 × AD-27 | Monitor lifetime: a running result, cancel and crash each conflict with always-release and never-stop-others |
| H1 | high | 39.2 × profile merge (`profiles.ts`) | `dataPolicy` set on the `default` profile entry is inherited by every profile |
| H2 | high | 38.4 / 38.5 × an explicit operator disable | New keys reopen capabilities the operator explicitly disabled (`iris_doc_put`, `iris_sql_execute`) |
| H3 | high | 38.5 `iris_sql_query` × the AD-6 `read-only` preset | A statement-type SELECT can write through a SQL function |
| H4 | high | 38.5.4 × `sql.ts:115` | `rowCount` already exists with a different meaning, so "additive" is false |
| H5 | high | 38.2 × 38.4 × Atelier PUT | No shared version token, so conflict detection is undefined |
| H6 | high | 39.3 / 39.4 × AD-12 | Identifiers are validated in TypeScript and interpolated IRIS-side, which allows injection through direct REST |
| H7 | high | 39.2 × `audit.ts` / `server-base.ts` | PHI reaches the audit log through name-keyed redaction and the `error` field |
| H8 | high | 40.1 / 40.2 × `core` preset × AD-7 | Coverage results of a long run are unreachable, because the companion is hidden in `core` |
| H9 | high | 41.1 × 42.8 | A build-output pack cannot be consumed by a git-sourced plugin |
| H10 | high | 42.2 × 42.4 × 42.5 × the dev loop | The version marker is undefined: sequence source, equal sequence with a different hash, `"dev"` |
| H11 | high | 42.4 IPM × bootstrap × 42.2 | Two owners of the deployed classes, and IPM downgrades bypass the guard |
| H12 | high | 42.2 × `@1` × every later handler change | No REST wire-compatibility rule, although the guard keeps newer classes under older clients |
| H13 | high | 42.1.6 × extension engine CLIs | The client-config and governance CLIs are spawned unpinned, and the launch spec has two owners |
| M1 | medium | 38.2 × 38.4 | Line *text* has no canonical form (terminators, BOM, numbered format, `format: xml`) |
| M2 | medium | 38.4 × Atelier UDL rendering | The diff, excerpt and `totalLines` after an edit are computed locally, not re-read from the server |
| M3 | medium | 38.3 × 38.4 | The storage override is open to every caller of a `defaultEnabled` write |
| M4 | medium | AD-24 × `iris_doc_xml_export:import` and bootstrap PUT | Document-writing paths with no owner |
| M5 | medium | 38.5 × Atelier `action/query` | Classification and execution can be split, and two serializers exist |
| M6 | medium | 39.1.2 × `resendFiltered` | The shared helper mixes refuse-over-cap with paging, and required-item with window-only |
| M7 | medium | 39.1 × 39.3 / 39.4 | `mode` versus `action`: governance granularity and audit `action` |
| M8 | medium | 39.2.5 × AD-19 × `AuditOutcome` | Policy outcomes "in the outcome field" versus additive-only fields |
| M9 | medium | 38.3 / 38.4 / 38.5 / 39.x / 40.x | No convention for machine-readable refusal codes |
| M10 | medium | 39.1 × the resend preview × `iris_production_messages` | One message-header entity with three shapes, and `timeCreated` with two formats |
| M11 | medium | AD-26 scope × `iris_production_logs` and header error text | Body-derived text outside bodies has no owner |
| M12 | medium | 40.1.3 × AD-4 | Coverage, a new instance-wide side effect, rides an enabled frozen write key |
| M13 | medium | 40.1 × AD-4 × AD-15 | The annotation must be truthful in 40.1, but the fix is sanctioned only in 40.4 |
| M14 | medium | 42.8 × `@1` servers | Plugin skills from the git head are out of version step with the npm servers |
| M15 | medium | 42.8 × 41.6 | Plugin and installer skills are duplicated in Claude Code |
| M16 | medium | 41.6 × AD-28 × AD-30 | Notice placement: auto-loaded folders, and collision with the user's own file |
| M17 | medium | 41.2.2 × 41.6 × AD-30 | The installer has no ownership record: retired skills and user-edited owned files |
| M18 | medium | 42.7 × AD-29 | An extension auto-update moves the pinned major |
| M19 | medium | 42.4 / 42.2 × 42.1.4 × 42.5 | Artifacts that embed the version versus the Changesets `version` step |
| L1 | low | bootstrap × mixed-version clients | Concurrent deployment race on a shared instance |
| L2 | low | 42.5 × 42.8.5 | The release channel list leaves out the versioned listings |
| L3 | low | `validate:prompts` × AD-7 | Skills name tools that the recommended preset hides |
| L4 | low | 41.5 × 41.2.1 / 41.3.3 | Internal rule numbers in generated workflow skills |
| L5 | low | 40.1 oracle × shared-instance convention | An instance-wide monitor counts executions by other processes |

---

## Critical

### C1 — PHI redaction runs on a body that was already truncated, flattened or sniffed

- **Pair:** Story 39.2 (the redaction engine, applied to the resend preview's `bodySummary` by AC 39.2.4) against the existing `MessageResend.BodySummary` (`src/ExecuteMCPv2/REST/MessageResend.cls:166-195`). A second pair is Story 39.5's size cap with a `truncated` flag (AC 39.5.2) against 39.2.
- **Why both comply:** AD-26 applies the policy "to every output derived from a body". It blocks "a body *type* the engine cannot redact reliably". AD-12 and the capability map put the engine in TypeScript. Nothing says what the engine receives.
- **The clash:**
  - `BodySummary` returns the first 1024 characters of a `%Stream` body, and replaces every control character with a space, including the CR segment terminator.
  - A 39.2 developer who redacts "HL7 v2 bodies" in the preview by recognising ER7 (an `MSH|` prefix in a stream) hands the engine one flattened, truncated "segment". PID is never found as a segment, nothing is redacted, and PID-5 passes through.
  - The same happens in 39.5 if the size cap is applied IRIS-side to protect the wire. A cut inside a PID segment leaves a partial segment that the field map can miss.
  - One story classifies body kind by class and another by content sniffing. The same message then gets different outcomes in the resend preview and in `iris_message_body`.
- **Proposed Rule (AD-26):**
  - Redaction runs only on the complete, unsanitized body. Truncation and sanitization happen after redaction, in TypeScript.
  - Body kind comes from the body class, through one shared classifier owned by 39.2, never from content.
  - Under `redact`, a surface that can supply only a pre-truncated or pre-sanitized body is `blocked`.

### C2 — Coverage monitor lifetime: AD-16 and AD-27 cannot both hold

- **Pair:** Story 40.1 (the `coverage` option on `iris_execute_tests`) against the AD-16 contract that Stories 36.1 and 36.2 implemented:
  - the running envelope, `packages/iris-dev-mcp/src/tools/execute.ts:673-694`;
  - `iris_test_status:cancel`, which sends `DELETE /work/{jobId}` (`test-status.ts:591`).
- **Why both comply:**
  - AD-16 says that when the budget expires, the tool returns `running` and the job keeps going.
  - AD-27 says "A run always releases what it started, including after a timeout or error, and never stops a session … it did not start."
  - Today the tests run as an Atelier work-queue job (`execute.ts:971`, `POST work`), in a worker process the suite does not control. The monitor must therefore be started and stopped by separate client calls.
- **The clash.** Each option breaks one rule:
  - **(a) Stop the monitor at budget expiry.** AD-27 holds. But coverage of the still-running job is silently cut short, and AD-16's "partial results labelled as partial" cannot be honoured for coverage.
  - **(b) Leave the monitor running.** AD-27 is broken, and nothing owns the later release.
  - **(c) Cancel through `iris_test_status`.** The Atelier job is deleted and nothing stops the monitor.
  - **(d) The client crashes.** The leaked suite monitor makes every later coverage run refuse (the AD-27 busy check). No tool may stop the monitor (AD-27 "never stops a session it did not start"). The result is a permanent lockout on a shared instance until someone acts manually in `%SYS`.
- **Proposed Rule (AD-27, with a pointer from AD-16):**
  - A monitor's lifetime is owned by one IRIS-side job. That job starts the monitor, runs the work and stops the monitor in its own `finally`.
  - A client wait budget, a poll or a cancel never starts or stops the monitor directly. A cancel only signals the job.
  - The suite records its session's owner (job id and start time) durably. A later run may reclaim a suite-owned session once the owning job is dead.
  - Coverage therefore cannot use an execution path whose job the suite does not control, which forces 40.1.2's decision.

---

## High

### H1 — `dataPolicy` on the `default` profile entry becomes everyone's policy

- **Pair:** Story 39.2 (a per-profile `dataPolicy` from the `IRIS_PROFILES` entry, plus an operator default variable) against the existing profile merge:
  - `packages/shared/src/profiles.ts:362-375` inherits operator controls from the default configuration;
  - `profiles.ts:458-465` lets an `IRIS_PROFILES` `"default"` entry override the default derived from the environment, and every named profile merges over that default.
- **Why both comply:** AD-9 says "A profile inherits omitted fields from `default`." AD-26 says the policy "follows AD-6's source precedence" (profile layer, then global layer, then the default seed).
- **The clash:**
  - **Implementation A** follows the AD-9 pattern, as `sqlMaxRows` does. It stores `dataPolicy` on the default configuration and inherits it. With `IRIS_PROFILES={"default":{"dataPolicy":"allow"},"prod":{…}}`, `prod` gets `allow` at its *profile* layer, which beats a global `redact`.
  - **Implementation B** follows the AD-6 pattern and gives `prod` the global `redact`.
  - `iris_server_profiles` reports whichever one the developer chose. A developer's permissive local default then silently loosens the PHI policy on every other instance.
- **Proposed Rule (AD-9 and AD-26):**
  - A safety control (`dataPolicy`, SQL read-only mode, SQL caps) is never inherited from the `default` profile *entry*.
  - An omitted per-profile value falls to the global operator variable, then to the safe default.
  - The `default` entry's value applies to `default` only.

### H2 — New keys reopen capabilities the operator explicitly disabled

- **Pair 1:** Story 38.4 (`iris_doc_edit:apply`, a `defaultEnabled` write) against an operator configuration written for today's suite: `IRIS_GOVERNANCE={"iris_doc_put":false,"iris_doc_load":false}`.
- **Pair 2:** Story 38.5 (`iris_sql_query`, a read that is enabled by default) against `{"iris_sql_execute":false}`. This is exactly the restriction that AD-26's residual-exposure bullet tells operators to apply ("which operators restrict through governance").
- **Why both comply:** AD-4 seeds the new keys. AD-6's cascade resolves each key independently.
- **The clash:** After the upgrade, the operator's explicit denial is still in place, yet:
  - the agent rewrites documents (replacing lines 1 to N is a full put);
  - the agent runs SQL reads over PHI tables.

  AD-15's "byte-identical" check holds key by key, so it misses this.
- **Proposed Rule (AD-4 and AD-6):**
  - A new key that re-exposes an existing key's capability declares that key as its *parent*.
  - When the parent is explicitly disabled at any layer, the child's seed is disabled too. Explicit child settings still win.
  - The CHANGELOG names the relation.

### H3 — `iris_sql_query` is read-classified but can write through a SQL function

- **Pair:** Story 38.5's `iris_sql_query` (read, available under the `read-only` preset) against AD-6 ("The `read-only` preset blocks every write").
- **Why both comply:** AD-25 classifies by statement type. `SELECT Pkg.Fn(…)`, a SqlProc function, or a view over a class query all classify as SELECT.
- **The clash:** The ObjectScript behind such a function can `SET` globals, call `%Save` or `JOB` a process. The suite then advertises a read-only mode in which the agent can mutate data.
- **Proposed Rule (AD-25):**
  - `iris_sql_query`, and the read-only mode of `iris_sql_execute`, execute inside a transaction that is always rolled back, in the same IRIS call that classifies the statement.
  - The remaining non-transactional effects (unjournaled and IRISTEMP globals, `$INCREMENT`, `JOB`, external calls) are listed in the tool description.
  - The preset documentation says "statement-level read-only, not side-effect-free".

### H4 — `rowCount` already means something else

- **Pair:** AC 38.5.4 ("Every DML result returns `rowCount` (`%ROWCOUNT`), an additive field"; `countOnly` returns "a query's row count") against existing `packages/iris-dev-mcp/src/tools/sql.ts:112-118`, which returns `rowCount: rows.length`, the number of rows *returned* after `maxRows` and the operator clamp.
- **The clash:**
  - One field now has three meanings: rows returned (today), rows affected (DML) and total matching rows (`countOnly`).
  - Today a DML result has `rowCount: 0`. Under 38.5.4 it becomes N unconditionally. That contradicts AC 38.5.5's byte-identical pin, and AD-15 does not say which AC wins, because 38.5.4 calls the change "additive".
  - An agent reading `rowCount` across `iris_sql_execute` and `iris_sql_query` gets different quantities.
- **Proposed Rule (Conventions, Tool results):**
  - A result field name keeps one meaning across every tool. A new meaning takes a new name, such as `rowsAffected` or `totalCount`.
  - A story that claims a field is "additive" proves the name is absent from today's output.

### H5 — Read and edit share no version token, so conflict detection is undefined

- **Pairs:**
  - Story 38.2 (ranged read) against Story 38.4 (edit).
  - Story 38.4 against existing `iris_doc_put` (`doc.ts:212-221`), which sends a PUT with no `If-None-Match` header.
- **Why both comply:** AD-24 requires only "never sends `ignoreConflict`", and claims to prevent "edits that overwrite unseen changes".
- **The clash:**
  - Atelier's PUT conflict check compares an `If-None-Match` ETag (or timestamp) from an earlier read with the server's copy (Atelier REST reference, GSCF_ref).
  - Story 38.4 can satisfy AD-24 by sending neither the flag nor the header. What Atelier does when the header is missing then decides the outcome (*probe*):
    - if it skips the check, there is a lost-update window;
    - if it always returns 409, the tool can never update an existing document.
  - AC 38.2.3's ranged-read `structuredContent` (`name`, `startLine`, `endLine`, `totalLines`, the lines) drops `ts`. An agent's two-call flow therefore has no version token at all.
- **Proposed Rule (AD-24):**
  - Ranged reads and edits share a version token. Every ranged read returns the document's `ts` or ETag.
  - The PUT in `iris_doc_edit` sends, as `If-None-Match`, the ETag of the GET its `expected` check ran against.
  - A 409 is reported as a conflict and never retried.
  - 38.2's probe records Atelier's behaviour when the header is missing.

### H6 — Body-filter identifiers are validated in TypeScript and interpolated in IRIS

- **Pair:** Stories 39.3 (filter `[{property, op, value}]`) and 39.4 (search-table property) against AD-12 ("A handler validates input … thresholds, verdicts and advisory heuristics live in TypeScript").
- **Why both comply:** AD-26 requires filters "validated against the class dictionary and `Ens.Config.SearchTableProp` and always passed as parameters". It does not say where the validation runs. Property names and operators *cannot* be SQL parameters, so they must be interpolated into the statement.
- **The clash:**
  - A developer following AD-12 validates in TypeScript (through a dictionary query) and sends the validated names to a thin handler that concatenates them into the SQL.
  - The Rule #26 smoke over direct REST then injects through the property slot, for example `Name) OR 1=1 --`.
- **Proposed Rule (AD-26):**
  - Identifier and operator validation runs IRIS-side, in the same handler that builds the statement.
  - Properties resolve against the compiled dictionary to their `SqlFieldName` and are emitted as delimited identifiers. Operators map from a closed enum.
  - TypeScript validation is advisory only.
  - The 39.3.3 fuzz drives the REST route directly.

### H7 — PHI reaches the audit log through two channels the spine does not cover

- **Pair:** AC 39.2.5 against:
  - `packages/shared/src/audit.ts:29-31`, where redaction is keyed on a regex of key names;
  - `server-base.ts:1659-1662` and `1745-1752`, where the audit `error` field is the first text block of *any* `isError` result, recorded whatever the value of `IRIS_AUDIT_LOG_PARAMS`.
- **Why both comply:** AD-19's assumption covers only "captured parameters".
- **The clash:**
  - **Name-keyed redaction.** A 39.2 developer adds `value` and `filters` to the name regex. That also redacts `iris_global_set`'s `value` and other tools' arguments, and still misses whatever parameter name 39.4 picks, such as `searchValue`.
  - **The `error` field.** Refusals in 39.3 and 39.4 that follow the Error-text convention (`<what happened>`) echo the offending value, as in "no match for PID-3 '12345'". That text lands verbatim in the audit `error` field. A per-body error in 39.5 can echo body text the same way.
- **Proposed Rule (AD-19):**
  - PHI-bearing inputs are declared on the `ToolDefinition` with a schema-level marker. Audit redacts by that declaration, taking the profile's policy into account.
  - A `dataPolicy`-governed tool's error text never echoes a caller value or body content, and its audit `error` field is written from that value-free text.

### H8 — Coverage results of a long run are unreachable in `core`

- **Pair:** Stories 40.1 and 40.2 against:
  - `packages/iris-dev-mcp/src/tools/presets.ts`, where dev `core` includes `iris_execute_tests` (line 42) and excludes `iris_test_status` (line 62);
  - AD-16 (re-attach happens on the companion);
  - AD-7 ("no story … changes another tool's preset rows").
- **The clash:**
  - A long coverage run returns `running`. The coverage summary, the Cobertura file (40.2.3) and the `minCoverage` verdict (40.2.4) then have to come from the companion.
  - The companion is hidden in `core`, and AD-7 forbids a story from moving it.
  - Today's fallback for test results is the `iris_global_get` / `iris_sql_execute` hint (`execute.ts:387-404`). Monitor data has no such fallback.
  - If the companion writes the Cobertura file, a read-classified tool writes a local file to a path it never received.
- **Proposed Rule (AD-16):**
  - Every result a completed run returns can be reproduced from the durable handles alone, by the companion.
  - When a primary's `running` result can be resolved only through its companion, the two are declared in `TOOL_PAIRS`. That needs a Lead decision if it moves a `core` row.
  - Local file output from the companion takes an explicit `outputPath` and follows the local-path convention.

### H9 — A build-output pack cannot be consumed by a git-sourced plugin

- **Pair:** Story 41.1 (one assembled pack, shipped by default inside `@iris-mcp/client-config`, whose manifest has `"files": ["dist"]`) against Story 42.8 (`.claude-plugin/plugin.json` and `marketplace.json` in this repo).
- **The clash:**
  - A git-sourced marketplace clones the repo, so the plugin carries only what is committed.
  - The assembled pack is a build output inside a tarball.
  - The repo's `skills/` folder holds only the generated workflow skills and `README.md`. If the plugin root is the repo root, that is the plugin's default skills folder.
  - So either the plugin ships a different skill set, with no knowledge skills and no notice, or 42.8 commits a second copy, which gives the content two owners.
  - AD-28's "One assembled pack is consumed by both the installer and the plugin" cannot be honoured as written.
- **Proposed Rule (AD-28):** Story 41.1 picks one of these two options and records it:
  - **A committed pack.** The assembled pack is a committed, generated, DO-NOT-EDIT directory with a `--check` drift test, at a path the plugin manifest names explicitly. The client-config tarball copies that same directory at pack time.
  - **An npm source.** The marketplace sources the plugin from the npm tarball.

### H10 — The bootstrap version marker is undefined at three points

- **Pair:** Story 42.2 ("a monotonic sequence plus the hash") against:
  - Story 42.4 (the module version equals the npm version, and IPM ships the stamped content);
  - Story 42.5 (tag, then publish);
  - the development loop: `Setup.cls:27` holds the `"dev"` placeholder, and `scripts/gen-bootstrap.mjs:54-59` and `85-90` compute the hash.
- **What is unspecified:**
  - **The sequence source:** a committed counter bumped by `gen:bootstrap`, the npm version, or a timestamp.
  - **Equal sequence with a different hash:** two branches can each bump N to N+1.
  - **How `"dev"` compares.**
- **The clash:**
  - Story 42.2 picks a counter, while Story 42.4 stamps the npm version. The Setup class that IPM installs then reports a marker the TypeScript guard cannot order.
  - Today's `ipm/module.xml:9` uses `SourcesRoot src`, so IPM loads the `"dev"` placeholder.
  - Depending on the story, the guard treats `"dev"` as older or as unknown:
    - **as older:** it overwrites a developer's `iris_doc_load` deployment on the shared instance;
    - **as unknown:** it never upgrades.
- **Proposed Rule (AD-14):**
  - The marker is `<semver of @iris-mcp/shared>+<content hash>`, stamped at generation.
  - Ordering is by semver. An equal semver with a different hash, and `"dev"`, both count as *foreign*: no redeploy, and a warning naming both markers.
  - IPM archives are built from the generator's stamped output, never from `src/`.

### H11 — Two owners of the deployed classes, and IPM downgrades bypass the guard

- **Pair:** Story 42.4's IPM install against bootstrap (AD-14) and Story 42.2's guard:
  - `ipm/module.xml:33-34` invokes `Configure` and `ConfigureMapping`;
  - `ConfigureMapping` maps the package to `%All` instance-wide (`Setup.cls:123`);
  - the 42.2 guard lives only in TypeScript, in `probeCustomRest` (`bootstrap.ts:140-177`).
- **Why both comply:** AD-14's assumption says "The bootstrap comparison then treats an IPM-installed and a bootstrap-installed deployment identically."
- **The clash:**
  - A `@1` client with a newer embed overwrites the IPM-managed classes, instance-wide through `%All`. IPM's registry still records the old version.
  - `zpm "install"` of an older module version downgrades the classes with no guard at all, because no TypeScript runs on that path.
- **Proposed Rule (AD-14):**
  - Each deployment has one owner.
  - When IPM installed the classes (detectable from the module registry or a marker field), bootstrap never redeploys. It reports the mismatch and the `zpm` command to run.
  - The IPM install and upgrade path runs the same monotonic check IRIS-side and refuses a downgrade.

### H12 — No REST wire-compatibility rule, although the guard keeps newer classes under older clients

- **Pair:** Story 42.2 (a newer deployment is kept) against AD-29's `@1` pin (clients float to the newest 1.x) and against every later story that changes a handler.
- **The clash:**
  - On a shared instance, clients at 1.3 and 1.5 coexist, and after 42.2 the 1.3 client runs against 1.5 handlers by design.
  - AD-15 governs the MCP surface, but nothing governs the REST contract between the TypeScript servers and the IRIS-side handlers.
  - Within this wave, Story 39.1.2 refactors a shared helper and Story 38.5 may add an endpoint. A 1.x story that renames a REST field, or tightens a route's validation, silently breaks older clients.
- **Proposed Rule (AD-11 and AD-15):**
  - Within a major version, custom REST routes are additive-only. An existing route keeps accepting every older request shape and returns a superset of its older response. A pin proves this for each changed route.
  - A non-additive handler change requires a new major version.

### H13 — The extension spawns the engine CLIs unpinned, and the launch spec has two owners

- **Pair:** AC 42.1.6, which names only `synthesize.ts:126` and `serverDefinitionProvider.ts`, against two other places in the extension:
  - `extensions/iris-mcp-launcher/src/clientsEngine.ts:25` runs `npx -y -p @iris-mcp/client-config iris-mcp-clients`;
  - `governanceEngine.ts:62` and `141-155` run `-p @iris-mcp/shared` together with server packages derived from `PACKAGE_NPM_NAME` (`definitions.ts:8-14`).
- **Why both comply:** AD-29's "Clients launch `npx -y @iris-mcp/<pkg>@1`" covers only the servers.
- **The clash:**
  - **Implementation A** appends `@1` in the provider only. The governance universe is then computed from the `@latest` servers and the `@latest` shared package.
  - **Implementation B** puts `@1` into `PACKAGE_NPM_NAME`. The servers are pinned but the shared CLI is not, so the majors mix at 2.0.
  - Either way, from 2.0 on, the MCP Clients view runs a 2.x client-config that writes `@2` entries.
  - `PKG_BY_SERVER` (`synthesize.ts:36-42`) and `PACKAGE_NPM_NAME` are two owners of one launch spec, so they drift.
- **Proposed Rule (AD-29):**
  - Every `npx` spec the suite emits, spawns or documents (servers, the client-config CLI, the governance CLI) carries the pinned major, taken from one exported constant.
  - A test searches the extension, client-config and the docs for an unpinned `@iris-mcp/` spec.

---

## Medium

### M1 — Line text has no canonical form (38.2 × 38.4)

- **Gap:** AD-24 fixes how lines are *numbered*, but not the *text* of a line. Undefined points:
  - which separator joins a multi-line `expected` or `text`;
  - whether `\r` inside `expected` or `text` is stripped;
  - how a BOM on line 1 is handled;
  - the numbered-line text format (AC 38.2.3 says "one documented format", and AC 38.4.5's "renumbered excerpt" may use another);
  - whether ranges apply to `format: "xml"` reads or to `enc: true` (base64) documents.
- **The clash:** A 38.2 developer prefixes `12→`, while a 38.4 developer compares `expected` byte-exact against lines joined with `\r\n`. Every edit copied from a read is then refused with `STALE_CONTENT`.
- **Proposed Rule (AD-24):** One `@iris-mcp/shared` line utility owns numbering, splitting (`/\r?\n/`), joining (`\n`), BOM handling and the single numbered-text format. Reads, `expected`/`text` parsing and edit excerpts all go through it. Ranges are defined only on UDL text documents.

### M2 — The response after an edit is computed locally (38.4 × Atelier class rendering)

- **Gap:** For a `.cls`, the UDL that `GET /doc` returns is re-rendered from the class definition (*probe* in AC 38.2.1). A developer can build the AC 38.4.5 diff, excerpt and `totalLines` from the array they applied locally.
- **The clash:** The server's re-rendering then differs from that array, for example in blank lines between members or in keyword order. The agent's next edit uses excerpt line numbers that are wrong.
- **Proposed Rule (AD-24):** The response after an edit is computed from a re-read of the document after the PUT, never from the locally applied array.

### M3 — The storage override is open to every caller of a `defaultEnabled` write (38.3 × 38.4)

- **Gap:** S-3 justified `iris_doc_edit:apply` as a default-enabled write because it is guarded. Yet 38.4.4 re-exposes `allowStorageRegeneration: true` to every caller of that enabled tool, and an operator cannot disable the override without disabling the tool.
- **Proposed Rule (AD-4 or AD-24):** On a `defaultEnabled` write, a guard override is a separate, default-disabled write action, such as `iris_doc_edit:applyUnsafe`. It is not a parameter, and it is not a holder of the `defaultEnabled` marker.

### M4 — Document-writing paths with no owner (AD-24)

- **Gap:** "Any other document-writing path adopts the guard or records its exclusion" names no owner. Two paths exist today that are neither guarded nor recorded:
  - `iris_doc_xml_export` action `import` (`format.ts:218`, `action/xml/load`);
  - the bootstrap PUT (`bootstrap.ts:252`, `ignoreConflict=1`).

  Story 38.3.6 records only `iris_doc_load` and `iris_env_promote`.
- **Proposed Rule (AD-24):** Story 38.3 enumerates every PUT and `xml/load` path in the codebase, exhaustive as of a named date (Rule #56). It gives each a verdict, and a grep test fails on a new unclassified path.

### M5 — SQL classification and execution can be split, with two serializers (38.5)

- **Gap:** AD-12 lists only "the AD-25 caps" as atomic IRIS-side checks.
- **The clash:**
  - A developer can classify statements through a custom prepare call, then execute through Atelier's `action/query` (`sql.ts:71`). The two run in different contexts (default schema, `#import`, select mode).
  - When the rows-affected cap is on, DML must go through a custom transactional endpoint. So whether a control is on decides which serializer formats the result (dates, nulls, lists, streams).
  - An operator who sets `IRIS_SQL_READ_ONLY` silently changes the value formats for every agent.
- **Proposed Rule (AD-25):**
  - Classification and execution happen on the same prepared statement, in one IRIS call.
  - All SQL tools share one result serializer and select mode. That serializer is pinned against `action/query` output on a fixture containing dates, nulls, `%List` values and streams.

### M6 — The shared header-search helper mixes two cap semantics (39.1.2 × `resendFiltered`)

- **Gap:** The two callers have different rules:
  - `resendFiltered` requires an item, a window of at most 7 days, and refuses a match count over 500 rather than truncating it (`message-resend.ts:259-265` and `321`);
  - the search, per the Epic 39 constraints, needs only a window and pages its output under a cap.

  If the extracted helper keeps resend's rules, search cannot page. If it relaxes them, resend's IRIS-side guards move or vanish, and the byte-identical pin may not exercise the refusal paths.
- **Proposed Rule (AD-17 and AD-20):** The shared helper owns only the translation from filters to a query. Required filters, windows, caps and the choice between refuse and truncate stay with each caller. Before and after the extraction, a refusal test over direct REST pins resend's own guards.

### M7 — `mode` versus `action` for `iris_message_search` (39.1 × 39.3 / 39.4)

- **Gap:** AD-4 asks for an `action` enum only for *mutating* operations, so read variants may be either an `action` or a `mode` parameter. `iris_sql_analyze` and `iris_test_status:poll` already use `action`. The epic says `mode`.
- **The clash:**
  - With `mode`, body and Search Table searches cannot be governed separately from header search; the only lever is `dataPolicy=block`, which also blocks `iris_message_body`.
  - The audit `action` (`deriveAuditAction`) is empty, so PHI-revealing searches cannot be told apart from header searches in the audit log.
  - If 39.3 converts `mode` into `action` after 39.1, the key changes in the middle of the epic.
- **Proposed Rule (AD-4):** A discriminator that changes the class of data a tool reads (header versus body-derived) is an `action` with its own key. It is fixed in the tool's first story.

### M8 — Policy outcomes "in the outcome field" versus additive-only audit fields (39.2.5 × AD-19)

- **Gap:**
  - `AuditOutcome` is the closed union `"ok" | "error" | "denied"` (`audit.ts:131`).
  - `deriveAuditOutcome` (`server-base.ts:1736-1743`) keys `denied` on `GOVERNANCE_DISABLED` only.
  - AC 39.2.5 puts the redacted and blocked outcomes "in the outcome field … without changing existing fields", while AD-19 says new entry fields are additive.
  - Story 39.5 has one outcome per body, which cannot fit a scalar field.
  - A refusal under `block` could be logged as `denied` or as `error`, depending on the developer.
- **Proposed Rule (AD-19):** `outcome` keeps its closed domain. Policy effects go in a new additive field, for example `dataPolicy: {policy, redacted: n, blocked: n}`. A policy refusal is `error`, with a distinct code (see M9).

### M9 — No convention for machine-readable refusal codes

- **Gap:** Several refusals in this wave need a code an agent can branch on:
  - 38.3's "distinct error code";
  - 38.4's `STALE_CONTENT`;
  - 38.5's refusals for read-only mode and for the rows-affected cap;
  - 39.3's refusal under `block`;
  - 40.1's busy refusal.

  The 38.6.2 prompt and the capstones branch on these codes. The only existing precedent is `structuredContent.code = "GOVERNANCE_DISABLED"` (`server-base.ts:1449`), and the audit layer reads that field. Stories will put codes in the text prefix, in `structuredContent.code` or in `structuredContent.error.code`.
- **Proposed Rule (Conventions, Error text):** A refusal a caller may branch on carries `structuredContent.code` in UPPER_SNAKE_CASE, from one shared catalog in `@iris-mcp/shared` with a uniqueness test. The prose text still follows `<what happened>. <what to do>.`

### M10 — One message-header entity with three shapes

- **Gap:** Three tools return message headers:
  - The resend preview row (`MessageResend.cls:200-239`) returns `timeCreated` as a raw UTC string such as `2026-10-14 12:00:00`.
  - Story 39.1, fed by the *same* shared helper, must return ISO 8601 with a `…Raw` sibling (AC 39.1.3), so the same field name ends up in two formats.
  - `iris_production_messages` (`monitor.ts:157`, `Interop.cls:1276`) is a third shape for the same entity.
  - On input, `NormalizeTimestamp` (`MessageResend.cls:57-64`) strips `Z` and mishandles offsets, so an ISO value with an offset that an agent echoes back is misread.
- **Proposed Rule (Conventions, Tool results):** New interop surfaces adopt one header-row shape, with UTC ISO 8601 `Z` in and out. TypeScript normalizes offsets before calling IRIS. Existing shapes stay frozen and are documented.

### M11 — Body-derived text outside bodies has no owner (AD-26 scope)

- **Gap:** Two kinds of body-derived text sit outside the policy:
  - `iris_production_logs` event text, which routinely quotes HL7 field values (validation errors, `$$$TRACE`);
  - header `ErrorStatus` and `Description`.

  Neither is in AD-26's Binds nor in its residual-exposure list (generic SQL, global and document tools). So nobody owns them.
- **Proposed Rule (AD-26):** Story 39.2's scope record classifies every interop tool, exhaustive as of a named date, as governed, residual or not applicable. Body-derived text fields are governed wherever they surface.

### M12 — Coverage rides an enabled frozen write key (40.1.3 × AD-4)

- **Gap:** AD-4 says "a new operation goes on a companion tool", but 40.1.3 makes coverage an *option* on the frozen baseline key `iris_execute_tests`, which is enabled.
- **The clash:** The option adds an instance-wide side effect (the monitor) and a local file write (Cobertura) that operators cannot disable separately. That breaks AD-4's intent that new writes ship disabled.
- **Proposed Rule (AD-4):** A parameter that adds a new kind of side effect to an existing key, such as instance-wide state or a local file write, counts as a new operation. It goes on a governed companion key, or a Lead decision is recorded.

### M13 — The annotation must be truthful in 40.1, but the fix is sanctioned only in 40.4

- **Gap:** `iris_execute_tests` declares `readOnlyHint: true` (`execute.ts:1268-1271`). Story 40.1 adds a monitor to it. AD-4 requires truthful annotations, but AD-15's table sanctions the annotation correction only in Story 40.4. Story 40.1 must therefore violate one of the two ADs.
- **Proposed Rule (AD-15):** A sanctioned change may land in the earliest story whose change needs it. The table names the change, not the story.

### M14 — Plugin skills are out of version step with the npm servers (42.8 × AD-29)

- **Gap:** Marketplace plugins are fetched from a git ref, typically the head of `main`, while the servers come from npm `@1`.
- **The clash:** Skills that name a tool which has merged to `main` but is not yet published send the agent to a tool the running server lacks. `validate:prompts` checks against the repo's catalog, not the published one.
- **Proposed Rule (AD-28 and AD-29):** The marketplace entry pins the plugin to the release tag of the same version as the npm packages, and the release workflow moves it.

### M15 — Plugin and installer skills are duplicated in Claude Code (42.8 × 41.6)

- **Gap:** The plugin README sends users to the 41.6 installer for the always-on rule, but the installer's Claude Code route also installs every skill into `.claude/skills/`. The user then has two copies (`plugin:name` and `name`), from two versions, with identical descriptions.
- **Proposed Rule (AD-28):** The installer has a rules-only Claude Code route, and it detects the plugin and selects that route.

### M16 — Notice placement (41.6 × AD-28 × AD-30)

- **Gap:** "Written alongside every installed copy" does not fix a path. Two placements go wrong:
  - In `.claude/rules/` (every `.md` file loads) or `.cursor/rules/`, the MIT text loads into every session.
  - At the repo root, the notice collides with the user's own `THIRD_PARTY_NOTICES.md`, a common filename, which AD-30 says the installer must not touch.
- **Proposed Rule (AD-28 and AD-30):** The notice uses a suite-specific filename, such as `IRIS-MCP-THIRD-PARTY-NOTICES.md`, at a location no supported client auto-loads. The location is listed per route in the 41.6 table.

### M17 — The installer has no ownership record (41.2.2 × 41.6 × AD-30)

- **Gap:** AD-30's "update and uninstall only what it owns" needs a durable record of ownership. Without one, two cases fail:
  - A skill dropped from the pack, such as the retired `objectscript-review`, stays installed forever.
  - A skill the user edited after installation is either overwritten or treated as foreign.
- **Proposed Rule (AD-30):** The installer writes a per-target manifest of the paths and content hashes it installed. Update removes owned paths that are absent from the new pack. A file whose hash no longer matches is never overwritten without confirmation.

### M18 — An extension auto-update moves the pinned major (42.7 × AD-29)

- **Gap:** The extension is outside the `fixed` group (`.changeset/config.json`; package `iris-mcp-launcher`) and hardcodes the server pin. VS Code auto-updates extensions by default. When the extension moves to `@2`, every user silently crosses the breaking major, which AD-29 says it prevents.
- **Proposed Rule (AD-29):** The server major is persisted in user settings at first activation. An extension update never changes a persisted major without explicit user confirmation.

### M19 — Generated artifacts that embed the version versus the Changesets `version` step

- **Gap:** Several artifacts embed the npm version:
  - the IPM module version (42.4.1);
  - possibly the bootstrap marker (H10).

  Changesets bumps `package.json` without running the generators (the root `package.json` has no `version` script).
- **The clash:** The tagged commit then fails the drift tests, or it ships stale versions in `module.xml`.
- **Proposed Rule (AD-14 and AD-29):** A root `version` script, run by the Changesets version step, regenerates every artifact that embeds the version. The tag commit passes `:check` for all of them.

---

## Low

- **L1 — Concurrent bootstrap.** Two clients of different versions can probe "older" on the same instance at the same time and interleave PUTs and compiles, leaving a mixed class set. The marker is read before deployment, not re-checked under a lock. **Proposed Rule (AD-14):** Deployment re-checks the marker immediately before it compiles `Setup`, and reports a lost race instead of compiling.
- **L2 — Versioned listings.** AC 42.5.3's channels (npm, then the extension, then IPM) leave out three listings that each carry a version:
  - the MCP Registry `server.json`;
  - the plugin marketplace;
  - Open Exchange.

  These go stale at 1.0.1. **Proposed Rule (AD-29):** Every listing that carries a version is a release-workflow step or is declared version-less.
- **L3 — Skills naming hidden tools.** Skills and prompts can name tools that the preset the docs recommend hides. For example, `iris_test_status` is hidden in dev `core`. `validate:prompts` checks only that the tool exists. **Proposed Rule (AD-28):** Each skill declares the preset it needs, and the validator checks visibility under that preset.
- **L4 — Internal rule numbers in workflow skills.** Generated workflow skills already carry internal rule numbers: `skills/deploy-and-test-class/SKILL.md` says "Rule #17", in two places. AC 41.2.1 and AC 41.3.3 forbid these only for the rule and the knowledge skills. **Proposed Rule (AD-28):** The no-internal-references rule covers all agent content, prompts included, and the check is mechanical.
- **L5 — Coverage oracle on a shared instance.** An instance-wide LineByLine session counts executions of the selected routines by other processes. Expected values captured on the shared instance (Rule #36) can therefore be polluted. **Proposed Rule (AD-27):** Coverage oracles are captured in a disposable namespace with routines nobody else runs, or the monitor is scoped to the job's own processes.

---

## Seams checked and found closed

The following were attacked and are closed by an existing AD Rule, so they are not reported as holes:

- **`iris_doc_edit` under `read-only`.** AD-6 says "blocks every write, including … `defaultEnabled` writes".
- **The `iris_doc_edit` key shape.** AD-4 requires `tool:action` for the marker, and Story 38.4 is amended to match.
- **The line-numbering origin** (a 1-based index into the `GET /doc` content array) is closed by AD-24. Only the text form is open (M1).
- **One storage guard function for put and edit** is closed by AD-24. Only ownership of the other paths is open (M4).
- **A caller loosening operator SQL caps on `iris_sql_query`** is closed by AD-9 and AD-25. Inheritance of safety controls from the `default` profile is open (H1).
- **Body search under `block`** is consistent with AD-26 (AC 39.3.2).
- **`TOOL_PAIRS` for search and body** is consistent with AD-7 and the Epic 39 constraints.
- **No `action` enum on `iris_execute_tests`** is closed by AD-4. Whether coverage counts as an option or a new operation is open (M12).
- **Transport rejection timing** is closed by AD-23 and AD-8.
- **Secrets only in `release.yml`, and no publish before 42.2** are closed by AD-29. The definition of the version marker is open (H10).
