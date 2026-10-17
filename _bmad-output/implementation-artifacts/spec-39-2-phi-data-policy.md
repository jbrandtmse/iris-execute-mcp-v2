---
title: 'Story 39.2: PHI Data Policy'
type: 'feature'
created: '2026-10-16'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/.claude/rules/iris-objectscript-basics.md'
  - '{project-root}/.claude/rules/object-script-testing.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings:
  - oversized
deferred: []
---

<intent-contract>

## Intent

**Problem:** Nothing governs message-body content (G50). The `iris_message_resend` preview returns the first 1 KB of a stream body verbatim, and Stories 39.3–39.5 are about to add body search, Search Table lookup and a body reader with no policy to apply.

**Approach:**
- Add a framework PHI data policy to `@iris-mcp/shared`: a per-profile `dataPolicy` (`block` | `redact` | `allow`, default `redact`, L-2), configured from the `IRIS_PROFILES` entry, the operator variable `IRIS_DATA_POLICY` and the governance file. It is reported by `iris_server_profiles` and recorded in the audit log.
- Add an HL7 v2 (ER7) redaction engine. It is fail-closed: it keeps a reviewed list of non-identifying fields per segment and redacts every other field, including every field of an unreviewed segment or a Z-segment. Add one IRIS-side body classifier, `MessageSearch.BodyKind`.
- Put the resend preview's `bodySummary` under the policy. That is the one sanctioned AD-15 change.
- Classify every tool of the suite as governed, residual or not applicable, as of 2026-10-16.

## Boundaries & Constraints

