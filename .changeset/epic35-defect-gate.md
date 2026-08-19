---
"@iris-mcp/all": patch
"@iris-mcp/dev": patch
"@iris-mcp/interop": patch
---

feat(all): Epic 35 defect gate + prompt/docs wording corrections (Epic 35, Story 35.8)

`@iris-mcp/all` gains the Epic 35 epic-done gate: `src/__tests__/epic35-defect-gate.test.ts`, a default-suite (non-integration) live-IRIS test file with one leg per Epic 35 finding (F1-F9) driving the shipped tool handlers against a real IRIS instance. It skips gracefully on a pristine/offline checkout and is armed fail-closed on the packaging path by the new `scripts/prepublish-gate.mjs` (this package's `prepublishOnly` now runs it instead of a bare reachability ping): under `IRIS_REQUIRE_LIVE=1` an unreachable IRIS, an undeployed ExecuteMCPv2 REST app, or missing test fixtures fail the publish. The arming also freshness-checks the built dists the gate drives (`@iris-mcp/shared`, dev, admin, data, interop) before running it.

Two user-visible wording corrections ride along: the `deploy-and-test-class`/`objectscript-review` prompts (and their generated skills) now say a bare non-glob `iris_doc_load` path is REFUSED at upload time when the derived name disagrees with the file's Class declaration (the Story 35.9 behavior), replacing the stale "mis-maps the class name" phrasing; and `iris_interop_rest`'s `delete` description/README note that IRIS preserves the generated `.impl` implementation class by design (delete it separately if unwanted).
