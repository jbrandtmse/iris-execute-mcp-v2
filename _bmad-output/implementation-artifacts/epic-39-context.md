# Epic 39 Context: Interop Message Forensics

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

An integration engineer can find interoperability messages by header fields, body content and Search Table value, and can read any message body. Caller input is never interpolated into a statement. Every output carrying body content or body-derived values falls under one per-profile PHI data policy (`block`, `redact` or `allow`; default `redact`). Together these close the competitor's forensics lead (G32–G35, G50). Stories 39.0–39.6 are done: header, body and Search Table search, the policy and HL7 redaction engine, the body reader, docs, prompts and the capstone. Story 39.7 remains. It is the burn-down of the five ledger entries the epic found, which the decision sheet chose to fix now (orchestrator decisions #30–#32). DW-579 went to Story 43.1 and is out of scope.

## Stories

- Story 39.0: Epic 38 Deferred Cleanup
- Story 39.1: Message Header Search
- Story 39.2: PHI Data Policy
- Story 39.3: Message Body Content Search
- Story 39.4: Search Table Lookup
- Story 39.5: Message Body Reader
- Story 39.6: Message Forensics Docs, Prompt and Capstone
- Story 39.7: Epic 39 Burn-Down

## Requirements & Constraints

- **Precedence and probing.** The spine binds every story, and AD-26 governs this epic. Where a story and the spine disagree, the spine wins. Probe each IRIS API and each "reuse X" claim before building on it, and record the earliest version verified (IRIS 2026.2 build 221U, Atelier v8).
- **Burn-down bar.** Prove each fix live on the real surface, or by mutation (revert → red → restore). Prove each new gate or pin red on the path it guards.
  - The burn-down's behavior changes are sanctioned AD-15 changes and are named in `CHANGELOG.md`.
  - Everything else stays byte-identical, and a pin proves it.
  - Custom REST routes are additive-only: an old request shape still works, the response is a superset, and a pin proves both.
- **Policy semantics.**
  - `block` withholds every body-derived value, and `allow` changes nothing.
  - Under `redact`, only HL7 v2 is redactable, using a fail-closed keep-list. Every other kind is withheld with a fixed reason, so nothing passes through unredacted.
  - Least exposure: under `redact`, no surface shows more body text than it did before the policy existed.
  - Body kind comes from `MessageSearch.BodyKind`, never from sniffing content.
  - A caller's `dataPolicy` can only tighten the operator's policy, and a clamp is noted in the response.
  - Audit `outcome` stays `ok | error | denied`. A policy refusal is `error`.
  - Error text never echoes a caller value or body content, and body content never reaches stderr or the audit file.
  - No document claims regulatory compliance.
- **Bounded search.** Every search needs a window of 0–7 days. `limit` caps output only and is never described as timeout protection.
- **Shared instance.**
  - Never stop it. Never start a production in HSCUSTOM, and never read HSCUSTOM's or another project's messages. A plan-only EXPLAIN (no rows) is allowed, as in 39.1 and 39.4.
  - Fixtures are synthetic: identifying values contain `SYNTHPHI`, values that must survive contain `KEEPME`, and times fall on 2001-02-03 UTC.
  - Fixtures live only in disposable namespaces named `EXECMCPTMP<digits><A-Z>`, which the story creates and removes, with nothing-left assertions. These namespaces get interoperability through mappings only (`Ens`/`EnsLib` → ENSLIB). Never call `EnableNamespace`.
  - Every call names `server:"default"`.
- **Current counts** (39.7 adds no tool, prompt or key):
  - interop: 24 package / 25 advertised tools; `core` 12 runtime; `developer` 25;
  - suite: 109 / 114 tools and 13 prompts;
  - governance baseline: `1e62c5ad5bf7`/141, verified with `:check` only;
  - `BOOTSTRAP_VERSION`: `2fd17b50a024`, 32 classes.

## Technical Decisions

- **DW-569: the shared `IrisHttpClient`.**
  - Today a non-2xx response whose `status.errors` is empty becomes an empty success. Fix it in the one gateway (AD-1, AD-11), and keep `IrisApiError` as the error class.
  - That carve-out exists because Atelier was recorded answering HTTP 400 with no errors for valid no-result `action/search` (`iris_doc_search`) and `action/getmacrodefinition` (`iris_macro_info`) requests. Probe both live first: a legitimate empty result must not become an error.
  - Pin the fix with the live `CLS/cls` and `RTN/cls` 400 pair from the dev `doc-type-description-live-gate` control rows. That gate's handler rows currently rely on the empty success.
  - Prove that no current 2xx path changes.
