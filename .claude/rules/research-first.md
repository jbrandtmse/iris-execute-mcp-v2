## Brief overview
- Adopt a "Research First" workflow: when not 100% certain about a technical point, research with Perplexity MCP before deciding or coding.
- Emphasis on InterSystems IRIS and ObjectScript topics (syntax, best practices, IRIS features, Ensemble/Interoperability, SQL, globals, vector search, embedded Python).
- Keep research focused, cite authoritative sources, and convert findings into precise implementation steps.

## When to research
- Any uncertainty about IRIS/Ensemble method signatures, adapters, or configuration.
- ObjectScript syntax and semantics (e.g., $$$ macro usage, QUIT behavior in try/catch, abstract method requirements).
- IRIS SQL, globals, or vector embedding datatypes/operations behavior.
- Conflicting memories, ambiguous forum answers, or gaps in best practices.

## How to use Perplexity MCP effectively
- Use the integrated Perplexity MCP tools with specific, context-rich prompts:
  - Prefer: `search` for broad discovery, `get_documentation` for targeted docs, `check_deprecated_code` to validate deprecations or outdated patterns.
- Include context in queries (e.g., "ObjectScript", "InterSystems IRIS", feature name, known error code).
- Example queries:
  - "ObjectScript abstract method compile requirements curly braces return value"
  - "IRIS vector search error -259 datatype mismatch %Library.Embedding vs %Vector"
  - "Ens.BusinessOperation OnMessage method signature and request/response types"
  - "Embedded Python in IRIS: correct way to import and check Python availability"
- Iterate with follow-up questions if initial results conflict or lack clarity.

## Sources and citation
- Prioritize: InterSystems official docs (docs.intersystems.com), InterSystems Community posts, official GitHub/org publications, and highly reputable sources.
- Provide 2–4 authoritative links with a one-line rationale per link.
- Quote short key lines only when they directly impact implementation decisions.

## From research to action
- Summarize decisions as bullets before coding (what to change and why).
- Map each decision to a concrete step (e.g., "Use $$$ macros, not $$" -> "Update all macros in ClassX.cls").
- For IRIS/ObjectScript changes, validate by compiling with the IRIS MCP compile tools after applying updates.

## IRIS/ObjectScript emphasis
- Confirm Ensemble/Interoperability signatures, adapters, and sync/async patterns via research prior to implementing.
- After research, verify uncertain SQL/globals/vector behavior with small, isolated tests using IRIS MCP tools.
- Prefer native ObjectScript patterns for IRIS operations; reserve embedded Python for external library integrations (after researching correct bridge usage).

## Escalation if ambiguity remains
- If sources disagree, briefly summarize the conflict and propose the safest standards-compliant approach.
- If uncertainty persists after an initial research pass, ask one targeted clarifying question to unblock.

## Deliverable format for researched answers
- Provide:
  - A brief summary of findings (1–3 bullets)
  - A decision list (actionable bullets)
  - Source links (2–4) and any decisive short quotes
  - Any adjusted code snippet(s) reflecting the researched guidance
