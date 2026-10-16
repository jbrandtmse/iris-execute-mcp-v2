# Epic 39 Context: Interop Message Forensics

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let an integration engineer find interoperability messages by header fields, by body content and by Search Table value, and read any message body, without ever interpolating caller input into a query. Every surface that returns body content or body-derived values falls under one per-profile PHI data policy (`block`, `redact` or `allow`; default `redact`). The policy also covers the existing `iris_message_resend` preview. This closes the competitor's P1 forensics lead (gaps G32–G35, G50). The competitor reads only three body classes and pastes caller input into generated ObjectScript; we cover every body class safely. Header search is nearly free: `resendFiltered`'s dry run already does it, but it sits behind a write key that is disabled by default. Story 39.0 first clears three Epic 38 ledger entries.

## Stories

- Story 39.0: Epic 38 Deferred Cleanup
- Story 39.1: Message Header Search
- Story 39.2: PHI Data Policy
- Story 39.3: Message Body Content Search
- Story 39.4: Search Table Lookup
- Story 39.5: Message Body Reader
- Story 39.6: Message Forensics Docs, Prompt and Capstone

## Requirements & Constraints

- **The spine binds every story.** It is `architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md`, and AD-26 governs this epic. Where story text and the spine disagree, the spine wins and the story is amended in place. Probe every IRIS API and every code-reuse claim live before building on it, and record the earliest IRIS version you verified it on.
- **Scope filter required (AD-20).** Every search needs a bounded time window, or an item plus a window. A whole-namespace run is an explicit opt-in, documented with the ~60 s gateway-timeout risk. Paging and caps are output caps only, never timeout protection.
- **PHI policy (L-2).**
  - Under `redact`, HL7 v2 is redacted field by field against a PHI field list that is exhaustive as of a named date, with its source (Rule #56). Any body type the engine cannot redact reliably is **blocked with a reason**, never passed through.
  - `block` withholds every body value. `allow` changes nothing.
  - Body search (39.3) and Search Table lookup (39.4) return header rows only. Under `block` they are refused, because a match reveals presence.
  - Docs say the policy reduces exposure. No document or listing claims regulatory compliance.
- **Sanctioned behavior change.** This is the only break in the epic. The default `redact` now applies to the resend preview `bodySummary`. Under `allow` the preview is byte-identical to today, and a test pins that. Name the change in `CHANGELOG.md` with Story 39.2. Everything else is additive and pinned (AD-15). Custom REST routes stay additive-only: a changed route still accepts every older request and returns a superset of its old response (AD-33).
- **Counts.** Interop has 22 package tools (23 advertised) and `core` has 9 package tools (10 runtime). Story 39.1 makes them 23 and 11, and Story 39.5 makes them 24 and 12. At Epic 38 close the suite stood at 107 package / 112 advertised tools and 12 prompts. Story 39.6 adds an interop prompt; prompts carry no tool count.
- **Shared IRIS instance.**
  - Never stop it.
  - Message fixtures are synthetic: no real names, no PHI. They live in a disposable interop-enabled namespace, or a documented scratch namespace that the story creates, and are removed afterwards with nothing-left assertions.
  - Never read another project's namespace or messages.
  - Epic 38's target was `localhost:52773`, HSCUSTOM, IRIS 2026.2 build 221U, Atelier v8. Name it with all six `IRIS_*` variables; the code's default namespace is `USER`.
- **Out of scope:** G31 (production needs-update check), G36 (same-server drift), G37 (lookup listing) and G38 (HL7 schema browsing).

## Technical Decisions

- **Keys and actions (AD-4).** The search kinds are `action` values on `iris_message_search`, never `mode` values: `headers`, `body` and `searchTable`.
  - Each action has its own read governance key and its own audit `action`, so an operator can disable body-derived searches separately.
  - Story 39.1 fixes the enum with all three values. Until 39.3 and 39.4 land, `body` and `searchTable` return a structured `NOT_IMPLEMENTED` refusal. That code is not yet in `packages/shared/src/refusals.ts`; add it there. Policy refusals also get their own catalog code.
  - `iris_message_body` is `mutates: "read"`.
  - New tools declare all four annotation hints truthfully.
  - The spine names only two governance `parent` pairs, `iris_doc_edit:apply`→`iris_doc_put` and `iris_sql_query`→`iris_sql_execute`. Search exists so it can run while resend stays disabled.
- **Shared search helper (AD-17, 39.1).** One IRIS-side helper, used by `resendFiltered` and by the new endpoint, owns only the filters-to-query translation. Each caller keeps its own required filters, windows, caps, and choice between refusing and truncating. A refusal test over direct REST pins resend's guards before and after the extraction.
- **No interpolated input (AD-26, AD-12).**
  - Body and Search Table filters are structured `{property, op, value}` values, and raw SQL `WHERE` text is never accepted.
  - Identifiers and operators are validated IRIS-side, in the handler that builds the statement. Validation in TypeScript is advisory only.
  - Properties resolve to their dictionary `SqlFieldName` and are emitted as delimited identifiers. Search Table properties are validated against the namespace's `Ens.Config.SearchTableProp` rows.
  - Operators map from a closed enum, and values are always bound as parameters.
  - Injection fuzzes drive the REST route directly, in the default suite, against an independent oracle.
- **Policy model (39.2; AD-9, AD-6, AD-8).**
  - `dataPolicy` is set per profile, from the `IRIS_PROFILES` entry and from the governance file, plus an operator default variable. It is **never inherited from the `default` entry**. An omitted value falls to the operator variable, then to `redact`.
  - Precedent: the SQL safety controls are global-only today (`profiles.ts`), so `dataPolicy` is the first per-profile safety control.
  - A malformed value fails fast and names the variable. Document every new variable with its default.
  - A caller can tighten the policy but never loosen it, and a clamp is noted in the response.
  - `iris_server_profiles` reports the policy.
  - Record the model and its precedence in the spine (AD-26) and in `architecture.md`'s N4 section.
- **Redaction and the classifier (AD-26).**
  - Redaction runs only on the complete, unsanitized body. Truncation and sanitization happen afterwards, in TypeScript.
  - Body kind comes from the body class, through one shared classifier owned by Story 39.2, never from sniffing content.
  - Any surface that can supply only a pre-truncated or pre-sanitized body is blocked under `redact`.
  - **Known tension.** Today `MessageResend.cls` `BodySummary` builds the preview IRIS-side from at most ~1 KB of a stream body, with control characters (CR included) turned into spaces. Non-stream bodies, HL7 included, yield only a class-name note. Story 39.2 must reconcile this with AC 39.2.4.
  - Redaction tests use varied fixtures (Rule #58): escape sequences, repetitions and components, Z-segments, a missing PID, and both CR and CRLF terminators.
  - Story 39.2 classifies every tool that can return body or body-derived text as governed, residual or not applicable, exhaustive as of a named date. Candidates: the generic SQL, global and document tools, `iris_production_logs`, header `ErrorStatus`/`Description`, `iris_message_diagram` and execution output.
- **Audit (AD-19).**
  - `outcome` keeps its closed domain (`ok`, `error`, `denied`). Policy effects go in a new additive field, for example `dataPolicy: {policy, redacted, blocked}`. A policy refusal is `error` with its own code.
  - Inputs that can carry PHI are declared on the `ToolDefinition` with a schema-level marker, and audit redacts by that declaration, never by matching parameter names. Under `IRIS_AUDIT_LOG_PARAMS`, search and body-filter values are redacted under `redact` and `block`.
  - Error text never echoes a caller value or body content, and body content never reaches console logs.
- **Result conventions.**
  - The new interop surfaces share one header-row shape.
  - Timestamps are UTC ISO 8601 with a `Z`, in and out. TypeScript normalizes offsets, and each timestamp has a `…Raw` sibling.
  - Return `structuredContent` alongside `content`.
  - A namespace with no interoperability, or with no Search Tables, returns `notApplicable`, never an error (Rule #41).
  - Per-body outcomes inside a multi-item read are fields, not refusals.
  - The body reader truncates to a size cap with a `truncated` flag.
- **IRIS side.**
  - Handlers extend `REST.Base`, render one envelope, save and restore `$NAMESPACE` without `New $NAMESPACE`, and pass `%Status` text through `SanitizeError`.
  - Routes follow `/<domain>/<resource>[/<verb>]`, using POST for a read that needs a body.
  - Changing a bootstrapped class regenerates the embed in the same story. `BOOTSTRAP_VERSION` is `089f8f0a62b2` at Epic 38 close; record from → to. A new class joins both rosters: `gen-bootstrap.mjs`, with `REST/Dispatch` last, and `bootstrap.test.ts`.
  - IRIS unit tests compare the reported `total` with the `Test*` count.
- **Governance and generated files.** `GOVERNANCE_BASELINE` stays frozen at `1e62c5ad5bf7`/141 and is checked with `pnpm gen:governance-baseline:check` only. Skills come only from `gen:skills`. Any change to a tool's description or schema moves its row in the docs payload table, which must equal `pnpm measure:tools-payload`.
- **Live gates, as delivered in Epic 38.**
  - Each gate checks `process.env.IRIS_REQUIRE_LIVE` itself and is listed in its package's `scripts/prepublish-gate.mjs` `gateTestFiles`, which `live-gate-roster.test.ts` enforces.
  - Interop and ops have no roster yet. A package that gets a gate creates one, wired to `prepublishOnly`.
  - Cross-package gates and the capstone go in `packages/iris-mcp-all/src/__tests__/`. That suite runs serially (`fileParallelism: false`, about 50 s).
  - Cleanup and nothing-left assertions go in `beforeAll`/`afterAll`, never in a final `it()`.
  - A bootstrapping gate calls `assertDeployedBootstrapVersion` in `beforeAll`. A moved `BOOTSTRAP_VERSION` fails that check until an armed start redeploys the classes through the normal bootstrap path.
  - Reuse `process-gate-helpers.ts`: `inheritedEnv` (it drops `MCP_TRANSPORT`), `irisTargetFromEnv`/`connectionEnv`, `withWireSession`, `atelierQuery`/`atelierDocument` and `spawnAndWaitForExit`.
  - Rebuild shared first: the dev and `all` packages import it through `dist`, and process gates fail on a stale dist.
  - Prove every gate red on the path it guards (Rule #59).
- **Story 39.0 notes.**
  - **DW-565.** One governance document is shared by all five servers, so a single server cannot reject a key it doesn't know. The cross-server key universe is reachable through the governance CLI's `universe` command and `deriveKeysForTool`. `parseGovernanceRoot` in `governance.ts` is the one shared validator, and Epic 38 made governance-shaped top-level keys fail fast. An unknown profile name only warns, which is the precedent. Valid documents must behave identically, with a pin.
  - **DW-543.** Promote one env harness without adding to the published `@iris-mcp/shared` surface; DW-506, owned by Story 42.1, already flags test-helper exports.
  - **DW-567.** The fix is a description change plus a pin, and it moves the payload row.

## UX & Interaction Patterns

The agent's forensic loop is:

1. **Search.** `iris_message_search` returns header rows only, including header ids, and never body values.
2. **Read.** `iris_message_body` takes 1–N header ids (bounded). It renders each body by kind: HL7 v2 as ER7, XML virtual documents as XML, persistent objects as JSON, streams as text, and anything else as its class and id with a reason. The renderer list is exhaustive as of a named date. Each body carries its own policy outcome.
3. **Diagram.** `iris_message_diagram` draws the flow.

Story 39.6 updates the `trace-message-flow` prompt to follow this loop, and adds a prompt that finds a patient's messages by Search Table value under the policy. Tool descriptions lead with what the tool does, when to use it and what it returns. They state default states and the operator controls that apply, and never name REST paths.

## Cross-Story Dependencies

- **39.0** is independent. New test files in later stories should use its promoted env harness rather than copy `makeEnvHarness`.
- **39.1** declares the full action enum, the scope filters and the header-row shape that 39.3 and 39.4 reuse. It adds `iris_message_search` to `core` and `developer`.
- **39.2** must land before any body-reading story. It owns the model, the redaction engine and the classifier. Stories 39.3–39.5 apply it to their own outputs (Rule #52 seam), and none of them re-opens it.
- **39.3, 39.4 and 39.5** each check against an oracle written by hand from live SQL (Rule #36):
  - 39.3: a JOIN of `Ens.MessageHeader` with the body table;
  - 39.4: SQL over the search table, after the `Ens.Config.SearchTableProp` and storage probe;
  - 39.5: a synthetic PHI value never appears under `redact` and does appear under `allow`.
- **39.5** declares the `TOOL_PAIRS` entry `[iris_message_search, iris_message_body]`; both tools stay co-visible.
- **39.6** brings the docs up to date: the READMEs, `tool_support.md` with default states, `CHANGELOG.md` and changesets. It runs `gen:skills`, `gen:skills:check` and `validate:prompts`.
  - Its capstone runs in the default suite, is listed in the live-gate roster and is proven red by disabling redaction. It generates synthetic HL7, finds it by header search and by Search Table, reads the body under `redact` (no leak) and under `allow` (the value shows).
  - It also closes DW-561: it promotes the fixture helpers (`putDoc`, `compileDoc`, `fixtureDocuments`, `removeFixtures`, `governanceReport`, `startStub`) into `process-gate-helpers.ts` and moves the 38.4, 38.5 and 38.7 wire gates and the Epic 38 capstone onto them.
- **Epic 40** follows, and its shared-instance coverage work relies on this epic's live-gate harness.
