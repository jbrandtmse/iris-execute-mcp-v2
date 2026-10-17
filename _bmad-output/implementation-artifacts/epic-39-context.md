# Epic 39 Context: Interop Message Forensics

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

An integration engineer can find interoperability messages by header fields, by body content and by Search Table value, and can read any message body. Caller input is never interpolated into a statement, and every output that carries body content or body-derived values falls under one per-profile PHI data policy (`block`, `redact` or `allow`; default `redact`). This closes the competitor's P1 forensics lead (gaps G32–G35, G50): the competitor reads three body classes and pastes caller input into generated ObjectScript, while this epic covers every body class safely. Stories 39.0–39.2 are done: the env harness and governance dead-key checks, header search, and the policy model, classifier and HL7 redaction engine. Story 39.3 (body content search) is next. It is the first tool to declare PHI-bearing inputs and the first to refuse with `DATA_POLICY_BLOCKED`.

## Stories

- Story 39.0: Epic 38 Deferred Cleanup
- Story 39.1: Message Header Search
- Story 39.2: PHI Data Policy
- Story 39.3: Message Body Content Search
- Story 39.4: Search Table Lookup
- Story 39.5: Message Body Reader
- Story 39.6: Message Forensics Docs, Prompt and Capstone

## Requirements & Constraints

- **The spine binds every story, and AD-26 governs this epic.** Where a story and the spine disagree, the spine wins and the story is amended. Probe every IRIS API and every "reuse X" claim before building on it, and record the earliest IRIS version verified (so far IRIS 2026.2 build 221U, Atelier v8).
- **Bounded scope.** Every search action needs a window: `from` is required, `to` defaults to now, and the span is 0–7 days. IRIS refuses an out-of-range window before it switches namespace. There is no whole-namespace mode. `limit` (default 100, max 500) caps output only and is never described as timeout protection. Open escalation DW-572: on an untuned `Ens.MessageHeader`, a name or status filter scans bitmaps over the whole history, so the window does not bound that scan.
- **No interpolated input.**
  - Body and Search Table filters are structured `{property, op, value}` values, never raw `WHERE` text.
  - Validation runs IRIS-side, in the handler that builds the statement; TypeScript checks are advisory only. Properties resolve to their dictionary `SqlFieldName` and are emitted as delimited identifiers. Search Table properties are checked against the namespace's `Ens.Config.SearchTableProp` rows.
  - Operators come from a closed enum, and values are always bound.
  - The injection fuzz drives the REST route directly, runs in the default suite, and checks against an independent oracle.
- **Search returns header rows only, never body values.** Under `block`, `body` and `searchTable` are refused with `DATA_POLICY_BLOCKED`, because a match reveals that a body exists. Under `redact` and `allow` they run.
- **Policy semantics.**
  - Under `redact`, only HL7 v2 is redactable. Any other readable body, and any HL7 body that is too large, unreadable or unparseable, is blocked with a fixed reason. Nothing is ever passed through unredacted.
  - `block` withholds every body, and `allow` changes nothing.
  - **Least exposure:** under `redact`, no surface shows more body text than it did before the policy existed.
- **Audit and echo.**
  - `outcome` stays `ok | error | denied`. A policy refusal is `error`.
  - A tool that declares `dataPolicy` gets an audit `dataPolicy: {policy, redacted, blocked}` automatically.
  - Inputs declared in `phiInputs` (39.3's filter values, 39.4's Search Table `value`) are logged as `"[REDACTED]"` under `IRIS_AUDIT_LOG_PARAMS` when the policy is `redact` or `block`, or the profile is unresolved. The 39.1 header filters are not PHI-bearing.
  - Error text from a governed tool never echoes a caller value or body content, and body content never reaches console logs.
  - No document claims regulatory compliance.
- **Back-compat.** Every change is additive and pinned. Custom REST routes are additive-only: an old request shape still works and the response is a superset, and a pin proves it. The only sanctioned behavior change in this epic was the 39.2 resend preview.
- **Counts.**
  - Today: interop has 23 package tools (24 advertised), `core` 11 runtime and `developer` 24. The suite has 108/113 tools and 12 prompts, and the scope table has 109 names.
  - 39.3 and 39.4 move no count.
  - 39.5 brings interop to 24/25, `core` to 12 and the suite to 109/114.
  - 39.6 adds one prompt.
- **Shared instance.**
  - Never stop it, and never read HSCUSTOM's or another project's messages. Never start a production in HSCUSTOM.
  - Fixtures are synthetic: identifying values contain `SYNTHPHI`, values that must survive contain `KEEPME`, and times fall on 2001-02-03 UTC. They live only in disposable namespaces the story creates and removes, with nothing-left assertions.
  - Every call names `server:"default"`.
- **Out of scope:** G31, G36, G37, G38.

## Technical Decisions

