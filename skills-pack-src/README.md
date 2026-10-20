# skills-pack-src

Hand-authored sources of the IRIS MCP skills pack. This file is for contributors; it is not copied into the pack.

## Layout

| Path | What it holds | Where it goes in the pack |
| --- | --- | --- |
| `knowledge/<name>/SKILL.md` (and any files beside it) | One knowledge skill per directory | `skills/<name>/...` |
| `rules/<name>.md` | One always-on rule per flat file, with no frontmatter | `rules/claude-code/<name>.md`, `rules/cursor/<name>.mdc` and `rules/agents-md/<name>.md` |
| `IRIS-MCP-THIRD-PARTY-NOTICES.md` | The third-party notice and the upstream licence text | the pack root |

Nothing else belongs here. `pnpm gen:pack` fails and names any other top-level entry, a `knowledge/<name>/` without a `SKILL.md`, a skill name that a workflow skill in `skills/` already uses, anything in `rules/` that is not a flat `<name>.md` file (lower-case letters, digits and single hyphens in the name), a rule source that opens with frontmatter, and a rule source with a line that starts with `<!-- IRIS-MCP-RULE:` (only the generated section's own two marker lines may).

The workflow skills in `skills/` are not hand-authored: `pnpm gen:skills` generates them from the MCP prompts, and `pnpm gen:pack` copies them into the pack beside the skills from `knowledge/`. `gen:skills` takes each skill's `description` and tool preset from the prompt's `skill` field (`packages/<server>/src/prompts/`), which only the generator and `validate:prompts` read; the server never sends it.

## Edit here, then generate

The pack is `packages/client-config/skills-pack/`. It is a generated, committed directory, and nothing under it is ever edited by hand. A hand edit is lost at the next `pnpm gen:pack`, and `pnpm gen:pack:check` (part of the default test suite) fails on any missing, changed or stray pack file.

1. Edit a file in this directory, or change a prompt and run `pnpm gen:skills`.
2. Run `pnpm gen:pack`.
3. Commit the sources and the regenerated pack together.

Every pack file is a byte-for-byte copy of its source, except the pack's `README.md`, the Cursor form of each rule and the `AGENTS.md` form of each rule, which the generator renders.

## Knowledge skills

A knowledge skill is one directory, `knowledge/<name>/`, that holds its `SKILL.md` and any files beside it. The generator copies the directory to `skills/<name>/` byte for byte. Hand-authored names carry the suite prefix, `iris-mcp-<name>`, so an installed copy never collides with a skill of the user's own or of another kit.

The `SKILL.md` opens with frontmatter on its first line, so a client reads the skill's name and description. `pnpm check:provenance` refuses a file that breaks any of these, and names the file and the fix:

- Line 1 is `---`, with no byte-order mark and nothing above it (an adaptation header goes after the frontmatter, never before it), and a later `---` line closes the block.
- The block holds `name` and `description`, each once, one `key: value` per line at column 1. A value is a double-quoted string that JSON reads, a single-quoted string, or a plain value that holds no `: ` or ` #`, does not end in `:` and does not start with a YAML indicator character. Blank lines and `#` comment lines are allowed.
- The block also allows an optional `metadata` map: a `metadata:` line plus two-space `key: value` lines, whose only key is `iris-tools-preset` (`core`, `developer` or `full`).
- `name` equals the directory name. It is lower-case letters and digits in groups joined by single hyphens, at most 64 characters, and holds neither `claude` nor `anthropic`.
- `description` is at most 1,024 characters and holds no XML tag. Write `UNDEFINED`, not `<UNDEFINED>`.

A description also names what the skill covers in its first sentence, then says `Use when` followed by the situations that call for it. `check:provenance` does not check that wording; `skills-pack-knowledge.test.ts` does, for every knowledge skill, because it lists each one by name.

The six knowledge skills are the three core skills (`iris-mcp-objectscript-gotchas`, `iris-mcp-objectscript-error-handling` and `iris-mcp-objectscript-unit-tests`) and the three platform skills (`iris-mcp-objectscript-sql`, `iris-mcp-system-classes` and `iris-mcp-interoperability`). All six name no `iris_*` tool, so they declare no preset, and they are written for a user's agent: no internal rule number, planning id, repository path or repository tooling. Each claim in them is checked on a live IRIS instance before it is written, by running it or, where running it would change a shared instance, by reading the IRIS class source of the same build, and a changed claim is checked again. A skill that names an `iris_*` tool declares, as `metadata` `iris-tools-preset`, the first of `core`, `developer` and `full` under which every tool it names is visible; `pnpm validate:prompts` checks it.

## Rules and their three forms

A rule is always on, so it takes no frontmatter, and `paths:` least of all: a scoped rule loads only when the agent touches a matching file, which is too late for a checklist that is meant to be in context before the first write. `pnpm gen:pack` fails and names a rule source whose first line is `---`. A rule also names no `iris_*` tool, so it declares no preset.

From each `rules/<name>.md` the generator writes three files:

- `rules/claude-code/<name>.md` holds the source bytes. Claude Code loads it from `.claude/rules/`.
- `rules/cursor/<name>.mdc` holds the source bytes after a fixed frontmatter block (`---`, `alwaysApply: true`, `---` and a blank line). Cursor loads a project rule from `.cursor/rules/` and ignores a plain `.md` file there, so the form is a `.mdc` file.
- `rules/agents-md/<name>.md` holds the same bytes between two marker lines, each a whole line ending in LF: `<!-- IRIS-MCP-RULE:<name>:BEGIN -->` before them and `<!-- IRIS-MCP-RULE:<name>:END -->` after them. When the source does not end in LF, the generator adds one so the END line stays a whole line. An installer finds the block by those two exact lines, replaces everything between them, and leaves the rest of the user's `AGENTS.md` byte for byte as it was.

## Adapted content: header and provenance row

Third-party content that is adapted into the pack (not written from scratch) carries both of these, and `pnpm check:provenance` checks them:

- **The header line**, as the first non-blank line after any frontmatter:

  `Adapted from intersystems-community/iris-agentic-dev (MIT, © 2025 InterSystems Corporation); see IRIS-MCP-THIRD-PARTY-NOTICES.md`

- **A provenance row** in the table of `IRIS-MCP-THIRD-PARTY-NOTICES.md`, naming the pack file (relative to the pack), the upstream source file at commit `b6205bb`, and what changed:

  `` | `skills/<name>/SKILL.md` | `skills/skills/<upstream-name>/SKILL.md` | <what changed> | ``

Do not change the MIT licence block in the notice. `pnpm check:provenance` compares it with the upstream `LICENSE` byte for byte.

One skill is adapted so far: `iris-mcp-objectscript-sql`. It carries the header on the first non-blank line after its frontmatter, and the notice holds its row, which cites `skills/skills/objectscript-sql-patterns/SKILL.md`. The header names the upstream project and the notice file, and it holds the copyright sign, so `skills-pack-knowledge.test.ts` exempts exactly that one line from its ASCII and wording checks. It does so only for a skill that the test's table marks as adapted (`adaptedFrom`), only when the line equals the header and is the first non-blank line after the frontmatter, and the same test requires the notice to hold exactly the rows of the adapted skills. A header in any other place or any other skill is read like any other line, and the test fails on it. `pnpm validate:prompts` exempts the same one line from its internal-reference check, for a skill that the notice's provenance table names, because the header names the notice file.

## The pack catalog

`pnpm gen:pack` renders the pack's `README.md` as a catalog of what the pack holds: the knowledge skills, then the workflow skills, then the always-on rules, each section sorted by name. A skill's entry carries its frontmatter `description` and, when it declares one, its tool preset; a rule's entry carries its first heading and how it loads. A `SKILL.md` whose description cannot be read renders a fallback line, and `gen:pack` still succeeds, so `pnpm check:provenance` can report the frontmatter.

## Never adapt these upstream sources

- `skills/kb/ipm-module-authoring.md`
- anything under `iris-objectscript-eval`

`pnpm check:provenance` refuses a provenance row that cites either of them.

## Checks

- `pnpm gen:pack:check`: the pack equals what the sources produce.
- `pnpm check:provenance`: the notice, the header lines, the provenance rows, the frontmatter of every `skills/<name>/SKILL.md` (rule `skill-frontmatter`), that the client-config tarball ships the whole pack, and that every npm tarball carrying pack or adapted content ships the notice.
- `pnpm validate:prompts`: every `iris_*` token in the skills and rule files names a real tool, every skill declares the tool preset it needs, and no prompt (its arguments and skill description included) or agent content file holds an internal reference (nine classes: a rule number, a bare `#` and digits that is not an IRIS error code, a planning or deferred-work id, a story number, a repository path, an absolute path, a repository file, repository tooling and a snapshot folder).
