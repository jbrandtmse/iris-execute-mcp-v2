# Epic 38 Context: Agent Code Editing & Write Safety

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make agent writes to IRIS safe and minimal. An agent reads a document by line range, changes only the lines it means to change under an expected-text check, and can never silently drop a class's Storage block. Operators can confine SQL to read-only statements or cap the rows a write affects. A new read-classified query tool keeps SQL usable under the `read-only` preset; today `iris_sql_execute` is a frozen-baseline write, so that preset blocks even SELECTs. The suite also stops accepting a transport it cannot run. This closes the competitor's editing gaps while keeping this suite's stricter conflict and governance guarantees. The architecture spine (AD-1..AD-34) binds every story. Where a story's text disagrees with the spine, the spine wins and the story is amended in place.

## Stories

- Story 38.0: Epic 37 Deferred Cleanup
- Story 38.1: Reject the Unimplemented HTTP Transport
- Story 38.2: Line-Range Document Read
- Story 38.3: Storage Block Drop Guard
- Story 38.4: Surgical Line Edit Tool
- Story 38.5: SQL Write Safety
- Story 38.6: Editing and SQL Safety Docs, Prompt and Capstone

## Requirements & Constraints

- **Wave rules.**
  - Probe API and reuse claims live before coding, and amend the story text in place when a claim is wrong.
  - Every new tool or action carries `mutates` and an include/exclude in every preset.
  - A changed bootstrapped class regenerates the embed in the same story and records `BOOTSTRAP_VERSION` from → to (now `3af8ca401e7c`). A new class joins both rosters.
  - `GOVERNANCE_BASELINE` stays frozen at `1e62c5ad5bf7`/141 and is checked with `:check` only.
  - Endpoint-backed stories smoke the live route, including one destructive refusal. Every gate is proven red on the path it guards, and the story names that path.
- **Shared IRIS instance.**
  - Never stopped.
  - Writes go only to disposable `ExecuteMCPv2.Temp.*` classes and tables, removed before and after. Fixtures are synthetic.
  - Live runs name their target with the six `IRIS_*` variables (`default`: localhost:52773, HSCUSTOM, IRIS 2026.2 build 221U, Atelier v8). The code default namespace is now `USER`.
  - Record the earliest IRIS version each API was verified on.
- **Back-compat.**
  - With the feature unused, requests and responses are byte-identical, pinned with `toEqual` against pre-feature output.
  - This epic's sanctioned behavior changes are transport rejection and the storage-drop refusal. Both have shipped. DW-540 (existing-document save) shipped under "Fixed".
  - A new output field is proven absent today, and a name keeps one meaning. `rowCount` stays "rows returned". The new names are `rowsAffected` (DML `%ROWCOUNT`) and `totalCount` (`countOnly`).
- **SQL controls (38.5).**
  - Read-only mode: a `readOnly` parameter, and an operator variable `IRIS_SQL_READ_ONLY` that forces the mode and that a parameter cannot weaken. A non-query statement is refused before execution, and the refusal names its statement type.
  - Rows-affected cap: a `maxRowsAffected` parameter and an operator ceiling `IRIS_SQL_MAX_ROWS_AFFECTED`. The refusal reports the row count and the cap.
  - All new controls are off by default, and the defaults are sent and stated explicitly.
  - A parameter can tighten an operator control but never loosen it. A clamp is noted in the response (the precedent is `rowsCapped`).
  - Safety controls are never inherited from the `default` profile entry. The order is the per-profile value, then the global variable, then the safe default.
  - New variables are documented with their defaults in the same story.
- **`iris_sql_query` (38.5).**
  - `mutates: "read"`, so it is enabled by default and available under `read-only` (a test proves it).
  - Read-only is enforced server-side, with the same classification as `readOnly`.
  - `IRIS_SQL_MAX_ROWS`, `IRIS_SQL_TIMEOUT` and `IRIS_SQL_READ_ONLY` apply to it exactly as to `iris_sql_execute`.
  - `parent: "iris_sql_execute"`. It joins `developer` and `core`.
  - The docs call the mode "statement-level read-only, not side-effect-free". The description lists the residual non-transactional effects (globals set by SQL functions, `JOB`, `$INCREMENT`).
- **Counts.**
  - Dev: 30 tools today (31 advertised), and the suite is 106/111. `iris_sql_query` takes dev to 31.
  - Dev `core`: 13 package / 14 runtime today, 15 runtime after 38.5. L-4 makes this a guideline, not a limit. The story records the resulting size and why the tool is everyday-loop.
  - No existing `core` tool is removed, and no other tool's preset row changes.
