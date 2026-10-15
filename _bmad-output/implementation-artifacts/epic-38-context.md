# Epic 38 Context: Agent Code Editing & Write Safety

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make agent writes to IRIS safe and minimal. An agent can read a document by line range and change only the lines it means to, guarded by an expected-text check, and it cannot silently drop a class's Storage block. Operators can confine SQL to read-only statements or cap the rows a write affects, and a read-classified query tool keeps SQL usable under the `read-only` preset. The suite also stops accepting a transport it cannot run. This closes the competitor's biggest gaps in editing ergonomics while keeping this suite's stricter conflict and governance guarantees. It opens a wave in which the architecture spine (AD-1..AD-34) binds every story: where a story's text disagrees with the spine, the spine wins and the story text is amended in place.

## Stories

- Story 38.0: Epic 37 Deferred Cleanup
- Story 38.1: Reject the Unimplemented HTTP Transport
- Story 38.2: Line-Range Document Read
- Story 38.3: Storage Block Drop Guard
- Story 38.4: Surgical Line Edit Tool
- Story 38.5: SQL Write Safety
- Story 38.6: Editing and SQL Safety Docs, Prompt and Capstone

## Requirements & Constraints

- **Wave rules for every story.**
  - Probe API and reuse claims live before coding, and amend the story text if a claim turns out wrong.
  - Every new tool or action carries `mutates` and an include/exclude in every preset.
  - A changed bootstrapped class regenerates the embed in the same story and records `BOOTSTRAP_VERSION` from → to (`2159ec9e6f69` at Epic 37 close).
  - `GOVERNANCE_BASELINE` stays frozen at `1e62c5ad5bf7`/141. Check it with `:check` only.
  - Endpoint-backed stories smoke the live route, including one destructive-path refusal. Every gate is proven red on the path it guards.
- **Shared IRIS instance.** It is never stopped. Writes go only to disposable `ExecuteMCPv2.Temp.*` classes, tables or namespaces, which are removed afterwards. Fixtures are synthetic.
- **Transport.** Only `stdio` is supported. Any other value, `http` included, is a configuration error raised before any IRIS traffic: the error names the value and the process exits non-zero. With the default or `stdio`, startup is byte-identical to today.
- **Ranged read.** `startLine`/`endLine` are 1-based and inclusive.
  - An `endLine` past the end clamps to the last line.
  - An invalid range, or a range combined with `metadataOnly`, returns `isError`, never an empty success.
  - The response reports `totalLines`.
- **Storage guard.** A put to an existing `.cls` that drops an existing Storage definition is refused and writes nothing.
  - The refusal carries a distinct code that names the dropped definitions.
  - The override is `allowStorageRegeneration: true` on put only.
  - Changing storage content is allowed.
  - Non-class documents and new classes never pay the extra read.
- **Line edits (`iris_doc_edit`).**
  - Edit kinds are `insert`, `delete` and `replace`. Each one carries `expected` text.
  - All edits are addressed against the document as read, applied bottom-up and all-or-nothing. Overlapping ranges are rejected before any write.
  - A mismatch is refused as `STALE_CONTENT`, with the current text of each mismatched range.
  - The response is a diff, excerpts and the new `totalLines`, never the whole document.
  - Compiling is not part of the tool; the description points agents to `iris_doc_compile`.
- **SQL safety.**
  - `readOnly` and `maxRowsAffected` parameters, plus the operator variables `IRIS_SQL_READ_ONLY` and `IRIS_SQL_MAX_ROWS_AFFECTED`.
  - New additive fields: `rowsAffected`, and `countOnly` → `totalCount`. The existing `rowCount` keeps its meaning (rows returned).
  - Every new control is off by default, so output is byte-identical to today (pin it with `toEqual`). Defaults are sent and documented explicitly.
- **Counts.** dev goes from 29 to 30 tools (`iris_doc_edit`), then to 31 (`iris_sql_query`). Dev `core` goes from 13 to 14 to 15 runtime tools; the 13 figure is a guideline, not a limit. Each story records the `core` size and why the tool is everyday-loop. No existing `core` tool is removed.
- **Sanctioned behavior changes.** These are the only ones: transport rejection and the storage-drop refusal on put. Each is named in `CHANGELOG.md` with its story.
- **Out of scope.**
  - Implementing Streamable HTTP, server-side source control, compile-by-wildcard and inline multi-document fetch.
  - A storage guard on `iris_doc_load` or on the `iris_env_promote` `execute` sync. Each is filed as a `wontfix-accepted` ledger row with a `reopen_if` trigger.

## Technical Decisions

- **Governance keys.** `iris_doc_edit` takes an `action` enum.
  - `apply` is `mutates: "write"` with the `defaultEnabled` marker. The marker addresses only `tool:action` keys, so the tool needs a per-action `mutates` record.
  - `regenerateStorage` is a separate write that ships disabled. The guard override is never a parameter of `apply`.
  - The `defaultEnabled` holder list is closed: `production_control:clean` and `doc_edit:apply`.
  - Never add an `action` enum to a frozen-baseline tool such as `iris_sql_execute`, because that renames its key. New operations go on a companion tool.
- **Parent keys.** This is a new governance mechanism, built in 38.4 and reused in 38.5.
  - `iris_doc_edit:apply` has the parent `iris_doc_put`, and `iris_sql_query` has the parent `iris_sql_execute`.
  - An explicit disable of the parent at any layer seeds the child disabled. An explicit setting on the child still wins.
  - `iris_server_profiles` and the governance resource report the inherited verdict from the same engine.