- **The tool (39.1).** `iris_message_search` is an interop tool with `scope: "NS"` and read-only, non-destructive, idempotent, closed-world annotations.
  - Its `action` enum is fixed: `headers` | `body` | `searchTable`. Each action has its own key, `iris_message_search:<action>`, classified read and enabled by default, under the `read-only` preset too. It has no parent key.
  - It has no `mode`, no raw SQL input and no `matchCount`.
  - `body` and `searchTable` return `NOT_IMPLEMENTED` after the `from`/`to` parse and before any HTTP call. 39.3 and 39.4 each replace their own branch.
- **The route.** `POST /interop/message/search` is handled by `ExecuteMCPv2.REST.MessageSearch`.
  - It validates before the namespace switch, and its texts name the parameter, never the value. Name filters are capped at 128 characters and `bodyClass` at 220.
  - It runs in Logical select mode. When the namespace has no `Ens.MessageHeader`, it returns `interopEnabled:false`, which TypeScript reports as `notApplicable`.
  - `HeaderWhere` is the single filters-to-WHERE translation, shared with `resendFiltered`. It emits only fixed column names and `?`, never validates, and never caps. Each caller keeps its own guards. `TOP ?` is bound.
  - Name filters are equality matches that ignore case, and they treat `%` and `_` literally.
- **The shared header-row and paging contract** (`message-search.ts` exports `HeaderRow`, `mapHeaderRow`, `utcToIso`, `toCanonicalUtc` and `encodeCursor`/`decodeCursor`).
  - Paging is a keyset over `(TimeCreated, ID)`, oldest first. The cursor is base64url `{t, id}`, and `nextCursor` appears only when `hasMore` is true. Callers pass the same `from` and `to` on every page.
  - Times go in as canonical UTC and come out as ISO with a `…Raw` sibling, or `""` when malformed. TypeScript sends `to` and `limit` explicitly.
  - Rows never include `ErrorStatus` or `Description`. `bodyId` can hold a literal body when the body class is empty, which is why `iris_message_search` is classified residual today.
- **Policy plumbing (39.2).**
  - The policy resolves per profile at startup, taking the first value found:
    1. the profile's `IRIS_PROFILES` `dataPolicy`;
    2. `IRIS_DATA_POLICY`;
    3. the governance file's `dataPolicy.profiles.<name>`;
    4. its `dataPolicy.global`;
    5. `redact`.

    It is never inherited from the `default` entry. `iris_server_profiles` reports `dataPolicy` and `dataPolicySource`.
  - Handlers read `effectiveDataPolicy(ctx.config)`. A caller may only tighten the policy (`tightenDataPolicy`), and a clamp is noted in the response.
  - A tool opts in with `ToolDefinition.dataPolicy: {actions?, phiInputs?}`. Registration checks that each action exists and that each `phiInputs` entry is a top-level schema key.
  - A response carries a top-level `dataPolicy: {policy, redacted, blocked}`, which the audit reads, plus a per-item `bodyPolicy` of `redacted{redactedFields}`, `blocked{reason}` or `none`.
  - `data-policy.ts` defines the five fixed `BLOCK_REASONS` and `HL7_BODY_TEXT_MAX_CHARS` (65536). Refusals use `refusalResult("DATA_POLICY_BLOCKED", …)`.
- **The classifier and body text (IRIS side).**
  - `MessageSearch.BodyKind(class)` returns one of nine tokens: `literal`, `missing`, `hl7v2`, `xmlvdoc`, `vdoc`, `stream`, `streamContainer`, `persistent` or `other`. Body kind comes from the class, never from sniffing content.
  - `Hl7Text` returns the complete `OutputToLibraryStream` ER7 text, or the fixed tokens `tooLarge` and `unreadable`. Never use HL7 `RawContent`, which truncates at 10,000 characters.
  - The preview route has optional `bodyDetail` (`kind` | `text`) and `bodyTextMaxChars` (1–1048576) fields. The route enforces no policy itself; TypeScript does.
- **The redaction engine.** `redactHl7` (`packages/shared/src/hl7-redaction.ts`) is fail-closed.
  - It keeps only the fields on a per-segment keep-list (HL7 2.5.1, reviewed 2026-10-16, cited sources) and redacts every other field. A separate Safe Harbor inventory is kept disjoint from that list.
  - Every field of an unreviewed segment or a Z-segment is redacted. A segment name must be reviewed, appear in IRIS's own schemas, or be a Z name.
  - It never throws, and its refusal reasons are fixed texts that contain no input.
  - It runs only on the complete, unsanitized body. Truncation and sanitization come afterwards, in TypeScript.
  - Accepted residual DW-578: a split-off line that starts with a known segment name and the field separator is read as that segment.
