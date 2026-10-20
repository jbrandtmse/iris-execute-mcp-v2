---
"@iris-mcp/client-config": minor
---

feat(skills-pack): three core ObjectScript knowledge skills, and a frontmatter rule for every pack skill (Epic 41, Story 41.3)

`@iris-mcp/client-config` now ships three knowledge skills in its skills pack: `iris-mcp-objectscript-gotchas` (language traps that compile or run differently from what the code suggests), `iris-mcp-objectscript-error-handling` (`%Status` values, exceptions and the `Try` and `Catch` method shape) and `iris-mcp-objectscript-unit-tests` (writing and running `%UnitTest` tests). Every claim in them was run on IRIS 2026.2, and they name no tool. The installer that places them arrives in Story 41.6.

`pnpm check:provenance` gains a `skill-frontmatter` rule: every pack `SKILL.md` must open with frontmatter on its first line that holds only `name` and `description`, so an adaptation header placed above the frontmatter, or a leading byte-order mark, no longer hides a skill's name and description.

No tool, action, governance key, preset, refusal code, route or bootstrapped class changes.