**Always:**
- **Values.** The three values are ordered by strictness: `block` > `redact` > `allow`. Every channel accepts them case-insensitively and stores them in lowercase. An empty `IRIS_DATA_POLICY` counts as unset.
- **Precedence** (AD-9, mirroring AD-6's order). For profile P, the first value found wins:
  1. the `IRIS_PROFILES` entry of P, field `dataPolicy`;
  2. `IRIS_DATA_POLICY`;
  3. the governance file's `dataPolicy.profiles.P`;
  4. the governance file's `dataPolicy.global`;
  5. `redact`.

  A value on the `default` entry applies to `default` only and is never inherited. Each profile records its source as one of `IRIS_PROFILES`, `IRIS_DATA_POLICY`, `IRIS_GOVERNANCE_FILE:profiles`, `IRIS_GOVERNANCE_FILE:global` or `default`.
- **The governance-file grammar.** One new top-level key, `"dataPolicy": {"global": "<policy>", "profiles": {"<name>": "<policy>"}}`, with both members optional. It is accepted only from `IRIS_GOVERNANCE_FILE`. `IRIS_GOVERNANCE` rejects the key and points to the right channels. Tool-key layers (`global`, `profiles`) are untouched, and a document without `dataPolicy` behaves exactly as before.
- **Fail-fast startup (AD-8, M1).** Startup fails on any of these, naming the channel:
  - a malformed value;
  - a non-object `dataPolicy`;
  - a key inside `dataPolicy` other than `global` or `profiles`;
  - `dataPolicy` in `IRIS_GOVERNANCE`.

  File-channel texts never echo file content, following the precedent. An unknown profile name under `dataPolicy.profiles` only warns.
- **A caller only tightens.** `tightenDataPolicy(operator, requested)` returns the stricter of the two, and reports `clamped: true` when the requested value was looser (AD-9). No tool takes a caller policy parameter in this story.
- **Redaction (AD-26).**
  - It runs only on the complete, unsanitized ER7 text. IRIS supplies the text uncut, up to an explicit cap that TypeScript sends. Truncation and sanitization run afterwards, in TypeScript.
  - Body kind comes only from the body class (`BodyKind`), never from content. Only `hl7v2` is redactable. Every other kind with a readable body is blocked under `redact`, with a reason. A header with no readable body (`missing`, `literal`, or a body that does not open) has the outcome `none`.
  - An HL7 body that is too large, unreadable or unparseable is also blocked. Nothing is ever passed through unredacted.
- **The preview under `allow`** sends today's exact request (`{headerIds, namespace}`) and returns today's exact result. No new field appears, in the wire, `structuredContent` or `content`.
- **Policy outcomes are visible.** The response carries `dataPolicy: {policy, redacted, blocked}` and a per-item `bodyPolicy`. Every audit entry of a governed key whose profile resolved carries `dataPolicy: {policy, redacted, blocked}`. `outcome` keeps its domain `ok | error | denied` (AD-19).
- **PHI-bearing inputs** are declared on the `ToolDefinition` (`dataPolicy.phiInputs`). Under `IRIS_AUDIT_LOG_PARAMS`, their values become `"[REDACTED]"` under `redact`, under `block`, and when the profile is unresolved. Parameter names are never matched.
- **No echo.** Message-body content never reaches console logs or the audit file, under any policy. New texts (refusal reasons, configuration errors) never echo body content or a caller value.
- **IRIS side** (AD-11, AD-12, AD-13). The preview route stays additive: `bodyDetail` and `bodyTextMaxChars` are optional request fields, validated before the namespace switch, and their texts name the parameter, never the value (AD-33). A `bodyText` catch path returns a fixed token, never exception text.
- **Live fixtures** are synthetic. Every identifying value contains `SYNTHPHI`; values that must survive contain `KEEPME`. Times fall on 2001-02-03 UTC.
  - They live only in the disposable namespaces `EXECMCPTMP392A` (the gate) and `EXECMCPTMP392P` (the Task 0 probes), in the classes `Story392.*` compiled inside those namespaces, and in the HSCUSTOM fixture class `ExecuteMCPv2.Temp.Story391Fixture`.
  - Every one is removed, with nothing-left assertions.
  - Every IRIS MCP call an agent makes names `server:"default"`. Inside the gate, the extra profile `loose` reuses the same connection settings, so it reaches the same instance.

**Never:**
- Never call `%Library.EnsembleMgr.EnableNamespace` (decision #21).
- Never start a production in HSCUSTOM, and never read HSCUSTOM's or another project's messages.
- No caller `dataPolicy` parameter on any tool, and no new tool or action, so no tool count moves.
- No change to `iris_message_search` (39.3/39.4 own `body`/`searchTable`), `TOOL_PAIRS` or prompts.
- No change to any other existing tool's output. `iris_production_logs`, `iris_message_diagram` and the SQL, global, document and execution tools stay residual (see Design Notes, decision (d)).
- No `resendFiltered`/`resend` behavior change. The 39.1 byte-identity replay stays green.
- Never run the bare governance-baseline generator, and never hand-edit `bootstrap-classes.ts`.
- No document or listing claims regulatory compliance.

## I/O & Edge-Case Matrix

**Fixture π** (namespace A, `SeedBodies("story392")`). It holds headers 1–9, every one a Request with status Error, source `Story392.Source`, target `Story392.Hl7Target`, and `TimeCreated` at 2001-02-03 09:00:0n UTC:

| ID | Body | Expected kind |
| --- | --- | --- |
| 1 | HL7 ADT^A01 2.5.1, with repetitions, components, subcomponents and escape sequences in PID-3, PID-5 and PID-11, plus NK1, PV1, GT1, IN1, OBX (OBX-3 text `KEEPME-GLUCOSE`, OBX-5 free text), NTE and the Z-segment ZPI | `hl7v2` |
| 2 | HL7 ACK (MSH, MSA, ERR; no PID) | `hl7v2` |
| 3 | `%Stream.GlobalCharacter`, 1500 characters with CR, LF and tab | `stream` |
| 4 | `Ens.StringRequest` | `persistent` |
| 5 | `Ens.StreamContainer` | `streamContainer` |
| 6 | body class `Story392.Body.Missing` (not compiled) | `missing` |
| 7 | empty body class, body ID `SYNTHPHI-LITERAL` | `literal` |
| 8 | HL7 with non-default separators (`MSH#!@$%…`) | `hl7v2` |
| 9 | HL7 whose OBX-5 holds 70,000 characters | `hl7v2`, too large |

**Fixture ρ** is headers 10–12: Request, status Error, source `Story392.Source`, target `Story392.Target`, `Ens.StringRequest` bodies, `TimeCreated` at 2001-02-03 10:00:0n UTC. Its window is `from:"2001-02-03T10:00:00Z"`, `to:"2001-02-03T10:59:59Z"`.

All tool calls pass `namespace:"EXECMCPTMP392A"` explicitly. A call on a named profile uses `session.callOn("<profile>", …)` (`process-gate-helpers.ts:271`).

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Precedence | P has `IRIS_PROFILES` `block`; `IRIS_DATA_POLICY=allow`; file `profiles.P` `allow`; file `global` `allow` | P is `block` from `IRIS_PROFILES`. Removing one layer at a time gives `allow` from `IRIS_DATA_POLICY`, from `IRIS_GOVERNANCE_FILE:profiles` and from `IRIS_GOVERNANCE_FILE:global`, and finally `redact` from `default` | none |
| Never inherited | `IRIS_PROFILES` `{"default":{"dataPolicy":"allow"},"p":{}}` | `default` is `allow` from `IRIS_PROFILES`; `p` is `redact` from `default` | none |
| Server Manager profile | file `profiles.sm` = `block` | `sm` is `block` from `IRIS_GOVERNANCE_FILE:profiles` | none |
| Bad values | `IRIS_DATA_POLICY=open`; an `IRIS_PROFILES` `p.dataPolicy` of `3`; file `dataPolicy` `"block"` (a string); file `global` `"x"`; file `dataPolicy.extra`; `IRIS_GOVERNANCE` `{"dataPolicy":{}}` | Startup fails. The texts are, in order:<br>`IRIS_DATA_POLICY must be "block", "redact" or "allow". Received: "open".`<br>`IRIS_PROFILES is invalid: profile "p": "dataPolicy" must be "block", "redact" or "allow".`<br>`IRIS_GOVERNANCE_FILE is invalid: … (path: …)`, which names the key and never the value<br>`IRIS_GOVERNANCE is invalid: "dataPolicy" is read only from IRIS_GOVERNANCE_FILE. Set IRIS_DATA_POLICY for every profile, or "dataPolicy" on an IRIS_PROFILES entry for one.` | fail fast |
| Case and empty | `IRIS_DATA_POLICY=BLOCK`; `IRIS_DATA_POLICY=""` | `block`; unset | none |
| Unknown profile | file `dataPolicy.profiles.ghost` | One `[WARN]` naming `ghost` and `dataPolicy.profiles`. Startup continues | warn |
| Tighten | operator `redact`, requested `allow`; requested `block`; none requested | `{redact, clamped:true}`; `{block, clamped:false}`; `{redact, clamped:false}` | none |
| Discovery | a server with no data-policy configuration; then the Precedence configuration | Each roster entry adds `dataPolicy` and `dataPolicySource`. With no configuration, the `default` entry is `{…today's fields, dataPolicy:"redact", dataPolicySource:"default"}`; with the Precedence configuration, each profile reports its resolved pair | none |
| Engine: golden | the two golden fixtures (Design Notes) | Output equals the golden text. `redactedFields` is exact. Segment order, terminators and empty fields are preserved. Every non-empty leaf of a redacted field becomes `***`, and separators are kept | none |
| Engine: variety (Rule #58) | CR, CRLF, LF and mixed terminators; trailing terminator present or absent; blank lines; escapes (`\F\ \S\ \T\ \R\ \E\ \X0D\ \H\ \N\`) in kept and in redacted fields; repetitions, components and subcomponents; a Z-segment; PD1 and MRG (unreviewed); missing PID; an MSH-only message; an FHS/BHS/BTS/FTS batch; non-default separators; non-ASCII values (authored as escapes) | No `SYNTHPHI` survives in any output. Every `KEEPME` value and every kept field is byte-identical. Redacting twice gives the same result | none |
| Engine: refuses | no MSH/FHS/BHS first segment; separators that repeat, are alphanumeric or contain `*`; a segment name not matching `^[A-Z][A-Z0-9]{2}$` (including an LF inside a segment) | `{ok:false, reason}`, where the reason is a fixed text and contains no input | blocked |
| IRIS parser oracle (Rule #36) | each non-batch engine fixture, parsed by IRIS (`Hl7Fields`, in A) before and after redaction | The segment names match. Every kept position equals IRIS's original value. Every other position holds only `***` and separators. Every fixture has at least one non-empty redacted field | none |
| Preview, `redact` (default) | the tool, `headerIds:[1..9]`, no `IRIS_DATA_POLICY` | The wire sends `bodyDetail:"text"` and `bodyTextMaxChars:65536`.<br>Items 1, 2 and 8: `bodyPolicy:{outcome:"redacted", redactedFields>0}`; `bodySummary` is the first 1024 characters of the redacted text, control characters (except tab) replaced by spaces, `...` appended at 1024 or more.<br>Items 3, 4, 5 and 9 are `blocked`, with `bodySummary:""` and a reason; 9's reason names the 65536 cap.<br>Items 6 and 7 are `none`, with `bodySummary:""`.<br>The result carries `dataPolicy:{policy:"redact", redacted:3, blocked:4}`, plus one trailing `content` line, and no `bodyText`, `bodyTextOmitted` or `bodyAvailable` key anywhere.<br>`SYNTHPHI` appears nowhere in the result | none |
| Preview, `block` | `IRIS_DATA_POLICY=block` | The wire sends `bodyDetail:"kind"`, so IRIS returns no body content: no `bodyText` and no `bodySummary`. Items 1–5, 8 and 9 are `blocked` with the block reason; 6 and 7 are `none`. `{policy:"block", redacted:0, blocked:7}`. No `SYNTHPHI` | none |
| Preview, `allow` (AD-15 pin) | `IRIS_DATA_POLICY=allow` | The result equals the tool capture taken before the change. Item 3's summary contains `SYNTHPHI` (the positive control). Item 1 is `(non-stream body; class=EnsLib.HL7.Message)` | none |
| Route, legacy body (AD-33) | direct REST, `{headerIds:[1..9], namespace:A}` | The raw text equals the REST capture | none |
| Route, new fields | direct REST: `bodyDetail:"text"` with `bodyTextMaxChars:100`; `bodyDetail:"raw"`; `bodyTextMaxChars` of 0, 1048577 or `"x"` | Item 1 gives `bodyTextOmitted:"tooLarge"`. The bad values give an envelope error naming the parameter, never the value. A bad value sent with the unknown namespace `EXECMCPTMP392Z` gets the parameter error (validation comes first) | refusal |
| Per profile | `IRIS_PROFILES={"loose":{"dataPolicy":"allow"}}`, plus a file `{"dataPolicy":{"global":"block"}}` | `server:"loose"` gives the `allow` capture. `default` gives the `block` result. `iris_server_profiles` reports `loose` `allow` from `IRIS_PROFILES` and `default` `block` from `IRIS_GOVERNANCE_FILE:global` | none |
| Audit and logs | `IRIS_AUDIT_LOG=<tmp>`, `IRIS_AUDIT_LOG_PARAMS=true`, `LOG_LEVEL=DEBUG`; preview under `redact`, then under `allow` | The entry is `{tool:"iris_message_resend", action:"preview", outcome:"ok", dataPolicy:{policy:"redact", redacted:3, blocked:4}}`, and under `allow` `dataPolicy:{policy:"allow", redacted:0, blocked:0}`. Neither the JSONL file nor the server's stderr contains `SYNTHPHI`, under either policy | none |
| PHI inputs | a synthetic tool with `dataPolicy:{phiInputs:["value"]}`, called with `value:"SYNTHPHI-X"` | `params.value` is `"[REDACTED]"` under `redact`, under `block` and for an unknown `server`. It is the value under `allow`. `paramKeys` lists `value` in every case | none |
| Policy refusal | a synthetic governed tool returns `refusalResult("DATA_POLICY_BLOCKED", …)` | The audit has `outcome:"error"`, the error text, and a `dataPolicy` field | refusal |
| Registration | `dataPolicy.actions` names a non-action; `phiInputs` names an absent key, or `server` | The construction throws `Tool "<name>" declares dataPolicy …` | throw |
| Scope (Rule #56) | the built dists of all five servers | Every tool name of the suite (109) has exactly one scope row. The governed rows equal the `ToolDefinition`s that declare `dataPolicy` (today `iris_message_resend` `preview`). The `tool_support.md` scope table lists exactly the governed and residual rows | none |
| DW-570, executing path | a production of `Story392.Production` (item `Story392.Target`, class `Story392.Operation`) started in A; raw REST `resendFiltered` with `item:"Story392.Target"`, `status:"Errored"`, ρ's window, `maxMessages:3`, `dryRun:false`, `confirm:true` | `matchCount:3`. `results` lists IDs 10, 11 and 12 in `TimeCreated` order, each `ok:true` with a fresh `newHeaderId`. `summary:{total:3, succeeded:3, failed:0}`. Oracle SQL in A: 3 new headers to `Story392.Target` whose `Description` starts with `Resent `. Afterwards the production is stopped, no process runs in A, and no `^%SYS("Ensemble","RunningNamespace","EXECMCPTMP392A")` remains | none |
| DW-575 | `PreviewOne` type label | The label comes from `MessageSearch.TypeLabel`. The allow and REST captures stay byte-identical | none |

</intent-contract>

## Code Map

**TypeScript, shared (`packages/shared/src/`)**
- `config.ts:9-77` `IrisConnectionConfig`. Add `dataPolicy?: DataPolicy` and `dataPolicySource?: DataPolicySource`. `loadConfig` (:118) does not set them, so the `config.test.ts:149` pin holds. Its error-text precedent is ``${VAR} must be <rule>. Received: "${raw}".`` (:207-217, `IRIS_SQL_READ_ONLY`).
- `profiles.ts`:
  - `ProfileOverride` (:156-164) gains `dataPolicy?: unknown`.
  - `mergeProfile` (:215-389) validates it with the `profilesError` style (:187). It sets `dataPolicy` with `dataPolicySource:"IRIS_PROFILES"` only from `override`, never from `base`.
  - `buildProfileRegistry` (:417-475): every entry merges over `defaultConfig`, never over the `default` entry, which is the "never inherited" property. Keep it.
  - Server Manager profiles go through `mergeProfile` with no `dataPolicy` (`server-manager-source.ts:621`).
  - `ProfileClientRegistry` (:677) reads the registry lazily, so replacing map entries after startup is safe.
- `governance.ts`:
  - `GovernanceConfig` (:84) gains `dataPolicy?: {global?: DataPolicy; profiles?: Record<string, DataPolicy>}`.
  - `parseGovernanceRoot` (:354) skips only `global`/`profiles`, and fails on governance-shaped keys (`looksLikeGovernance`, :337). Add a channel argument: the file accepts `dataPolicy`, and the env channel rejects it with its own text. `parseGovernanceConfig` (:309), `loadGovernanceFile` (:554) and `parseGovernanceFileText` (:588) pass it. The `governanceError`/`governanceFileError` wrappers are at :100 and :110.
  - `unknownProfileWarnings` (:420) also covers `dataPolicy.profiles` names.
- `server-base.ts`:
  - `start()` (:1998-2059) builds the registry, then `parseGovernanceConfig`, then `loadGovernanceFile`, then the warnings. Right after the file loads, call `parseOperatorDataPolicy()` and `applyDataPolicies(this.profiles, operator, this.governanceFileConfig)`. This also covers the injected-config path (:2007).
  - `dispatchToolCall` (:1298) builds the context at `buildToolContext(…, profile, …)` (:1604), so `ctx.config.dataPolicy` is the effective policy. AD-3 is unchanged.
  - `recordAuditEntry` (:1661-1707) adds the `dataPolicy` field and the PHI-input redaction. `deriveAuditOutcome` (:1769) is unchanged, since only `GOVERNANCE_DISABLED` maps to `denied`.
  - Registration: `rebuildMutatesLookup` (:728) and `assertGovernanceClassified` (:817). `addTools`/`removeTools` re-run them (:1867, :1919). Add an `assertDataPolicyDeclarations` there; the precedent is `buildDefaultEnabledWrites` at `governance.ts:714`.
- `tool-types.ts:53-151` `ToolDefinition`: add `dataPolicy?: {actions?: readonly string[]; phiInputs?: readonly string[]}`. `ToolContext` (:217-296) is unchanged.
- `audit.ts`:
  - `REDACT_KEY_PATTERN`/`REDACTED_VALUE` (:30-33) and `redactValue` (:108) are untouched.
  - `AuditEntryInput` (:134) and `AuditEntry` (:193) gain `dataPolicy?`. `log()` (:270-292) writes it when present.
- `server-discovery.ts`: `ProfileRosterEntry` (:83) and `buildRosterEntry` (:192) are the allow-list. Add `dataPolicy` and `dataPolicySource` by conditional spread. The exact-shape pin is `__tests__/server-discovery.test.ts:214-226`.
- `refusals.ts:15` `REFUSAL_CODES`: add `DATA_POLICY_BLOCKED` ("a data policy withheld the requested body data"). The sorted-list pin is `__tests__/refusals.test.ts:46`.
- `index.ts`: the hand-written barrel. Export the new modules there; there is no `exports`-map change.
- `__tests__/startup-env.ts:33-57` `STARTUP_ENV_VARS`: add `IRIS_DATA_POLICY`. The guard is `packages/iris-mcp-all/src/__tests__/startup-env-roster.test.ts`, which reads shared's BUILT dist.
- Logging: `http-client.ts` logs method and path only (:142, :258, :263); no body is logged. `server-base.ts:1634` logs a thrown handler message, so the engine never throws with input text.
- Test helpers: `@iris-mcp/shared/test-helpers` exports `makeEnvHarness`, `stageDefaultStartup`, `callTool`, `createMockHttp`, `createMockCtx` and `envelope`. The audit JSONL read pattern is `audit-interceptor.test.ts:104, :174-200`.

**TypeScript, interop**
- `packages/iris-interop-mcp/src/tools/message-resend.ts`:
  - The preview branch is :386-410. Today it posts `{headerIds, namespace: ns}` to `${BASE_URL}/interop/message/resend/preview`, maps headers with `mapPreviewHeader` (:184-200, a spread plus ISO times), renders lines with `renderPreviewLine` (:212-222, which never shows `bodySummary`), and returns `toStructured({...result, headers})` (:162-170).
  - The description's preview sentence is at :250-254. Annotations (:346-351) and `mutates` (:358-362) are unchanged.
  - The handler reads only `ctx.resolveNamespace` and `ctx.http`.
- Existing preview unit tests (`src/__tests__/message-resend.test.ts:256-332, :336-467, :777-788`) use `createMockCtx`, whose config has no `dataPolicy`, so they would now run under `redact`. Give them `dataPolicy:"allow"` so they keep pinning the legacy wire.
- `message-resend-governance.test.ts:139-155` (preview allowed) is unaffected.

**IRIS side**
- `src/ExecuteMCPv2/REST/MessageResend.cls`:
  - `BodySummary` (:166-195): stream bodies give `Read(1024)` with control characters except tab turned to spaces, and `...` at 1024 or more. Other classes give `(non-stream body; class=X)`, and a missing class or ID gives `""`.
  - `PreviewOne(pId)` (:200-251): the type `$Select` is at :229 (DW-575), and `bodySummary` at :239.
  - `MessageResendPreview` (:258-310): validates, then switches namespace at :277-281. That is where `bodyDetail`/`bodyTextMaxChars` are validated, before the switch.
  - `resendFiltered`:
    - guard d (:550-556), then guard f, `IsProductionRunning` (:559-565);
    - the fetch `SELECT TOP <max> ID … ORDER BY TimeCreated` (:567-577);
    - `ResendBatch` (:583, :343-361) and `ResendOne` (:316-338) → `ResendDuplicatedMessage`.
- `irislib/Ens/MessageHeader.cls:443-478`: `ResendDuplicatedMessage` needs a running production. A Request's target must be a running item ("Target config item '…' is not running"). The copy is enqueued.
- `src/ExecuteMCPv2/REST/MessageSearch.cls`: `TypeLabel` (:106-109). Put `BodyKind` and `Hl7Text` beside it. `COLUMNS` (:30) excludes `ErrorStatus`/`Description`.
- `src/ExecuteMCPv2/REST/Dispatch.cls:120` is the preview route, unchanged.
- HL7 API (`irislib/EnsLib/HL7/Message.cls`, 2026.2 build 221U):
  - `OutputToLibraryStream(pLibStream, pSeparators, …)` (:1607) writes the complete text, children included. Use it rather than `OutputToString`, because `OutputToIOStream`'s segment loop (:1643-1651) can drop a segment past the long-string limit and still return OK.
  - `RawContent` is truncated at 10000 characters (:88-90, :1570); never use it.
  - Default separators are `|^~\&` with a CR terminator only (`Segment.cls:289`; `EnsHL7.inc:36-41,56,68`). Each segment's data is written as stored.
  - `ImportFromString(pString, .pStatus)` (:1709) returns an unsaved non-batch message (`%Save` it). Batches save while parsing.
  - Segments: `SegCount`, `GetSegmentAt(i)`, `Segment.Name`, `EDI.Segment.Count` and `GetValueAt(n)` (`Segment.cls:923`).
  - Schema: `EnsLib.HL7.Schema.GetFieldNameFromNumber(cat, seg, n)` (`Schema.cls:1121`).
- Body-class hierarchy (Task 0 a confirms it live):
  - `EnsLib.HL7.Message` (no class in irislib extends it);
  - `EnsLib.EDI.XML.Document`;
  - other `Ens.VDoc.Interface` documents: X12, EDIFACT, ASTM, `EnsLib.ebXML.Message`, `EnsLib.REST.DynamicObjVDoc`;
  - `Ens.StreamContainer`, extended by `EnsLib.HTTP.GenericMessage` and `Ens.MFT.StreamContainer`;
  - `%Stream.Object`;
  - `Ens.StringRequest` → `Ens.Request` → `Ens.MessageBody`;
  - `Ens.StringContainer` (`%Persistent`).
  - An empty `MessageBodyClassName` means `MessageBodyId` holds a literal value (`MessageHeader.cls:120-122`).
- Production start (`irislib/Ens/Director.cls:14-51`, `%SYS/Ensemble.cls:273-280`, `%Library/EnsembleMgr.cls:79-83`):
  - `StartProduction` requires `IsEnsembleNamespace()`, which is `$Data(^|ns|oddCOM("Ens.StudioManager"))`. This is probably satisfied by the `Ens` package mapping, and is unverified (Task 0 d).
  - It also requires an `Ens.Config.Production` row, which compiling an `Ens.Production` subclass creates.
  - `Ens.BusinessOperation`'s default `OnMessage` errors (:707-709), so `Story392.Operation` overrides it to return `$$$OK`.
- `iris_production_control` (`production.ts:95`) → `Interop.cls:ProductionControl` (:258, start :303, stop :311). `start` and `stop` are frozen-baseline keys, enabled by default.
- `scripts/gen-bootstrap.mjs` `classes[]` has 31 entries, and `BOOTSTRAP_VERSION` is `6dcdd238c792` (`bootstrap-classes.ts:25`). No class is added.

**Live harness** (`packages/iris-mcp-all/src/__tests__/`)
- `interop-namespace-fixture.ts`:
  - `FIXTURE_CLASS_SOURCE` (:51): `Add` (:61-79), `Seed` (:83, guarded by `EXECMCPTMP391`+1U), `RemoveDatabaseFiles` (:123) and `Leftovers` (:147). The latter two are guarded by `EXECMCPTMP` + digits + 1U.
  - `putFixtureClass`/`removeFixtureClass` (:218, :229), `createInteropNamespace` (:242), `removeInteropNamespace` (:283), `seedHeaders` (:307) and `leftovers` (:328).
  - The TS name guard is `/^EXECMCPTMP\d+[A-Z]$/` (:48).
- `process-gate-helpers.ts`:
  - `openWireSession(options, extraEnv)` (:237), whose options include `onStderr` (:228), and `withWireSession` (:279);
  - `spawnAndWaitForExit` (:115), `atelierQuery` (:334), `executeMcpPost` (:360) and `docFixtures(session, namespace?)` (:389);
  - `shippedBootstrapVersion` (:434) and `assertDeployedBootstrapVersion` (:455).
- The precedent gate is `story-39-1-message-search-live-gate.test.ts`:
  - `beforeAll` :182-229 and `afterAll` :231-259, with each teardown step in its own guard;
  - the capture row and the byte-identity replay at :292-313, against `fixtures/story-39-1-resend-baseline.json`.
- `scripts/prepublish-gate.mjs:105-140` `gateTestFiles` lists 9 files. `live-gate-roster.test.ts` arms on `process.env.IRIS_REQUIRE_LIVE ===`.
- The cross-package tool loader is `scripts/lib/tool-catalog.mjs` `loadAllTools`. The precedent is `default-enabled-holders.test.ts:18-25`.

**Docs**
- `README.md`:
  - the env table (:68-98), with `IRIS_SQL_READ_ONLY` (:88) as the row model;
  - the optional-variable list (:100);
  - the refusal table (:476-485);
  - the fail-fast list (:605);
  - the audit section (:697-720; redaction at :709).
- `packages/iris-interop-mcp/README.md:227`: the preview bullet.
- `tool_support.md`.
- `CHANGELOG.md:5`: the top section is Story 39.1. The new section must not contain the `` `full` N/N/N/N/N `` roster pattern.
- `.changeset/`.

## Tasks & Acceptance

**Execution** (in dependency order):

*Task 0: probes, the fixture extension and the capture, before any edit to a bootstrapped class.*
1. **Probes (Rule #16).** Use `ExecuteMCPv2.Temp.Story392Probe` in HSCUSTOM (data-free) and a throwaway mapping-only `EXECMCPTMP392P`, built and removed with 39.1's Step L. Record each result under Verification, with the IRIS version.
   - (a) `$ClassMethod(c,"%Extends",s)` gives the expected `BodyKind` for every class listed in item 6.
   - (b) An ER7 text imported with `ImportFromString` and `%Save`d in `EXECMCPTMP392P` comes back complete from `OutputToLibraryStream` into `%Stream.TmpCharacter`, with CR terminators. CRLF input is stored as CR. A message with the separators `#!@$%` imports, and comes back with its own separators.
   - (c) Every keep-list entry (Design Notes) has the expected name in `EnsLib.HL7.Schema.GetFieldNameFromNumber("2.5.1", seg, n)`. If a number is wrong, correct the number, not the name, and record it.
   - (d) Production lifecycle in `EXECMCPTMP392P`:
     1. `docFixtures` puts and compiles `Story392.Operation` and `Story392.Production`;
     2. `iris_production_control` `start` (namespace P);
     3. `iris_production_status`;
     4. `stop` with force;
     5. then no process has `NameSpace="EXECMCPTMP392P"` (`%SYS.ProcessQuery`), no `^%SYS("Ensemble",*,"EXECMCPTMP392P")` subscript remains, and the teardown leaves nothing.

     Before step 4, one `##class(Ens.MessageHeader).ResendDuplicatedMessage` of a seeded Request header (source `Story392.Source`, target `Story392.Target`) must return OK with a new header ID.

     **If (d) fails, or leaves residue the teardown cannot remove:** record the evidence, decline DW-570 under Design Notes, and skip every item marked *(DW-570)*.
   - (e) Segment numbering: `GetValueAt(1)`/`GetValueAt(2)` on MSH, and the field count of a parsed PID.
   - (f) The deployed `BOOTSTRAP_VERSION` is `6dcdd238c792`.
2. `packages/iris-mcp-all/src/__tests__/interop-namespace-fixture.ts`: extend it; do not copy.
   - In `FIXTURE_CLASS_SOURCE`, add these methods:
     - `SeedBodies(pSet)`: set `"story392"`, guarded to `1"EXECMCPTMP392"1U`, refusing a namespace that already holds headers. It creates fixtures π and ρ through `Add`, with explicit times and literal codes. It returns the JSON ID map `{"pi":"1..9","rho":"10..12"}`.
     - `Hl7Fields(pText)`: `ImportFromString`, then JSON `[{name, fields:[…]}]` read through `GetSegmentAt`/`GetValueAt`. It is called only with `namespace:"EXECMCPTMP392A"`.
     - `Leftovers` also lists any `^%SYS("Ensemble",*,<ns>)` subscript, and any process whose namespace is one of `pNames`.
   - TS additions:
     - `seedBodies(dev, name)`;
     - `hl7Fields(dev, name, text)`;
     - the constants `STORY392_OPERATION_SOURCE` and `STORY392_PRODUCTION_SOURCE` (production `Story392.Production`, item `Story392.Target`, `PoolSize` 1, enabled) *(DW-570)*.
3. `packages/iris-mcp-all/src/__tests__/story-39-2-data-policy-live-gate.test.ts` (new): write the capture row `it.runIf(process.env.STORY_39_2_CAPTURE === "1")`. It writes `fixtures/story-39-2-preview-baseline.json`:

   `{capturedWithBootstrapVersion, irisVersion, capturedAt, command, rest:[{name, body, status, text}], tool:[{name, args, structuredContent, text}]}`

   It holds the legacy REST preview of `[1..9]` and the tool preview through the PRE-change built interop server. Run it with the pre-change classes and dists (Verification step C).

*Task 1: IRIS side.*

4. `src/ExecuteMCPv2/REST/MessageSearch.cls`:
   - **`BodyKind(pClassName) As %String`.** In this order: `""` → `literal`; not `%Dictionary.CompiledClass.%ExistsId` → `missing`; `EnsLib.HL7.Message` → `hl7v2`; `EnsLib.EDI.XML.Document` → `xmlvdoc`; `Ens.VDoc.Interface` → `vdoc`; `%Stream.Object` → `stream`; `Ens.StreamContainer` → `streamContainer`; `%Library.Persistent` → `persistent`; anything else → `other`.
   - **`Hl7Text(pBodyClass, pBodyId, pMaxChars, Output pText) As %String`.** It returns `""` with the complete `OutputToLibraryStream` text in `pText`; `tooLarge` when the size is over `pMaxChars`; or `unreadable` on any error, without exception text.
5. `src/ExecuteMCPv2/REST/MessageResend.cls`:
   - **`PreviewOne(pId, pBodyDetail As %String = "", pMaxChars As %Integer = 0)`.**
     - With `""`, the code and output stay exactly as today.
     - Otherwise there is no `bodySummary`. It adds `bodyKind` (`BodyKind`) and `bodyAvailable` (the same open test as `BodySummary`).
     - For `text` on an available `hl7v2` body, it adds `bodyText`, or `bodyTextOmitted` (`tooLarge`|`unreadable`).
     - DW-575: the type label becomes `##class(ExecuteMCPv2.REST.MessageSearch).TypeLabel(tType)`.
   - **`MessageResendPreview`.** Before the namespace switch, it validates the optional `bodyDetail` (`kind`|`text`; text `bodyDetail must be kind or text.`) and `bodyTextMaxChars` (an integer from 1 to 1048576; default 65536 when `bodyDetail` is `text`; text `bodyTextMaxChars must be an integer from 1 to 1048576.`), then passes both through.
6. `src/ExecuteMCPv2/Tests/MessagePreviewPolicyTest.cls` (new; data-free; not in the manifest; at most 500 lines):
   - **`TestBodyKindEveryKind`:** `""`, `No.Such.Story392Class`, `EnsLib.HL7.Message`, `EnsLib.EDI.XML.Document`, `EnsLib.EDI.X12.Document`, `%Stream.GlobalCharacter`, `Ens.StreamContainer`, `EnsLib.HTTP.GenericMessage`, `Ens.StringRequest`, `Ens.StringContainer` and `%Library.DynamicObject`. That gives every kind, `other` included.
   - **`TestHttpPreviewBodyDetailRefusals`:** each bad value from the matrix, sent over real HTTP with `namespace:"EXECMCPTMP392Z"`. The text names the parameter and not the value. It uses its own `ResolvePort`/`PostJson`, the 39.1 Rule 2 precedent.
7. Run `pnpm gen:bootstrap` and record `BOOTSTRAP_VERSION` `6dcdd238c792` → new; the roster stays 31 (Rule #24).

*Task 2: TypeScript, shared.*

8. `packages/shared/src/data-policy.ts` (new):
   - **Types:** `DATA_POLICIES`, `DataPolicy`, `DataPolicySource`, and `BODY_KINDS` (the nine tokens of item 4) with `BodyKind`. `isRedactableBodyKind(k)` is true only for `hl7v2`.
   - **Parsing:** `parseDataPolicyValue(raw)`, and `parseOperatorDataPolicy(env = process.env)`, which reads `env.IRIS_DATA_POLICY` and fails fast with the matrix text.
   - **Resolution:** `resolveDataPolicy(profile, operator, fileConfig)` → `{policy, source}`; `applyDataPolicies(registry, operator, fileConfig)` replaces each registry entry with `{...profile, dataPolicy, dataPolicySource}`; `effectiveDataPolicy(config)` returns `config.dataPolicy ?? "redact"`.
   - **Tightening:** `tightenDataPolicy(operator, requested?)`.
   - **Outcome types:** `DataPolicySummary {policy, redacted, blocked}`, and `BodyPolicyOutcome {outcome:"redacted", redactedFields} | {outcome:"blocked", reason} | {outcome:"none"}`.
9. `packages/shared/src/hl7-redaction.ts` (new):
   - **Data:** `HL7_REDACTION_REVIEW` `{date:"2026-10-16", hl7Version:"2.5.1", sources}`; `HL7_KEEP_FIELDS` (the Design Notes table, field names in comments); `HL7_SAFE_HARBOR_FIELDS` (the cross-check inventory, with categories); `HL7_REDACTED_VALUE = "***"`.
   - **`redactHl7(text)`** returns `{ok:true, text, redactedFields} | {ok:false, reason}`. It:
     - splits on `/\r\n|\r|\n/`, keeping each terminator;
     - reads the separators from every MSH/FHS/BHS segment;
     - follows MSH/FHS/BHS numbering, where the field separator is field 1;
     - redacts each non-kept non-empty field leaf by leaf (repetition, component, subcomponent), keeping separators and empty leaves;
     - redacts every field of a segment not in `HL7_KEEP_FIELDS`;
     - follows the matrix's refusal rules.

     It never throws, and its reasons never include input.
10. `profiles.ts`, `governance.ts`, `config.ts`, `tool-types.ts`, `server-discovery.ts`, `refusals.ts`, `audit.ts`, `server-base.ts` and `index.ts`: the Code Map changes, implementing these matrix rows: Precedence through Discovery, PHI inputs, Policy refusal and Registration.
    - Audit `dataPolicy`: when the tool declares `dataPolicy` (and, with `actions`, the call's action is listed), record `{policy, redacted, blocked}`.
      - `policy` is `structuredContent.dataPolicy.policy` when that is valid, else the resolved profile's effective policy.
      - The counts are `structuredContent.dataPolicy` counts when they are non-negative integers, else 0.
      - The field is omitted when the profile is unresolved.
    - PHI inputs: replace the declared keys with `"[REDACTED]"` in a clone before `redactValue`.
11. `packages/shared/src/__tests__/startup-env.ts`: add `IRIS_DATA_POLICY`.

*Task 3: TypeScript, interop.*

12. `packages/iris-interop-mcp/src/tools/message-resend.ts`:
    - Add `dataPolicy: {actions: ["preview"]}`.
    - Under `effectiveDataPolicy(ctx.config)`:
      - **`allow`:** today's code path, unchanged.
      - **`redact`:** send `bodyDetail:"text"` and `bodyTextMaxChars: PREVIEW_BODY_TEXT_MAX_CHARS` (65536).
      - **`block`:** send `bodyDetail:"kind"`.
      - **Mapping per found item** (matrix):
        - `bodySummary` is set through `summarizeForPreview`, a function local to `message-resend.ts` that applies BodySummary's rule after redaction;
        - set `bodyKind` and `bodyPolicy`;
        - always delete `bodyText`, `bodyTextOmitted` and `bodyAvailable`;
        - an unknown kind token, or `hl7v2` without text or an omission, is `blocked`.
      - **Response:** the top-level `dataPolicy`, plus one trailing text line, `Data policy <policy>: <n> redacted, <m> withheld.`
    - The block reasons are fixed texts (Design Notes).
    - Replace the description's "a first-~1KB body summary," with "a first-~1KB body summary under the operator's data policy (`IRIS_DATA_POLICY`, set per profile; default `redact`: an HL7 v2 body shows only its non-identifying fields, every other body is withheld with a reason; `block` withholds every body; `allow` shows the summary unchanged),".

*Task 4: tests.*

13. Shared, all new unless noted:
    - `data-policy.test.ts`: precedence, values, tightening, the classifier tokens.
    - `hl7-redaction.test.ts`, plus `hl7-redaction-fixtures.ts` exported for the gate: the golden, variety and refusal rows, plus the cross-check `HL7_SAFE_HARBOR_FIELDS ∩ HL7_KEEP_FIELDS = ∅`.
    - `data-policy-server.test.ts`, on a real `McpServerBase` through `makeEnvHarness`/`stageDefaultStartup`/`callTool`: startup resolution, every fail-fast and warning row, the roster fields, the audit `dataPolicy` and PHI rows, the refusal row and the registration throws.
    - `governance-cli.test.ts` rows: `set` keeps a file's `dataPolicy` section byte-for-byte, and `validate` and `check` accept it.
    - Update `server-discovery.test.ts:214` and `refusals.test.ts:46`.
14. Interop:
    - `message-resend-policy.test.ts` (new, mocked HTTP): the wire body per policy, the mapping and stripping, the summary at 1023, 1024 and 1025 characters, every reason, and `allow` `toEqual` the legacy result.
    - Set `dataPolicy:"allow"` on the existing preview rows in `message-resend.test.ts`.
15. `packages/iris-mcp-all/src/__tests__/`:
    - `data-policy-scope.ts` (new: `DATA_POLICY_SCOPE_DATE = "2026-10-16"` and one row per tool, `{scope, governedActions?, reason}`, per Design Notes);
    - `data-policy-scope.test.ts` (new, default suite: the Scope row, over `loadAllTools`);
    - `story-39-2-data-policy-startup.test.ts` (new, default suite, closed port): `spawnAndWaitForExit` with each bad value, which exits 1 naming its channel;
    - `story-39-2-doc-claims.test.ts` (new).

*Task 5: the gate, docs and counts.*

16. Finish `story-39-2-data-policy-live-gate.test.ts`.
    - **`beforeAll`:**
      1. fails on a stale shared, dev, admin or interop dist, or an unreachable IRIS, when armed;
      2. runs `assertDeployedBootstrapVersion`;
      3. puts the fixture class, removes `EXECMCPTMP392A` by name and asserts nothing is left;
      4. creates A (interop), runs `SeedBodies`, and runs a positive leftovers control.
    - **`afterAll`:** each step in its own guard: stop the production *(DW-570)*, remove A, the leftovers check, remove the fixture class, delete the temp files, then check that `iris_doc_list` (HSCUSTOM, generated included) shows no `Story391Fixture`, `Story392Probe` or `Story392` document.
    - **Rows:**
      - every live matrix row through the BUILT interop server (sessions for default, `allow`, `block`, per profile plus a temp governance file, and audit with `onStderr` capture);
      - the REST rows through `executeMcpPost`;
      - the oracle row through `hl7Fields`;
      - the capture assertions `capturedWithBootstrapVersion === "6dcdd238c792"` and `!== shippedBootstrapVersion()`;
      - the DW-570 row, which starts and stops its own production through `iris_production_control` and drives the resend over raw REST. It reads no π header, so it does not depend on row order *(DW-570)*.
    - Add the file to `scripts/prepublish-gate.mjs` `gateTestFiles` with a comment.
17. Docs (Rules #30 and #43, minimal; 39.6 enriches):
    - **Root `README.md`:**
      - an env row for `IRIS_DATA_POLICY`: default `redact`; per profile through `IRIS_PROFILES` `dataPolicy` and the governance file `dataPolicy`; malformed fails startup;
      - an entry in the optional-variable list and in the fail-fast list;
      - a short "PHI data policy" subsection, with the values, the precedence, a pointer to the scope table, and the sentence "The data policy reduces exposure of message-body data; it is not a compliance certification.";
      - in the audit section, the `dataPolicy` field and the PHI-input redaction;
      - a refusal-table row for `DATA_POLICY_BLOCKED` ("returned from Story 39.3 on").
    - **Interop `README.md:227`:** the preview bullet, plus a `> **Data policy:**` line.
    - **`tool_support.md`:** a section "PHI data policy scope (as of 2026-10-16)" listing the governed and residual rows with reasons, plus the not-applicable rule.
    - **`CHANGELOG.md`:** the top section `## [Pre-release — 2026-10-16] — Story 39.2: PHI data policy`.
      - Changed: the preview `bodySummary` under the default `redact`, as the sanctioned AD-15 L-2 change; and the `BOOTSTRAP_VERSION` from → to.
      - Added; Tests.
    - **Changeset:** `.changeset/story-39-2-phi-data-policy.md` (`@iris-mcp/shared` minor, `@iris-mcp/interop` minor).
    - **Payload:** after rebuilding, the interop and suite payload rows equal `pnpm measure:tools-payload`.

**Acceptance Criteria:**
- **AC-1 (39.2.1; AD-9, AD-6, AD-8).**
  - Given each configuration in the Precedence through Discovery rows, when a server starts, then the effective `dataPolicy` and `dataPolicySource` of every profile are the stated ones, `iris_server_profiles` reports them, and every malformed value fails startup naming its channel.
  - Given a governance document with no `dataPolicy`, when any server or the governance CLI reads it, then the behavior is unchanged.
- **AC-2 (39.2.2; Rules #56 and #58).**
  - Given every engine fixture, when `redactHl7` runs, then no `SYNTHPHI` value survives, every kept field is byte-identical, terminators are preserved, and IRIS's own parser agrees on every position (the oracle row).
  - Given the shipped `hl7-redaction.ts`, when its cross-check test runs, then the keep-list and the Safe Harbor inventory carry the review date 2026-10-16 and their sources, and do not intersect.
- **AC-3 (39.2.3).**
  - Given `redact`, when the preview meets a body of kind `xmlvdoc`, `vdoc`, `stream`, `streamContainer`, `persistent` or `other`, or an HL7 body that is too large, unreadable or unparseable, then that body is `blocked` with a reason, `bodySummary` is `""`, and nothing of it is passed through.
  - Given `redact` or `block`, when a header has no readable body (`missing`, `literal`, or a body that does not open), then its outcome is `none` and `bodySummary` is `""`.
  - Given `block`, when the preview runs, then every body value is withheld and IRIS returns no body content.
  - Given `allow`, when the preview runs, then nothing changes.
- **AC-4 (39.2.4; AD-15, AD-33).**
  - Given fixture π, when the built interop server previews `[1..9]` under `IRIS_DATA_POLICY=allow`, then the result equals the pre-change capture, and the legacy REST body equals its capture.
  - Given fixture π and no data-policy configuration, when the same preview runs, then items 1, 2 and 8 are redacted HL7 summaries and items 3, 4, 5 and 9 are withheld.
  - Given the delivered tree, when `story-39-2-doc-claims.test.ts` runs, then `CHANGELOG.md`'s Story 39.2 section names the preview change.
- **AC-5 (39.2.5; AD-19).**
  - Given the audit session, when the preview runs under `redact` and then under `allow`, then:
    - each JSONL entry carries `dataPolicy` with the stated counts and `outcome:"ok"`;
    - the response carries `dataPolicy` and `bodyPolicy` under `redact`;
    - neither the audit file nor stderr contains `SYNTHPHI`.
  - Given `IRIS_AUDIT_LOG_PARAMS=true` and a tool that declares `phiInputs`, when it is called under `redact`, `block` or an unknown profile, then the declared values are `"[REDACTED]"`. Under `allow` they are logged.
  - Given the delivered docs, when `story-39-2-doc-claims.test.ts` runs, then the README carries the exposure sentence, and no document claims compliance.
- **AC-6 (AD-26 scope; Rule #56).** Given the built dists, when the scope test runs, then:
  - every suite tool has exactly one classification as of 2026-10-16;
  - the governed rows equal the `dataPolicy` declarations;
  - the `tool_support.md` table matches.
- **AC-7 (Integration; Rules 1 and 2).** Given fixture π and the gate's sessions, when the built interop server's `iris_message_resend` preview and `iris_server_profiles` run, then:
  - the preview produces the matrix's redact, block, allow and per-profile outcomes from the resolved policy, `BodyKind` and `redactHl7`;
  - `iris_server_profiles` reports each profile's `dataPolicy` and `dataPolicySource`;
  - the audit interceptor writes the `dataPolicy` field.
- **AC-8 (DW-570).** Given ρ and a running `Story392.Production` in A, when `resendFiltered` executes over REST, then the matrix row holds and the gate leaves no production, process or namespace behind. If item 1 (d) fails, the decline and its evidence are recorded instead.
- **AC-9 (DW-575; AD-14, AD-15).** Given the delivered tree, when the gates, `bootstrap.test.ts` and `pnpm gen:governance-baseline:check` run, then:
  - `PreviewOne` takes its type label from `MessageSearch.TypeLabel`, and the allow and REST captures are unchanged;
  - the 39.1 resend byte-identity replay stays green;
  - `BOOTSTRAP_VERSION` has moved, and the roster stays 31;
  - `GOVERNANCE_BASELINE` stays `1e62c5ad5bf7`/141;
  - no tool count moves.

## Spec Change Log

## Review Triage Log

## Design Notes

**Orchestrator decisions: DECIDED at the spec gate, 2026-10-16 (`orchestrator-decisions-wave-6.md` #23–#26; the spine's AD-26 "Configuration" and `architecture.md` N4 were updated, Rule 20).**
- **#23 = (a), the ALTERNATIVE, overriding the recommendation.** Under `redact`, the resend preview keeps today's HL7 summary, the `(non-stream body; class=…)` class note, and shows NO new HL7 body text. Non-HL7 bodies are withheld with a reason, as planned. The default policy must never show more body text than today's output (least exposure; L-2's intent).
  - The HL7 redaction engine (`hl7-redaction.ts`, the keep-list) is still built in this story and pinned by its own unit and oracle tests. Its first body-text consumer is `iris_message_body` (Story 39.5).
  - AC 39.2.4's "HL7 v2 bodies are redacted" is met by the engine and by the rule that the preview never shows unredacted HL7 text.
  - **The implement stage adjusts every Task, I/O row and Verification line that shows HL7 body text in the preview under `redact`.** Each one instead pins that the redact preview equals the class note and carries the policy disposition fields.
- **#24 = (b) as recommended:** a fail-closed keep-list, with a separate Safe Harbor inventory that is disjoint from it.
- **#25 = (c) as recommended:** the precedence as planned. The file-only top-level `dataPolicy` object is accepted; `IRIS_GOVERNANCE` rejects the key; a non-object top-level `dataPolicy` fails fast.
- **#26 = (d) as recommended:** in this story the policy governs the resend preview only. `iris_production_logs` and `iris_message_diagram` are residual. The lead files a ledger entry for extending the policy to them in the Epic 39 burn-down.

The planning text follows.
- **(a) How does the preview show an HL7 body under `redact`?**
  - **Recommended:** the first 1024 characters of the redacted complete ER7, sanitized as today.
  - **Because:** AC 39.2.4 says "HL7 v2 bodies are redacted". Today's HL7 summary is only `(non-stream body; class=…)` (`MessageResend.cls:179`), so keeping that note makes the clause vacuous and leaves the engine with no consumer in this story. `allow` must stay byte-identical, so under `allow` the HL7 summary stays the class note.
  - **The cost:** `redact` shows more HL7 structure than `allow` does.
  - **The alternative:** keep the class note under `redact` too. The engine's first consumer would then be 39.5.
- **(b) How is the PHI field list built?**
  - **Recommended:** fail-closed. Per reviewed segment, keep only the listed fields and redact every other field. Redact every field of an unreviewed segment or Z-segment. The PHI field list is the complement of the keep-list, and a separate Safe Harbor inventory must stay disjoint from it.
  - **Because:** there is no exhaustive published HIPAA-to-HL7 v2 map. The IHE De-Identification Handbook's HL7 v2 example names a selection and does not claim to be exhaustive. A deny-list that misses a field leaks it, while a keep-list that misses a field only over-redacts (Rule #56, and Rule #44's stricter side).
  - **The alternative:** a pure deny-list of Safe Harbor fields.
- **(c) The configuration grammar and precedence.**
  - **Recommended:** the precedence in the Boundaries; a file-only top-level `dataPolicy` object; `IRIS_GOVERNANCE` rejects the key.
  - **Because:** the AC names the `IRIS_PROFILES` entry and the governance file. The order mirrors AD-6 (env outranks file; profile outranks global). Tool-key layers stay boolean-only (`GovernanceLayer`), so `validateLayer`, the dead-key warning and `check` are untouched. Today, a top-level object fails fast.
  - **The one previously valid shape that now fails:** a top-level `dataPolicy` holding a non-object (a string is accepted today as metadata). Failing fast beats silently ignoring a key that reads as a policy (the 38.7 trap class).
  - **The alternatives:** a string `dataPolicy` key inside layers, or also accepting it in `IRIS_GOVERNANCE`.
- **(d) The scope.**
  - **Recommended:** only the resend preview is governed in this story. `iris_production_logs` (whose `Text` can carry segment text: `TCPOutboundAdapter.cls:68,72`, `Parser.cls:262,287`) and `iris_message_diagram` (sanitized `ErrorStatus`, which parser errors fill with segment text: `Parser.cls:223,280`; `Correlator.cls:194-198`) are residual, along with the SQL, global, document and execution tools.
  - **Because:** AD-15 sanctions only the preview change. Governing the logs or the diagram would change existing outputs by default. Operators can disable those keys.
  - **The alternative:** bring `iris_production_logs` under the policy. That needs a Lead-sanctioned AD-15 change.

**For the lead (Rule 20), once (c) is decided:**
- **AD-26.** Replace its Configuration bullet with: "Story 39.2. `dataPolicy` resolves per profile at startup, first found: the profile's `IRIS_PROFILES` `dataPolicy`, `IRIS_DATA_POLICY`, the governance file's `dataPolicy.profiles.<name>`, its `dataPolicy.global`, `redact`. `IRIS_GOVERNANCE` does not carry it. A malformed value fails startup naming its channel; an unknown profile name only warns. `iris_server_profiles` reports `dataPolicy` and `dataPolicySource`. Body kind comes from `MessageSearch.BodyKind`; only `hl7v2` is redactable, by a fail-closed keep-list (`hl7-redaction.ts`). Scope as of 2026-10-16: `tool_support.md`."
- **`architecture.md` N4.** Replace "Story 39.2 records the configuration precedence here." with the same precedence sentence.

**Plan-time interpretations** (apply and report):
- **I1. "Search values and body-filter values" (AC 39.2.5)** are the PHI-bearing inputs that Stories 39.3 (`filters` values) and 39.4 (the Search Table `value`) add and declare in `phiInputs`. 39.1's header filters (config item names, class names, session IDs, statuses, times) are not PHI-bearing and stay logged. This story ships the mechanism, pinned with a synthetic tool.
- **I2. "A caller value" in the no-echo rule** means a PHI-bearing input or body text. The preview's existing per-item `Header N not found` names a numeric header ID and stays byte-identical (AD-15).
- **I3. No caller `dataPolicy` parameter in this story.** `tightenDataPolicy` is the model, and its first consumer is 39.5.
- **I4. `DATA_POLICY_BLOCKED` joins the catalog now** (AD-19: the model owns the code). The first consumers are 39.3/39.4 (refusing under `block`).
- **I5. Under `allow` the preview carries no `dataPolicy` or `bodyPolicy` field**, which is the strongest form of the byte-identity pin. The audit still records `{policy:"allow", redacted:0, blocked:0}`.
- **I6. The governance resource and `iris-mcp-governance effective` do not report `dataPolicy`.** The AC names `iris_server_profiles`.
- **I7. The schema-level marker (AD-19) is `ToolDefinition.dataPolicy.phiInputs`.** It lists top-level input-schema keys, and registration verifies that each one exists in `inputSchema.shape`. It is a declaration about the schema, never a name pattern.

**The keep-list** (HL7 v2.5.1, reviewed 2026-10-16; every other field of these segments is redacted):

| Segment | Kept fields |
| --- | --- |
| MSH | 1 Field Separator; 2 Encoding Characters; 9 Message Type; 11 Processing ID; 12 Version ID; 15 Accept Acknowledgment Type; 16 Application Acknowledgment Type; 18 Character Set |
| FHS, BHS | 1 Field Separator; 2 Encoding Characters |
| FTS / BTS | 1 File Batch Count / 1 Batch Message Count |
| EVN | 1 Event Type Code; 4 Event Reason Code |
| MSA | 1 Acknowledgment Code |
| ERR | 3 HL7 Error Code; 4 Severity |
| PID | 1 Set ID; 8 Administrative Sex |
| NK1 | 1 Set ID; 3 Relationship; 7 Contact Role |
| PV1 | 1 Set ID; 2 Patient Class; 4 Admission Type; 18 Patient Type |
| GT1, IN1 | 1 Set ID |
| ORC | 1 Order Control; 5 Order Status |
| OBR | 1 Set ID; 4 Universal Service Identifier; 24 Diagnostic Serv Sect ID; 25 Result Status |
| OBX | 1 Set ID; 2 Value Type; 3 Observation Identifier; 4 Observation Sub-ID; 6 Units; 8 Abnormal Flags; 11 Observation Result Status |
| NTE | 1 Set ID; 2 Source of Comment |
| DG1 | 1 Set ID; 2 Diagnosis Coding Method; 3 Diagnosis Code; 6 Diagnosis Type |
| AL1 | 1 Set ID; 2 Allergen Type Code; 3 Allergen Code/Mnemonic/Description; 4 Allergy Severity Code |
| PR1 | 1 Set ID; 2 Procedure Coding Method; 3 Procedure Code |
| SPM | 1 Set ID; 4 Specimen Type |

**The Safe Harbor inventory** (independent of the keep-list; the cross-check signal, Rule #44):
- MSH 7, 10
- EVN 2, 3, 5, 6
- PID 2, 3, 4, 5, 6, 7, 9, 11, 12, 13, 14, 18, 19, 20, 21, 23, 29, 33
- NK1 2, 4, 5, 6, 16, 30, 31, 32, 33, 37
- PV1 5, 19, 44, 45, 50
- GT1 2, 3, 5, 6, 7, 8, 12
- IN1 16, 18, 19, 36, 49
- MRG 1, 2, 3, 5, 6, 7
- ORC 2, 3, 9
- OBR 2, 3, 7, 8
- OBX 5, 14, 18
- NTE 3
- DG1 5
- AL1 6
- PR1 5
- SPM 2, 17

Each entry is tagged with its 45 CFR §164.514(b)(2)(i) category (A)–(R).

**Sources** (recorded in `HL7_REDACTION_REVIEW`):
- 45 CFR §164.514(b)(2)(i)(A)–(R) (Cornell LII, accessed 2026-10-16);
- the IHE ITI De-Identification Handbook v2.0.0-comment, HL7 v2 example (profiles.ihe.net/ITI/DeId/hl7-example.html, generated 2026-06-12, accessed 2026-10-16): MSH-10; PID-3, 5, 7, 8, 11, 13, 14, 18 and 19; PV1-19; OBR-7 and 8; NTE. It is not exhaustive. PID-8 is kept, because Safe Harbor does not list sex.
- the HL7 v2.5.1 field definitions, with names verified live (Task 0 c).

**Golden fixtures (examples, CR-terminated):**

```
MSH|^~\&|SYNTHPHI-APP|SYNTHPHI-FAC|||20010203120000||ADT^A01^ADT_A01|SYNTHPHI-CTL|P|2.5.1
PID|1||SYNTHPHI-MRN^^^SYNTHPHI-AA~SYNTHPHI-MRN2||SYNTHPHI-LAST^SYNTHPHI-FIRST\T\X||19010101|F
ZPI|SYNTHPHI-Z||x
→
MSH|^~\&|***|***|||***||ADT^A01^ADT_A01|***|P|2.5.1
PID|1||***^^^***~***||***^***||***|F
ZPI|***||***
```

(`redactedFields` 9). A second golden is the ACK `MSH…|ACK^A01^ACK|…` with `MSA|AA|SYNTHPHI-CTL` → `MSA|AA|***`.

**Block reasons** (fixed texts):
- "The block data policy withholds every message body."
- "A `<kind>` body cannot be redacted reliably, so the redact data policy withholds it."
- "The HL7 v2 body is longer than 65536 characters, so the redact data policy withholds it."
- "The HL7 v2 body could not be read in full, so the redact data policy withholds it."
- "The HL7 v2 body could not be parsed (`<engine reason>`), so the redact data policy withholds it."

**Scope rows** (`data-policy-scope.ts`, 109 names):
- **governed:** `iris_message_resend` (`preview`).
- **residual:** `iris_sql_execute`, `iris_sql_query`, `iris_sql_analyze`, `iris_global_get`, `iris_execute_command`, `iris_execute_classmethod`, `iris_execute_tests`, `iris_test_status`, `iris_doc_get`, `iris_doc_search`, `iris_doc_convert`, `iris_doc_xml_export`, `iris_doc_export`, `iris_env_diff`, `iris_env_promote`, `iris_production_logs`, `iris_message_diagram`, `iris_transform_test`, `iris_docdb_document`, `iris_docdb_find`, `iris_analytics_mdx`, `iris_audit_manage`, `iris_audit_events`. Each comes with a one-line reason; operators restrict it through its governance key or visibility.
- **notApplicable:** every other tool, including:
  - `iris_message_search`: `headers` returns no body-derived text, and `body`/`searchTable` are governed from 39.3/39.4;
  - `iris_production_messages` (header columns only);
  - `iris_message_resend` `resend`/`resendFiltered` (status texts).
- **Header fields:** `ErrorStatus` and `Description` are reachable only through residual tools. Governed forensics tools keep excluding both.

**Extend, don't copy (Rule 2).**
- **Extended:** `mergeProfile` validation, `parseGovernanceRoot`, `unknownProfileWarnings`, `buildRosterEntry`, the audit entry, `Story391Fixture`, `interop-namespace-fixture.ts`, `docFixtures`/`executeMcpPost`/`openWireSession`, and `TypeLabel`, whose sibling `BodyKind` sits beside it.
- **Siblings, with reasons:**
  - `parseOperatorDataPolicy` lives in `data-policy.ts`, not `loadConfig`. If it were on the base config, `mergeProfile`'s base spread would make every profile inherit it, and the source attribution would be lost.
  - `summarizeForPreview` ports `BodySummary`'s character rule to TypeScript, because AD-26 puts truncation after redaction, in TypeScript.
  - PHI-input redaction is separate from `redactValue`: AD-19 requires a declaration, not name matching.
  - `MessagePreviewPolicyTest` carries its own HTTP helpers (the 39.1 precedent).

**Integration (Rules 1 and 2).**
- **Integration ACs:** AC-7 (and the matrix's Preview, Per profile and Audit rows), against the real instance.
- **Consumed-by:**
  - 39.3: `DATA_POLICY_BLOCKED` under `block`, `phiInputs` for `filters`, `dataPolicy.actions` for `body`, and a scope-row update.
  - 39.4: the same, for `searchTable`/`value`.
  - 39.5: `BodyKind`, `Hl7Text`, `redactHl7`, `tightenDataPolicy`, `BodyPolicyOutcome`, the block reasons, and a scope row.
  - 39.6: the capstone (proven red by disabling redaction) and the docs enrichment.
- **Consumes:**
  - 39.0's env harness and roster guard;
  - 39.1's `interop-namespace-fixture.ts`, `TypeLabel` and gate helpers;
  - `refusalResult`.

**Ledger inbox (Rule 17):**
- **DW-570:** addressed by items 1 (d), 2 and 16, the DW-570 matrix row and AC-8, with a decline-on-evidence branch (item 1 d).
- **DW-575:** addressed by item 5, the DW-575 matrix row and AC-9.

**Governing ADs.**
- **AD-26.** The binding AD: the policy, the redaction inputs, the classifier, the scope and the no-compliance rule.
- **AD-9.** The channels, never inheriting, the fallback, and tightening.
- **AD-6.** The precedence analog. **AD-8.** Fail-fast startup, and warnings for unknown profiles.
- **AD-19.** The audit field, PHI declarations, `outcome`, and no echo. **AD-15.** The sanctioned preview change, and the `allow` pin.
- **AD-33.** The additive route fields. **AD-11, AD-12, AD-13.** The handler shape. **AD-14.** The bootstrap regeneration.
- **AD-3.** Policy through `ctx.config`; `ToolContext` is unchanged. **AD-4.** The `ToolDefinition` marker, and no annotation change. **AD-10.** `iris_server_profiles`, with no count change.
- **AD-2.** The new modules live in shared, with no leaf imports. **AD-5.** `:check` only. **AD-17.** The bounded `resendFiltered` (DW-570). **AD-29.** Minor changesets.
- **Conventions:** Tool descriptions, Tool results (`dataPolicy`, `bodyPolicy`, `bodyKind`, `dataPolicySource` are absent today, as the captures prove), Refusals, Error text, Logging, Configuration variables, Live gates, Live testing on a shared instance, Probes, Performance budgets.

## Verification

Every command runs from `/Users/jbrandt/git/iris-execute-mcp-v2`, in the foreground, with `timeout: 600000`, one package per call.
- `ENV` is `IRIS_HOST=localhost IRIS_PORT=52773 IRIS_NAMESPACE=HSCUSTOM IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=SYS IRIS_HTTPS=false IRIS_REQUIRE_LIVE=1`.
- MCP calls name `server:"default"`. Their `namespace` is `HSCUSTOM`, or one of this story's own `EXECMCPTMP392*` namespaces.

**Step C: capture** (once, after Task 0 items 2–3 and before Task 1).
- Build shared, dev, admin and interop from the unchanged sources. Confirm the deployed version is `6dcdd238c792`.
- Run `ENV STORY_39_2_CAPTURE=1 pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-39-2-data-policy-live-gate.test.ts -t capture`.
- The fixture is never edited by hand (Rule #36).

**Shared surfaces:** these change, and other tests assert on them.
- `REFUSAL_CODES`, `STARTUP_ENV_VARS` and `ProfileRosterEntry`. Search the test trees for `isDefault: true` `toEqual` pins.
- The `ToolDefinition`, `GovernanceConfig`, `IrisConnectionConfig` and `AuditEntry` types.
- The `iris_message_resend` description, which moves the interop and suite payload rows.
- The existing preview unit rows, which are now under `allow`.
- `BOOTSTRAP_VERSION`: every armed gate redeploys.
- `gateTestFiles`.
- The README env, refusal, fail-fast and audit text; `tool_support.md`; `CHANGELOG.md`.

Standing criterion: every test added or changed passes on a fresh environment, in either order.
- The gate creates and removes all its own state: `EXECMCPTMP392A`, `Story392.*` inside it, the extended `ExecuteMCPv2.Temp.Story391Fixture`, and temp governance and audit files. The Task 0 probes use `EXECMCPTMP392P` and `ExecuteMCPv2.Temp.Story392Probe`, both removed.
- OS classes run one class per `iris_execute_tests` call, and `total` is compared with the `Test*` count (Rule #35).

**Commands:**
- `(once)` Build shared, then dev, admin, interop, ops, data and client-config, one command each. Run Task 0 and Step C.
- `(loop)` `pnpm --filter @iris-mcp/shared build && pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/data-policy.test.ts src/__tests__/hl7-redaction.test.ts src/__tests__/data-policy-server.test.ts src/__tests__/server-discovery.test.ts src/__tests__/refusals.test.ts src/__tests__/governance-file.test.ts src/__tests__/governance-cli.test.ts src/__tests__/audit-interceptor.test.ts src/__tests__/profiles.test.ts src/__tests__/bootstrap.test.ts` -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/interop build && pnpm --filter @iris-mcp/interop exec vitest run src/__tests__/message-resend-policy.test.ts src/__tests__/message-resend.test.ts src/__tests__/message-resend-governance.test.ts src/__tests__/index.test.ts` -- expected: pass.
- `(loop)` After the first armed run deploys the new version: `iris_doc_load` `/Users/jbrandt/git/iris-execute-mcp-v2/src/**/MessagePreviewPolicyTest.cls` (HSCUSTOM), then `iris_execute_tests` `ExecuteMCPv2.Tests.MessagePreviewPolicyTest` -- expected: total 2, 0 failed. Then, in separate calls, `MessageResendTest` (12) and `MessageSearchTest` (5) -- expected: 0 failed.
- `(loop)` `ENV pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-39-2-data-policy-live-gate.test.ts` -- expected: pass armed, nothing left. Then `ENV pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-39-1-message-search-live-gate.test.ts` -- expected: pass (resend byte-identity).
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/data-policy-scope.test.ts src/__tests__/story-39-2-data-policy-startup.test.ts src/__tests__/story-39-2-doc-claims.test.ts src/__tests__/startup-env-roster.test.ts src/__tests__/live-gate-roster.test.ts src/__tests__/docs-visibility-roster-sync.test.ts src/__tests__/story-39-1-doc-claims.test.ts` -- expected: pass.
- `(once)` For each of shared, dev, admin, interop, ops, data and client-config, one command each: `build`, then `test`, `lint` and `type-check`. Then `ENV pnpm --filter @iris-mcp/dev exec vitest run --no-file-parallelism`, then `ENV pnpm --filter @iris-mcp/all test` -- expected: green.
- `(once)` `pnpm gen:bootstrap` a second time -- expected: no diff. Also `pnpm gen:governance-baseline:check`, `pnpm gen:skills:check`, `node scripts/check-epics-sync.mjs` and `pnpm measure:tools-payload` -- expected: OK, and the README rows equal the output.
- `(once)` Performance: record the first armed bootstrap (budget 60 s) and one redact preview of `[1..9]` (budget 2 s).
- `(once)` After every armed run: `Leftovers(["EXECMCPTMP392A","EXECMCPTMP392P"])` is `[]`; `iris_namespace_list` and `iris_database_list` show no `EXECMCPTMP392*`; `iris_doc_list` (HSCUSTOM, `Story392` and `ExecuteMCPv2.Temp.`, generated included) holds nothing of this story.

**Planned mutations (Rule 19).** For each: apply it, observe red, revert, rebuild any dist it touched, reload any class, and confirm that `git status --short` and `git diff --stat` are unchanged. Record each as `mutation: <change> -> <red test>`.

| AC | Mutation | Expected red |
|---|---|---|
| AC-1 | `IRIS_DATA_POLICY` checked after the file's profile layer | the Precedence rows |
| AC-1 | named profiles resolved from the `default` entry's value | the Never inherited row |
| AC-1 | `IRIS_GOVERNANCE`'s `dataPolicy` accepted | the Bad values row (startup test) |
| AC-2 | `PID: [1, 5, 8]` in `HL7_KEEP_FIELDS` | the disjointness test; the no-`SYNTHPHI` rows; the oracle row |
| AC-2 | unreviewed segments kept; separately, the split on `\r` only | the Z-segment/PD1 rows; the CRLF rows |
| AC-3 | `isRedactableBodyKind` true for `stream` | the Preview redact row (item 3); the unit mapping rows |
| AC-3 | `block` sends `bodyDetail:"text"` | the block wire row |
| AC-4 | `allow` sends `bodyDetail` | the allow `toEqual` rows (unit and live) |
| AC-4 | `PreviewOne` legacy path drops `bodySummary` (reloaded) | the REST byte-identity row |
| AC-5 | the audit `dataPolicy` omitted; separately, `phiInputs` ignored | the Audit rows; the PHI inputs rows |
| AC-5 | a `logger.debug` of the IRIS preview response in the handler | the stderr sweep |
| AC-6 | one tool removed from `data-policy-scope.ts`; separately, a `dataPolicy` declaration added to `iris_production_logs` | the Scope test |
| AC-7 | the handler ignores `ctx.config.dataPolicy` and uses `"redact"` | the Per profile row |
| AC-8 | the fetch as `TOP 1` (reloaded) | the DW-570 row |
| AC-9 | `TypeLabel(1)` returns `Req` (reloaded) | the allow and REST byte-identity rows |

## Auto Run Result

Status: ready-for-dev
Blocking condition: none

Planned on 2026-10-16. This run halted after planning, as instructed. Four orchestrator decisions are open for the spec gate, (a) to (d) under Design Notes. The plan follows each recommendation. Both ledger entries are addressed: DW-570 (with a branch that declines it on evidence) and DW-575.