- **The scope table.** `packages/iris-mcp-all/src/__tests__/data-policy-scope.ts` classifies every tool of the suite, one row each, as of 2026-10-16. A test requires the governed rows to equal the `dataPolicy` declarations and the `tool_support.md` table to match. A story that adds a declaration or a tool updates both.
- **IRIS side and generated files.**
  - Handlers extend `REST.Base`, render one envelope, save and restore `$NAMESPACE`, and pass status text through `SanitizeError`.
  - `BOOTSTRAP_VERSION` is `d440a659ba1e`, with 31 classes. A change to a bootstrapped class regenerates the embed in the same story; record the version from → to. A new class joins both rosters.
  - Run OS tests one class per call and compare `total`: `MessageSearchTest` has 5, `MessageResendTest` 12 and `MessagePreviewPolicyTest` 4.
  - The governance baseline stays frozen at `1e62c5ad5bf7`/141 and is checked with `:check` only. After a description or schema change, the README payload rows must equal `pnpm measure:tools-payload`.
- **The live harness.**
  - Gates are armed by `IRIS_REQUIRE_LIVE` and listed in `scripts/prepublish-gate.mjs` `gateTestFiles`.
  - `beforeAll` calls `assertDeployedBootstrapVersion` and runs a positive leftovers control. `afterAll` guards each teardown step separately.
  - Rebuild dists first, and prove each gate red on the path it guards.
  - `interop-namespace-fixture.ts` provides `createInteropNamespace`, `removeInteropNamespace`, `seedHeaders`, `seedBodies`, `hl7Fields` and `leftovers`. Extend it rather than copying it.
    - Namespaces get interop through mappings only (`Ens`, `EnsLib` and routine `Ens*` → ENSLIB). Never call `EnableNamespace`.
    - Names must match `EXECMCPTMP<digits><A-Z>`.
    - The fixture class `ExecuteMCPv2.Temp.Story391Fixture` lives in HSCUSTOM.
  - A synthetic production can be started and stopped in the disposable namespace (39.2 precedent).
  - `process-gate-helpers.ts` provides `executeMcpPost`, `docFixtures` and `openWireSession`/`callOn`.
  - Atelier `action/query` renders a NULL integer as `0`, so oracles test NULL-ness with `IS NULL`.
  - Shared test helpers come from `@iris-mcp/shared/test-helpers` and are never copied. A new startup env var joins `STARTUP_ENV_VARS`.

## UX & Interaction Patterns

The agent's forensic loop:

1. **Search.** `iris_message_search` returns header rows with ids.
2. **Read.** `iris_message_body` takes 1–N header ids (bounded). It renders HL7 v2 as ER7, XML virtual documents as XML, persistent objects as JSON, streams as text, and anything else as its class and id with a reason. A size cap applies with `truncated`, and each body carries its own policy outcome.
3. **Diagram.** `iris_message_diagram` draws the flow.

Tool descriptions lead with what the tool does, when to use it and what it returns. They state default states and the operator controls that apply (including the data policy), and they never name REST paths.

## Cross-Story Dependencies

- **39.3** builds on 39.1's tool, route, `HeaderWhere`, row and cursor contract, and on 39.2's `DATA_POLICY_BLOCKED`, `dataPolicy.actions: ["body"]` and `phiInputs` for the filter values.
  - It drops `body`'s `NOT_IMPLEMENTED` branch and updates `iris_message_search`'s scope row and `tool_support.md`.
  - Oracle: a hand-written JOIN of `Ens.MessageHeader` and the body table over synthetic fixtures.
- **39.4** does the same for `searchTable` and its `value`.
  - Probe `Ens.Config.SearchTableProp` first, and how values are stored.
  - A namespace with no search tables returns `notApplicable`.
  - Oracle: SQL over the search table, with a synthetic MRN found live.
- **39.5** is the first consumer of `redactHl7`, `Hl7Text`, `bodyDetail:"text"`, `tightenDataPolicy`, `BodyPolicyOutcome` and all five block reasons.
  - It owns DW-577: bound the size before full serialization.
  - It declares `TOOL_PAIRS` `[iris_message_search, iris_message_body]`, both preset rows and a scope row. The renderer list is exhaustive as of a named date.
  - DW-578 reopens if a live sample shows the residual.
- **39.6** covers docs with default states, `CHANGELOG.md` and changesets.
  - Prompts: update `trace-message-flow` and add one new prompt, then run `gen:skills`, `gen:skills:check` and `validate:prompts`.
  - The capstone runs in the default suite and the roster, and is proven red by disabling redaction.
  - DW-561: promote the gate fixture helpers into `process-gate-helpers.ts`.
  - DW-573: snapshot-pin the pre-existing `tools/list` entries.
- **Owned by the Epic 39 burn-down**, with no story yet:
  - DW-569: the HTTP client reports an HTTP 400 with an empty error list as success.
  - DW-571: a flake in the `doc-type-description` gate.
  - DW-572: the plan-strategy escalation above.
  - DW-576: bring `iris_production_logs` and `iris_message_diagram` under the policy, which needs a sanctioned AD-15 change.
