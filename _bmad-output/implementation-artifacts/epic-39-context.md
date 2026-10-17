# Epic 39 Context: Interop Message Forensics

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

An integration engineer can find interoperability messages by header fields, by body content and by Search Table value, and can read any message body. Caller input is never interpolated into a query. Every surface that returns body content or body-derived values falls under one per-profile PHI data policy (`block`, `redact` or `allow`; default `redact`), and that includes the existing `iris_message_resend` preview. This closes the competitor's P1 forensics lead (gaps G32–G35 and G50). The competitor reads three body classes and pastes caller input into generated ObjectScript; this epic covers every body class safely. Stories 39.0 (Epic 38 ledger cleanup) and 39.1 (header search) are done. Story 39.2 builds the policy that the body-touching stories 39.3–39.5 consume.

## Stories

- Story 39.0: Epic 38 Deferred Cleanup
- Story 39.1: Message Header Search
- Story 39.2: PHI Data Policy
- Story 39.3: Message Body Content Search
- Story 39.4: Search Table Lookup
- Story 39.5: Message Body Reader
- Story 39.6: Message Forensics Docs, Prompt and Capstone

## Requirements & Constraints

- **The spine binds every story, and AD-26 governs this epic.** Where story text and the spine disagree, the spine wins and the story is amended in place. Probe every IRIS API and every claim that internal code can be reused before building on it. Record the earliest IRIS version you verified it on (so far IRIS 2026.2 build 221U, Atelier v8).
- **Scope filter (AD-20).** Every search needs a bounded window. For `headers`, `from` is required, `to` defaults to now, and the window spans 0–7 days (decision #22). There is no whole-namespace mode. `limit` (default 100, max 500) caps the output only and is never presented as timeout protection. Open escalation DW-572: on an untuned `Ens.MessageHeader`, a name or status filter makes IRIS intersect bitmaps over the whole history, so the window does not bound that scan.
- **PHI policy (L-2).**
  - Under `redact`, HL7 v2 is redacted field by field. The PHI field list must be exhaustive as of a named date and cite its source, for example the HIPAA Safe Harbor identifiers mapped to PID, NK1, GT1, IN1, PV1 and other segments (Rule #56).
  - Any body type the engine cannot redact reliably is **blocked with a reason**, never passed through. `block` withholds every body value, and `allow` changes nothing.
  - Body search and Search Table lookup return header rows only. Under `block` both are refused, because a match reveals presence.
  - Docs say the policy reduces exposure. Nothing claims regulatory compliance.
- **The one sanctioned behavior change.** The default `redact` now applies to the resend preview `bodySummary`. Under `allow` the preview stays byte-identical, and a test pins that. `CHANGELOG.md` names the change with Story 39.2. Everything else is additive and pinned (AD-15). Custom REST routes stay additive-only (AD-33).
- **Audit (AD-19).**
  - `outcome` keeps its closed domain (`ok`, `error`, `denied`). Policy effects go in a new additive field, for example `dataPolicy: {policy, redacted, blocked}`. A policy refusal is `error` with its own catalog code.
  - PHI-bearing inputs are declared with a schema-level marker on the `ToolDefinition`. Today's secret redaction in `audit.ts` matches a key-name regex, and PHI redaction must not work that way.
  - Under `IRIS_AUDIT_LOG_PARAMS`, search and body-filter values are redacted under `redact` and `block`.
  - Body content never reaches console logs. Error text from a governed tool never echoes a caller value or body content.
- **Counts.**
  - After 39.1, interop has 23 package tools (24 advertised), `core` has 11 runtime and `developer` 24 runtime. The suite has 108 package tools (113 advertised) and 12 prompts.
  - Stories 39.2–39.4 move no tool count, because a new action on an existing tool counts nothing.
  - Story 39.5 brings interop to 24/25, `core` to 12 runtime and the suite to 109/114.
  - Story 39.6 adds one prompt.
- **Shared IRIS instance.**
  - Never stop it.
  - Fixtures are synthetic: no real names and no PHI. They live only in disposable namespaces that the story creates and removes, with nothing-left assertions.
  - Never read HSCUSTOM's or another project's messages, and never start a production in HSCUSTOM.
  - The target is `localhost:52773` with all six `IRIS_*` variables set, and calls name `server:"default"`.
- **Out of scope:** G31, G36, G37 and G38.

## Technical Decisions

- **The delivered tool (39.1).** `iris_message_search` is an interop tool with `scope: "NS"` and truthful annotations (read-only, non-destructive, idempotent, closed-world).
  - Its fixed `action` enum is `headers` | `body` | `searchTable`. Each action has its own key, `iris_message_search:<action>`, and every key is a read that is enabled by default, under the `read-only` preset too. The tool has no governance `parent`, so search works while resend stays disabled.
  - `body` and `searchTable` return the catalog refusal `NOT_IMPLEMENTED` (in `refusals.ts`) after the `from`/`to` parse and before any HTTP call. Stories 39.3 and 39.4 replace it.
  - The tool has no `mode` parameter, no raw SQL input and no `matchCount`.
- **The delivered route and helper.** The route is `POST /interop/message/search`, handled by `ExecuteMCPv2.REST.MessageSearch`.
  - The handler validates input before it switches namespace. Its texts name the parameter, never the value. Name filters are capped at 128 characters and `bodyClass` at 220.
  - It runs in Logical select mode. When `Ens.MessageHeader` is absent it returns the raw signal `interopEnabled:false`, which TypeScript reports as `notApplicable`.
  - `HeaderWhere(filters, .where, .params)` is the one filters-to-WHERE translation, shared with `resendFiltered` (AD-17). It emits only fixed column names and `?`, never validates, and never sees caps. `TOP ?` is bound.
  - `HeaderRow` never selects `ErrorStatus` or `Description`. Story 39.2 classifies those two fields.
  - Name filters use equality. They ignore case and trailing blanks or tabs (default `%String` collation), and treat `%` and `_` as literal characters.
- **The shared header-row and paging contract.** Stories 39.3 and 39.4 reuse it, and 39.5 reads header ids from it.
  - The fields are `id`, `sessionId`, `type`, `status` (label), `isError`, `sourceItem`, `targetItem`, `bodyClassName`, `bodyId`, `timeCreated`/`timeCreatedRaw`, `timeProcessed`/`timeProcessedRaw` and `correspondingMessageId` (`null` when absent).
  - `message-search.ts` exports `HeaderRow`, `mapHeaderRow`, `utcToIso`, `toCanonicalUtc` and `encodeCursor`/`decodeCursor`.
  - Paging is a keyset over `(TimeCreated, ID)`, oldest first. The cursor is base64url `{t, id}`, and `nextCursor` is present only when `hasMore` is true. Callers pass the same `from` and `to` on every page.
  - Input times are ISO with `Z` or an offset, converted to canonical UTC: whole seconds, plus `.fff` only when the millisecond part is non-zero. Output times are `toISOString()` with a `…Raw` sibling, and `""` when the value is empty or malformed. TypeScript sends `to` and `limit` explicitly.
- **No interpolated input in 39.3 and 39.4 (AD-26, AD-12).**
  - Filters are structured `{property, op, value}` values. Validation runs IRIS-side, in the handler that builds the statement.
  - Properties resolve to their dictionary `SqlFieldName` and are emitted as delimited identifiers. Search Table properties are validated against the namespace's `Ens.Config.SearchTableProp` rows.
  - Operators come from a closed enum, and values are always bound.
  - The injection fuzz drives the REST route directly, in the default suite, against an independent oracle.
- **The policy model (39.2; AD-9, AD-6, AD-8).**
  - `dataPolicy` is set per profile, from the `IRIS_PROFILES` entry and from the governance file, plus one operator default variable. It is never inherited from the `default` entry. An omitted value falls to the operator variable, then to `redact`.
  - It is the first per-profile safety control. The SQL controls are global-only: `profiles.ts` spreads them from the base config, and `ProfileOverride` holds only connection fields.
  - A malformed value fails fast and names the variable. A caller can tighten the policy but never loosen it, and a clamp is noted in the response. `iris_server_profiles` reports the policy.
  - Record the model and its precedence in the spine (AD-26) and in `architecture.md` N4.
  - The new operator variable must join `STARTUP_ENV_VARS` in `packages/shared/src/__tests__/startup-env.ts`, because `startup-env-roster.test.ts` fails otherwise.
- **How the governance file behaves today (38.7 and 39.0).** These rules shape where `dataPolicy` can live:
  - layer values must be booleans (`validateLayer` throws on a string);
  - a top-level key with a string value is accepted silently as metadata;
  - a top-level key that starts with `iris_`, or holds a boolean or object, fails fast;
  - a key inside a layer that names one of a server's tools but is none of its keys logs a startup `[WARN]`;
  - `iris-mcp-governance check` reports any key that matches no key of the suite, and exits 1.

  Valid documents must stay byte-identical.
- **Redaction and the classifier (AD-26).**
  - Redaction runs only on the complete, unsanitized body. Truncation and sanitization come afterwards, in TypeScript.
  - Body kind comes from the body class, through one shared classifier that Story 39.2 owns, never from sniffing content.
  - A surface that can supply only a pre-truncated or pre-sanitized body is blocked under `redact`.
  - **Known tension.** `MessageResend.BodySummary` reads at most 1024 characters, from stream bodies only, and turns control characters (CR included) into spaces. Non-stream bodies, HL7 included, get only a class-name note.
  - Redaction tests use varied fixtures (Rule #58): escape sequences, repetitions and components, Z-segments, a missing PID, and both CR and CRLF terminators.
  - Story 39.2 classifies every surface that can return body-derived text as governed, residual or not applicable, exhaustive as of a named date. The candidates are the generic SQL, global and document tools, `iris_production_logs`, header `ErrorStatus`/`Description`, `iris_message_diagram` and execution output.
- **IRIS side and generated files.**
  - Handlers extend `REST.Base`, render one envelope, save and restore `$NAMESPACE` (never `New`), and pass status text through `SanitizeError`.
  - `BOOTSTRAP_VERSION` is `6dcdd238c792`, with 31 classes. A bootstrapped class change regenerates the embed in the same story; record the version from → to. A new class joins both rosters: `gen-bootstrap.mjs`, with `Dispatch` last, and all four lists in `bootstrap.test.ts`.
  - The IRIS unit test classes are `MessageSearchTest` (5 methods) and `MessageResendTest` (12). Run one class per call and compare `total`.
  - The baseline stays frozen at `1e62c5ad5bf7`/141 and is checked with `:check` only. The README payload rows must equal `pnpm measure:tools-payload` after any description or schema change.
- **The live-gate harness (delivered).**
  - Gates are armed by `IRIS_REQUIRE_LIVE` and listed in `packages/iris-mcp-all/scripts/prepublish-gate.mjs` `gateTestFiles`. The `@iris-mcp/all` suite runs serially.
  - `beforeAll` calls `assertDeployedBootstrapVersion` and runs a positive-control leftovers check. `afterAll` runs each teardown step in its own guard. Rebuild shared first, from clean when mtimes lie, and prove each gate red on the path it guards (Rule #59).
  - `@iris-mcp/shared/test-helpers` exports `makeEnvHarness`, `stageDefaultStartup`, `callTool`, `createMockHttp`, `createMockCtx` and `envelope`, and a `setupFiles` scrub clears startup variables. Never copy these helpers or publish them.
  - **Disposable namespaces (decision #21).** `interop-namespace-fixture.ts` provides `createInteropNamespace`, `removeInteropNamespace` (idempotent), `seedHeaders` and `leftovers`.
    - Interop comes from mappings only: `Ens`, `EnsLib` and routine `Ens*` → ENSLIB. Never call `EnableNamespace`.
    - Teardown order: mappings, namespace, database configuration, `RemoveDatabaseFiles`, fixture class. `RemoveDatabaseFiles` refuses any name that is not `EXECMCPTMP` + digits + one capital letter.
    - The fixture class `ExecuteMCPv2.Temp.Story391Fixture` lives in HSCUSTOM and resolves in other namespaces through the `%ALL` mapping.
    - Fixture times fall on 2001-02-03 UTC.
  - `process-gate-helpers.ts` adds `executeMcpPost`, which pins `Accept-Language: en-US`, and `docFixtures(session)`.
  - Atelier `action/query` renders a SQL NULL integer as `0`, so oracles test NULL-ness with `IS NULL`.

## UX & Interaction Patterns

The agent's forensic loop:

1. **Search.** `iris_message_search` returns header rows with header ids, never body values.
2. **Read.** `iris_message_body` takes 1–N header ids (bounded). It renders HL7 v2 as ER7, XML virtual documents as XML, persistent objects as JSON, streams as text, and anything else as its class and id with a reason. The renderer list is exhaustive as of a named date. A size cap applies with a `truncated` flag, and each body carries its own policy outcome as a field.
3. **Diagram.** `iris_message_diagram` draws the flow.

Story 39.6 updates `trace-message-flow` to follow this loop, and adds a prompt that finds a patient's messages by Search Table value under the policy. Tool descriptions lead with what the tool does, when to use it and what it returns. They state default states and the operator controls that apply, and never name REST paths.

## Cross-Story Dependencies

- **39.0 (done).** It supplied the env harness and its roster guard, the startup dead-key WARN and `iris-mcp-governance check`.
- **39.1 (done).** It supplied the tool, the route, `HeaderWhere`, the row, cursor and time contract, and the namespace fixture.
  - 39.3 and 39.4 add their actions to this same tool and route, and each drops its `NOT_IMPLEMENTED` branch.
  - 39.5 declares `TOOL_PAIRS` `[iris_message_search, iris_message_body]` and the `core` and `developer` rows of `iris_message_body`.
- **39.2 lands before any body-reading story.** It owns the model, the engine and the classifier. Stories 39.3–39.5 apply them to their own outputs and never re-open them (Rule #52 seam).
  - 39.2 also owns `MessageResend.cls` `PreviewOne` and `BodySummary`.
  - **DW-575:** `PreviewOne` must call `##class(ExecuteMCPv2.REST.MessageSearch).TypeLabel(tType)` instead of its own copy.
  - **DW-570:** drive `resendFiltered`'s executing path (the `TOP` ID fetch after guard f, then the resend) in a disposable mapping-only namespace with a synthetic production, never in HSCUSTOM.
  - It must keep the 39.1 resend byte-identity replay green: `fixtures/story-39-1-resend-baseline.json`, captured on `089f8f0a62b2` (dry runs and guard refusals).
- **Oracles (Rule #36).**
  - 39.3: a hand-written JOIN of `Ens.MessageHeader` with the body table.
  - 39.4: SQL over the search table, after probing `Ens.Config.SearchTableProp` and how values are stored. A namespace without search tables returns `notApplicable`.
  - 39.5: no synthetic PHI value appears anywhere under `redact`, and the value appears under `allow`.
- **39.6.**
  - Docs: the READMEs and `tool_support.md` with default states, plus `CHANGELOG.md` and changesets.
  - Prompts: run `gen:skills`, `gen:skills:check` and `validate:prompts`.
  - The capstone runs in the default suite and is listed in the roster. It generates synthetic HL7, finds it by header search and by Search Table, reads the body under `redact` (no leak) and under `allow` (the value shows), and is proven red by disabling redaction.
  - **DW-561:** promote the fixture helpers into `process-gate-helpers.ts` (building on `docFixtures`), and move the 38.4, 38.5 and 38.7 gates and the Epic 38 capstone onto them.
  - **DW-573:** add a snapshot pin of every pre-existing `tools/list` entry, captured from the built servers.
- **Open ledger entries owned by the burn-down** (no Epic 39 story yet):
  - DW-569: the HTTP client reports an HTTP 400 with an empty error list as an empty success.
  - DW-571: a flake in the `doc-type-description` live gate.
  - DW-572: a plan-strategy escalation.
