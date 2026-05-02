---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments: []
workflowType: 'research'
lastStep: 6
research_type: 'technical'
research_topic: 'TOON (Token-Oriented Object Notation) as a JSON alternative for MCP tool calls'
research_goals: |
  1. Evaluate TOON as the new default wire format for MCP tool calls (request and response), with JSON as a configurable fallback.
  2. Quantify token-efficiency gains (target: ≥10% savings) on representative IRIS-Execute MCP tool payloads.
  3. Verify near-100% parse rate and no tool-call accuracy regression across:
     - Frontier models: Claude 4.x, GPT (4.x/5), Gemini 2.x
     - Local LLMs: Gemma 4, Llama 3.x, Qwen 2.5+
  4. Assess whether asymmetric formatting (request in one format, response in another) confuses models.
  5. Define implementation pattern for transcoding in the TypeScript MCP layer (ObjectScript API stays JSON-native).
user_name: 'Developer'
date: '2026-05-01'
web_research_enabled: true
source_verification: true
---

# Research Report: technical

**Date:** 2026-05-01
**Author:** Developer
**Research Type:** technical

---

## Research Overview

This research evaluates **TOON (Token-Oriented Object Notation)** as a token-efficient alternative to JSON for MCP tool calls in the IRIS-Execute MCP v2 suite. The proposal: transcode JSON ↔ TOON in the TypeScript MCP layer (server-side), keep the ObjectScript REST API JSON-native, and offer a configurable JSON fallback. The research goals fix three specific pass criteria — ≥10% token savings, ~100% parse rate, no tool-call accuracy regression — across frontier (Claude 4.x, GPT 4.x/5, Gemini 2.x) and local (Gemma 4, Llama 3.x, Qwen 2.5+) models. The user's instinct on asymmetric format effects (request vs response) is treated as a first-class research question.

