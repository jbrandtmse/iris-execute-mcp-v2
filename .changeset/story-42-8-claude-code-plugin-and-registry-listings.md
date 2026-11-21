---
"@iris-mcp/client-config": minor
---

feat: a Claude Code plugin, an installer that knows it, and the MCP Registry and IPM listings (Story 42.8)

- The skills pack directory is now a Claude Code plugin root. `pnpm gen:pack` writes `.claude-plugin/plugin.json` (plugin `iris-mcp`, at the shared version, with six connection options: host, port, namespace, HTTPS, user name and password) and `.mcp.json` (the five servers as `dev`, `admin`, `data`, `interop` and `ops`, each `npx -y @iris-mcp/<name>@1`) into `skills-pack/`, from `skills-pack-src/plugin/`. The repository's `.claude-plugin/marketplace.json` lists the plugin, pinned to the release tag. Install with `/plugin marketplace add jbrandtmse/iris-execute-mcp-v2` and `/plugin install iris-mcp@iris-mcp` (from release 1.1.0).
- `iris-mcp-clients skills install --client claude-code` reads `enabledPlugins["iris-mcp@iris-mcp"]` from the user (`CLAUDE_CONFIG_DIR` aware), project and local Claude Code settings, the highest file that has the key deciding. With the plugin enabled it installs only the always-on rule, because the plugin brings the skills, and it removes skill files it installed earlier under the usual manifest rules. The run prints the file that decided, or the three it checked, and a `[WARN]` line for a settings file that is not valid JSON. New exports: `CLAUDE_CODE_PLUGIN_ID`, `detectClaudeCodePlugin`, `describePluginDetection`.

No tool, action, governance key, annotation, description, REST route or environment variable is added or changed, and `BOOTSTRAP_VERSION` does not move.
