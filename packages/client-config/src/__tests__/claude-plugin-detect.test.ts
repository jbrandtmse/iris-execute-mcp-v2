/**
 * Story 42.8 (DW-625; AD-28) - `detectClaudeCodePlugin`: whether the `iris-mcp@iris-mcp` Claude Code plugin is enabled, from the
 * `enabledPlugins` key of exactly three settings files, the highest one that holds the key deciding.
 *
 * Every fixture settings file has the shape of the real `enabledPlugins` key (Claude Code settings reference, checked 2026-11-21, and
 * the `settings.json` a real `claude plugin install` wrote in the story's Task 0 probe: `{"enabledPlugins":{"<plugin>@<marketplace>":true}}`).
 * Each test builds its own temp home and project and removes them, so no test reads the real home or the real `CLAUDE_CONFIG_DIR`.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CLAUDE_CODE_PLUGIN_ID,
  describePluginDetection,
  detectClaudeCodePlugin,
  type PluginDetectionHost,
} from "../claude-plugin-detect.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Fixture {
  home: string;
  project: string;
  host: (env?: Record<string, string | undefined>) => PluginDetectionHost;
  write: (file: string, text: string) => string;
}

function fixture(): Fixture {
  const root = path.resolve(mkdtempSync(path.join(tmpdir(), "plugin-detect-")));
  roots.push(root);
  const home = path.join(root, "home");
  const project = path.join(root, "proj");
  mkdirSync(home);
  mkdirSync(project);
  return {
    home,
    project,
    write: (file, text) => {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, text);
      return file;
    },
    host: (env = {}) => ({
      homeDir: home,
      projectDir: project,
      env,
      platform: path.sep === "\\" ? "win32" : "linux",
      readFile: (file) => {
        try {
          return readFileSync(file, "utf8");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw error;
        }
      },
    }),
  };
}

const settings = (value: unknown): string => `${JSON.stringify({ enabledPlugins: { [CLAUDE_CODE_PLUGIN_ID]: value } }, null, 2)}\n`;

describe("the three files and their precedence (I/O matrix)", () => {
  it("none of the three has the key: not enabled, nothing decided, the three paths named", () => {
    const f = fixture();
    const detection = detectClaudeCodePlugin(f.host());
    expect(detection.enabled).toBe(false);
    expect(detection.decidedBy).toBeNull();
    expect(detection.checked).toEqual([
      path.join(f.home, ".claude", "settings.json"),
      path.join(f.project, ".claude", "settings.json"),
      path.join(f.project, ".claude", "settings.local.json"),
    ]);
    expect(detection.warnings).toEqual([]);
    expect(describePluginDetection(detection)).toBe(
      `no Claude Code plugin iris-mcp@iris-mcp is enabled (checked ${detection.checked.join(", ")}); installing the skills and the rule`,
    );
  });

  it("the user file has the key set to true: enabled, decided by that file", () => {
    const f = fixture();
    const user = f.write(path.join(f.home, ".claude", "settings.json"), settings(true));
    const detection = detectClaudeCodePlugin(f.host());
    expect(detection).toMatchObject({ enabled: true, decidedBy: user, warnings: [] });
    expect(describePluginDetection(detection)).toContain(`is enabled in ${user}; installing only the rule`);
  });

  it("the project file alone has it: enabled, decided by the project file", () => {
    const f = fixture();
    const project = f.write(path.join(f.project, ".claude", "settings.json"), settings(true));
    expect(detectClaudeCodePlugin(f.host())).toMatchObject({ enabled: true, decidedBy: project });
  });

  it("the local file wins over the user file: user true, local false is not enabled", () => {
    const f = fixture();
    f.write(path.join(f.home, ".claude", "settings.json"), settings(true));
    const local = f.write(path.join(f.project, ".claude", "settings.local.json"), settings(false));
    const detection = detectClaudeCodePlugin(f.host());
    expect(detection).toMatchObject({ enabled: false, decidedBy: local });
    expect(describePluginDetection(detection)).toContain(`is set to false in ${local}; installing the skills and the rule`);
  });

  it("the local file wins the other way too: user false, local true is enabled", () => {
    const f = fixture();
    f.write(path.join(f.home, ".claude", "settings.json"), settings(false));
    const local = f.write(path.join(f.project, ".claude", "settings.local.json"), settings(true));
    expect(detectClaudeCodePlugin(f.host())).toMatchObject({ enabled: true, decidedBy: local });
  });

  it("the project file wins over the user file", () => {
    const f = fixture();
    f.write(path.join(f.home, ".claude", "settings.json"), settings(true));
    const project = f.write(path.join(f.project, ".claude", "settings.json"), settings(false));
    expect(detectClaudeCodePlugin(f.host())).toMatchObject({ enabled: false, decidedBy: project });
  });

  it("a file that lacks the key does not decide, whatever else it holds", () => {
    const f = fixture();
    const user = f.write(path.join(f.home, ".claude", "settings.json"), settings(true));
    f.write(path.join(f.project, ".claude", "settings.local.json"), JSON.stringify({ enabledPlugins: { "other@market": false } }));
    f.write(path.join(f.project, ".claude", "settings.json"), JSON.stringify({ model: "x" }));
    expect(detectClaudeCodePlugin(f.host())).toMatchObject({ enabled: true, decidedBy: user });
  });
});

describe("CLAUDE_CONFIG_DIR moves the user file", () => {
  it("reads <dir>/settings.json, and never ~/.claude, when the variable is set", () => {
    const f = fixture();
    const configDir = path.join(f.home, "..", "elsewhere");
    const moved = f.write(path.join(configDir, "settings.json"), settings(true));
    const detection = detectClaudeCodePlugin(f.host({ CLAUDE_CONFIG_DIR: configDir }));
    expect(detection).toMatchObject({ enabled: true, decidedBy: path.join(configDir, "settings.json") });
    expect(detection.checked[0]).toBe(path.join(configDir, "settings.json"));
    expect(detection.checked.some((file) => file.startsWith(path.join(f.home, ".claude")))).toBe(false);
    expect(detection.decidedBy, "the file the detector reports is the one the fixture wrote").toBe(moved);
  });

  it("does not read ~/.claude/settings.json when the variable is set", () => {
    const f = fixture();
    f.write(path.join(f.home, ".claude", "settings.json"), settings(true));
    const detection = detectClaudeCodePlugin(f.host({ CLAUDE_CONFIG_DIR: path.join(f.home, "empty-config") }));
    expect(detection).toMatchObject({ enabled: false, decidedBy: null });
  });

  it("an empty variable counts as unset", () => {
    const f = fixture();
    const user = f.write(path.join(f.home, ".claude", "settings.json"), settings(true));
    expect(detectClaudeCodePlugin(f.host({ CLAUDE_CONFIG_DIR: "" }))).toMatchObject({ enabled: true, decidedBy: user });
  });
});

describe("a file that cannot be used", () => {
  it("invalid JSON: a warning that names the file, no refusal, and the file counts as having no entry", () => {
    const f = fixture();
    const broken = f.write(path.join(f.project, ".claude", "settings.local.json"), "{ not json");
    const user = f.write(path.join(f.home, ".claude", "settings.json"), settings(true));
    const detection = detectClaudeCodePlugin(f.host());
    expect(detection.enabled).toBe(true);
    expect(detection.decidedBy).toBe(user);
    expect(detection.warnings).toHaveLength(1);
    expect(detection.warnings[0]).toContain(broken);
    expect(detection.warnings[0]).toContain("counts as having no entry");
  });

  it("JSONC (comments and a trailing comma) is read, as Claude Code reads it", () => {
    const f = fixture();
    const user = f.write(
      path.join(f.home, ".claude", "settings.json"),
      `// the user settings\n{\n  "enabledPlugins": { "${CLAUDE_CODE_PLUGIN_ID}": true, },\n}\n`,
    );
    expect(detectClaudeCodePlugin(f.host())).toMatchObject({ enabled: true, decidedBy: user, warnings: [] });
  });

  it("a file that starts with a byte order mark is read: its key decides, with no warning", () => {
    const f = fixture();
    const user = f.write(path.join(f.home, ".claude", "settings.json"), `\uFEFF${settings(true)}`);
    expect(readFileSync(user, "utf8").charCodeAt(0), "the fixture really starts with a BOM").toBe(0xfeff);
    expect(detectClaudeCodePlugin(f.host())).toMatchObject({ enabled: true, decidedBy: user, warnings: [] });
  });

  it("an empty or whitespace-only file is absent, with no warning, and does not hide a lower file's entry", () => {
    const f = fixture();
    const user = f.write(path.join(f.home, ".claude", "settings.json"), settings(true));
    f.write(path.join(f.project, ".claude", "settings.json"), "");
    f.write(path.join(f.project, ".claude", "settings.local.json"), " \n\t\n");
    expect(detectClaudeCodePlugin(f.host())).toMatchObject({ enabled: true, decidedBy: user, warnings: [] });
  });

  it("a value that is not true or false warns and does not decide", () => {
    const f = fixture();
    const odd = f.write(path.join(f.project, ".claude", "settings.json"), settings("yes"));
    const detection = detectClaudeCodePlugin(f.host());
    expect(detection).toMatchObject({ enabled: false, decidedBy: null });
    expect(detection.warnings[0]).toContain(odd);
  });

  it("a file that cannot be read warns, and the others still decide", () => {
    const f = fixture();
    const user = f.write(path.join(f.home, ".claude", "settings.json"), settings(true));
    const real = f.host();
    const host: PluginDetectionHost = {
      ...real,
      readFile: (file) => {
        if (file.endsWith("settings.local.json")) throw new Error("EACCES: permission denied");
        return real.readFile(file);
      },
    };
    const detection = detectClaudeCodePlugin(host);
    expect(detection).toMatchObject({ enabled: true, decidedBy: user });
    expect(detection.warnings).toHaveLength(1);
    expect(detection.warnings[0]).toContain("settings.local.json");
    expect(detection.warnings[0]).toContain("EACCES");
  });

  it("an enabledPlugins that is not an object, or a document that is not an object, is no entry and no warning", () => {
    const f = fixture();
    f.write(path.join(f.home, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: [CLAUDE_CODE_PLUGIN_ID] }));
    f.write(path.join(f.project, ".claude", "settings.json"), "[]");
    expect(detectClaudeCodePlugin(f.host())).toMatchObject({ enabled: false, decidedBy: null, warnings: [] });
  });

  it("only the exact key counts: a plugin of the same name from another marketplace does not", () => {
    const f = fixture();
    f.write(path.join(f.home, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "iris-mcp@other-market": true, "iris-mcp": true } }));
    expect(detectClaudeCodePlugin(f.host())).toMatchObject({ enabled: false, decidedBy: null });
  });
});

describe("the plugin id", () => {
  it("is the install key of the plugin and the marketplace the repository ships", () => {
    expect(CLAUDE_CODE_PLUGIN_ID).toBe("iris-mcp@iris-mcp");
  });
});