- **DW-571: the gate flake.** The same gate compares a handler listing with a wire listing of the shared HSCUSTOM, taken at different moments. Make the comparison immune to concurrent writes (a fixed filter, or comparing the request rather than counts), and prove it stable under a parallel run. It stays in dev's `prepublish-gate.mjs` roster.
- **DW-572: the header search plan (decision #30).**
  - An index hint bounds the plan of the `headers` search statement to the `TimeCreated` index. Measure it with EXPLAIN before and after: untuned, item + status costs 19,075, against 103.84 for the window alone.
  - `HeaderWhere` is shared with `resendFiltered`, so the hint goes in `MessageSearch`'s own statement text, never in `HeaderWhere`. `resendFiltered`'s statements, its sample `ORDER BY TimeCreated` and its tie order are pinned byte-identical by the 39.1 replay.
  - The `body` and `searchTable` statements already join with `%INORDER`, header first. Their text is pinned by plan rows over `INFORMATION_SCHEMA.STATEMENTS` and by OS statement-text tests.
- **DW-576: logs and diagram under the policy (decision #31).**
  - Under `block` only, withhold the message-derived text of two tools, each with a fixed reason that contains no input:
    - `iris_production_logs`: the Event Log `Text`;
    - `iris_message_diagram`: the sanitized `ErrorStatus`, which the IRIS-side Diagram correlator inserts as an error warning.
  - Under `redact` and `allow`, both stay byte-identical as documented residuals: log text cannot be redacted reliably, and sniffing is forbidden.
  - Declaring `ToolDefinition.dataPolicy` makes a scope row `governed`, and the scope test requires those rows to equal the declarations and the `tool_support.md` table.
    - `DATA_POLICY_SCOPE_DATE` stays 2026-10-16 (it is a pinned anchor).
    - There is no "governed only under `block`" class, so the row's reason must say so.
  - When a declared tool's response omits `structuredContent.dataPolicy`, the audit falls back to the profile's policy with 0 counts. So the `redact` and `allow` responses can stay byte-identical.
- **DW-583: character-stream bodies (decision #32).**
  - Under `allow` only, `iris_message_body` renders the text of a body's character-stream property, for example `HS.Message.XMLMessage` `ContentStream` (`%Persistent` + `%XML.Adaptor`). The text is bounded by `maxChars`, with the existing `truncated` reporting: TypeScript's cut plus IRIS's `bodyTextComplete`.
  - `redact` withholds it (`bodyRead:"hl7"`, so IRIS never reads it), and `block` returns kind metadata only.
  - Today `PropertyDump` emits a stream property as `{stream, size}`. A 39.5 live row pins that the `allow` dump of `Story395.Plain` holds no `SYNTHPHI-NOTE` (a `%Stream.GlobalCharacter` property). The plan decides which streams render and amends that pin as a sanctioned change.
  - Sanitization (CRLF → LF; C0 → U+FFFD) runs before truncation.
  - Probe whether `HS.*` classes are reachable in a mapping-only namespace.
- **Shared mechanics.**
  - **Bootstrap.** A change to a bootstrapped class (`MessageSearch`, `MessageBody`, `Diagram.*`) runs `pnpm gen:bootstrap` in the same story and records `BOOTSTRAP_VERSION` from → to. Gates assert the deployed version.
  - **Descriptions.** A description, schema or annotation change turns `tools-list-snapshot.test.ts` red. Regenerate the snapshot with `pnpm gen:tools-list-snapshot --force` (never edit it by hand), and keep the README payload rows equal to `pnpm measure:tools-payload`.
  - **Handlers.** They extend `REST.Base`, render one envelope, validate before the namespace switch, save and restore `$NAMESPACE`, and pass text through `SanitizeError`. Run OS tests one class per call and compare `total`.
  - **Gates.** They are armed by `IRIS_REQUIRE_LIVE` and listed in the owning package's `gateTestFiles`, and `GATES` where it applies. Each keeps its own arming, dist-freshness and version-assert literals.
    - Gate helpers come from `process-gate-helpers.ts`; `gate-helper-copies.test.ts` fails on a copy.
    - Fixtures extend `interop-namespace-fixture.ts`.
    - Rebuild dists first.

## UX & Interaction Patterns

- **Tool descriptions.** They lead with what the tool does, when to use it and what it returns. They state default states and the operator controls that apply, including the data policy, and never name REST paths.
- **Withheld values.** A withheld value is a per-item outcome field inside a successful read, never a refusal.

## Cross-Story Dependencies

- **What 39.7 builds on:**
  - 39.0: the doc-type gate and `DOC_TYPE_DESCRIPTION`;
  - 39.1: `HeaderWhere`, the `headers` statement and the resend byte-identity replay;
  - 39.2: the policy plumbing, `BLOCK_REASONS`, the scope table and the audit field;
  - 39.5: the `MessageBody` route, the `bodyRead` wire and `PropertyDump`;
  - 39.6: the snapshot, the promoted helpers, the docs surfaces, and `epic39-capstone-gate` (which reads HL7 bodies and must stay green).
- **Not in this story:**
  - DW-578 is an accepted residual.
  - DW-579 belongs to Story 43.1.
  - G31, G36, G37 and G38 stay out of scope.
