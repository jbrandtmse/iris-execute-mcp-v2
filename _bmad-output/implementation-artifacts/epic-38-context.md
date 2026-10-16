# Epic 38 Context: Agent Code Editing & Write Safety

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make agent writes to IRIS safe and minimal. An agent reads a document by line range, changes only the lines it means to change under an expected-text check, and can never silently drop a class's Storage block. Operators can confine SQL to read-only statements or cap the rows a write affects, and the read-classified `iris_sql_query` keeps querying possible under the `read-only` preset, which blocks the frozen-baseline write `iris_sql_execute`. The suite also stops accepting a transport it cannot run. Stories 38.0–38.5 have shipped all of this. The closing story enriches the docs, adds an edit-in-place prompt, fixes three routed ledger items and runs one live capstone over the whole surface. The architecture spine binds every story; where a story's text disagrees with the spine, the spine wins and the story is amended in place.

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
  - Probe API and reuse claims live before coding, and amend the story text when a claim is wrong.
  - Every new tool or action needs `mutates` and an include/exclude in every preset.
  - A changed bootstrapped class regenerates the embed in the same story and records `BOOTSTRAP_VERSION` from → to (now `d352a6a32158`).
  - `GOVERNANCE_BASELINE` stays frozen at `1e62c5ad5bf7`/141 and is checked with `:check` only.
  - Endpoint-backed work smokes the live route, including one destructive refusal. Every gate is proven red on the path it guards, and the story names that path.
- **Shared IRIS instance.**
  - It is never stopped.
  - Writes go only to disposable `ExecuteMCPv2.Temp.*` fixtures, which are removed before and after. Fixtures are synthetic.
  - Live runs name their target with the six `IRIS_*` variables. `default` is localhost:52773, HSCUSTOM, IRIS 2026.2 build 221U, Atelier v8. The code default namespace is `USER`.
- **Back-compat.**
  - With the features unused, every request and response is byte-identical, pinned with `toEqual`.
  - These sanctioned behavior changes have shipped and are in the CHANGELOG:
    - transport rejection;
    - the storage-drop refusal;
    - the DW-540 existing-document save;
    - the `iris_sql_execute` move to the custom SQL endpoint. Result shapes are unchanged; the request and the error wrapper changed, and error text keeps the SQLCODE and the IRIS message.
- **Docs (38.6 enriches; earlier stories shipped minimal docs).**
  - The root README, the dev README and `tool_support.md` state every new parameter, tool and variable with its default state:
    - `iris_doc_edit:apply` is a write that is enabled by default (S-3, because it is guarded). Document how to disable it and that it inherits a disable of `iris_doc_put`.
    - `regenerateStorage` is disabled by default.
    - `iris_sql_query` is a read, enabled by default, and runs under `read-only`.
    - `allowStorageRegeneration` defaults to false. The `readOnly`, `countOnly` and `maxRowsAffected` defaults are off.
  - `IRIS_SQL_READ_ONLY` (`true`/`false`, unset means off) and `IRIS_SQL_MAX_ROWS_AFFECTED` (a non-negative integer, unset means no cap, 0 is a valid cap) are global operator variables. Every profile inherits them, there is no per-profile key, and a malformed value fails startup.
  - 38.6 also owns the client-config guides (`docs/client-config/*`) and the launcher env-var docs, which 38.5 deferred to it.
  - The SQL mode is called "statement-level read-only, not side-effect-free". A rollback does not undo:
    - `$INCREMENT`/`$SEQUENCE` and row-ID counters;
    - process-private and IRISTEMP globals;
    - `JOB` and device output;
    - a function, procedure or trigger that opens or ends a transaction.
  - Add a CHANGELOG top section and a `.changeset/story-38-6-*.md` (`patch`/`minor` only). Re-measure the payload table with `pnpm measure:tools-payload` (after 38.5: dev full 83,996, core 43,170). No `changeset version`, no publish and no CI wiring.
- **Counts today.**
  - Dev has 31 package tools (32 advertised), and the suite has 107/112.
  - Dev `core` is 14 package / 15 runtime, a guideline figure (L-4).
  - Prompts carry no governance keys and change no tool count. No `core` row changes.