- **Policy order.** The order is env profile > env global > file profile > file global > preset seed > default seed. The `read-only` preset blocks every write, `defaultEnabled` writes included. Explicit keys beat the preset.
- **Annotations.** New tools declare all four hints truthfully. For `iris_doc_edit` that is `destructiveHint: true`, `readOnlyHint: false` and `idempotentHint: false`; it does not copy `iris_doc_put`'s grandfathered `false`.
- **Visibility.** Both new tools are in `developer` and `core`. `iris_doc_edit` and `iris_doc_get` form a new `TOOL_PAIRS` pair. No other tool's preset rows change.
- **One line utility in `@iris-mcp/shared`.** It owns:
  - numbering, as 1-based indexes into the `content` array of Atelier `GET /doc`;
  - splitting on `\r?\n` and joining with `\n`;
  - BOM handling;
  - the single numbered-text format.

  Reads, `expected`/`text` parsing and excerpts all use it. Ranges apply to UDL text documents only.
- **Conflicts.**
  - A ranged read returns the document's version token (`ts` or ETag).
  - An edit's PUT sends `If-None-Match` with the token of the GET its `expected` check ran against.
  - A 409 is a conflict and is never retried. `ignoreConflict` is never sent.
  - The edit response is built from a re-read after the PUT, never from the locally edited array.
- **Storage guard.** One shared function maps (current source, new source) to the names of dropped Storage definitions. A Storage keyword inside a comment or string must not count. 38.3 lists every document-writing path, exhaustive as of a named date, with a verdict for each. A grep test fails on any new path that has no verdict.
- **Diff code.** Servers never import `client-config`. Any reused diff code moves into `@iris-mcp/shared`; otherwise a small line-diff utility is written there.
- **SQL classification.** Use the statement type from preparing the statement through `%SQL.Statement`, not a keyword blocklist, wherever the probe confirms the type is available. Classification and execution use the same prepared statement, in one IRIS call.
- **SQL read paths.** `iris_sql_query` and read-only mode run inside a transaction that is always rolled back.
  - The docs call this "statement-level read-only, not side-effect-free".
  - The tool description lists the remaining non-transactional effects.
- **Row caps.** Rows-affected caps are enforced inside IRIS before commit, with TypeScript passing in the limit. This is a sanctioned exception to the thin-handler rule.
- **Operator controls.** `IRIS_SQL_MAX_ROWS`, `IRIS_SQL_TIMEOUT` and `IRIS_SQL_READ_ONLY` bind both SQL tools.
  - A caller parameter can tighten a control but never loosen it. A clamped value is noted in the response.
  - SQL safety controls are never inherited from the `default` profile entry. An omitted per-profile value falls to the global variable, then to the safe default.
- **One serializer.** All SQL tools share one result serializer and select mode. It is pinned against `action/query` output on a fixture with dates, nulls, `%List` values and streams. 38.5 records whether `iris_sql_analyze`'s `explain` and `indexUsage` paths are in scope.
- **Refusals.** A refusal is `isError: true` and changes nothing. `structuredContent.code` is a stable UPPER_SNAKE_CASE code from one catalog in `@iris-mcp/shared`, with a uniqueness test. The refusal also carries the fields a caller needs to act, such as the statement type, row count and cap, dropped names, or current text.
- **Field names.** A field name keeps one meaning across tools. A story that adds a field proves the name is absent today.
- **Tool descriptions.** Lead with what the tool does, when to use it and what it returns. Then state the default state of any governed write and the operator controls that affect the call. Never name REST paths.
- **Custom REST routes.** Routes are additive only: an existing route accepts every older request shape and returns a superset, pinned per changed route.
- **Handlers.** Handlers use only `ToolContext` and never read environment variables.
- **Live gates.** They are armed by `IRIS_REQUIRE_LIVE` and listed in the package's `prepublish-gate.mjs` `gateTestFiles`.

## Cross-Story Dependencies

- **38.0 runs first.** It drains the inherited deferred-work backlog, changes the `IRIS_NAMESPACE` default to `USER` (tests and scripts must then set it explicitly), and regenerates the bootstrap embed.
- **38.2 → 38.4.** 38.2 defines the line numbering and the version token, and 38.4 reuses them unchanged.
- **38.3 → 38.4.** 38.4 reuses 38.3's storage guard without redesigning it. 38.4 owns only applying the edits.
- **38.4 → 38.5.** 38.4 adds the parent-key mechanism, and 38.5 reuses it for `iris_sql_query`. One statement classification serves both `readOnly` mode and `iris_sql_query`.
- **38.6 depends on all earlier stories.** It covers:
  - enriching the docs (every new parameter, tool and variable, with its default state);
  - a new MCP prompt: ranged read → edit with `expected` → compile → run tests, with a total-count check;
  - updating the `deploy-and-test-class` prompt where it overlaps, then `gen:skills`, `gen:skills:check` and `validate:prompts`;
  - a default-suite live capstone over all six guards, proven red by reverting one guard;
  - the epic-close checks.
- **Later epics.** Epic 43's human-confirmation helper later binds `iris_doc_edit:regenerateStorage`; it is not built here. Changesets use only `patch` or `minor`, and no story runs `changeset version` or publishes.