The methodology combines current public-source verification (TOON spec, BAML's critique, MCP protocol surface, vendor tool-call APIs) with grounding in the actual IRIS-Execute MCP v2 codebase ([packages/shared/](packages/shared/)). All token-efficiency and accuracy claims are traced to the [official TOON benchmark](https://github.com/toon-format/toon) (209 retrieval questions across 4 small/fast models — Claude Haiku 4.5, Gemini 3 Flash preview, GPT-5 Nano, Grok 4.1 Fast non-reasoning) with explicit confidence levels noting where public data is absent. The analysis identifies three significant evidence gaps — flagship frontier models, all listed local models, and asymmetric-format effects — which a proposed three-experiment internal benchmark closes in roughly one sprint.

**Bottom line**: **No-go on TOON adoption at this time.** The research supports the decision in two directions: (1) public model-support evidence is too thin — zero coverage of the actual deployment matrix (Gemma 4, Llama 3.x, Qwen 2.5+, flagship Claude/GPT-5/Gemini), and the four small/fast models that *were* benchmarked show >30pp accuracy variance, so any default decision would be running ahead of the data; (2) implementation cost (transcoder + telemetry + per-tool config + auto-fallback monitor + ongoing per-model regression checking) is non-trivial for a project not bottlenecked by token costs. The technical case for the architecture is sound — the architecture is additive, single-flag-rollback, and ObjectScript-untouched — but the cost-benefit favors keeping the surface simple. This document is preserved as a reference if the picture changes (model support matures, MCP standardizes format negotiation, or token costs become a real pressure point). See the **Decision** section near the end for the dated decision record, and the **Research Synthesis** for the supporting analysis.

---

<!-- Content will be appended sequentially through research workflow steps -->

## Technical Research Scope Confirmation

**Research Topic:** TOON (Token-Oriented Object Notation) as a JSON alternative for MCP tool calls

**Research Goals:**

1. Evaluate TOON as the new default wire format for MCP tool calls (request and response), with JSON as a configurable fallback.
2. Quantify token-efficiency gains (target: ≥10% savings) on representative IRIS-Execute MCP tool payloads.
3. Verify near-100% parse rate and no tool-call accuracy regression across:
   - Frontier models: Claude 4.x, GPT (4.x/5), Gemini 2.x
   - Local LLMs: Gemma 4, Llama 3.x, Qwen 2.5+
4. Assess whether asymmetric formatting (request in one format, response in another) confuses models.
5. Define implementation pattern for transcoding in the TypeScript MCP layer (ObjectScript API stays JSON-native).

**Technical Research Scope:**

- Architecture Analysis — TOON spec, design intent, encoding rules, comparison surface to JSON / YAML / MessagePack
- Implementation Approaches — TypeScript transcode middleware, fallback config, error handling, format negotiation
- Technology Stack — TOON parser/serializer libs, MCP SDK extension points, IRIS-Execute MCP integration touchpoints
- Integration Patterns — bidirectional transcoding, schema preservation, content-type negotiation, MCP protocol conformance
- Performance Considerations — token savings on tabular vs nested vs scalar payloads, parse-time cost, model-side accuracy

**Research Methodology:**

- Current web data with rigorous source verification
- Multi-source validation for critical technical claims (vendor claims vs independent benchmarks)
- Confidence level framework for uncertain information
- Comprehensive technical coverage with architecture-specific insights

**Scope Confirmed:** 2026-05-01

---

## Technology Stack Analysis

> **Note on category adaptation:** The standard "Programming Languages / Frameworks / Databases / Dev Tools / Cloud" structure is adapted to the actual technology surface of this research topic — a wire-format question that lives in the TypeScript MCP layer. Categories below map to the equivalent stack dimensions for that surface.

### Format Specification & Versioning *(equivalent: Programming Languages)*

TOON (Token-Oriented Object Notation) is a text serialization format for the JSON data model, designed to minimize token consumption when feeding structured data to LLMs. Created by Johann Schopplich and released October 2025, with the official specification governed at [github.com/toon-format/spec](https://github.com/toon-format/spec).

- **Current spec version:** 3.0 (per official repo as of 2026-05).
- **Reference TypeScript SDK npm version:** `@toon-format/toon` v2.1.0 (released 2025-12-04).
- **Self-described maturity:** "Stable, but also an idea in progress" — the spec authors signal that breaking changes remain possible.
- **Design substrate:** YAML-style indentation for nested objects + CSV-style tabular layout for uniform arrays. Explicit `[N]` length declarations and `{fields}` headers act as inline schema hints.
- **Provisional content type:** `text/toon` with `.toon` file extension.
- **Lossless roundtrip:** Spec claims a lossless representation of objects, arrays, and primitives equivalent to JSON.

**Limitations declared in the spec/repo:**
- TOON's `[N]` length declaration detected payload truncation in **0% of test cases** (vs CSV's 100%) — structural-validation gap.
- On arrays with extra rows beyond the declared length, TOON detected the mismatch in **75%** of cases (vs CSV's 100%).
- For deeply nested or non-uniform data, **YAML performed comparably or better** (93.1% vs TOON 94.8% on deeply nested configs) and JSON's structural advantage reasserts.

_Source: [github.com/toon-format/toon](https://github.com/toon-format/toon), [github.com/toon-format/spec](https://github.com/toon-format/spec), [toonformat.dev](https://toonformat.dev/), [InfoQ on TOON release](https://www.infoq.com/news/2025/11/toon-reduce-llm-cost-tokens/)_

---

### Libraries & Implementations *(equivalent: Frameworks)*

The reference implementation is in TypeScript. Multi-language community implementations exist with varying maturity.

**Official TypeScript / JavaScript:**
- `@toon-format/toon` (npm) — official SDK. API surface: `encode(data, options?)`, `decode(toonString, options?)`, plus streaming variants `encodeLines()`, `decodeFromLines()`, `decodeStream()`. `options.replacer` supports per-field transforms (filtering, normalization).
- Install: `npm install @toon-format/toon`.

**Alternative npm packages** (community, varying coverage of spec):
- `@sibshahz/toon-parser`
- `@byjohann/toon`
- `toon-parser` (claims TOON v2.1 spec coverage with prototype-pollution guards)
- `json-to-toon` (one-direction converter)

**Other languages:** Python ([xaviviro/python-toon](https://github.com/xaviviro/python-toon)), PHP ([HelgeSverre/toon-php](https://github.com/HelgeSverre/toon-php)), OCaml ([davesnx/ocaml-toon](https://github.com/davesnx/ocaml-toon)), plus Rust / Go / .NET implementations referenced in the official ecosystem list. **Confidence:** medium-high — community implementations may lag spec v3.0.

**Decision implication for IRIS-Execute MCP v2:** the MCP server is TypeScript, so the official SDK is a direct fit. ObjectScript-side stays JSON-native (no IRIS TOON library needed) — transcoding lives entirely in the TypeScript layer between the IRIS REST API and the MCP wire.

_Source: [github.com/toon-format/toon](https://github.com/toon-format/toon), [npmjs.com/package/@byjohann/toon](https://www.npmjs.com/package/@byjohann/toon), [npmjs.com/package/toon-parser](https://www.npmjs.com/package/toon-parser), [npmjs.com/package/@sibshahz/toon-parser](https://www.npmjs.com/package/@sibshahz/toon-parser)_

---

### Tokenization & Encoding Substrate *(equivalent: Database / Storage)*

TOON's value proposition is **token-count reduction at a specific tokenizer**, not byte-count reduction. This matters for the IRIS-Execute MCP architecture because the model determines the tokenizer, not the server.

- **Reference benchmark tokenizer:** GPT-5 `o200k_base` (via `gpt-tokenizer`). Token-savings claims (39.9% mean reduction) are calibrated to this tokenizer.
- **Cross-model variance:** Different model families use different BPE vocabularies. A TOON document that saves 39.9% under `o200k_base` may save more or less under Claude's tokenizer, Gemini's, or a Llama 3.3 BPE. **Public per-tokenizer breakdowns are not available** — confidence: low.
- **Worst-case alert:** On flat tabular data, TOON uses **+5.9% more tokens than CSV** but provides structural validation CSV lacks. So TOON is "between CSV and JSON" — not unconditionally smaller than every alternative.
- **Latency caveat:** TOON's prompt-side savings can be offset by **slower decoding on local/quantized models**. The official repo explicitly warns: "On latency-critical deployments (especially local/quantized models), JSON may be faster despite lower token count."

**Decision implication:** any benchmark we run for IRIS-Execute payloads must be done at each target model's tokenizer separately — a single number won't generalize.

_Source: [github.com/toon-format/toon](https://github.com/toon-format/toon) benchmark methodology, [DigitalOcean: TOON vs JSON](https://www.digitalocean.com/community/tutorials/toon-vs-json), [Adam Holter: TOON vs JSON for LLMs](https://adam.holter.com/toon-vs-json-for-llms-token-efficiency-retrieval-accuracy-and-where-it-actually-helps/)_

---

### MCP Protocol Surface & TypeScript Integration Tooling *(equivalent: Dev Tools)*

Where TOON can plug into the MCP wire is constrained by the MCP and Anthropic tool-use protocols.

**MCP transport:** JSON-RPC 2.0 over stdio (local servers) or HTTP (remote). The framing layer (request/response/notification envelope) is **JSON and not negotiable** — TOON cannot replace the JSON-RPC framing without forking the MCP spec.

**Where TOON CAN go on the wire:**
- **Tool-result `content` payload** — Anthropic's tool_use API accepts tool_result content as either a plain string or a structured array including `{"type": "text", "text": "<arbitrary string>"}`. TOON is text — it goes in as `type: "text"` content. This is the highest-leverage insertion point because tool results dominate token volume in agent loops.
- **Resource and prompt content** delivered via MCP `resources/read` and `prompts/get` — same string-content rule applies.
- **Tool input arguments** are bound by the JSON Schema declared in the tool definition; the API expects the model to emit JSON matching that schema. TOON cannot replace tool-call arguments **without** custom prompt-engineering that asks the model to emit TOON inside a single string field — which adds parsing burden and defeats schema validation. **Recommend: keep tool inputs as JSON.**

**Reference precedent — the Claude Code JSON-to-TOON hook** ([maman gist](https://gist.github.com/maman/de31d48cd960366ce9caec32b569d32a)):
- Operates on the `UserPromptSubmit` event before each prompt is sent to Claude.
- Detects JSON code blocks and inline JSON in user prompts and converts to TOON.
- **Transparent to Claude** — Claude does not need to "know" about TOON; it just processes a more compact representation.
- This precedent is **input-side only** (prompts → model); does not touch tool results.

**Competing/complementary MCP token-optimization strategies in 2026:**
- **Cloudflare Code Mode** — exposes only `search()` and `execute()` tools backed by a typed SDK that runs JavaScript in a sandbox. Reported reductions from 1.17M tokens to ~1K (99.9%). Operates at the **tool surface area** layer, not the wire-format layer.
- **Dynamic tool search** — single `search_tools(query)` tool replaces eager schema injection, reportedly cutting schema-related token usage 80–95%.
- **Output trimming / field selection** — return only requested fields (the MindStudio MCP optimization article frames this as the same family TOON belongs to).

**Confidence:** the TOON-via-tool-result pattern is theoretically sound and consistent with both Anthropic's API contract and the Claude Code hook precedent. **No public production deployment of TOON-on-tool-result in an MCP server is documented as of 2026-05** — confidence: medium. We would be early adopters.

_Source: [Anthropic tool-use docs](https://docs.anthropic.com/en/docs/build-with-claude/tool-use), [MCP specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25), [InfoQ: Cloudflare Code Mode](https://www.infoq.com/news/2026/04/cloudflare-code-mode-mcp-server/), [MindStudio: Optimize MCP Server Token Usage](https://www.mindstudio.ai/blog/optimize-mcp-server-token-usage), [maman: Claude Code JSON-to-TOON Hook gist](https://gist.github.com/maman/de31d48cd960366ce9caec32b569d32a)_

---

### Deployment & Model Targets *(equivalent: Cloud Infrastructure)*

The research goal lists frontier models (Claude 4.x, GPT 4.x/5, Gemini 2.x) and locals (Gemma 4, Llama 3.x, Qwen 2.5+). Public benchmark coverage is uneven.

**Frontier — public benchmark coverage:**

The canonical TOON benchmark (209 retrieval questions, 11 datasets) tested **only "fast / nano" model variants**:

| Model | TOON Accuracy | Note |
|---|---|---|
| `claude-haiku-4-5-20251001` | 59.8% | Smallest Claude variant |
| `gemini-3-flash-preview` | n/a in extracts | Preview model |
| `gpt-5-nano` | 90.9% | Smallest GPT-5 variant |
| `grok-4-1-fast-non-reasoning` | 58.4% | Reasoning explicitly disabled |
| **Mean** | **76.4%** (vs JSON 75.0%) | Mixed-structure datasets |

**Critical gaps for IRIS-Execute MCP v2:**
- **No public benchmark on flagship Claude (Sonnet 4.x, Opus 4.x), GPT-5 mainline, or Gemini 3 Pro** — confidence on frontier-flagship parse reliability: **low**.
- **Per-model accuracy spread is enormous** — 90.9% on GPT-5 Nano vs 58.4% on Grok-4 Fast on the same questions. Rolling up to "76.4% average" hides model-family risk. A model that scores 60% on retrieval is unsuitable for production tool calling.

**Local LLM target list — public benchmark coverage:**

| Model | TOON Public Benchmark? |
|---|---|
| Gemma 4 (multi-size) | **None located** |
| Llama 3.x | **None located** |
| Qwen 2.5+ | **None located** |

**Confidence on local-LLM TOON viability: very low.** This is the single largest evidence gap and the most likely place where the "≥10% savings AND no regression" criterion fails. Smaller / quantized models tend to be more sensitive to format drift, and TOON's reliance on indentation + tabular layout is brittle when the model occasionally drops or mis-counts characters.

**Recommended verification path:** internal benchmark on representative IRIS-Execute MCP payloads, run against each target local model in our deployment matrix, before defaulting on TOON.

_Source: [github.com/toon-format/toon](https://github.com/toon-format/toon) benchmark, [Local AI Master: Small Models 2026](https://localaimaster.com/blog/small-language-models-guide-2026), [Oflight: Gemma 4 vs Llama 4 vs Qwen 3.5](https://www.oflight.co.jp/en/columns/gemma4-vs-llama4-vs-qwen35-local-llm-comparison-2026)_

---

### Adoption Trends

- **Release timeline:** TOON open-sourced October 2025; npm package v2.1.0 December 2025; spec at v3.0 by mid-2026. ~7 months of production maturity at time of this research.
- **Tooling proliferation:** within ~7 months of release, multi-language implementations (TS, Python, PHP, OCaml, Rust, Go, .NET) and at least 4 distinct npm packages exist. Indicates community traction.
- **Claude Code precedent:** Community hooks (maman gist) demonstrate the prompt-side transcoding pattern is viable at the agentic-coding-tool layer. **No equivalent precedent for tool-result transcoding** is documented.
- **MCP ecosystem positioning:** TOON is being discussed as **one of three** mainstream 2026 token-reduction patterns alongside (1) Cloudflare-style code execution and (2) dynamic tool search. None has clearly "won" — they target different layers.
- **Format-war framing:** Industry voices range from "Bye Bye JSON for LLMs" (overclaim) to "JSON is the correct default for most production LLM workflows" (DigitalOcean's measured framing). The conservative read: TOON is a worthwhile tool for the right payload shapes, not a default replacement for all structured-data wire formats.

**Adoption inertia risk:** if frontier model providers add native tokenizer-aware compaction (or if MCP standardizes a different optimization), TOON's window narrows. This argues for **the configurable fallback to JSON** the user already proposed — protects against format-war losses.

_Source: [InfoQ: TOON reduce LLM cost](https://www.infoq.com/news/2025/11/toon-reduce-llm-cost-tokens/), [Medium: TOON Bye Bye JSON for LLMs](https://medium.com/data-science-in-your-pocket/toon-bye-bye-json-for-llms-91e4fe521b14), [DigitalOcean: TOON vs JSON](https://www.digitalocean.com/community/tutorials/toon-vs-json), [LogRocket: How to use TOON to reduce token usage by 60%](https://blog.logrocket.com/reduce-tokens-with-toon/)_

---

### Cross-Stack Analysis & Confidence Summary

**Patterns connecting the stack layers:**
- TOON is **tokenizer-coupled**: all efficiency claims attach to a specific tokenizer. The IRIS-Execute MCP server must support multiple model targets, each with its own tokenizer — so a single number for "savings" cannot be quoted to users.
- TOON is **payload-shape-sensitive**: uniform arrays of objects → big wins. Deeply nested or non-uniform → wash or loss vs JSON. The IRIS-Execute MCP tool catalog has both shapes (e.g., `iris_global_list` returns tabular data → big TOON win; `iris_production_status` returns nested/heterogeneous → potentially a loss).
- TOON is **model-sensitivity-coupled**: per-model accuracy variance in the public benchmark exceeds 30 percentage points across the 4 small models tested. We have **no public data on the 7+ flagship and local models in our actual deployment matrix**.
- The MCP wire is **JSON-RPC framed**: TOON can only replace **content payloads** (tool_result text, resource bodies, prompt strings) — not the surrounding envelope.

**Confidence framework:**

| Claim | Confidence | Why |
|---|---|---|
| TOON saves 30-60% tokens on uniform-array data | High | Multiple independent benchmarks converge |
| TOON achieves comparable or slightly better accuracy than JSON on the 4 benchmarked small models | Medium-High | Single primary benchmark; reproduced on per-source secondary references |
| TOON performance generalizes to flagship frontier models (Claude Sonnet 4.x, GPT-5 mainline, Gemini 3 Pro) | **Low** | No public benchmark coverage |
| TOON performance generalizes to local models (Gemma 4, Llama 3.x, Qwen 2.5+) | **Very Low** | Zero public benchmark coverage |
| TOON-via-tool-result is API-compatible with Anthropic / OpenAI / Google tool-use | High | Standard `text` content type accepts arbitrary strings |
| Asymmetric format (request JSON, response TOON) does not confuse models | **Unknown** | No primary research located; Claude Code hook precedent is input-only |
| TypeScript ecosystem can support production transcoding | High | Official SDK + multiple alternates available |

**Research gaps requiring closure in subsequent steps:**
1. Empirical local-LLM (Gemma 4, Llama 3.x, Qwen 2.5+) parse-rate data on TOON tool-result content.
2. Asymmetric-format effect on tool-call accuracy — the user's instinct on this needs explicit testing.
3. Per-model tokenizer breakdown of TOON vs JSON savings on representative IRIS-Execute payloads.
4. Production MCP server precedent (any team that has shipped TOON-on-tool-result and reported metrics).

---

## Integration Patterns Analysis

> **Note on category adaptation:** The standard "REST / GraphQL / Microservices / Event-driven / OAuth" structure is adapted here to the integration surface that actually matters for a wire-format substitution: format negotiation, bidirectional transcoding, asymmetric handling, schema preservation, and error recovery.

### Format Negotiation & Capability Discovery *(equivalent: API Design Patterns)*

MCP includes a capability-negotiation handshake at protocol initialization, but **does not standardize content-type negotiation for tool result formats** as of MCP spec version 2025-11-25.

**What MCP currently provides:**
- Initialization handshake exchanges supported features (resources, tools, prompts, logging, etc.).
- Tool results are typed at the content level (`text`, `image`, `audio`, `resource`, `embedded_resource`) — TOON is just `type: "text"`.
- No mechanism today for client to say "I want tool results in TOON" and server to acknowledge.

**Proposal #315 (still in discussion as of March 2026):** the [Suggested Response Format proposal](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/315) introduces `_meta.suggestedFormat` with MIME type + JSON Schema. **No mention of TOON** in the entire thread. Maintainer pushback cited "servers should be extremely easy to build" — proposal is unlikely to land soon. **Implication:** any TOON support we ship now must be **out-of-band negotiation** — a custom MCP server initialization argument, environment variable, or client tool annotation, NOT a protocol-level feature.

**Recommended integration patterns for IRIS-Execute MCP v2:**

1. **Server-side environment/config flag** (`IRIS_MCP_FORMAT=toon|json`, default `json` initially, `toon` later once benchmarks pass). Lives in the TypeScript layer; ObjectScript REST API never sees it.
2. **Per-tool override** in the tool catalog metadata — some tools (uniform tabular returns: `iris_global_list`, `iris_sql_execute`, `iris_doc_list`) get TOON by default; others (deeply nested: `iris_production_status`, `iris_metrics_alerts`) stay JSON.
3. **Client capability hint** via a custom `_meta.preferredOutputFormat` field in the `initialize` request — non-standard, ignored by clients that don't recognize it, but readable by ours.
4. **Auto-fallback on parse failure** — if model output references TOON-encoded data and downstream tool calls fail with parse errors above a threshold, drop to JSON for that session.

_Source: [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25), [MCP Proposal #315: Suggested Response Format](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/315), [Portkey: MCP Message Types Reference](https://portkey.ai/blog/mcp-message-types-complete-json-rpc-reference-guide/)_

---

### Bidirectional Transcoding & Asymmetric Format Effects *(equivalent: Communication Protocols)*

**The user's instinct was correct.** Asymmetric format mixing has measurable effects, but they are model-specific.

**Empirical evidence on mixed-format effects:**
- **Gemini 3 Flash showed accuracy drops below 65%** on Hybrid CSV/Prefix prompt styles — well below same-model performance on pure structured formats. Gemini exhibits "significant declines in mixed-style prompts" per Preprints.org study.
- **GPT-3.5 prefers JSON, GPT-4 favors Markdown** (different models have different format preferences, even for the same data shape) — per arxiv.org/2411.10541.
- **JSON-as-output forced format degrades reasoning ~10-15%** vs free-form (per multiple format-vs-reasoning studies, summarized in DigitalOcean and ImprovingAgents pieces). This is a counter-argument to "just keep JSON everywhere": forcing the model to *emit* JSON is itself a tax.
- **TOON official documentation does NOT address mixing TOON and JSON within the same conversation.** Confirmed via direct fetch of [toonformat.dev/guide/llm-prompts](https://toonformat.dev/guide/llm-prompts). This is a documented unknown, not a documented safe pattern.

**Implication:** the user's three viable architectures map to distinct risk profiles —

| Pattern | Tool Args | Tool Results | Risk Level | Notes |
|---|---|---|---|---|
| **A. Symmetric JSON (status quo)** | JSON | JSON | None | Baseline; no token savings on results |
| **B. Asymmetric (JSON in / TOON out)** | JSON | TOON | **Medium** | Model still emits JSON for tool args; reads TOON for results. No format expected to be generated. **No public study; theoretically lowest-risk asymmetric variant.** |
| **C. Asymmetric (TOON in / JSON out)** | TOON | JSON | **High** | Model must read TOON-encoded args and reason about them, but emit JSON. Very little precedent except Claude Code prompt hook (which is input-only). |
| **D. Symmetric TOON** | TOON | TOON | **Highest** | Model must both *read* TOON args AND *emit* TOON results — TOON output is exactly where BAML observed GPT-5.1 miscounting [N] by 17%. |

**Strong recommendation for IRIS-Execute MCP v2:** start with **Pattern B (JSON args in, TOON results out)**. Tool args are small JSON; the bulk of the token volume lives in tool results, which is where TOON earns its keep. The model never has to *generate* TOON, sidestepping BAML's array-counting failure mode entirely.

_Source: [Preprints.org: Prompt Engineering for Structured Data](https://www.preprints.org/manuscript/202506.1937), [arxiv: Does Prompt Formatting Have Any Impact on LLM Performance](https://arxiv.org/html/2411.10541v1), [BAML: Beware When Using TOON](https://boundaryml.com/blog/beware-when-using-toon), [Medium: LLM Reliability JSON vs YAML](https://medium.com/@mr.sean.ryan/llm-reliability-json-vs-yaml-22c58d7f51f6), [toonformat.dev/guide/llm-prompts](https://toonformat.dev/guide/llm-prompts)_

---

### Comparison Surface — TOON vs Adjacent Formats *(equivalent: Data Formats and Standards)*

The user's question implicitly excludes binary formats (which can't replace JSON for LLM contexts at all). Here's the actual integration trade-space:

| Format | LLM-Readable? | Token Efficiency vs JSON | Schema Validation | Verdict for MCP Tool Results |
|---|---|---|---|---|
| **JSON** | Yes (universal training) | Baseline (1.0×) | External (JSON Schema) | Default — all models trained on it |
| **TOON** | Yes | -30 to -60% on uniform arrays; +5.9% on flat tabular vs CSV | Inline via `[N]`+`{fields}` (weak: 0% truncation detection) | Strong on uniform-array tool results |
| **YAML** | Yes | Variable; comparable or slightly better than TOON on **deeply nested** data (93.1% vs 94.8% accuracy) | None inline | Better than TOON for non-uniform/nested |
| **CSV** | Yes | -5.9% vs TOON on flat tabular; no nested support | 100% truncation detection; 100% missing-field detection | Best for flat tabular; can't carry nested |
| **Markdown tables** | Yes | Roughly comparable to TOON for tables; better for nested narrative | None | GPT-4 prefers Markdown for some formats; usable as a "soft" middle ground |
| **MessagePack / CBOR** | **No** (binary) | n/a — must decode to text before injection | External | **Disqualified for LLM contexts.** Binary saves on storage/transport, not LLM tokens. |
| **Protobuf / FlatBuffers** | **No** (binary) | n/a | Strong | **Disqualified for same reason as MessagePack.** |

**Key integration insight:** the right choice depends on per-tool payload shape, not a single global setting. A "strict TOON or strict JSON" architecture leaves money on the table. **The recommended pattern is per-tool format selection** — the tool catalog declares the format alongside the JSON Schema.

```typescript
// Tool catalog metadata pattern (illustrative — would live in TypeScript layer):
{
  name: "iris_global_list",
  resultFormat: "toon",      // tabular, uniform → TOON wins
  ...
},
{
  name: "iris_production_status",
  resultFormat: "json",      // nested, heterogeneous → JSON
  ...
},
{
  name: "iris_sql_execute",
  resultFormat: "toon",      // typically tabular result sets
  ...
}
```

_Source: [zderadicka.eu: JSON vs UBJSON vs MessagePack vs CBOR](https://zderadicka.eu/comparison-of-json-like-serializations-json-vs-ubjson-vs-messagepack-vs-cbor/), [github.com/toon-format/toon](https://github.com/toon-format/toon), [improvingagents.com: Best Nested Data Format](https://www.improvingagents.com/blog/best-nested-data-format/), [DigitalOcean: TOON vs JSON](https://www.digitalocean.com/community/tutorials/toon-vs-json)_

---

### Schema Preservation & Validation *(equivalent: System Interoperability)*

**TOON's lossless roundtrip claim is strong:** `decode(encode(x)) === x` after normalization (Date, NaN, etc.). This means transcoding at the TypeScript MCP layer should be safe IRT data fidelity.

**TOON's schema-validation model is weak:** the format encodes **structural** validation (`[N]` row counts, `{fields}` headers, indentation), but has no equivalent of JSON Schema for **semantic** validation:
- No type declarations on fields (TOON doesn't say "this column is integer; that one is string")
- No required/optional distinction
- No enum, format, or pattern constraints
- BAML's specific complaint: "TOON doesn't actually have a mechanism for describing output schemas"

**Critical implication for MCP tool definitions:** the tool **input** schema is JSON Schema (per MCP spec). Tool **outputs** in MCP have an optional `outputSchema` (also JSON Schema). TOON does NOT obviate the JSON Schema. Translation pattern:
1. ObjectScript-side: returns JSON-shaped data (existing behavior).
2. TypeScript layer: validates the JSON against the tool's `outputSchema` (recommended; not always done today).
3. TypeScript layer: encodes valid JSON to TOON via `@toon-format/toon`.
4. Wire: TOON travels as `tool_result.content[].text` string.
5. Model: reads TOON content directly (no decode step needed at the model side — it just sees a more compact text representation).

**Validation defense in depth:**
- **JSON Schema** validation BEFORE encoding (catches semantic errors).
- **TOON strict-mode decoder** AFTER any roundtrip (catches truncation, count mismatches, escaping errors). Default mode in `@toon-format/toon`. Throws on malformed input.
- **Length-mismatch heuristic**: count actual rows vs declared `[N]`; if mismatch, log + fallback.

**TOON detection rates per the official benchmark:**
- Truncated array detection: **0%** (TOON's `[N]` count gives no signal when tail is missing — this is the killer validation gap)
- Extra rows beyond declared length: **75%** detection
- Systematic missing fields: **75%** detection
- vs CSV: 100% / 100% / 100% (CSV's strict row format detects every drift)

This is **the single biggest integration risk**: TOON's structural-validation story underperforms even CSV. Pattern B (TOON outputs only, never inputs) limits exposure because **we control the encoding** and can re-validate end-to-end before sending. But if we ever asked the *model* to emit TOON, this validation gap becomes the failure mode BAML observed.

_Source: [github.com/toon-format/toon](https://github.com/toon-format/toon) benchmark, [BAML: Beware When Using TOON](https://boundaryml.com/blog/beware-when-using-toon), [toonformat.dev/guide/llm-prompts](https://toonformat.dev/guide/llm-prompts)_

---

### Error Recovery & Fallback Strategies *(equivalent: Microservices Integration Patterns)*

Error-recovery surface area for the MCP-layer transcoder:

**At encoding time (server → wire):**
- TOON encoder failure (e.g., `Date`, `NaN`, circular reference, non-string keys). Surface area is small — `@toon-format/toon` accepts the JSON data model. Pattern: **try TOON encode → on exception, log + fall back to JSON for this single response**, with a note in the response that fallback occurred.
- Recovery code is ~5 lines: `try { toon.encode(data) } catch { return JSON.stringify(data) }`.

**At decoding time (anywhere we re-parse, e.g., test harnesses):**
- Strict mode (default in `@toon-format/toon`) catches malformed TOON via `[N]`/indent/escape checks. Throws.
- Recovery patterns from broader LLM-output-parsing literature: simple retry, corrective re-prompt, fallback to safe defaults.

**At runtime (tool-call accuracy regression):**
- Track tool-call success rate by format: if format=toon results in N% more tool-arg parse failures or M% more agent loops/retries vs format=json baseline, automatically degrade the session to JSON.
- Define a regression threshold up front (per the user's "no regression" criterion). Suggested: **>2% absolute drop in tool-call success rate** triggers fallback.

**Configuration ramp pattern (recommended rollout):**
1. **Phase 0** — Ship with `format=json` default, `format=toon` opt-in via env/CLI flag. No risk.
2. **Phase 1** — Internal benchmark on real IRIS-Execute MCP payloads + flagship Claude/GPT/Gemini, plus the 3 local models in scope. Pass criteria from research goals: ≥10% token savings AND ~100% parse rate AND no >2% accuracy regression.
3. **Phase 2** — Selective per-tool TOON enablement (uniform-array tools first).
4. **Phase 3** — `format=toon` becomes the default; `format=json` is the fallback.
5. **Phase 4** (only if Phase 3 holds for ≥30 days) — consider TOON for input args (Pattern C/D), with much stricter benchmarking.

_Source: [apxml.com: Handling LLM Output Parsing Errors](https://apxml.com/courses/prompt-engineering-llm-application-development/chapter-7-output-parsing-validation-reliability/handling-parsing-errors), [github.com/mangiucugna/json_repair](https://github.com/mangiucugna/json_repair), [gocodeo.com: Error Recovery and Fallback Strategies in AI Agents](https://www.gocodeo.com/post/error-recovery-and-fallback-strategies-in-ai-agent-development)_

---

### Configuration & Tool-Catalog Patterns *(equivalent: Integration Security Patterns — adapted)*

Integration risk for an IRIS-Execute MCP server is not the typical OAuth/MTLS surface — it's **configuration drift between what we ship and what models actually do well with**. Pattern set:

**Configuration sources (priority order):**
1. Per-tool `resultFormat` declared in the tool catalog (highest precedence).
2. Per-namespace override via env var (e.g., `IRIS_MCP_FORMAT_OVERRIDE_iris_global_list=json`).
3. Server-wide default (`IRIS_MCP_FORMAT=toon|json`, default initially `json`).
4. Per-client capability hint via custom `_meta.preferredOutputFormat` (if present in `initialize`).
5. Hard fallback to JSON if any encoding step fails.

**Telemetry / observability surface:**
- Counter: tool-call result format actually used (toon vs json), per tool name.
- Counter: encode-time failures (with format → fallback).
- Counter: decoded-result parse-success rate (proxy for "did the model handle it correctly").
- Histogram: tokens-saved per tool (compare TOON-encoded byte/token count vs would-have-been JSON).
- This telemetry is essential for the Phase 2 → Phase 3 promotion gate.

**Backward compatibility:** because TOON output is type=text in MCP tool_result, **any MCP client without TOON awareness will simply see a denser text blob** — they won't crash, they'll just have less-pretty output. This is excellent integration safety: the MCP envelope format never changes, so no existing client breaks.

_Source: [github.com/toon-format/toon](https://github.com/toon-format/toon), [Anthropic tool-use docs](https://docs.anthropic.com/en/docs/build-with-claude/tool-use), [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)_

---

### Cross-Integration Analysis & Updated Confidence

**Patterns connecting integration choices:**
- The MCP protocol envelope **must** stay JSON; TOON only fits inside text-content payloads. This is a hard constraint that simplifies the architecture — no need to worry about JSON-RPC framing changes.
- Tool args should stay JSON (preserves JSON Schema validation and avoids BAML's array-counting failure on model-generated TOON).
- Tool results are the high-leverage opportunity (Pattern B: JSON in / TOON out).
- Per-tool format selection beats global setting because payload shape varies dramatically across the IRIS-Execute MCP catalog.

**Updated confidence (revised after Step 3 evidence):**

| Claim | Confidence | Δ from Step 2 |
|---|---|---|
| Asymmetric format (Pattern B) is the lowest-risk path | High | NEW — supported by BAML evidence + Claude Code precedent + lossless roundtrip |
| TOON output works reliably on flagship frontier models | **Medium-Low** ↓ | DOWN from Medium-Low — BAML's GPT-5.1 17% miscount is direct counter-evidence |
| Per-tool format selection is implementable in TypeScript | High | NEW |
| Backward compatibility is preserved (older MCP clients don't break) | High | NEW |
| TOON's structural validation catches truncation | **Low** ↓ | DOWN — official benchmark says 0% detection on truncated arrays |
| MCP protocol will standardize TOON support soon | **Very Low** | NEW — proposal #315 doesn't mention TOON; maintainer pushback on similar proposals |

**Largest residual integration risks:**
1. **Frontier-model TOON-reading (not generation) reliability remains untested** on flagship models for our specific payload shapes.
2. **Local-model TOON-reading reliability is wholly untested** — same problem as Step 2.
3. **TOON spec is still moving (v3.0, "stable but an idea in progress")** — locking in v2.1 SDK now means a future spec bump may require re-encoding.
4. **MCP standardization gap means our TOON support is private convention**; if MCP later standardizes a different approach, we may need to migrate.

---

## Architectural Patterns and Design

> **Note:** This section grounds recommendations in the actual IRIS-Execute MCP v2 codebase shape — the 5-server suite (`iris-admin-mcp`, `iris-data-mcp`, `iris-dev-mcp`, `iris-interop-mcp`, `iris-ops-mcp`) plus `iris-mcp-all` umbrella, all sharing the [`@iris-mcp/shared`](packages/shared/) package. Direct file references use clickable paths.

### System Architecture — Where the Transcoder Lives

The existing layered architecture has a single, clean seam for TOON transcoding:

```
┌──────────────────────────────────────────┐
│ MCP Client (Claude / GPT / Gemini / local)│
└────────────┬─────────────────────────────┘
             │ JSON-RPC over stdio (UNCHANGED)
             ▼
┌──────────────────────────────────────────┐
│ MCP Server Process                       │
│  (e.g. iris-dev-mcp, iris-data-mcp, …)   │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ McpServerBase (shared)             │  │
│  │  • Zod arg validation              │  │
│  │  • Tool routing                    │  │
│  │  ◀──── NEW SEAM ────▶              │  │  ← Transcoder lives here
│  │  • ToolResult shaping              │  │
│  └────────────┬───────────────────────┘  │
│               ▼                          │
│  ┌────────────────────────────────────┐  │
│  │ Tool handler (per-tool, in each    │  │
│  │  server package)                   │  │
│  └────────────┬───────────────────────┘  │
│               ▼                          │
│  ┌────────────────────────────────────┐  │
│  │ IrisHttpClient → IRIS REST         │  │
│  │  (Atelier envelope, JSON, never    │  │
│  │   touched by TOON)                 │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

**Key seam:** `ToolResult.content[0].text` in [`packages/shared/src/tool-types.ts:118`](packages/shared/src/tool-types.ts#L118). Today this is typically populated as `JSON.stringify(structuredContent)`. The transcoder hooks here — the change is transparent to every tool handler.

**Architectural advantages of this placement:**
- **One implementation, all 5 servers benefit.** No per-package duplication.
- **ObjectScript REST API never changes.** The IRIS-side stays JSON-native; aligned with the user's stated intent and avoids a new dependency on the IRIS side.
- **Transparent to tool handlers.** Existing handlers continue to return `structuredContent` as JSON-shaped objects — the wrapper transcodes after they return.
- **Reversible.** Pulling TOON support out is a one-line change in `McpServerBase` if it doesn't pan out.

_Source: actual code at [packages/shared/src/server-base.ts](packages/shared/src/server-base.ts), [packages/shared/src/tool-types.ts](packages/shared/src/tool-types.ts)_

---

### Design Principles & Best Practices — Strategy Pattern + Decorator

Two cooperating patterns deliver the per-tool format selection:

**1. Strategy pattern at the tool-definition layer.** Add an optional `resultFormat` field to [`ToolDefinition`](packages/shared/src/tool-types.ts#L52-L71):

```typescript
export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: ZodObject<any>;
  outputSchema?: ZodObject<any>;
  annotations: ToolAnnotations;
  scope: ToolScope;
  handler: (args: unknown, context: ToolContext) => Promise<ToolResult>;
  // NEW — optional per-tool format hint:
  resultFormat?: "json" | "toon" | "auto";  // default: "auto"
}
```

Default `"auto"` lets the transcoder decide based on payload shape (uniform-array → TOON; nested → JSON). Explicit `"json"` or `"toon"` forces a choice. This honors **open/closed** — existing tools work unchanged; new tools opt in by adding one line.

**2. Decorator pattern around the handler call.** [`McpServerBase`](packages/shared/src/server-base.ts) already wraps handler invocation for Zod validation; add one more wrapper that applies format transformation to the returned `ToolResult`:

```typescript
// Pseudocode for the transformation step (NOT implementation — illustrative):
async function withFormatTranscoding(
  toolDef: ToolDefinition,
  ctx: ToolContext,
  handler: () => Promise<ToolResult>,
): Promise<ToolResult> {
  const result = await handler();
  const format = resolveFormat(toolDef, ctx, result);  // strategy lookup
  if (format === "json") return result;                 // pass through
  return applyToon(result);                             // transcode result.content[0].text
}
```

`resolveFormat` priority chain (per Step 3 integration analysis):
1. Server-wide kill switch: `IRIS_MCP_FORMAT=json` → always JSON, ignore tool-level hint.
2. Per-tool override env: `IRIS_MCP_FORMAT_OVERRIDE_<tool_name>=json|toon`.
3. `toolDef.resultFormat` field.
4. Auto: shape-based heuristic (default tabular → TOON; nested → JSON).
5. Failure-fallback: encoder threw → JSON.

**Single Responsibility:** the transcoder doesn't know about IRIS, ObjectScript, Atelier, or any tool semantics — it only transforms `ToolResult` text content.

_Source: actual code at [packages/shared/src/tool-types.ts:52-71](packages/shared/src/tool-types.ts#L52-L71), [packages/shared/src/server-base.ts](packages/shared/src/server-base.ts), [@toon-format/toon SDK API](https://github.com/toon-format/toon)_

---

### Scalability and Performance Patterns

**Cold-start cost.** `@toon-format/toon` is a small TypeScript library; lazy-import it (`await import('@toon-format/toon')`) inside the transcoder so JSON-only deployments don't pay startup cost. For Node.js 18+ this is sub-millisecond.

**Encode latency at request time.** TOON encoding is O(n) over the JSON tree. For a typical IRIS tool result (1-50 KB JSON), this is sub-millisecond on Node 18+. Latency budget is dominated by the IRIS HTTP round-trip, not the transcode. **Confidence: high** — TypeScript JSON parsers and TOON encoders both run in the same complexity class.

**Streaming for large results.** Some IRIS tools (e.g., `iris_doc_search` returning many matches; `iris_global_list` over a large global) can produce results well over the [24KB MCP chunk threshold](https://github.com/lizqwerscott/mcp.el/pull/47) where chunked-transfer issues have been observed in MCP clients. The TOON SDK provides `encodeLines(largeData)` and `decodeStream()` for this, but **the more important architectural lever is whether the IRIS tool already paginates**. Looking at [`packages/shared/src/server-base.ts:57-83`](packages/shared/src/server-base.ts#L57-L83) — pagination via `encodeCursor` / `decodeCursor` / `paginate` is already a first-class shared utility. **Recommendation: rely on existing pagination; don't add streaming TOON encode in v1.** If a single page exceeds chunked-transfer thresholds, the page size needs reducing regardless of format.

**Memoization for repeated identical responses.** Some tools are highly repetitive (e.g., `iris_server_info` called multiple times in a session returns the same data). A small LRU cache keyed by `(toolName, JSON-canonicalised args)` storing the encoded TOON string saves the re-encode cost. **Recommendation for v1: skip this**. Encode cost is sub-ms; cache invalidation adds complexity; only add later if telemetry shows real benefit.

**Token-cost telemetry as a performance signal.** The architecture should record both formats' token counts per tool call (not just bytes) — needed for the Phase 2 → Phase 3 promotion gate from Step 3. Use the same `o200k_base` tokenizer the TOON benchmark uses, recognising its results don't generalize across model families (per Step 2 confidence note). Storage: extend the existing logger interface in [`packages/shared/src/logger.ts`](packages/shared/src/logger.ts) with a structured event for `tool.result.format`.

_Source: [packages/shared/src/server-base.ts](packages/shared/src/server-base.ts), [github.com/lizqwerscott/mcp.el PR #47](https://github.com/lizqwerscott/mcp.el/pull/47), [github.com/toon-format/toon](https://github.com/toon-format/toon) streaming API_

---

### Integration and Communication Architecture

**Single-server-instance model.** Each of the 5 server packages spawns as a separate Node.js process when invoked by the MCP client. Each loads its own copy of `@iris-mcp/shared` from the workspace. **Implication:** a config change (e.g., flipping `IRIS_MCP_FORMAT=toon`) requires restarting affected servers, but doesn't require coordinating between servers.

**Umbrella `iris-mcp-all` package.** The `iris-mcp-all` umbrella aggregates tools from all 5 servers into one process. The transcoder must work identically here — and because it lives in `@iris-mcp/shared`, it does, with no extra work.

**Inter-server uniformity vs flexibility trade-off.** The five servers serve very different tool catalogs:
- `iris-dev-mcp` — heavy use of tabular results (`iris_global_list`, `iris_sql_execute`, `iris_doc_list`, `iris_doc_search`) → strong TOON candidates.
- `iris-data-mcp` — analytics cubes, DocDB results — mixed shapes.
- `iris-admin-mcp` — security listings (users, roles, web apps) — mostly tabular → TOON candidate.
- `iris-interop-mcp` — production status, message traces — heterogeneous nested → keep JSON.
- `iris-ops-mcp` — system metrics, alerts, journal info — mixed.

A per-server default is **less useful** than a per-tool selection. Servers don't have homogeneous payload shapes. **Architecturally: keep all routing logic in the shared transcoder; vary per-tool, not per-server.**

**Config / CLI args contract.**

| Variable | Default | Purpose |
|---|---|---|
| `IRIS_MCP_FORMAT` | `json` (Phase 0/1), then `toon` (Phase 3+) | Server-wide default |
| `IRIS_MCP_FORMAT_OVERRIDE_<tool>` | unset | Per-tool override |
| `IRIS_MCP_FORMAT_DEBUG` | `false` | Emit detailed transcoder telemetry to logger |
| `IRIS_MCP_FORMAT_FALLBACK_THRESHOLD_PCT` | `2` | If tool-call success rate drops more than this, auto-fallback to JSON for the session |

These extend the existing config pattern in [`packages/shared/src/config.ts`](packages/shared/src/config.ts) — same env-var-driven approach, validated in `loadConfig`.

_Source: actual code at [packages/shared/src/config.ts](packages/shared/src/config.ts), [packages/shared/src/server-base.ts](packages/shared/src/server-base.ts), [packages/](packages/) layout_

---

### Security Architecture

The transcoder is a **string transformation** — it doesn't add new authentication surface, network traffic, or storage. Risk surface is narrow but real:

**Data-disclosure risk:** TOON's compactness means more data fits in a given output budget. A tool that previously truncated long results to fit may now include more. **Audit:** any tool with PII, secret keys, or password-adjacent fields needs a redaction pass independent of format. This is a **pre-existing architectural concern** that TOON doesn't introduce — but TOON makes the risk **slightly larger** because of the expanded effective capacity.

**Injection / parser exploit:** the [`toon-parser` npm package](https://www.npmjs.com/package/toon-parser) explicitly advertises "prototype-pollution guards" — confirming that prior TOON parsers have had injection issues, and the design space is real. **Mitigation:** use the official `@toon-format/toon` SDK only; pin version with exact match (no `^` ranges); verify package integrity in CI.

**Lossless-roundtrip guarantee preserves auditability.** Because `decode(encode(x)) === x`, an audit log that records the JSON form of a tool result remains valid evidence even when the on-the-wire form is TOON. Recommendation: **log the JSON form, not the TOON form**, in any audit trail (existing logger configuration in [`packages/shared/src/logger.ts`](packages/shared/src/logger.ts)).

**No new MCP transport surface.** TOON rides as `text` content inside the existing MCP envelope — no new ports, no new auth, no new network paths.

_Source: [npmjs.com/package/toon-parser](https://www.npmjs.com/package/toon-parser), [github.com/toon-format/toon lossless guarantee](https://github.com/toon-format/toon)_

---

### Data Architecture Patterns

**JSON Schema + TOON cohabitation.** MCP `outputSchema` is JSON Schema (per protocol). [`ToolDefinition.outputSchema`](packages/shared/src/tool-types.ts#L64) at the TypeScript type level is a Zod schema, which generates JSON Schema for the wire. **TOON does not have an equivalent schema description language.** Architectural decision: **JSON Schema remains the canonical source of truth** for tool output structure; TOON is a presentation-layer transform applied AFTER schema validation.

This means:
1. Tool handler returns JSON-shaped `structuredContent`.
2. `outputSchema` (Zod) validates the JSON shape — catches semantic errors (missing required fields, wrong types).
3. THEN transcoder optionally encodes to TOON for `content[0].text`.
4. `structuredContent` (the JSON form) is preserved alongside, as today.

This is a **defense-in-depth pattern**: validation happens on the JSON form (where validators exist); presentation happens in TOON (where the savings exist). The model can use either form depending on what the client surface presents.

**Schema-evolution behavior.** Per BAML's critique, "simple schema changes (adding fields) cause TOON to look like malformed YAML" — but BAML was talking about **model-generated TOON** with hard-coded few-shot examples. **For server-generated TOON (Pattern B), schema changes are a non-issue** because the transcoder just emits whatever shape the handler produced. The asymmetric architecture sidesteps this risk.

**Heterogeneous arrays handling.** TOON's tabular layout requires uniform fields. When `structuredContent` is an array of heterogeneous objects (e.g., a result from `iris_production_status` mixing services and operations), the transcoder must fall back to TOON's nested form (which is just YAML-like) — and at that point, a JSON output may actually be smaller. The auto-format heuristic should detect this and route to JSON for non-uniform arrays. **Heuristic:** if `≥80%` of array elements share the same key set, use TOON; else use JSON.

_Source: [packages/shared/src/tool-types.ts:64](packages/shared/src/tool-types.ts#L64), [BAML: Beware When Using TOON](https://boundaryml.com/blog/beware-when-using-toon), [github.com/toon-format/toon](https://github.com/toon-format/toon) tabular eligibility rules_

---

### Deployment and Operations Architecture

**Distribution.** All five MCP servers + the umbrella ship as one workspace ([root pnpm workspace](packages/)). Adding `@toon-format/toon` to `@iris-mcp/shared`'s `dependencies` (NOT `peerDependencies` — this is an internal concern, not a host-app concern) propagates to all five published packages. **Bump the patch version of all packages in the same release**, per existing project convention.

**Bootstrap classes implication.** Per the project's [bootstrap drift check rule](.claude/CLAUDE.md), any change touching ObjectScript classes triggers regeneration of [`packages/shared/src/bootstrap-classes.ts`](packages/shared/src/bootstrap-classes.ts). **TOON support is a TypeScript-only change** — no ObjectScript classes are modified — so **bootstrap regeneration is NOT required** for this work. This is an architectural win for the user's stated direction (TypeScript layer, not ObjectScript).

**Feature-flag rollout.** The phased rollout from Step 3 maps to the deployment architecture as:
1. Phase 0 (next release): code merged behind `IRIS_MCP_FORMAT=json` default. Zero behavior change for users.
2. Phase 1 (release N+1): Internal benchmarks run; data feeds the Phase 2 gate.
3. Phase 2 (release N+2): per-tool TOON enablement for the safest 5-10 tools (`iris_global_list`, `iris_sql_execute`, `iris_doc_list`, `iris_package_list`, `iris_user_get` etc.). Default still JSON for unflagged tools.
4. Phase 3 (release N+M, on metric pass): default flips to TOON.
5. Phase 4 (separate proposal): TOON for inputs.

**Telemetry exfiltration.** Telemetry stays local — log lines via existing `logger`. **No external telemetry calls are added** by this work. Operators can grep logs for `event=tool.result.format` to gather Phase 2 → Phase 3 promotion data.

**Rollback.** Single env-var flip. No state, no migration, no schema. Rollback time is "next server restart." This is the gold standard for low-risk feature rollout architecture.

**Release coordination with `iris-mcp-all`.** Because the umbrella package re-exports from each server, the umbrella version bump must follow the constituent versions per existing release process. No new architectural concern; standard workspace bump.

_Source: actual repo layout at [packages/](packages/), [packages/shared/src/bootstrap-classes.ts](packages/shared/src/bootstrap-classes.ts), [packages/shared/src/logger.ts](packages/shared/src/logger.ts), project rule [`.claude/rules/project-rules.md`](.claude/rules/project-rules.md) §18_

---

### Architectural Decisions & Trade-offs Summary

| Decision | Choice | Rejected Alternatives | Why |
|---|---|---|---|
| Where transcoder lives | `@iris-mcp/shared` `McpServerBase` decorator | Per-server, on the wire as a separate process, in ObjectScript | Single point, all servers benefit, ObjectScript-side stays JSON |
| Format direction | Pattern B (JSON args in / TOON results out) | Symmetric TOON, TOON in / JSON out | Avoids BAML's GPT-5.1 array-counting failure; tool args keep JSON Schema validation |
| Format selection granularity | Per-tool with auto-default | Per-server, per-namespace, global only | Tool catalog payload shapes vary too much for per-server |
| Schema source of truth | JSON Schema (Zod) | TOON `[N]+{fields}` headers | TOON has no schema language; validation must happen pre-transcode |
| Streaming | Skip in v1 | Use `encodeLines` | Existing pagination already addresses size; encode is sub-ms |
| Memoization | Skip in v1 | LRU cache by `(toolName, args)` | Encode cost too low to justify cache invalidation complexity |
| Telemetry transport | Existing local logger | New metrics endpoint | Avoid new operational surface |
| Rollback model | Env var flip + restart | Migration / schema versioning | TOON is presentation-layer; no state to migrate |
| Bootstrap regeneration | Not required | (would be required if ObjectScript touched) | All changes confined to TypeScript layer |

**Patterns connecting layers:**
- The architecture is **additive** — every new piece (transcoder decorator, `resultFormat` field, env vars, telemetry events) is optional and defaults to current behavior. **Removing TOON support is a one-PR revert**, never a migration.
- The architecture is **per-tool**, not per-server, not per-namespace. This matches the actual variance in payload shape across the catalog.
- The architecture **respects the JSON-RPC envelope and JSON Schema as protocol substrate** — TOON is positioned as presentation, not protocol.
- The architecture **explicitly enables A/B observability** via per-tool telemetry, providing the data needed to advance phases without guesswork.

_Source: synthesis of Steps 1-4 evidence; codebase grounding from [packages/shared/](packages/shared/)_

---

## Implementation Approaches and Technology Adoption

### Technology Adoption Strategies

**The five-phase rollout (refined from Step 3) maps to specific milestones:**

| Phase | Trigger | Default | TOON Tools | Exit Criterion |
|---|---|---|---|---|
| **0. Foundation** | Code merge | `IRIS_MCP_FORMAT=json` | None | Transcoder + telemetry shipped, feature-flagged off |
| **1. Internal benchmark** | Phase 0 GA | `json` | None (benchmark only) | Empirical pass/fail report on user's three criteria |
| **2. Selective TOON** | Phase 1 pass | `json` | 5–10 safest tools | 30 days no metric regression |
| **3. Default flip** | Phase 2 stable | `toon` | All eligible | 30 days no metric regression |
| **4. Inputs (separate proposal)** | Phase 3 stable | n/a | n/a | Out of scope for this research |

**Migration patterns from comparable wire-format adoptions** (binary protocols, gzip-content-encoding, brotli rollout in HTTP, GraphQL adoption) consistently show:
- Big-bang format swaps fail more often than they succeed; gradual per-endpoint enablement wins.
- Telemetry-driven phase gating beats calendar-driven gating.
- A clean rollback path matters more than fast rollout.

The architecture from Step 4 supports all three of these.

_Source: [Datadog: Feature Flags](https://www.datadoghq.com/knowledge-center/feature-flags/), [LaunchDarkly + OpenTelemetry pattern](https://dev.to/alexiskroberson/opentelemetry-for-llm-applications-a-practical-guide-with-launchdarkly-and-langfuse-1a3a)_

---

### Development Workflows and Tooling

**TDD-first sequence for the transcoder** (matches existing project conventions per [`packages/shared/`](packages/shared/) test layout):

1. Write roundtrip tests against `@toon-format/toon` v2.1.0 with vitest snapshot files (`toMatchFileSnapshot()`) — covers shape preservation. Pin the SDK version exactly.
2. Write per-tool format-selection tests — given a `ToolDefinition` with `resultFormat`, expected output shape and content type.
3. Implement the `withFormatTranscoding` wrapper inside [`McpServerBase`](packages/shared/src/server-base.ts).
4. Add the env-var driven `resolveFormat` priority chain.
5. Add structured-event logging for `tool.result.format` to the existing logger.
6. Integration tests: real tool handlers from one server (start with `iris-dev-mcp` since it has the most tabular tools), verify both formats produce equivalent semantic content.

**Tooling additions (minimal):**
- `@toon-format/toon` (production dependency, exact version pin)
- vitest snapshot serializer for TOON content (or just store as `.toon` files via `toMatchFileSnapshot()`)
- `js-tiktoken` (dev dependency only) for offline OpenAI/Claude approximation in token-savings benchmarks
- `@anthropic-ai/sdk` `messages.countTokens` for billing-grade Claude counts in benchmarks (optional; requires API key in CI)

**Workflow pattern:** golden-file tests in `__snapshots__/` directories ensure roundtrip stability — `decode(encode(x)) === x` becomes a first-class CI assertion. This is exactly the pattern Vitest's `toMatchFileSnapshot` and custom serializers were designed for.

_Source: [Vitest snapshot guide](https://vitest.dev/guide/snapshot.html), [@anthropic-ai/tokenizer](https://www.npmjs.com/package/@anthropic-ai/tokenizer), [Anthropic Token Counting API](https://platform.claude.com/docs/en/build-with-claude/token-counting), [github.com/toon-format/toon](https://github.com/toon-format/toon)_

---

### Testing and Quality Assurance — The Benchmark Methodology

**This is the highest-value implementation deliverable**, because it closes the local-LLM and frontier-flagship evidence gaps from Step 2.

**Benchmark harness recommendation: [Promptfoo](https://github.com/promptfoo/promptfoo)** — declarative YAML configs, multiple model backends (Anthropic / OpenAI / Google / Ollama / vLLM), CI/CD integration, supports JSON Schema and semantic-similarity assertions. (Note: acquired by OpenAI in March 2026; remains open source. Picking it now is a watch-but-don't-block decision.) Alternative if Promptfoo unsuitable: [DeepEval](https://github.com/confident-ai/deepeval) or a custom harness on top of `@anthropic-ai/sdk` + Ollama.

**Benchmark design — three matched-pair experiments:**

**Experiment A — Token savings, per-model, per-payload-shape.**
- Sample 20 representative IRIS-Execute MCP tool result payloads from production tools, stratified by shape: 10 uniform-tabular (`iris_global_list`, `iris_sql_execute`, `iris_user_get` listings, etc.), 5 nested-heterogeneous (`iris_production_status`, `iris_metrics_alerts`), 5 mixed.
- Encode each as JSON (current) and TOON.
- Count tokens at each target model's tokenizer:
  - Anthropic: `messages.countTokens` API (billing-grade)
  - OpenAI: `js-tiktoken` with appropriate encoding
  - Google Gemini: their token-counting API
  - Local (Gemma 4 / Llama 3.x / Qwen 2.5+): use the model's own tokenizer via Ollama or transformers library
- **Pass criterion (per goal #2):** ≥10% mean token savings on tabular shapes; net-zero or positive on nested.

**Experiment B — Tool-call accuracy regression, per-model, Pattern B (JSON in / TOON out).**
- 50 multi-turn agent test cases drawn from realistic IRIS-Execute MCP usage (e.g., "find all globals matching X then look up the latest entry for Y", "run SQL Q and explain the results").
- Run each case TWICE: once with format=json, once with format=toon.
- Measure: tool selection F1, tool argument exact-match rate, end-to-end task completion rate.
- **Pass criterion (per goal #3):** ≥99% exact-match parse rate AND tool-call success rate within 2 absolute percentage points of JSON baseline.
- Baseline reference: Docker's eval found **Qwen 3 14B at F1=0.971** for local tool calling — proves the local-model bar is achievable; question is whether TOON degrades it.

**Experiment C — Asymmetric format effects.**
- Sub-experiment of B: split test cases into trios:
  - C1: JSON args / JSON results (status quo baseline)
  - C2: JSON args / TOON results (Pattern B candidate)
  - C3: TOON args / JSON results (control — to confirm Pattern C is worse)
- **Pass criterion:** C2 within 2pp of C1; C3 confirms higher risk (sanity check).

**Test matrix:**

| Model | API surface | Tokenizer | Priority |
|---|---|---|---|
| Claude Sonnet 4.x | Anthropic API | countTokens API | P0 |
| Claude Haiku 4.5 | Anthropic API | countTokens API | P0 (matches public TOON benchmark) |
| GPT-5 (mainline) | OpenAI API | tiktoken `o200k_base` | P0 |
| Gemini 3 Pro | Google API | Google count API | P0 |
| Gemma 4 (representative size) | Ollama / vLLM | local tokenizer | P0 (your goal #3) |
| Llama 3.x (representative size) | Ollama / vLLM | local tokenizer | P0 |
| Qwen 2.5+ (representative size) | Ollama / vLLM | local tokenizer | P0 |
| GPT-5 Nano | OpenAI API | tiktoken | P1 (matches public TOON benchmark) |

**Reporting format:** publish a per-model table with rows for each experiment, columns for token savings %, accuracy delta vs baseline, parse-rate %. Include confidence intervals from repeated runs (≥3 runs per cell to characterize variance).

**Estimated cost:** Anthropic / OpenAI / Google API spend for full benchmark run is bounded; depending on rep count, expect <$50 in API costs. Local models are free CPU/GPU. Engineer time is the dominant cost.

_Source: [Promptfoo GitHub](https://github.com/promptfoo/promptfoo), [Docker: Local LLM Tool Calling Evaluation](https://www.docker.com/blog/local-llm-tool-calling-a-practical-evaluation/), [Ollama Tool Calling Docs](https://docs.ollama.com/capabilities/tool-calling), [Anthropic Token Counting](https://platform.claude.com/docs/en/build-with-claude/token-counting), [Propel: Token Counting tiktoken Anthropic Gemini](https://www.propelcode.ai/blog/token-counting-tiktoken-anthropic-gemini-guide-2025)_

---

### Deployment and Operations Practices

**Phased deployment (from Architecture, refined):**
- Use a single env var for the kill switch — operators can roll back in under 60 seconds (next server restart).
- Tag every release with which Phase it is in (e.g., `v1.x.x-toon-phase2`) for support clarity.
- Document the phase gate triggers in `CHANGELOG.md` so users know what changed.

**Telemetry shape (one structured log line per tool call):**

```json
{
  "event": "tool.result.format",
  "tool": "iris_global_list",
  "format": "toon",
  "format_source": "auto-uniform",  // or "tool-default", "env-override", "fallback-after-error"
  "input_bytes": 412,
  "output_bytes_json": 8192,
  "output_bytes_toon": 4096,
  "encode_ms": 0.4,
  "namespace": "HSCUSTOM",
  "atelier_ms": 87
}
```

This goes to the existing logger; operators can aggregate with `jq`/`grep` or pipe to whatever observability stack they use. **No new operational dependency.**

**Auto-fallback monitor.** A lightweight middleware in `McpServerBase` tracks rolling tool-call success rate over the last N calls (e.g., 50). If success rate for `format=toon` drops below `JSON_baseline - threshold%`, switch to JSON for the rest of the session and emit a warning event. Threshold from goal: **2 percentage points absolute**.

**Disaster recovery.** None of TOON adoption introduces new state, so DR is unchanged. The transcoder is stateless — process restart = clean slate.

**Compliance / audit.** Per Step 4 security note: log the JSON form of tool results in audit trails; the wire form may be TOON, but the canonical record is JSON. Lossless roundtrip means the auditor's view is unchanged.

_Source: [OpenTelemetry: feature_flag.evaluation events](https://opentelemetry.io/docs/specs/semconv/feature-flags/feature-flags-events/), [Harness: Feature Flag Context in OpenTelemetry Spans](https://www.harness.io/blog/using-feature-flags-with-open-telemetry), [Vellum: LLM Observability Guide](https://www.vellum.ai/blog/a-guide-to-llm-observability)_

---

### Team Organization and Skill Requirements

**Skills required for this work:**
- TypeScript / Node.js fluency (existing team baseline; no new skills).
- Familiarity with the MCP TS SDK and the existing `@iris-mcp/shared` patterns.
- Comfort writing benchmark harnesses against multiple LLM APIs (Anthropic + OpenAI + Google + Ollama).
- Awareness of TOON's edge cases (count mismatches, non-uniform arrays — the BAML critique).

**Skills NOT required:**
- ObjectScript changes — this is a TypeScript-layer-only change. No IRIS-side knowledge needed.
- Deep ML / model internals — TOON encoding is mechanical.
- Custom tokenizer implementation — vendor SDKs and `js-tiktoken` cover the field.

**Roles:**
- 1 senior dev for transcoder + harness implementation (~1 sprint).
- 1 dev (could be same person) for benchmark execution and reporting (~3–5 days end-to-end).
- 0.25 reviewer — code review of the architecture changes per `.claude/rules/project-rules.md` Rule #2 ("read IRIS class source before wrapping" doesn't apply here; this is TypeScript-only — but Rules #15 (don't wrap method calls in `$Get`) and #18 (auto-generated files) DO apply if any future ObjectScript work is added).

_Source: existing project conventions, project rules at [`.claude/rules/project-rules.md`](.claude/rules/project-rules.md)_

---

### Cost Optimization and Resource Management

**Token-cost ROI calculation (illustrative, NOT a guarantee):**

Assume a representative IRIS-Execute MCP session: 100 tool calls, mean output 4 KB JSON each = 400 KB JSON output / session. With Anthropic pricing roughly $3/M tokens (input) on Claude Sonnet 4.6 in 2026, that's:
- JSON: 400 KB → ~100K tokens → $0.30 / session at input rate
- TOON (40% reduction on uniform-array shapes; assume ~25% blended across mixed catalog): ~75K tokens → $0.225 / session
- **Savings per session: ~$0.075** (25% of cost in this illustrative case)

**Caveats:**
- Savings only realize when the model actually reads the tool result. If the model summarizes-and-discards, savings are immediate.
- If the model echoes large portions of tool results into its output, savings are partial (the model's output is JSON-or-natural-language, not TOON).
- Per-tool variance is large — `iris_doc_search` returning 50 matches saves much more than `iris_server_info` returning a small object.

**npm package size impact:**
- `@toon-format/toon` is a small library; published bundle is well under 50 KB. No meaningful install-size impact for users.
- Lazy-import means cold-start unaffected.

**API benchmark cost (one-time):** <$50 in vendor API spend per full benchmark cycle. Re-running quarterly to detect model-side regressions: <$200/year. Negligible vs the engineering time.

**Resource management — local-model benchmarks:**
- Gemma 4 / Llama 3.x / Qwen 2.5+ at representative sizes run on a single workstation with sufficient VRAM (24-48 GB). Existing dev hardware should suffice; no new infra needed.

_Source: [Anthropic pricing model](https://docs.anthropic.com/en/docs/build-with-claude/tool-use), [Ollama models library](https://ollama.com/library), Step 2 token-savings analysis_

---

### Risk Assessment and Mitigation

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| **Model accuracy regresses on TOON-encoded results (>2pp drop)** | Medium | High (kills the change) | Phase 1 benchmark; auto-fallback monitor; per-tool revert |
| **Local-LLM (Gemma 4 / Llama 3.x / Qwen) handles TOON poorly** | Medium-High | Medium (locals are subset of users) | Per-model `IRIS_MCP_FORMAT_OVERRIDE_*` allowlist; document recommended model→format pairings |
| **TOON spec breaking change in v3.x → v4** | Medium | Low (we pin v2.1.0) | Pin SDK version; quarterly review of upstream changelog |
| **MCP standardizes a different approach (e.g., proposal #315 lands with JSON Schema)** | Low | Medium (rework needed) | Architecture is per-tool / config-driven — additive; can support both paths |
| **Encoder throws on edge-case input (Date, NaN, circular ref)** | Low | Low (fallback-to-JSON catches) | Try/catch around encode; structured fallback event |
| **Audit logs less readable in TOON form** | Low | Low (we log JSON form) | Per architecture: log JSON form in audit trail, not wire form |
| **Bootstrap drift from accidental ObjectScript changes** | Very Low | Low (this is TS-only) | This work explicitly does not touch ObjectScript — Rule #18 not triggered |
| **Benchmark cost overruns** | Low | Low (<$200/year) | Use approximations (`js-tiktoken`) for early iterations; reserve API calls for final reporting |
| **Asymmetric format confuses some local models (your concern from Step 0)** | Unknown → bench in Phase 1 | Medium | Experiment C in benchmark plan addresses directly; falls back if confirmed |
| **Frontier-flagship parse rate not in public benchmark** | High (no data exists) | Medium | Phase 1 benchmark generates the data we need |

**Killers (would force a no-go):**
- Phase 1 benchmark shows >5pp accuracy drop on any P0 model — go-to-baseline-JSON.
- TOON spec abandoned by maintainers within 6 months of release.

_Source: synthesis of Steps 1-4 evidence, [BAML critique](https://boundaryml.com/blog/beware-when-using-toon)_

---

## Technical Research Recommendations

### Implementation Roadmap

**Sprint 1 (Phase 0 prep — ~1 week):**
1. Add `@toon-format/toon` v2.1.0 (exact pin) to `@iris-mcp/shared` deps.
2. Extend `ToolDefinition` with optional `resultFormat?: "json" | "toon" | "auto"`.
3. Implement `withFormatTranscoding` decorator in `McpServerBase`.
4. Implement `resolveFormat` priority chain (env vars → tool default → auto heuristic → fallback).
5. Add structured logger event for `tool.result.format`.
6. Vitest roundtrip tests + golden-file tests via `toMatchFileSnapshot()`.
7. Default `IRIS_MCP_FORMAT=json` (Phase 0 ships dark).

**Sprint 2 (Phase 1 benchmark — ~1 week):**
1. Set up Promptfoo (or equivalent) harness with the test matrix.
2. Run Experiments A, B, C across the P0 model set.
3. Produce empirical pass/fail report against the user's three goals.
4. **Decision gate: do we proceed to Phase 2?**

**Sprint 3 (Phase 2, if Phase 1 passes — ~1 week):**
1. Enable TOON for the 5–10 safest tools by adding `resultFormat: "toon"` to their definitions.
2. Ship in production behind `IRIS_MCP_FORMAT=toon` opt-in flag.
3. Monitor telemetry for 30 days.

**Sprint 4 (Phase 3, if Phase 2 stable):**
1. Flip default to `toon`.
2. JSON becomes the explicit fallback (`IRIS_MCP_FORMAT=json`).
3. Update README to document the change.

### Technology Stack Recommendations

- **TOON SDK:** `@toon-format/toon` v2.1.0, exact-pinned. (Re-evaluate quarterly for spec/SDK updates.)
- **Test harness:** Promptfoo (open-source, multi-vendor, CI-friendly). Fallback: `@anthropic-ai/sdk` + `openai` SDK + Ollama HTTP client + custom Vitest tests.
- **Token counters:** Anthropic `messages.countTokens` (Claude); `js-tiktoken` (OpenAI offline); Google count API (Gemini); local tokenizer per model (Ollama/transformers).
- **Snapshot testing:** Vitest's `toMatchFileSnapshot()` for roundtrip stability.
- **Observability:** existing `@iris-mcp/shared` `logger` — no new tooling. Operators can layer OpenTelemetry on top later if they want.

### Skill Development Requirements

None blocking. Existing TypeScript / Node.js / MCP SDK fluency on the team is sufficient. New familiarity needed:
- TOON spec (~30 minutes to read [github.com/toon-format/spec](https://github.com/toon-format/spec))
- The BAML critique (~10 minutes to internalize the array-counting failure mode)
- Promptfoo basics (~1 hour for first config and run)

### Success Metrics and KPIs

**Primary KPIs (the user's three goals, made measurable):**
1. **Token savings:** ≥10% mean reduction on tool-result payloads, measured per-model, per-payload-shape, per-tool. Target: ≥30% on uniform-tabular tools.
2. **Parse rate:** ≥99% successful structured-result parse rate across all P0 models. Failures auto-fall-back to JSON without session disruption.
3. **No accuracy regression:** tool-call success rate within 2pp of JSON baseline for each P0 model.

**Secondary KPIs:**
4. **Encode latency:** p99 < 5ms (well within typical IRIS HTTP round-trip).
5. **Adoption rate:** % of tool calls in production using TOON (tracks rollout phase progression).
6. **Auto-fallback rate:** <0.5% of sessions trigger format-fallback (high rate signals a model that needs to be allowlisted out).
7. **Cost savings:** verified vendor-bill reduction over a 30-day window post-Phase 3.

**Reporting cadence:**
- During Phase 1: snapshot report at end of benchmark (one-time).
- During Phase 2: weekly telemetry rollup (Phase 2 → Phase 3 promotion gate).
- Post-Phase 3: monthly review for first quarter; quarterly thereafter.

_Source: synthesis of Steps 1-5 evidence_

---

# Research Synthesis: TOON for IRIS-Execute MCP v2 — Decision Brief

## Executive Summary

**Decision: No-go on TOON adoption for IRIS-Execute MCP v2 at this time.** The research supports declining the proposal in two directions, and the technical case for proceeding doesn't outweigh either.

**Concern 1 — Model support evidence is too thin to support a default-flip decision.** The single canonical TOON benchmark covers only four small/fast model variants (Claude Haiku 4.5, Gemini 3 Flash preview, GPT-5 Nano, Grok 4.1 Fast non-reasoning) with **>30 percentage points of per-model accuracy variance** on the same 209 questions (90.9% on GPT-5 Nano vs 58.4% on Grok-4 Fast). There is **zero public benchmark data** on flagship Claude Sonnet/Opus, GPT-5 mainline, or Gemini 3 Pro — and **zero public data** on any of the local LLMs in the deployment matrix (Gemma 4, Llama 3.x, Qwen 2.5+). Adopting on this evidence base would be running ahead of the data. Closing the gap requires the internal Phase 1 benchmark, which itself is significant work.

**Concern 2 — Implementation cost is non-trivial for a project not bottlenecked by token costs.** Even with the architecture's "additive, ObjectScript-untouched, single-flag rollback" framing, full adoption requires a transcoder in [`McpServerBase`](packages/shared/src/server-base.ts), per-tool `resultFormat` configuration on the tool catalog, structured telemetry for `tool.result.format` events, an auto-fallback monitor that tracks rolling tool-call success rates, ongoing per-model regression checking against a moving SDK target ("stable, but also an idea in progress"), and operator-facing documentation of recommended model→format pairings. This is meaningful surface area for a token-cost optimization on a project where token cost has not been identified as a pressure point.

**Counter-evidence weighed.** TOON's token savings are real (~40% mean reduction on uniform tabular data, corroborated across multiple independent benchmarks). The architectural design is sound — Pattern B (JSON args in / TOON results out) sidesteps BAML's documented GPT-5.1 array-counting failure. The ObjectScript REST API would not have changed. None of this overcomes the two concerns above when token cost is not the bottleneck and model-support data is not yet credible for the deployment matrix.

**Document status:** preserved as a research reference. Reopen if any of these change: (a) public benchmarks emerge covering flagship + local models on TOON, (b) MCP standardizes format negotiation in a way that subsumes private TOON conventions, (c) token cost becomes a measurable pressure point for this project.

**Key Technical Findings (preserved as reference):**

- **Format reality**: TOON's official spec is at v3.0 with [`@toon-format/toon`](https://github.com/toon-format/toon) at v2.1.0 (Dec 2025). Self-described as "stable, but also an idea in progress."
- **Token savings real but shape-dependent**: ~40% mean reduction on uniform-array data; **+5.9% loss vs CSV** on flat tabular; potentially worse than JSON on deeply nested heterogeneous payloads.
- **Per-model accuracy variance is the load-bearing risk**: 90.9% (GPT-5 Nano) vs 58.4% (Grok-4 Fast) on the same 209 questions — averaging hides this.
- **MCP protocol envelope is JSON-only**: TOON can only ride inside `tool_result.content[].text` strings. Backward compatibility would be automatic, but MCP standardization of TOON specifically is unlikely (proposal #315 doesn't mention it).
- **Three evidence gaps remain unclosed**: no public TOON data on flagship Claude/GPT-5/Gemini; zero public data on Gemma 4 / Llama 3.x / Qwen 2.5+; asymmetric-format effects untested.

**Strategic context (had the decision gone the other way):**
The architecturally correct shape would have been Pattern B with per-tool format selection in [`ToolDefinition`](packages/shared/src/tool-types.ts#L52-L71), behind an `IRIS_MCP_FORMAT` env flag, with the three-experiment internal benchmark gating any default change. This is documented in the body of the report and remains valid as a reference design if the project revisits the question.

---

## Decision Recommendation

**Recommendation: NO-GO on TOON adoption at this time.** See the **Decision** section at the end of this document for the dated decision record and reasoning.

The original conditional recommendation (PROCEED to Phase 0 + Phase 1 benchmark, with Phase 2/3 promotion gated on empirical results) is preserved here for reference. It would have read:

> ~~Recommendation: PROCEED to Phase 0 (transcoder shipped behind feature flag) and Phase 1 (internal benchmark). Phase 2/3 promotion conditional on the Phase 1 benchmark satisfying all three pass criteria (≥10% token reduction, ≥99% parse rate, ≤2pp accuracy regression) on each P0 model.~~

That conditional recommendation was reviewed and declined for the reasons captured in the **Decision** section: insufficient public model-support data for the actual deployment matrix, and disproportionate implementation cost relative to the absence of a token-cost pressure point on this project.

**Phase 4 (TOON for tool inputs) was already rejected as out of scope** independent of this decision: BAML's GPT-5.1 array-counting failure means model-generated TOON is currently unreliable. That conclusion stands regardless of the Phase 0-3 decision.

---

## Table of Contents

1. [Research Overview](#research-overview) (top of document)
2. [Technical Research Scope Confirmation](#technical-research-scope-confirmation)
3. [Technology Stack Analysis](#technology-stack-analysis) — TOON spec, libraries, tokenization, MCP integration tooling, model targets, adoption trends, confidence summary
4. [Integration Patterns Analysis](#integration-patterns-analysis) — format negotiation, asymmetric handling, comparison surface, schema preservation, error recovery, configuration patterns
5. [Architectural Patterns and Design](#architectural-patterns-and-design) — system architecture, strategy + decorator, scalability, integration, security, data, deployment, decisions table
6. [Implementation Approaches and Technology Adoption](#implementation-approaches-and-technology-adoption) — adoption strategies, dev workflows, **benchmark methodology**, deployment, skills, costs, risks
7. [Technical Research Recommendations](#technical-research-recommendations) — implementation roadmap (Sprints 1-4), tech stack, skills, success metrics
8. **Research Synthesis** *(this section)* — executive summary, decision, key findings, methodology and source documentation, conclusion

---

## Key Decisions Captured Across the Research

| Decision | Choice | Rejected | Why |
|---|---|---|---|
| Direction | Pattern B (JSON in / TOON out) | Pattern D (symmetric TOON), Pattern C (TOON in / JSON out) | Sidesteps BAML's array-counting failure; preserves JSON Schema validation |
| Where transcoder lives | `@iris-mcp/shared` `McpServerBase` decorator | Per-server, on-the-wire, in ObjectScript | Single point, all 5 servers benefit, ObjectScript untouched |
| Format selection granularity | Per-tool with auto-default | Per-server, per-namespace, global only | Tool catalog payload shapes vary too much for per-server |
| Default initial state | `IRIS_MCP_FORMAT=json` | TOON default from day one | Phase 0 ships dark; promote only after benchmark |
| Schema source of truth | JSON Schema (Zod) | TOON `[N]+{fields}` | TOON has no schema language; validation pre-transcode |
| Streaming | Skip in v1 | Use `encodeLines` | Existing pagination handles size; encode is sub-ms |
| Memoization | Skip in v1 | LRU cache | Encode cost too low to justify cache invalidation |
| Bootstrap regeneration | Not required | (would be required if ObjectScript touched) | All TS-only; Rule #18 not triggered |
| Rollback | Env var flip + restart | Migration / schema versioning | Stateless; presentation-layer change |

---

## Strategic Technical Impact Assessment

**For IRIS-Execute MCP v2 (this project):**
- **Cost reduction**: realistic 20-30% blended token savings on the catalog (mix of tabular and nested tools), translating to proportional vendor-bill savings on Claude/GPT/Gemini-backed clients. Negligible savings for clients using local LLMs at zero marginal token cost — but the LLM context-window budget benefits regardless.
- **Capability unlock**: tools that previously hit context-window limits (e.g., a `iris_global_list` returning thousands of nodes) become more usable with TOON's denser encoding, even before any API cost considerations.
- **Reversibility**: this is the lowest-risk feature category — additive, presentation-layer, env-var-controlled. The architecture explicitly supports a "ship and let metrics decide" mode.

**For the broader MCP ecosystem (informational):**
- We become an early adopter of Pattern B for tool-result transcoding. **No public production deployment of this pattern is documented as of 2026-05.** First-mover signal; potential to contribute findings back to the MCP and TOON communities (an empirical Pattern B benchmark with frontier + local model coverage would be a meaningful artifact).
- We are NOT betting on MCP standardizing TOON support. Proposal #315 doesn't mention TOON; maintainer pushback on similar proposals suggests private convention is the right scope.

**For ObjectScript/IRIS engineering team:**
- **Zero impact.** No ObjectScript classes change, no compile cycles affected, bootstrap regeneration not triggered. This is purely a TypeScript MCP-layer concern.

---

## Future Outlook and Research Opportunities

**Near-term (next 6 months):**
- Run the Phase 1 benchmark and publish the per-model table.
- Monitor TOON spec/SDK churn — current self-described "stable but an idea in progress" status means breaking changes possible.
- Watch MCP proposal #315 for any movement; if it lands with structured-format negotiation, our private convention may become standardizable.

**Medium-term (6-18 months):**
- If Phase 3 stable for 30+ days, consider extending pattern to `resources/read` content (also rides as text inside MCP).
- If model providers add native server-side tokenizer-aware compaction (Cloudflare Code Mode-style), reassess whether TOON is still the right token-reduction layer.
- Consider whether selective TOON-for-inputs could work for specific tools where the user (LLM) constructs args from a TOON-encoded tool result already in context — this is a narrower bet than "all tool inputs as TOON" and may be tractable.

**Long-term (18+ months):**
- The format-war framing ("TOON replaces JSON") is the wrong frame. Token-efficient formats are likely to coexist with JSON the way Brotli coexists with gzip — automatic, negotiated at the boundary, invisible to end users. The architecture from this research is consistent with that future.

---

## Risk Register (Synthesis from Steps 3-5)

| Risk | Likelihood | Severity | Mitigation Strategy |
|---|---|---|---|
| Model accuracy regresses on TOON-encoded results | Medium | High | Phase 1 benchmark; auto-fallback monitor; per-tool revert |
| Local-LLM (Gemma 4 / Llama 3.x / Qwen 2.5+) handles TOON poorly | Medium-High | Medium | Per-model `IRIS_MCP_FORMAT_OVERRIDE_*` allowlist |
| TOON spec breaking change (v3 → v4) | Medium | Low | Pin v2.1.0 exactly; quarterly upstream review |
| MCP standardizes a different approach | Low | Medium | Architecture is additive; supports both paths |
| Encoder edge-case input throws | Low | Low | Try/catch + fallback to JSON; structured event |
| Audit logs less readable | Low | Low | Log JSON form in audit trail (lossless roundtrip preserves) |
| Asymmetric format confuses some local models | Unknown → Phase 1 | Medium | Experiment C tests directly; allowlist if confirmed |
| Frontier-flagship parse rate untested | High (no data exists) | Medium | Phase 1 benchmark closes the gap |
| Bootstrap drift from ObjectScript change | Very Low | Low | This work is TS-only; Rule #18 not triggered |
| Benchmark cost overruns | Low | Low | Approximations early; API only for final reporting |

---

## Technical Research Methodology and Source Documentation

**Methodology:**
- Multi-source verification — every claim cross-checked across primary spec, vendor docs, independent commentary, and where applicable, the actual IRIS-Execute MCP v2 codebase.
- Confidence levels marked explicitly. Public-data gaps surfaced rather than hidden.
- Architecture recommendations grounded in the **actual** repository structure, not generic patterns — every code reference is a clickable link to the live file.
- Decision-oriented synthesis rather than open-ended summary.

**Primary technical sources consulted:**
- [TOON official specification — github.com/toon-format/spec](https://github.com/toon-format/spec)
- [TOON reference implementation — github.com/toon-format/toon](https://github.com/toon-format/toon) (TypeScript SDK)
- [TOON official site — toonformat.dev](https://toonformat.dev/) including [LLM prompts guide](https://toonformat.dev/guide/llm-prompts)
- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP Proposal #315 — Suggested Response Format](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/315)
- [Anthropic tool-use documentation](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)
- [Anthropic Token Counting API](https://platform.claude.com/docs/en/build-with-claude/token-counting)
- [Ollama Tool Calling Docs](https://docs.ollama.com/capabilities/tool-calling)
- IRIS-Execute MCP v2 codebase: [packages/shared/src/server-base.ts](packages/shared/src/server-base.ts), [tool-types.ts](packages/shared/src/tool-types.ts), [config.ts](packages/shared/src/config.ts), [http-client.ts](packages/shared/src/http-client.ts), [index.ts](packages/shared/src/index.ts)
- Project rules: [`.claude/rules/project-rules.md`](.claude/rules/project-rules.md)

**Secondary/independent sources:**
- [BAML: Beware When Using TOON](https://boundaryml.com/blog/beware-when-using-toon) — the canonical critical perspective; documents GPT-5.1 array-counting failure
- [InfoQ: TOON release coverage](https://www.infoq.com/news/2025/11/toon-reduce-llm-cost-tokens/)
- [InfoQ: Cloudflare Code Mode MCP](https://www.infoq.com/news/2026/04/cloudflare-code-mode-mcp-server/) — competing token-optimization pattern
- [DigitalOcean: TOON vs JSON](https://www.digitalocean.com/community/tutorials/toon-vs-json) — measured framing
- [Adam Holter: TOON vs JSON for LLMs](https://adam.holter.com/toon-vs-json-for-llms-token-efficiency-retrieval-accuracy-and-where-it-actually-helps/)
- [LogRocket: How to use TOON to reduce tokens by 60%](https://blog.logrocket.com/reduce-tokens-with-toon/)
- [Docker: Local LLM Tool Calling — A Practical Evaluation](https://www.docker.com/blog/local-llm-tool-calling-a-practical-evaluation/) — Qwen 3 14B at F1=0.971 baseline
- [MindStudio: Optimize MCP Server Token Usage](https://www.mindstudio.ai/blog/optimize-mcp-server-token-usage) — TOON in the MCP context
- [Claude Code JSON-to-TOON Hook gist](https://gist.github.com/maman/de31d48cd960366ce9caec32b569d32a) — input-side transcoding precedent
- [Preprints.org: Prompt Engineering for Structured Data](https://www.preprints.org/manuscript/202506.1937) — mixed-format accuracy data
- [arxiv: Does Prompt Formatting Have Any Impact on LLM Performance?](https://arxiv.org/html/2411.10541v1)
- [improvingagents.com: Best Nested Data Format](https://www.improvingagents.com/blog/best-nested-data-format/)
- [Promptfoo](https://github.com/promptfoo/promptfoo) — proposed benchmark harness
- [Vitest snapshot guide](https://vitest.dev/guide/snapshot.html)

**Web search queries used (representative subset):**
- TOON Token-Oriented Object Notation specification format LLM
- TOON vs JSON token efficiency benchmark LLM tool calling 2026
- TOON format npm package TypeScript parser serializer
- TOON Token Oriented Object Notation github repository
- MCP Model Context Protocol tool call format token optimization 2026
- TOON format LLM accuracy parse rate comparison Gemma Llama Qwen
- TOON benchmark Claude OR GPT-4 OR Gemini tool calling accuracy 2026
- Anthropic tool_use tool_result content type text JSON string format
- TOON JSON roundtrip fidelity lossless schema validation
- MessagePack CBOR vs JSON LLM tool calling token efficiency
- LLM mixed format prompt JSON YAML accuracy degradation tool calling
- TOON parse error recovery fallback malformed output LLM
- MCP server content-type negotiation custom format text response 2026
- MCP TypeScript SDK middleware interceptor response transform pattern
- JSON Schema to TOON schema mapping field type validation
- streaming JSON encoder large MCP response chunked text content
- LLM tool calling evaluation framework promptfoo accuracy benchmark 2026
- Ollama local model tool calling test harness automated evaluation
- tiktoken Anthropic Claude tokenizer count tokens TypeScript Node
- contract testing golden file snapshot LLM output format vitest
- "feature flag" rollout LLM format A/B telemetry observability

**Research quality notes:**
- **Confidence transparency**: every major claim is annotated with confidence (High / Medium / Low / Very Low) and the reason. Zero hidden assumptions.
- **Limitation disclosure**: no public benchmark covers the user's listed local LLMs or flagship frontier models. Phase 1 internal benchmark is required to make defensible default decisions.
- **Version sensitivity**: TOON spec at v3.0, SDK at v2.1.0 (Dec 2025). Status "stable but an idea in progress" — re-validate findings if SDK bumps to v3.x or beyond.
- **Confirmation bias check**: BAML's adversarial critique was deliberately surfaced and weighted alongside TOON-promotional sources. The strongest single piece of evidence against Pattern D came from this counter-source, not the marketing material.

---

## Conclusion

TOON is a credible, well-engineered token-efficient JSON alternative for the *specific* shape of payload it was designed for — uniform arrays of objects sent to LLMs — and it earns its keep there. It is NOT a universal JSON replacement, and treating it as one would lose money relative to JSON on nested/heterogeneous data and **introduce real reliability risk** if applied to model-generated outputs (per BAML's GPT-5.1 evidence).

For IRIS-Execute MCP v2, the architecturally correct adoption is:
1. **Pattern B only** (JSON in / TOON out — never the reverse, never symmetric).
2. **Per-tool format selection** (auto-default based on payload shape; explicit overrides for known shapes).
3. **TypeScript-layer transcoder** in [`McpServerBase`](packages/shared/src/server-base.ts) (one implementation, all 5 servers benefit, ObjectScript untouched, bootstrap regeneration not required).
4. **Phased rollout with empirical gate** at Phase 1 (internal benchmark closes the local-LLM and frontier-flagship evidence gaps).
5. **Single-flag rollback** as the standing safety net.

The lowest-risk, highest-information path forward is to **ship Phase 0 (the transcoder, dark) and run the Phase 1 benchmark**. The benchmark either produces empirical green-light data for Phase 2 promotion, or it produces a per-model recommendation table identifying which models can use TOON safely and which can't. Either outcome is more valuable than the current state of "no public data on our deployment matrix."

---

**Technical Research Completion Date:** 2026-05-01
**Research Period:** Comprehensive technical analysis spanning TOON spec, MCP protocol surface, model-side parsing reliability, and IRIS-Execute MCP v2 codebase grounding
**Document Length:** Sufficient for comprehensive technical coverage with empirical decision support
**Source Verification:** All technical facts cited with current sources; counter-perspectives explicitly surfaced
**Technical Confidence Level:** High on architecture and integration patterns; Medium-Low on per-model accuracy outside the public-benchmarked 4 small models (Phase 1 benchmark closes this)

_This research document serves as an authoritative reference on TOON adoption for IRIS-Execute MCP v2. The dated **Decision** below records the project's resolution; the body of the report is preserved as a reference if the question is revisited._

---

# Decision

**Decision date:** 2026-05-02
**Decision:** **No-go.** TOON will not be adopted in IRIS-Execute MCP v2 at this time.
**Decision-maker:** Project owner (Developer / @jbrandtmse)
**Status:** Closed. Document retained as research reference; no active workstream.

## Reasoning

The recommendation to proceed conditionally to Phase 0 (transcoder shipped dark) + Phase 1 (internal benchmark) was reviewed and declined. The two load-bearing concerns:

1. **Model support is not where it needs to be.** The single canonical TOON benchmark covers four small/fast model variants only. There is **zero public benchmark data on the actual deployment matrix** — flagship Claude Sonnet/Opus, GPT-5 mainline, Gemini 3 Pro, Gemma 4, Llama 3.x, Qwen 2.5+. Per-model accuracy variance on the four small models that *were* tested spans 30+ percentage points (90.9% on GPT-5 Nano vs 58.4% on Grok-4 Fast on the same 209 questions). Closing the evidence gap would itself require running the Phase 1 benchmark, and the gap exists in part because TOON is too new (released October 2025; spec self-described as "stable, but also an idea in progress") for the empirical record to have caught up.

2. **The infrastructure complication outweighs the benefit on this project.** Even with the architecture's "additive, ObjectScript-untouched, single-flag rollback" framing, full adoption is meaningful surface area: a transcoder decorator in [`McpServerBase`](packages/shared/src/server-base.ts), a `resultFormat` field on every relevant `ToolDefinition`, env-var-driven priority chain logic, structured telemetry events, an auto-fallback monitor with rolling-window tracking, an internal benchmark harness, per-model regression checking against a moving SDK target, operator documentation of recommended pairings. This is real ongoing maintenance burden for a token-cost optimization on a project where token cost has not been called out as a bottleneck.

These concerns compound: even if the architecture were free, the model-support gap would still argue for waiting; even if the model-support gap were closed, the infrastructure cost would still need a token-cost pressure point to justify it. Neither is currently present.

## What was preserved

- The full research analysis (Steps 1-5) remains in the body of this document as a reference.
- The architectural design (Pattern B, per-tool selection, [`McpServerBase`](packages/shared/src/server-base.ts) decorator placement, JSON Schema as canonical) remains valid as a starting point if the question is revisited.
- The Phase 1 benchmark design (three matched-pair experiments across the P0 model matrix) remains valid as a starting point if the model-support evidence base changes.
- No code changes were made to IRIS-Execute MCP v2. No dependencies added. No bootstrap regeneration. ObjectScript untouched.

## When to revisit

This decision was made on the current evidence and current project priorities. Conditions under which it would be worth reopening:

- **Model support evidence matures.** Public benchmarks emerge that cover flagship Claude / GPT-5 / Gemini AND the user's local LLM list (Gemma 4 / Llama 3.x / Qwen 2.5+) on TOON parsing reliability, with per-model breakdowns rather than single averages.
- **MCP standardization changes the calculus.** [Proposal #315 (Suggested Response Format)](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/315) or a successor lands with structured format negotiation that subsumes private conventions — or names TOON as a supported content type.
- **Token cost becomes a measurable pressure point.** A specific deployment scenario surfaces where the token-budget cost of JSON tool results materially impacts user experience or vendor bills.
- **The TOON spec stabilizes definitively.** The current "stable, but also an idea in progress" framing softens to a versioned LTS posture that protects against breaking changes.

## What is NOT changing as a result of this decision

- The IRIS-Execute MCP v2 wire format remains JSON throughout, end to end.
- The five MCP servers and the umbrella package remain unchanged.
- No feature flags are added, no env vars introduced, no telemetry events emitted for `tool.result.format`.
- The ObjectScript REST API stays as-is; bootstrap classes are not regenerated.
- Existing project rules ([`.claude/rules/project-rules.md`](.claude/rules/project-rules.md)) are unaffected — this research did not produce a rule-codification candidate (no general-pattern lesson; Rule #1's "narrow one-off → stay in the document" applies).

## Disposition

- This document remains in [`_bmad-output/planning-artifacts/research/`](_bmad-output/planning-artifacts/research/) as a reference.
- No follow-up scheduled. No periodic review. If the question is revisited, the trigger will be one of the conditions in **When to revisit** above, surfaced organically.