- **Docs and release.**
  - Each story ships minimal docs with default states: the README tool table and `tool_support.md`.
  - It also adds a CHANGELOG top section `## [Pre-release — <date>] — Story X.Y: ...` and a `.changeset/story-38-N-*.md` (`patch`/`minor` only).
  - Re-measure the payload table with `pnpm measure:tools-payload`.
  - No `changeset version`, no publish and no CI wiring.
- **Out of scope.**
  - Streamable HTTP (DW-538), server-side source control, compile-by-wildcard and inline multi-document fetch.
  - A Storage guard on `iris_doc_load`, the promote sync and the XML import (DW-544, DW-545 and DW-546).

## Technical Decisions

- **Keys and classification.**
  - Frozen-baseline tools (`iris_doc_put`, `iris_sql_execute`) never gain an `action` enum or an annotation change. A new operation goes on a companion tool, or on a parameter that adds no new kind of side effect.
  - The `defaultEnabled` holders are a closed list: `iris_production_control:clean` and `iris_doc_edit:apply`. `iris-mcp-all` `default-enabled-holders.test.ts` pins that list and the parent declarations; 38.5 adds `iris_sql_query: "iris_sql_execute"` there.
  - New tools declare all four annotations truthfully and never copy grandfathered hints.
- **Parent mechanism (shipped in 38.4; reuse unchanged).**
  - `parent` is declared per tool. `buildParentKeys` validates it at construction: the parent is a known key, not the tool's own key, and not itself a child, and the declaring tool owns no baseline key.
  - Only a disable is inherited. If the parent's first explicit layer (env profile, env global, file profile, file global) sets it `false`, the child seeds disabled. That seed sits below every explicit child layer and above the preset.
  - Reporting: `configSource: "parent"`; the denial carries `inheritedFrom` and the suffix ` (inherited from '<parent>')`, with no `presetApplied`. `iris_server_profiles`, the governance resource and CLI `universe` all read the same engine.
  - The `read-only` preset blocks every write, `defaultEnabled` included. Explicit keys beat it, and a preset-caused denial carries `presetApplied`.
- **`IRIS_GOVERNANCE` shape.** Use `{"global":{...}}` or `{"<profile>":{...}}`. A flat `{"key":false}` is silently ignored today (DW-554, high, owned by the burn-down), so tests and smokes must use the documented shape.
- **Refusals.**
  - A refusal is `isError: true` and changes nothing. `structuredContent.code` comes from the one catalog in `@iris-mcp/shared` `refusals.ts` (`GOVERNANCE_DISABLED`, `STORAGE_DROPPED`, `DOCUMENT_CONFLICT`, `STALE_CONTENT`), with the fields a caller needs to act.
  - New SQL refusal codes go in that file. A test pins the key list, and code literals appear only in `refusals.ts`.
  - Argument and range errors carry no code.
  - Error text has the form `<what happened>. <what to do about it>.`
- **SQL (38.5).**
  - Classify by the `%SQL.Statement` statement type. Compare it with a keyword blocklist on adversarial fixtures: comments, literals containing keywords, CTEs, `CALL` and multi-statement input.
  - Classify and execute the same prepared statement, in one IRIS call.
  - Read paths (`iris_sql_query` and `readOnly` mode) run inside a transaction that is always rolled back.
  - Rows-affected caps are enforced transactionally inside IRIS before commit, with TypeScript passing the limit in. This is a recorded thin-handler exception; other judgment stays in TypeScript.
  - The existing `IRIS_SQL_MAX_ROWS` and `IRIS_SQL_TIMEOUT` clamps stay.
  - All SQL tools share one serializer and select mode, pinned against `action/query` output on dates, nulls, `%List` values and streams.
  - Record whether `iris_sql_analyze` `explain`/`indexUsage` are in scope.
  - If a custom endpoint is needed, the bootstrap moves (regenerate the embed and update both rosters). The handler:
    - extends `REST.Base`;
    - saves and restores `$NAMESPACE`, never `New $NAMESPACE`;
    - renders one envelope;
    - sends errors through `SanitizeError`.

    Routes stay additive within the major (older request shapes accepted, superset responses), with a pin.
