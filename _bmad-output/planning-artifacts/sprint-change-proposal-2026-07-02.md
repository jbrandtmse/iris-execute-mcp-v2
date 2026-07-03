# Sprint Change Proposal — 2026-07-02

**Author:** Bob (Scrum Master) via `bmad-correct-course`
**Trigger:** New stakeholder capability request — generate a **Mermaid sequence diagram** from an Interoperability **message trace** (session) via an MCP tool, so an AI client (or a human reading its output) can visualize message flow through a production without the Management Portal's Visual Trace.
**Reference implementation:** `../DiagramTool/` (standalone ObjectScript tool, `MALIB.Util.DiagramTool`, same author/owner). **Reviewed for functional requirements only — its code is NOT embedded or ported.** The suite gets a clean-room reimplementation as our own library. The distilled behavioral spec is captured in §6 of this proposal so downstream story creation does not need to re-survey the reference project.
**Change type:** Additive capability — one new read tool on `@iris-mcp/interop` + a new clean-room **ObjectScript** diagram library under `src/ExecuteMCPv2/Diagram/` + one new thin REST endpoint.
**Path forward:** Option 1 — Direct Adjustment (append one new epic).
**Scope classification:** Moderate (new tool + new endpoint + a non-trivial library with real algorithmic content; no foundation/shared changes, no breaking changes).
**Review mode:** Batch (user-selected).
**Tool shape:** New tool (user-selected) — `iris_production_messages` is untouched (Rule #19).
**New epic:** Epic 21 (two stories: 21.0 core, 21.1 episode compression + dedup + docs).
**New FR:** FR129.
**BOOTSTRAP_VERSION:** **bump required in BOTH stories** (each adds/edits ObjectScript under `src/ExecuteMCPv2/` — Rule #24 per-story regen).

**Approval:** Approved by stakeholder 2026-07-02 (batch review) with two amendments, both incorporated below:
1. **Library placement** — the diagram library lives in **ObjectScript under `src/ExecuteMCPv2/`** (subpackage `ExecuteMCPv2.Diagram.*`), NOT a TypeScript library and NOT a separate IRIS package: everything ships through the existing bootstrap, requiring **no additional package mappings** and no new npm package. (Supersedes the originally-drafted TS-library placement.)
2. **Improvements welcome** — where we can genuinely improve on the reference tool, do so. Two improvements are specced (§2 I1/I2): error-state visualization and a session-metadata header.

---

## 1. Issue Summary

The suite can already *trace* a session — `iris_production_messages` returns a flat list of `Ens.MessageHeader` rows by `sessionId`/`headerId` ([`Interop.cls:1012`](../../src/ExecuteMCPv2/REST/Interop.cls#L1012)). But a flat row list is a poor way for an AI client to *communicate* a flow: no request/response pairing, no sync-vs-async distinction, no visual structure. Integration engineers (persona Raj, PRD Journey 3) routinely need "show me how this message moved through the production" as a **diagram** — today that means the Portal's Visual Trace.

The stakeholder owns a proven standalone ObjectScript tool (`../DiagramTool/`) that does exactly this: reads a session's `Ens.MessageHeader` rows and emits a Mermaid `sequenceDiagram` with request/response correlation, sync/async arrows, and two-tier loop compression so large repetitive traces stay readable. The request is to deliver **equivalent functionality inside the MCP suite** as our own library — using the reference tool only as a functional spec, not as source.

**Why this fits the suite well:** Mermaid text is an ideal MCP payload — clients like Claude render fenced ` ```mermaid ` blocks natively, the output is compact relative to raw rows (compression collapses `loop 14 times …` instead of 28 lines), and the tool is a pure read.

### Key gap analysis vs the existing `iris_production_messages`

The existing endpoint's projection is insufficient for diagram generation. It returns `ID, MessageBodyClassName, MessageBodyId, SourceConfigName, TargetConfigName, TimeCreated, TimeProcessed, Status, SessionId, CorrespondingMessageId` — it lacks **`Invocation`** (Inproc vs Queue → sync `->>` vs async `-->>` arrows), **`ReturnQueueName`** (async correlation fallback), and **`Type`** (Request vs Response). It also lacks the NULL-safe trace-event filter and the deterministic `TimeCreated, ID` ordering the diagram algorithm requires. Hence a **new, dedicated diagram endpoint** backed by its own loader (see §2 Technical Impact) rather than mutating the existing one.

---

## 2. Impact Analysis

### Epic Impact
- **No existing epic invalidated, rolled back, or rescoped.** Epics 1–20 are `done` and remain valid.
- **One new epic appended (Epic 21)** with two stories, following the small-feature-epic pattern of Epics 13/19/20. Two stories (not one) because the episode-level compression algorithm is the highest-complexity, highest-risk piece and deserves its own story + review cycle; the tool is already useful after Story 21.0.
- **No resequencing.** Builds on shipped Epic 5 (interop server) + Epic 14 (governance) foundations.

### Story Impact
- **2 new stories (21.0, 21.1).** No existing story touched.

### Artifact Conflicts
| Artifact | Impact | Nature |
|---|---|---|
| **PRD** | Add FR129; no existing FR changed | Additive |
| **Architecture** | Add Epic 21 ADR (decisions **G1** library placement/data flow, **G2** clean-room boundary, **G3** output contract); no decision reversed | Additive |
| **UX** | N/A — headless MCP suite (the diagram is rendered by the MCP client) | None |
| **`epics.md`** | Add Epic 21 section | Additive |
| **`sprint-status.yaml`** | Add `epic-21` + `21-0-…` + `21-1-…` + `epic-21-retrospective` as `backlog` | Additive |
| **`src/ExecuteMCPv2/Diagram/`** | New clean-room ObjectScript library subpackage (`ExecuteMCPv2.Diagram.*`) | Additive |
| **`Interop.cls` + `Dispatch.cls`** | New thin diagram handler method + route (`/interop/production/messages/diagram`) delegating to the library | Additive |
| **`packages/iris-interop-mcp`** | New thin tool wrapper `iris_message_diagram` | Additive |
| **`bootstrap-classes.ts` / `BOOTSTRAP_VERSION`** | Regenerate + bump in **each** story (both touch ObjectScript — Rule #24). New `Diagram/` classes must be picked up by `gen-bootstrap.mjs` (it reads `src/ExecuteMCPv2/**/*.cls`) | **Required ×2** |
| **Governance** | New key `iris_message_diagram` classified `mutates: "read"` (Rule #28) → default-enabled; frozen baseline `1e62c5ad5bf7` **untouched** (Rule #23/#25) | Additive |
| **Docs** (root README, interop + `iris-mcp-all` READMEs, `tool_support.md`, migration guide, annotation audit) | New tool row + counts: interop **20 → 21** package tools (21 → 22 advertised incl. framework tool); suite package total +1. Package `index.test.ts` `toHaveLength` bumps (normal package tool — NOT the Rule #31 framework-tool case). Default-state callout: **read, enabled by default** (Rule #30). | Additive (Story 21.1 deliverable) |
| **CHANGELOG** | New entry | Additive |

### Technical Impact — design decisions (G1–G3)

**G1 — Clean-room ObjectScript library under `ExecuteMCPv2.Diagram.*`, thin REST surface, thin TS wrapper (stakeholder-directed).** All diagram logic lives IRIS-side in a new subpackage under the existing `ExecuteMCPv2` package so it deploys through the **existing bootstrap with zero new package mappings** and adds **no new npm package**:
- **Library classes** (indicative shape; dev finalizes): `ExecuteMCPv2.Diagram.Loader` (embedded-SQL trace load + normalization), `ExecuteMCPv2.Diagram.Correlator` (request/response pairing), `ExecuteMCPv2.Diagram.Compressor` (pair-level + episode-level loop compression), `ExecuteMCPv2.Diagram.Writer` (Mermaid emission), plus small model classes as needed (e.g. `ExecuteMCPv2.Diagram.Event`). The library is callable independently of REST (a `Generate(sessionIds, options, Output result)` facade) — mirrors the reference tool's callable-API shape.
- **REST surface:** one new thin handler method on `ExecuteMCPv2.REST.Interop` + Dispatch route — `GET /interop/production/messages/diagram?sessionIds=<csv>&namespace=&labelMode=&maxRows=&dedup=` → validates, delegates to the facade, returns `{ diagrams: [...], count }`. Multi-session in one request so cross-session dedup lives in the library.
- **TS tool:** `iris_message_diagram` on `@iris-mcp/interop` is a thin wrapper exactly like every other interop tool (validate via Zod → call endpoint → wrap output).
- **Testing:** library behavior tested with **ObjectScript `%UnitTest` classes** (`ExecuteMCPv2.Test.Diagram*Test`, project precedent; ≤~500 lines per test class per project rules) run via `iris_execute_tests`; the TS wrapper gets standard mocked-HTTP vitest tests; per-story live smoke per Rules #22/#26.
- *Alternatives rejected:* (a) TS-side generation (original draft) — rejected by stakeholder: the library must live with `src/ExecuteMCPv2/`, avoiding any additional deployment surface; (b) a separate IRIS package (reference uses `MALIB.*`) — would require its own deployment/mapping story; `ExecuteMCPv2.Diagram.*` rides the existing bootstrap; (c) extending `iris_production_messages`' endpoint — projection/filter/ordering all differ; mutating them risks the shipped contract (Rule #19), and the user chose a new tool.

**G2 — Clean-room boundary.** The reference tool has no LICENSE file and is the stakeholder's own project, but the directive is explicit and repeated: **clean-room port, not a copy**. The boundary: this proposal's §6 behavioral spec (data contract, correlation rules, compression semantics, edge-case ledger) is the *only* input to implementation — **no ObjectScript source is ported or copied (even though both sides are ObjectScript, the code is written fresh against §6), no `MALIB.*` naming, and no reference sample data (which contains real HIE config names) is committed**. Test fixtures are synthesized neutral traces (e.g. `Demo.Service` → `Demo.Process` → `Demo.Operation`). Code review explicitly verifies provenance.

**G3 — Output contract.** The tool returns:
- `content`: one fenced ` ```mermaid ` block per session (clients render it inline), preceded by a one-line summary (session id, message count, truncation/warning count).
- `structuredContent`: `{ diagrams: [{ sessionId, mermaid, messageCount, warnings: string[], truncated: boolean, dedupOf?: number }], count }`.
- Diagram-level anomalies (unknown Invocation, unpaired request/response, correlation conflicts, errored messages) surface **both** as `%%` Mermaid comments (parity with reference FR-12: best-effort, never fail) **and** in the structured `warnings` array (better for AI clients than comments alone).
- **No file output** — the reference's append-to-file feature (FR-11) is out of scope; MCP clients persist artifacts themselves.
- **Response size:** per-session `maxRows` cap (default 2000, max 10000) + `truncated` flag, applying the Epic 10 response-cap lesson. Compression is the readability strategy; the cap is the safety net.

### Improvements over the reference tool (stakeholder-requested)

- **I1 — Error-state visualization.** The reference ignores `IsError`/`ErrorStatus` entirely — yet "where did it fail?" is the single most common reason an engineer opens Visual Trace. The loader SELECT adds `IsError, ErrorStatus` (data contract becomes 12 columns). An errored message renders with an ` [ERROR]` label suffix plus a `%%` comment carrying a **sanitized** short error summary (reuse the `ExecuteMCPv2.Utils` sanitization discipline — no internal details, no caret-globals per Rule #33), and the error is mirrored into structured `warnings[]`. **Signature rule (critical):** `IsError` participates in pair AND episode signatures so an errored iteration never silently merges into a clean `loop N times` block — the failure stays visible.
- **I2 — Session metadata header.** Each diagram opens with `%% Session <id>: <n> messages, <first TimeCreated> .. <last TimeCreated>` — orientation the reference lacks (it renders no time information at all). Dedup normalization (§6.3) must normalize this whole header line, not just the session id.
- *Considered and rejected:* Mermaid `autonumber` (numbering counts rendered lines, which loop compression makes misleading vs actual message counts); message-body previews (requires body-table joins — different tool's job); `TimeProcessed` latency annotations (bloat; candidate future enhancement).

---

## 3. Recommended Approach

**Option 1 — Direct Adjustment.** Append Epic 21 (2 stories); no rollback, no MVP review.

**Rationale:** Strictly additive, self-contained (one new ObjectScript subpackage + one thin endpoint + one thin tool), and fully specified by the reference tool's proven behavior (§6) plus two well-bounded improvements. It reuses every established pattern: thin handler + `SanitizeError` + namespace save/restore (Rule #7), read-tool governance (Rule #28), per-story bootstrap regen (Rule #24), docs rollup with default-state callout (Rule #30).

- **Effort:** Medium. Story 21.0 (loader + correlation + emission + pair compression + endpoint + tool + tests) is the bulk; Story 21.1 (episode compression + dedup + docs) is the algorithmically hardest but well-specified.
- **Risk:** Low–Medium. The correlation/episode algorithms have documented edge cases (§6.4) that the reference already paid for — encoding them as `%UnitTest` fixtures up front converts that experience into regression protection. ObjectScript-side logic means the heavy testing lives in `%UnitTest` rather than vitest — mitigated by the project's established ObjectScript test practice (`ExecuteMCPv2.Test.*`, `iris_execute_tests`, debug-global tracing) and per-story live smokes. No shared-foundation change; blast radius is one subpackage + one handler + one package.
- **Timeline/sequencing:** No dependencies; can start immediately. 21.0 → 21.1 strictly sequential (21.1 builds on the library).

**Alternatives considered:**
- *Extend `iris_production_messages` with `format:"mermaid"`* — rejected (user decision + Rule #19 coupling risk; see §1).
- *TypeScript-side library* — original draft; rejected by stakeholder (library must live with `src/ExecuteMCPv2/`; no additional packages/mappings).
- *Separate IRIS package (`MALIB.*`-style)* — rejected; would need its own deployment/mapping; `ExecuteMCPv2.Diagram.*` rides the existing bootstrap.
- *Single-story epic (19/20 pattern)* — rejected; the episode-compression algorithm is the one genuinely tricky component and warrants its own dev/review cycle. The tool ships useful value at 21.0.

---

## 4. Detailed Change Proposals

> Additive — new content blocks only. Nothing existing is modified, so there are no old→new diffs.

### 4.1 PRD addition (append to Functional Requirements)

**Epic 21 — Message Trace Sequence Diagram (added 2026-07-02)**
- **FR129:** Integration engineer can generate a **Mermaid sequence diagram** from an Interoperability message trace via a new read tool (proposed name `iris_message_diagram`) on `@iris-mcp/interop`. Input is one or more session IDs (plus `labelMode`, `maxRows`, `dedup`, `namespace` options); output is one Mermaid `sequenceDiagram` per session as fenced text plus structured content (`mermaid`, `messageCount`, `warnings[]`, `truncated`). The diagram derives participants from config item names (first-appearance order, sanitized IDs, collision-suffixed, `as` labels), maps `Invocation` to arrow style (Inproc → sync `->>`, Queue → async `-->>`), correlates requests to responses (Inproc by reversed endpoints with `CorrespondingMessageId` confirmation; Queue by `CorrespondingMessageId` with `ReturnQueueName` fallback), compresses repetition (contiguous identical request/response pairs and contiguous identical multi-hop episodes into `loop N times` blocks), **flags errored messages** (`IsError`/`ErrorStatus` — sanitized), and opens each diagram with a session-metadata header (message count, time span). Generation is best-effort: anomalies produce `%%` warnings and structured `warnings[]`, never a failed call. The generation library is a **clean-room ObjectScript reimplementation** (reference tool consulted for functional spec only; no code or sample data embedded) living under `ExecuteMCPv2.Diagram.*` so it deploys via the existing bootstrap with no additional package mappings, exposed through a thin REST endpoint and a thin TS tool wrapper. The tool is classified `mutates: "read"` (enabled by default) and is strictly additive — `iris_production_messages` is unchanged.

### 4.2 Architecture additions (new ADR section — Epic 21, decisions G1 + G2 + G3)

- **G1 — Clean-room ObjectScript diagram library under `ExecuteMCPv2.Diagram.*` (stakeholder-directed placement).** All generation logic (loader, correlator, two-tier compressor, Mermaid writer, callable `Generate` facade) lives in a new subpackage under the existing `ExecuteMCPv2` package in `src/ExecuteMCPv2/Diagram/` — deployed by the **existing bootstrap** (picked up by `gen-bootstrap.mjs`'s `src/ExecuteMCPv2/**/*.cls` glob), requiring **no new IRIS package mappings and no new npm package**. REST surface is one thin handler (`ExecuteMCPv2.REST.Interop` + Dispatch route `GET /interop/production/messages/diagram`) that validates and delegates to the facade; the TS tool is a thin wrapper. Loader contract: 12-column `Ens.MessageHeader` projection (ID, Invocation, MessageBodyClassName, SessionId, SourceConfigName, TargetConfigName, ReturnQueueName, CorrespondingMessageId, TimeCreated, Type, **IsError, ErrorStatus**) with NULL-safe `HS.Util.Trace.Request` filter, `ORDER BY TimeCreated, ID` (fallback `ORDER BY ID`), and a `maxRows` cap. Library tests are ObjectScript `%UnitTest` (`ExecuteMCPv2.Test.Diagram*Test`); the wrapper gets mocked-HTTP vitest tests. *Note:* this is a deliberate, stakeholder-directed exception to the "handlers stay thin / logic in TS" default — the library itself is a self-contained IRIS-side component (like the reference tool it reimplements), and the REST handler stays thin by delegating to it.
- **G2 — Clean-room boundary for the reference tool.** `../DiagramTool/` is consulted as a functional spec only (captured in sprint-change-proposal-2026-07-02.md §6). No ObjectScript ported or copied (fresh code against the spec), no `MALIB.*` naming, no reference sample data (real HIE config names) committed; synthetic fixtures only. Code review verifies provenance.
- **G3 — Output contract.** Fenced ` ```mermaid ` block(s) in `content` + `structuredContent` `{ diagrams: [{ sessionId, mermaid, messageCount, warnings, truncated, dedupOf? }], count }`. Best-effort generation (warnings, never failure). Errored messages flagged (` [ERROR]` label suffix + sanitized `%%` comment + structured warning); session-metadata header per diagram. No file output. Mermaid subset: `sequenceDiagram`, `participant [as]`, `->>`/`-->>`, `loop N times … end`, `%%` comments.

### 4.3 sprint-status.yaml addition (applied on approval)

```yaml
  # Epic 21: Message Trace Sequence Diagram (iris-interop-mcp)
  # Added 2026-07-02 via bmad-correct-course. See sprint-change-proposal-2026-07-02.md.
  # Clean-room reimplementation of stakeholder-owned ../DiagramTool/ functionality — reference consulted for spec ONLY (proposal §6), no code/sample-data embedded (decision G2).
  # Library = ObjectScript ExecuteMCPv2.Diagram.* under src/ExecuteMCPv2/ (stakeholder-directed; rides existing bootstrap, no new package mappings).
  # ObjectScript touched in BOTH stories → BOOTSTRAP_VERSION bump per story (Rule #24).
  # New iris_message_diagram key = mutates:read → default-enabled (Rule #28); frozen baseline 1e62c5ad5bf7 untouched.
  epic-21: backlog
  21-0-message-diagram-core: backlog
  21-1-episode-compression-dedup-and-docs: backlog
  epic-21-retrospective: optional
```

### 4.4 New Epic (for `epics.md`) — full text

The Epic 21 section as applied to `epics.md` (Goal / Scope / FRs / Stories / Out-of-scope + Stories 21.0 and 21.1 with full ACs). See `epics.md` — the applied text is the authoritative copy; it matches this proposal's design (G1 ObjectScript library placement, I1/I2 improvements, per-story bootstrap bumps).

### 4.5 Tool description draft (for Story 21.0)

> "Generate a Mermaid sequence diagram from an Interoperability message trace. Use this when the user wants to visualize how messages flowed through a production for one or more sessions — equivalent to the Management Portal's Visual Trace, as renderable Mermaid text. Returns one `sequenceDiagram` per session showing config items as participants, sync (`->>`) vs async (`-->>`) calls, request/response pairing, `loop` blocks compressing repeated patterns, and `[ERROR]` flags on failed messages; anomalies are reported as warnings, and `iris_production_messages` remains the tool for raw message-row data."

---

## 5. Implementation Handoff

**Scope classification: Moderate** — new tool + new endpoint + a real algorithmic ObjectScript library, but no shared-foundation change, no destructive path, no breaking-change risk. Routes to the standard epic cycle.

**Routing:**
1. **Architect (Winston)** — confirm G1 (ObjectScript library placement + endpoint shape) and G3 (output contract) — light-touch; no foundation change. Note G1 records a stakeholder-directed exception to the logic-in-TS default.
2. **Scrum Master (Bob)** — run `/epic-cycle 21`: create Story 21.0 from this proposal, drive dev → review → smoke → 21.1 → retro.
3. **Dev (Amelia)** — implement per ACs; §6 of this proposal is the binding behavioral spec; clean-room discipline per G2.
4. **QA / Review** — verify fixture tests against §6 semantics, the Rule #19 back-compat snapshot on `iris_production_messages`, governance read classification, error-in-signature rule (I1), and that no reference code/sample data entered the repo.

**Guardrails (project rules in force):**
- **Rule #19/#23/#25:** strictly additive; frozen baseline untouched; `gen:governance-baseline:check` only — never the bare generator.
- **Rule #24:** bootstrap regen + `BOOTSTRAP_VERSION` move in **each** story (both touch `src/ExecuteMCPv2/`); confirm `gen-bootstrap.mjs` picks up the new `Diagram/` classes (memory: new handler classes must land in `bootstrap-classes.ts`).
- **Rule #28:** `mutates: "read"` mandatory on the new tool.
- **Rule #30/#31:** docs rollup with default-state callout; normal package tool → package-array count DOES bump (not the framework-tool split).
- **Rule #7/#33:** handler single-render discipline; no caret-globals in sanitized error text (I1's error summaries name globals without carets if ever needed).
- **Rule #2/#16:** verify `Ens.MessageHeader` column types and the `Type`/`Invocation` enum values against `irislib` before writing the loader (§6 derives from the reference tool, not IRIS docs).
- **ObjectScript practice:** `%UnitTest` conventions per `.claude/rules/object-script-testing.md` (triple-`$$$` macros, `%OnNew(initvalue)`, ≤~500-line test classes — split `Diagram*Test` by stage); classes created on disk first, deployed via `iris_doc_load` with glob-prefixed paths (Rule #17).
- **G2 clean-room:** no code or sample data from `../DiagramTool/`; synthetic fixtures only; review verifies provenance.

**Success criteria:**
- FR129 demonstrably satisfied: a real session traces to a valid, rendering Mermaid sequence diagram with correct arrows, pairing, compression, error flags, and metadata header; large repetitive traces compress to readable size.
- `iris_production_messages` byte-for-byte unchanged; suite green; bootstrap bumped per story and idempotent at close; docs + counts consistent.

**Open items carried into implementation (non-blocking):**
- Final tool name (`iris_message_diagram` vs `iris_production_trace_diagram`) — confirm in dev against naming conventions.
- `labelMode` default (`full` for reference parity vs `short` for token economy) — proposal says `full`; dev may revisit with stakeholder.
- Envelope-wrapper heuristic fidelity (exact reference rule vs documented simplification) — dev's call in 21.1, recorded either way.
- Exact class decomposition of `ExecuteMCPv2.Diagram.*` — indicative shape in G1; dev finalizes.

---

## 6. Reference Behavioral Spec (distilled from `../DiagramTool/` — clean-room input)

> Captured from a survey of the reference tool's PRD (`docs/prd/`), architecture doc, and source (`src/MALIB/Util/DiagramTool*`). This section is the **only** artifact implementation may consult; the reference repo itself should not be opened during dev (G2). Items marked **[I1]/[I2]** are our additions — not reference behavior.

### 6.1 Data contract (the entire acquisition surface)

One read-only SQL query against `Ens.MessageHeader` (reference used 10 columns; ours adds the two **[I1]** error columns):

```sql
SELECT ID, Invocation, MessageBodyClassName, SessionId,
       SourceConfigName, TargetConfigName,
       ReturnQueueName, CorrespondingMessageId, TimeCreated, Type,
       IsError, ErrorStatus                                   -- [I1] our addition
FROM Ens.MessageHeader
WHERE SessionId = :sessionId
  AND (MessageBodyClassName IS NULL OR MessageBodyClassName <> 'HS.Util.Trace.Request')
ORDER BY TimeCreated, ID          -- primary; fallback: ORDER BY ID
```

- The `IS NULL OR <>` guard is load-bearing: bodyless headers (empty acks, error responses) have NULL `MessageBodyClassName` and a bare `<>` drops them (SQL three-valued logic). This was a shipped bug in the reference.
- `Type` is a stored enum — normalize to logical `"Request"`/`"Response"` (IRIS `$$$eMessageTypeRequest`/`$$$eMessageTypeResponse` macros) at the source.
- Determinism is a hard requirement: `TimeCreated, ID` with ID tiebreak; ID-only fallback if the primary sort is unavailable.
- Columns deliberately NOT consumed by the reference: `IsError`, `ErrorStatus` (we consume both — **[I1]**), `Status`, `SuperSession`, `BusinessProcessId`, `Priority`, `TimeProcessed` (session rollup and latency stay out of scope).
- Invalid/non-positive sessionId → empty result, not an error.

### 6.2 Correlation & rendering rules

- **Arrows:** `Invocation` Inproc → sync `->>` both legs; Queue → async `-->>` both legs; unknown → `%%` warning + default sync. No other arrow types; no `activate`/`Note`/`alt`/`opt`.
- **Type resolution:** string, numeric enum, or heuristic — a row with `CorrespondingMessageId` set is a Response.
- **Inproc pairing:** forward-only scan; for each Request, first unused Response with **reversed endpoints**; `CorrespondingMessageId` confirms — mismatch emits a conflict `%%` warning but still pairs by order; the response arrow is forced sync.
- **Queue pairing:** primary — Response whose `CorrespondingMessageId` = Request ID; fallback — equal `ReturnQueueName` + reversed endpoints + empty CorrId. Unmatched request → warning. **Never reclassify** a queued pair to sync (even with empty ReturnQueueName).
- **Unpaired responses are emitted standalone** with a warning — never dropped. Response direction is always its own row's Src→Dst (i.e., reversed from the request).
- **Participants:** collected in first-appearance order over the (compressed) event stream; ID sanitization keeps `[A-Za-z0-9_.]` (else `_`; empty → `P`); collisions get `_2`, `_3`…; emit `participant <id> as <name>` only when the label differs from the id.
- **Labels:** full `MessageBodyClassName` by default; `short` mode → last dotted segment. **[I1]** an errored message's label gets an ` [ERROR]` suffix; a sanitized one-line error summary is emitted as a `%%` comment and mirrored into structured warnings.
- **Per-diagram framing:** `sequenceDiagram` header + session comment. **[I2]** the session comment is a metadata header: `%% Session <id>: <n> messages, <first TimeCreated> .. <last TimeCreated>`. Empty session → minimal valid diagram + `%% No data available` comment.
- **Timestamps** are ordering-only in the body — never rendered on arrows (reference behavior; **[I2]** adds them only to the header line).
- **Best-effort contract:** anomalies are `%%` comments; generation never fails a call.

### 6.3 Compression (two tiers)

- **Pair-level:** a Request immediately followed by its paired Response is a pair; signature = `reqSrc|reqDst|reqLabel|reqArrow || respSrc|respDst|respLabel|respArrow` (arrow inclusion keeps Inproc/Queue distinct). **[I1]** the pair's `IsError` state joins the signature so an errored pair never merges into a clean loop. Contiguous identical signatures with count > 1 collapse to a synthetic loop event carrying the count + both legs; warnings from compressed pairs are deduped and retained.
- **Episode-level:** group events into multi-hop "episodes" using a **depth stack over sync calls** (a sync request pushes, its response pops). Episode signature is built from business events only — trace-utility events (`HS.Util.Trace.*`-like) are excluded from signatures but retained in the rendered body; a pair-loop contributes its fragments plus `LOOPCOUNT=N`; **[I1]** error state joins episode signatures too. Contiguous identical-signature episodes collapse to `loop N times <representative label>` wrapping the episode body. Indentation: 2 spaces per nesting level. Invocation values are excluded from signatures (arrow style substitutes — a reference-platform quirk worth keeping for simplicity).
- **Cross-session dedup:** normalize the session header line (**[I2]** the whole metadata header, not just the id), hash/compare full text, collapse identical flows across sessions (report the mapping via `dedupOf` in structured output).

### 6.4 Edge-case ledger (each becomes a fixture test)

1. NULL `MessageBodyClassName` rows must be retained (NULL-safe filter).
2. Ordering ties broken by ID; ID-only fallback path exercised.
3. Episode signatures must include loop counts, else different-count episodes wrongly merge.
4. **Abandoned sync request:** one unanswered Inproc request must not inflate the depth stack and swallow all later episodes — unwind when a new request's source ≠ top frame's destination, and when a response answers a deeper frame.
5. Trace-utility events *between* episodes attach to the previous episode so contiguity (and thus compression) isn't broken.
6. Queue-rooted episodes: an async request with a known paired response opens a compressible episode that closes when that response is consumed.
7. Envelope-wrapper flows (an outer sync wrapper request whose response arrives at the very end) start episode detection at depth 2 — the reference used a domain heuristic (first-request class / `.SERVICES`→`.PROCESS` naming + wrapper response in the last few events); a simplified general rule is acceptable if fixtures prove equivalent.
8. Warnings must survive both compression tiers.
9. Dedup of an empty key must not error.
10. Large traces: no truncation in the reference (compression is the strategy); our MCP context adds the `maxRows`/`truncated` safety net on top.
11. **[I1]** An errored pair adjacent to identical clean pairs must NOT merge into their loop (error-in-signature rule).
