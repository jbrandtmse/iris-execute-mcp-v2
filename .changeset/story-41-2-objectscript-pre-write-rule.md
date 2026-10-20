---
"@iris-mcp/dev": minor
"@iris-mcp/client-config": minor
---

feat(skills-pack): the ObjectScript pre-write checklist becomes an always-on rule, and the `objectscript-review` prompt is retired (Epic 41, Story 41.2)

`@iris-mcp/dev` no longer registers the `objectscript-review` prompt: `prompts/list` holds `diagnose-slow-query`, `deploy-and-test-class`, `promote-environment-change` and `edit-and-test-class`, and `prompts/get` for the retired name answers InvalidParams. Its generated skill is gone too. The checklist now ships as a rule that is in context before the first write, and every claim in it was verified on IRIS 2026.2. Nothing was published yet, so no release loses the prompt.

`@iris-mcp/client-config` ships the rule in the skills pack in two forms: `rules/claude-code/iris-mcp-objectscript-pre-write.md` for Claude Code, and `rules/agents-md/iris-mcp-objectscript-pre-write.md` for `AGENTS.md` (the same text between two `IRIS-MCP-RULE` marker lines). The installer that places them arrives in Story 41.6.

No tool, action, governance key, preset, refusal code, route or bootstrapped class changes.