- **Out of scope.**
  - Streamable HTTP (DW-538), server-side source control, compile-by-wildcard and inline multi-document fetch.
  - Storage guards on `iris_doc_load`, the promote sync and the XML import (DW-544, DW-545 and DW-546, all terminal).

## Technical Decisions

- **Lines (AD-24).** One `@iris-mcp/shared` `lines.ts` owns:
  - numbering: line N is element N-1 of the Atelier `GET /doc` `content` array, after one BOM is stripped;
  - `splitLines`/`joinLines`, and `textToLines`, which drops one trailing line break and makes `""` one empty line;
  - the `cat -n` numbered format;
  - `unifiedDiff` (`diff -U3`).
- **Document versions.**
  - The version token is `ts`. An edit's PUT sends `If-None-Match: <ts>` and never `ignoreConflict`.
  - A 409 on a version-checked save is `DOCUMENT_CONFLICT`, never retried.
  - IRIS regenerates class UDL on save (blank lines between members, a trailing `""`), so edit output comes from a re-read.
- **Tools as shipped.**
  - `iris_doc_get`:
    - `startLine`/`endLine` return `{name, ts, startLine, endLine, totalLines, lines}`;
    - a range combined with `metadataOnly` is an error;
    - `metadataOnly` returns `{exists, name, etag}`.
  - `iris_doc_put`: Storage guard with `allowStorageRegeneration`. For an existing document, the flow is a 409, then one `If-None-Match` retry.
  - `iris_doc_edit`:
    - takes `action` `apply|regenerateStorage` and `edits` of insert, delete and replace, each with `expected`;
    - applies them bottom-up and all-or-nothing, and rejects overlapping edits;
    - never compiles;
    - returns `unifiedDiff`, one excerpt per edit with 3 context lines, `totalLines` and `ts`.
  - **DW-552 (38.6).** `STALE_CONTENT` `mismatches[].current` gains a trailing line break, so that passing it back as `expected` round-trips even when the range ends in an empty line. The description gains one line on it.
- **SQL (AD-25).** `ExecuteMCPv2.REST.Sql` (the `/dev/sql/execute` route) prepares once, classifies by `%SQL.Statement` statement type and executes the same statement, all in one call.
  - Read paths run inside a transaction that is always rolled back.
  - Under a cap, only types 1–4 run, and every other type, DDL and `CALL` included, is refused before execution. A SELECT runs as it would with no cap. INSERT, UPDATE and DELETE run in a transaction, and a count over the cap, or an unknown count (TRUNCATE gives -1), rolls back.
  - A refuse-only `%NOJOURN` token check applies under a cap. A changed `$TLEVEL` is an error.
  - Refusal codes:
    - `SQL_READ_ONLY` carries `{namespace, statementType, readOnlySource}`;
    - `SQL_ROWS_AFFECTED_CAP` carries `{namespace, statementType, rowsAffected?, maxRowsAffected, capSource}`.
  - Additive result fields: `rowsAffected` (types 2–4), `totalCount` (`countOnly`), `readOnlyForced` and `maxRowsAffectedCapped`. `rowCount` keeps its meaning, rows returned.
- **Governance.**
  - `parent` is declared per tool: `iris_doc_edit` → `iris_doc_put`, `iris_sql_query` → `iris_sql_execute`. Only a disable is inherited, taken from the parent's first explicit layer. It reports `configSource:"parent"`, and the denial carries `inheritedFrom` with the suffix ` (inherited from '<parent>')` and no `presetApplied`.
  - The `read-only` preset blocks every write, `defaultEnabled` included.
  - Tests and smokes use the `{"global":{...}}` or `{"<profile>":{...}}` shape. The flat shape is silently ignored (DW-554).
- **Refusals.** A refusal is `isError: true` and changes nothing. Codes come only from `refusals.ts`, and a test fails on a code literal anywhere else. Argument errors carry no code. Error text is `<what happened>. <what to do about it>.`
- **Prompts and skills.**
  - Prompts are authored once, in `packages/*/src/prompts/` (dev `deployAndTestClass.ts` and others).
  - `skills/` is generated (DO-NOT-EDIT) by `pnpm gen:skills` and checked by `gen:skills:check`.
  - `validate:prompts` needs a built dist and requires every `iris_*` token to name a real tool.
  - Agent content never cites internal rule numbers or repository paths.
