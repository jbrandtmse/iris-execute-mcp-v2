---
"@iris-mcp/client-config": minor
---

feat(skills): `iris-mcp-clients skills install|uninstall` places the skills pack and its always-on rule in a project (Epic 41, Story 41.6)

`@iris-mcp/client-config` gains the skills and rules installer. `iris-mcp-clients skills install --client <id>` writes the pack into one project, at project scope only, along one of four routes: `claude-code` (`.claude/skills/` and `.claude/rules/`), `cursor` (`.agents/skills/` and `.cursor/rules/*.mdc`), `gemini` (`.agents/skills/` and a marked block in `GEMINI.md`) and `agents` (`.agents/skills/` and a marked block in `AGENTS.md`, for every other client). It previews the plan first and writes only after `--yes` or a TTY confirmation, exactly like `apply`; `--dry-run` writes nothing. It keeps a per-project record of the files and blocks it owns in `.iris-mcp/skills-pack.json`, so an update, a second run and an uninstall change only those, and the bytes of a user's `AGENTS.md` or `GEMINI.md` outside the marked block are kept as they were. It places `IRIS-MCP-THIRD-PARTY-NOTICES.md` beside every installed skill that carries adapted content. Backups of anything it overwrites or deletes go under `~/.iris-mcp/client-manager/backups/skills-pack/`.

The package also exports the data and engine behind it: the disposition table of 17 clients (`PACK_TARGETS`), the marked-block reader and writer (`locateRuleBlock`, `withRuleBlock`, `withoutRuleBlock`), `loadPack`, `planPackChange`, `installerPayloads`, `preparePackChange` and `executePackPlan`.

The skills pack gains a Cursor form of its rule, `rules/cursor/<name>.mdc` (always-apply frontmatter, then the rule), and `pnpm check:provenance` now checks the notice beside the adapted skill in what each route installs.

No MCP tool, action, governance key, preset roster, refusal code, route or bootstrapped class changes.