- **Documents (shipped).**
  - One line utility, `@iris-mcp/shared` `lines.ts`, owns:
    - numbering: line N is element N-1 of the Atelier `GET /doc` `content` array, after one BOM is stripped;
    - `splitLines`, `joinLines` and `textToLines` (which drops one trailing line break; `""` is one empty line);
    - `formatNumberedLines` (`cat -n` layout);
    - `unifiedDiff` (`diff -U3` conventions) and `alignLines`.
  - The version token is `ts`. Atelier saves an existing document only when `If-None-Match` equals it; otherwise it answers 409 with the current document and its `ts`.
  - A 409 on a version-checked save is `DOCUMENT_CONFLICT` and is never retried. Agent edits never send `ignoreConflict`.
  - IRIS regenerates class UDL on save (blank lines between members, a trailing `""`), while routines are stored as sent. Edit output therefore comes from a re-read.
  - One Storage guard (`storage-guard.ts`) covers `iris_doc_put` (override `allowStorageRegeneration`) and `iris_doc_edit` (override: the default-disabled `regenerateStorage` action). `document-write-paths.test.ts` pins a verdict for every write path.
- **Conventions.**
  - Handlers use only `ToolContext`, never environment variables.
  - Descriptions lead with what the tool does, when to use it and what it returns, then the default state of a governed write and the operator controls. They never name REST paths. `structuredContent` goes beside `content`.
  - Live gates:
    - each carries its own `process.env.IRIS_REQUIRE_LIVE ===` comparison and is listed in its package's `scripts/prepublish-gate.mjs` `gateTestFiles` (`live-gate-roster.test.ts` enforces this);
    - cross-package gates live in `iris-mcp-all` and reuse `process-gate-helpers.ts` and `live-doc-helpers.ts`;
    - a gate's emptiness checks cover only its own fixture stems, because turbo runs package suites concurrently.

## Cross-Story Dependencies

- **Delivered (38.0–38.4).**
  - 38.0: `stripLeadingBom` and `atelierDocStatusError`; `IRIS_NAMESPACE` now defaults to `USER`; bootstrap `2159ec9e6f69` → `3af8ca401e7c`.
  - 38.1: `resolveTransport()` accepts stdio only and exits 1 before any IRIS traffic. DW-538 files the real HTTP transport.
  - 38.2: `iris_doc_get` `startLine`/`endLine` return `{name, ts, startLine, endLine, totalLines, lines}`. The no-range path is frozen.
  - 38.3: the put Storage guard and the existing-document flow (a 409, then one `If-None-Match` retry). `metadataOnly` returns `{exists, name, etag}`.
  - 38.4: `iris_doc_edit` (`apply` enabled by default, `regenerateStorage` disabled, `parent: iris_doc_put`, paired with `iris_doc_get` in `TOOL_PAIRS`) and the parent mechanism.
- **38.5** reuses the parent mechanism with no engine change. One statement classification serves both `readOnly` and `iris_sql_query`.
- **38.6** depends on all of the above:
  - DW-552 first: append a trailing line break to `STALE_CONTENT` `mismatches[].current` and add one description line. A retry that passes `current` back as `expected` then works when the range ends in an empty line; the edit prompt depends on this.
  - A new edit-in-place MCP prompt: ranged read → `iris_doc_edit` with `expected` → `iris_doc_compile` → `iris_execute_tests` with a total-count check. Update `deploy-and-test-class`, then run `pnpm gen:skills`, `gen:skills:check` and `validate:prompts`.
  - One default-suite live capstone, listed in `gateTestFiles`. It covers a ranged read, an edit, the stale refusal, the storage-drop refusal, the read-only SQL refusal and the rows-affected refusal, and is proven red by reverting one guard.
  - Epic-close records: `:check`, the counts, `BOOTSTRAP_VERSION` and `check-epics-sync.mjs`.
  - Route the existing-tool annotation divergences to one owned ledger entry: `destructiveHint:false` on `iris_sql_execute`, `iris_execute_command` and `iris_doc_put`, and `readOnlyHint:true` on `iris_execute_tests`.
- **Owned elsewhere; don't fix incidentally.**
  - DW-542: a no-range soft error is reported as success.
  - DW-530: promote ignores `result.status`.
  - DW-528: `modifiedSince` gets HTTP 405.
  - DW-547 and DW-548: Storage scanner limits.
  - DW-549: `iris_doc_load` with `ignoreConflict: false` gets a 409 for every existing document.
  - DW-551: the Rule #53 wording.
  - DW-554: the flat governance shape is silently ignored.
  - Epic 43's confirmation helper later binds `iris_doc_edit:regenerateStorage`.
- **Build loop.**
  - Dev and `iris-mcp-all` import `@iris-mcp/shared` through `dist`, so rebuild shared before the dependent tests.
  - Default-suite process gates fail on a stale dist. After a byte-identical revert, `touch` a dist file.
  - Run per-package build and test when the parallel turbo run flakes.
