# skills-pack-src

Hand-authored sources of the IRIS MCP skills pack. This file is for contributors; it is not copied into the pack.

## Layout

| Path | What it holds | Where it goes in the pack |
| --- | --- | --- |
| `knowledge/<name>/SKILL.md` (and any files beside it) | One knowledge skill per directory | `skills/<name>/...` |
| `rules/<name>.md` | One always-on rule per flat file, with no frontmatter | `rules/claude-code/<name>.md` and `rules/agents-md/<name>.md` |
| `IRIS-MCP-THIRD-PARTY-NOTICES.md` | The third-party notice and the upstream licence text | the pack root |

Nothing else belongs here. `pnpm gen:pack` fails and names any other top-level entry, a `knowledge/<name>/` without a `SKILL.md`, a skill name that a workflow skill in `skills/` already uses, anything in `rules/` that is not a flat `<name>.md` file (lower-case letters, digits and single hyphens in the name), a rule source that opens with frontmatter, and a rule source with a line that starts with `<!-- IRIS-MCP-RULE:` (only the generated section's own two marker lines may).

The workflow skills in `skills/` are not hand-authored: `pnpm gen:skills` generates them from the MCP prompts, and `pnpm gen:pack` copies them into the pack beside the skills from `knowledge/`.

## Edit here, then generate

The pack is `packages/client-config/skills-pack/`. It is a generated, committed directory, and nothing under it is ever edited by hand. A hand edit is lost at the next `pnpm gen:pack`, and `pnpm gen:pack:check` (part of the default test suite) fails on any missing, changed or stray pack file.

1. Edit a file in this directory, or change a prompt and run `pnpm gen:skills`.
2. Run `pnpm gen:pack`.
3. Commit the sources and the regenerated pack together.

Every pack file is a byte-for-byte copy of its source, except the pack's `README.md` and the `AGENTS.md` form of each rule, which the generator renders.

## Rules and their two forms

A rule is always on, so it takes no frontmatter, and `paths:` least of all: a scoped rule loads only when the agent touches a matching file, which is too late for a checklist that is meant to be in context before the first write. `pnpm gen:pack` fails and names a rule source whose first line is `---`. A rule also names no `iris_*` tool, so it declares no preset.

From each `rules/<name>.md` the generator writes two files:

- `rules/claude-code/<name>.md` holds the source bytes. Claude Code loads it from `.claude/rules/`.
- `rules/agents-md/<name>.md` holds the same bytes between two marker lines, each a whole line ending in LF: `<!-- IRIS-MCP-RULE:<name>:BEGIN -->` before them and `<!-- IRIS-MCP-RULE:<name>:END -->` after them. When the source does not end in LF, the generator adds one so the END line stays a whole line. An installer finds the block by those two exact lines, replaces everything between them, and leaves the rest of the user's `AGENTS.md` byte for byte as it was.

## Adapted content: header and provenance row

Third-party content that is adapted into the pack (not written from scratch) carries both of these, and `pnpm check:provenance` checks them:

- **The header line**, as the first non-blank line after any frontmatter:

  `Adapted from intersystems-community/iris-agentic-dev (MIT, © 2025 InterSystems Corporation); see IRIS-MCP-THIRD-PARTY-NOTICES.md`

- **A provenance row** in the table of `IRIS-MCP-THIRD-PARTY-NOTICES.md`, naming the pack file (relative to the pack), the upstream source file at commit `b6205bb`, and what changed:

  `` | `skills/<name>/SKILL.md` | `skills/skills/<upstream-name>/SKILL.md` | <what changed> | ``

Do not change the MIT licence block in the notice. `pnpm check:provenance` compares it with the upstream `LICENSE` byte for byte.

## Never adapt these upstream sources

- `skills/kb/ipm-module-authoring.md`
- anything under `iris-objectscript-eval`

`pnpm check:provenance` refuses a provenance row that cites either of them.

## Checks

- `pnpm gen:pack:check`: the pack equals what the sources produce.
- `pnpm check:provenance`: the notice, the header lines, the provenance rows, that the client-config tarball ships the whole pack, and that every npm tarball carrying pack or adapted content ships the notice.
- `pnpm validate:prompts`: every `iris_*` token in the skills and rule files names a real tool.