- **Live gates and capstone.**
  - A gate carries its own `IRIS_REQUIRE_LIVE` check and is listed in the owning package's `scripts/prepublish-gate.mjs` `gateTestFiles`, which run with `--no-file-parallelism`. `live-gate-roster.test.ts` enforces the listing.
  - Cross-package gates go in `iris-mcp-all` (`process-gate-helpers.ts`). Dev gates reuse `live-doc-helpers.ts` (`putDocLines`, `compileDocs`, `removeStored`, `runQuery`) and `sql-test-support.ts`.
  - Do cleanup and the nothing-left assertions in `afterAll`, never a final cleanup `it()` (DW-556). Emptiness checks cover only the gate's own fixture stems.

## Cross-Story Dependencies

- **Delivered.**
  - 38.0: `stripLeadingBom`, `atelierDocStatusError`, and the `USER` default namespace.
  - 38.1: stdio-only `resolveTransport`, which exits 1 before any IRIS traffic.
  - 38.2: ranged reads.
  - 38.3: the Storage guard, the refusal catalog and the existing-document flow.
  - 38.4: `iris_doc_edit` (paired with `iris_doc_get` in `TOOL_PAIRS`) and the parent mechanism.
  - 38.5: the SQL endpoint, the controls and `iris_sql_query`. The bootstrap moved `3af8ca401e7c` → `d352a6a32158`, and classes went 29 → 30.
- **38.6 consumes all of the above.**
  - Do DW-552 first: the new edit prompt depends on the retry round trip. Its flow is a ranged read → `iris_doc_edit` with `expected` → `iris_doc_compile` → `iris_execute_tests`, checking that `total` matches the expected `Test*` count.
  - DW-555: point the `iris_execute_tests` hints (`execute.ts`), the `deploy-and-test-class` prompt and its generated skill at `iris_sql_query` for read-only queries.
  - DW-559: the capstone asserts that the deployed `BOOTSTRAP_VERSION` equals the shipped embed before its live legs. The 38.5 review read the deployed version with `ExecuteMCPv2.Setup.GetBootstrapVersion()`. Reuse the check in other gates where it is cheap.
  - Capstone legs:
    1. ranged read;
    2. edit with `expected`;
    3. a stale edit, refused with `STALE_CONTENT`;
    4. a storage-dropping put, refused with `STORAGE_DROPPED`;
    5. a read-only SQL refusal, `SQL_READ_ONLY`;
    6. a rows-affected refusal, `SQL_ROWS_AFFECTED_CAP`.
- **Epic-close records.**
  - `:check` exits 0.
  - Tool counts.
  - `BOOTSTRAP_VERSION` across the epic: `2159ec9e6f69` → `d352a6a32158`, moving again only if 38.6 changes a bootstrapped class.
  - `check-epics-sync.mjs` OK.
  - Route the existing-tool annotation divergences to one owned ledger entry: `destructiveHint:false` on `iris_sql_execute`, `iris_execute_command` and `iris_doc_put`. The `iris_execute_tests` `readOnlyHint`/`idempotentHint` divergence is DW-498, owned by 40.4.
- **Owned elsewhere; don't fix incidentally.** The Epic 38 burn-down gate, which runs after 38.6, owns:
  - DW-554 (HIGH: the flat governance shape fails open);
  - DW-556 (the other gates' final cleanup `it()`);
  - DW-558 (the cap's rollback does not undo IRISTEMP tables);
  - DW-542, DW-549, DW-528 and DW-530.

  Epic 41 owns the skills pack. Epic 43 binds `regenerateStorage` to its confirmation helper.
- **Build loop.** Dev and `iris-mcp-all` import `@iris-mcp/shared` through `dist`, so rebuild shared first. Process gates fail on a stale dist. Run build and test per package when the parallel turbo run flakes.
