/**
 * `@iris-mcp/client-config` - whether the IRIS MCP Claude Code plugin is enabled (Story 42.8, DW-625; AD-28).
 *
 * The plugin brings the skills pack, so `skills install --client claude-code` installs only the always-on rule (a plugin cannot carry
 * rules) when the plugin is enabled. Claude Code records an enabled plugin as `enabledPlugins["<plugin>@<marketplace>"]` in a settings
 * file. This module reads exactly three settings files, lowest precedence first, and the highest one that holds the key decides:
 *
 *   1. user:    `$CLAUDE_CONFIG_DIR/settings.json`, else `<home>/.claude/settings.json`
 *   2. project: `<project>/.claude/settings.json`
 *   3. local:   `<project>/.claude/settings.local.json`
 *
 * Managed settings, `--settings`, `--add-dir` and synced plugins are out of scope (the Claude Code settings reference describes
 * `enabledPlugins`; a miss only installs the skills twice, never loses the rule). A file that is not valid JSON or JSONC, or that cannot be
 * read, is reported as a warning and counts as having no entry. A leading byte order mark is ignored, and an empty or whitespace-only file
 * counts as absent, with no warning.
 *
 * Pure over an injected host: it never reads `process.*` or the file system itself; `host.readFile` does.
 */

import { parse as parseJsonc, type ParseError } from "jsonc-parser";

import type { AdapterPlatform } from "./types.js";

/** The plugin's install key, `<plugin name>@<marketplace name>`; a test holds it equal to `plugin.json` and `marketplace.json`. */
export const CLAUDE_CODE_PLUGIN_ID = "iris-mcp@iris-mcp";

/** What the detector needs from its host. */
export interface PluginDetectionHost {
  homeDir: string;
  /** The project the skills are installed into. */
  projectDir: string;
  env: Record<string, string | undefined>;
  /** Defaults to a POSIX path form. */
  platform?: AdapterPlatform;
  /** The text of a file, or `null` when it does not exist. It may throw when the file cannot be read. */
  readFile(path: string): string | null;
}

export interface PluginDetection {
  /** True only when the highest settings file that holds the key sets it to `true`. */
  enabled: boolean;
  /** The settings file whose entry decided (enabled or not), or `null` when none holds the key. */
  decidedBy: string | null;
  /** The three files that were looked at, lowest precedence first. */
  checked: string[];
  /** One line per file that could not be read or holds an entry that is not `true` or `false`. */
  warnings: string[];
}

function join(platform: AdapterPlatform | undefined, ...parts: string[]): string {
  const separator = platform === "win32" ? "\\" : "/";
  return parts.map((part, index) => (index === 0 ? part.replace(/[\\/]+$/, "") : part.replace(/^[\\/]+|[\\/]+$/g, ""))).join(separator);
}

type Entry = { kind: "absent" } | { kind: "set"; value: boolean } | { kind: "unusable"; warning: string };

function entryIn(host: PluginDetectionHost, file: string): Entry {
  let text: string | null;
  try {
    text = host.readFile(file);
  } catch (error) {
    return { kind: "unusable", warning: `${file} could not be read (${error instanceof Error ? error.message : String(error)}); it counts as having no entry` };
  }
  if (text === null) return { kind: "absent" };
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.trim() === "") return { kind: "absent" };
  const errors: ParseError[] = [];
  let parsed: unknown;
  try {
    parsed = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false });
  } catch (error) {
    return { kind: "unusable", warning: `${file} is not valid JSON (${error instanceof Error ? error.message : String(error)}); it counts as having no entry` };
  }
  if (errors.length > 0) {
    return { kind: "unusable", warning: `${file} is not valid JSON (parse error at offset ${errors[0]?.offset ?? 0}); it counts as having no entry` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { kind: "absent" };
  const enabledPlugins = (parsed as Record<string, unknown>).enabledPlugins;
  if (enabledPlugins === null || typeof enabledPlugins !== "object" || Array.isArray(enabledPlugins)) return { kind: "absent" };
  if (!Object.prototype.hasOwnProperty.call(enabledPlugins, CLAUDE_CODE_PLUGIN_ID)) return { kind: "absent" };
  const value = (enabledPlugins as Record<string, unknown>)[CLAUDE_CODE_PLUGIN_ID];
  if (typeof value === "boolean") return { kind: "set", value };
  return { kind: "unusable", warning: `${file} sets enabledPlugins["${CLAUDE_CODE_PLUGIN_ID}"] to a value that is not true or false; it counts as having no entry` };
}

/**
 * Decide whether the plugin is enabled for the project (see the module comment).
 *
 * @param host - The injected home directory, project, environment and file reader.
 */
export function detectClaudeCodePlugin(host: PluginDetectionHost): PluginDetection {
  const configured = host.env.CLAUDE_CONFIG_DIR;
  const user =
    configured !== undefined && configured !== ""
      ? join(host.platform, configured, "settings.json")
      : join(host.platform, host.homeDir, ".claude", "settings.json");
  const checked = [
    user,
    join(host.platform, host.projectDir, ".claude", "settings.json"),
    join(host.platform, host.projectDir, ".claude", "settings.local.json"),
  ];
  const warnings: string[] = [];
  let decidedBy: string | null = null;
  let enabled = false;
  for (const file of [...checked].reverse()) {
    const entry = entryIn(host, file);
    if (entry.kind === "unusable") warnings.push(entry.warning);
    if (entry.kind === "set" && decidedBy === null) {
      decidedBy = file;
      enabled = entry.value;
    }
  }
  return { enabled, decidedBy, checked, warnings: warnings.reverse() };
}

/**
 * The one line an install prints about the detection: what decided, or what was checked, and what the install does as a result.
 */
export function describePluginDetection(detection: PluginDetection): string {
  if (detection.decidedBy === null) {
    return `no Claude Code plugin ${CLAUDE_CODE_PLUGIN_ID} is enabled (checked ${detection.checked.join(", ")}); installing the skills and the rule`;
  }
  return detection.enabled
    ? `Claude Code plugin ${CLAUDE_CODE_PLUGIN_ID} is enabled in ${detection.decidedBy}; installing only the rule, because the plugin brings the skills`
    : `Claude Code plugin ${CLAUDE_CODE_PLUGIN_ID} is set to false in ${detection.decidedBy}; installing the skills and the rule`;
}
