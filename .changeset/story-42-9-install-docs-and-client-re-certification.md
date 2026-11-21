---
"@iris-mcp/client-config": minor
---

feat: a home-directory guard, a plugin-duplicates check and current client data (Story 42.9)

- A project-scope write (`apply`, `diff`, `enable`, `disable`, `remove` and `restore` with `--scope project`, and `skills install` and `skills uninstall`) is refused when the project directory is your home directory. It exits 1, writes nothing and puts the reason, which names the project and user paths, in the `--json` envelope's `error`. Both paths go through the real path, and are compared case-insensitively on macOS and Windows. Reads are unchanged.
- `iris-mcp-clients doctor` reports each `iris-*-mcp` entry in Claude Code's user or project scope while the `iris-mcp@iris-mcp` plugin is enabled (`claude-code-plugin-duplicates`), with the `remove` command that clears it.
- With `CLAUDE_CONFIG_DIR` set, the Claude Code user file is `$CLAUDE_CONFIG_DIR/.claude.json`, the file Claude Code then reads.
- Pi and JetBrains Junie are supported clients. Goose's Windows path is `%APPDATA%\Block\goose\config\config.yaml`. Windsurf is Devin Desktop (formerly Windsurf), Kimi CLI is archived and Roo Code is discontinued; their adapters stay. The skills installer gains an `antigravity` target on the `gemini` route. The adapter data is `2026-11-21.1`.
- The install docs describe the published install: one path per client, every `npx` command pinned to `@1`, and the clone-and-build steps in Contributing.

No tool, action, governance key, annotation, description, REST route or environment variable is added or changed, and `BOOTSTRAP_VERSION` does not move.
