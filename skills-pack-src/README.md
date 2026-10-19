# skills-pack-src

Hand-authored sources of the IRIS MCP skills pack. This file is for contributors; it is not copied into the pack.

## Layout

| Path | What it holds | Where it goes in the pack |
| --- | --- | --- |
| `knowledge/<name>/SKILL.md` (and any files beside it) | One knowledge skill per directory | `skills/<name>/...` |
| `rules/...` | The always-on rule, in the forms each client reads | `rules/...` |
| `IRIS-MCP-THIRD-PARTY-NOTICES.md` | The third-party notice and the upstream licence text | the pack root |

Nothing else belongs here. `pnpm gen:pack` fails and names any other top-level entry, a `knowledge/<name>/` without a `SKILL.md`, and a skill name that a workflow skill in `skills/` already uses.

The workflow skills in `skills/` are not hand-authored: `pnpm gen:skills` generates them from the MCP prompts, and `pnpm gen:pack` copies them into the pack beside the skills from `knowledge/`.

## Edit here, then generate

The pack is `packages/client-config/skills-pack/`. It is a generated, committed directory, and nothing under it is ever edited by hand. A hand edit is lost at the next `pnpm gen:pack`, and `pnpm gen:pack:check` (part of the default test suite) fails on any missing, changed or stray pack file.

1. Edit a file in this directory, or change a prompt and run `pnpm gen:skills`.
2. Run `pnpm gen:pack`.
3. Commit the sources and the regenerated pack together.

Every pack file is a byte-for-byte copy of its source, except the pack's `README.md`, which the generator renders.

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
- `pnpm check:provenance`: the notice, the header lines, the provenance rows, and the notice in every npm tarball.
- `pnpm validate:prompts`: every `iris_*` token in the skills and rule files names a real tool.
