/**
 * Story 42.8 (DW-625; AD-28) - `skills install --client claude-code` and the Claude Code plugin: with `iris-mcp@iris-mcp` enabled the
 * install writes only the always-on rule, and the run reports which settings file decided. In process through `runCli`, over a temp
 * project and a temp home behind a jailed byte file system (a read of the real `~/.claude` would throw).
 *
 * The settings fixtures have the shape of the real key, `{"enabledPlugins":{"iris-mcp@iris-mcp":true}}` (the file a real
 * `claude plugin install` wrote in the story's Task 0 probe, Claude Code 2.1.330).
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { runCli, type CliDeps } from "../cli/clients.js";
import { MANIFEST_PATH } from "../pack-plan.js";

import { fixedNow } from "./helpers.js";
import { hostPlatform, jailedBytesFs, makeSandbox, readProjectFile, removeSandboxes, treeSnapshot, writeProjectFile, type Sandbox } from "./pack-test-helpers.js";

afterEach(removeSandboxes);

const RULE_PATH = ".claude/rules/iris-mcp-objectscript-pre-write.md";
const SKILL_FILE = ".claude/skills/iris-mcp-objectscript-sql/SKILL.md";
const ENABLED = `${JSON.stringify({ enabledPlugins: { "iris-mcp@iris-mcp": true } })}\n`;
const DISABLED = `${JSON.stringify({ enabledPlugins: { "iris-mcp@iris-mcp": false } })}\n`;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(sandbox: Sandbox, argv: string[], env: Record<string, string> = {}): Promise<Run> {
  let stdout = "";
  let stderr = "";
  const stdin = Readable.from([""]) as Readable & { isTTY?: boolean };
  stdin.isTTY = false;
  const deps: CliDeps = {
    env,
    platform: hostPlatform(),
    homeDir: sandbox.home,
    projectDir: sandbox.project,
    stateDir: sandbox.state,
    bytesFs: jailedBytesFs(sandbox.root),
    stdout: { write: (chunk: string) => void (stdout += chunk) },
    stderr: { write: (chunk: string) => void (stderr += chunk) },
    stdin,
    now: fixedNow(1, 2, 3, 4, 5, 6, 7, 8),
  };
  const code = await runCli(argv, deps);
  return { code, stdout, stderr };
}

const install = (sandbox: Sandbox, extra: string[] = [], env: Record<string, string> = {}): Promise<Run> =>
  run(sandbox, ["skills", "install", "--client", "claude-code", "--yes", ...extra], env);

const userSettings = (sandbox: Sandbox): string => path.join(sandbox.home, ".claude", "settings.json");
const exists = (sandbox: Sandbox, rel: string): boolean => existsSync(path.join(sandbox.project, ...rel.split("/")));

describe("no plugin (the DW-625 default)", () => {
  it("installs the skills and the rule, and reports that no plugin was found and which three files were checked", async () => {
    const sandbox = makeSandbox();
    const result = await install(sandbox);
    expect(result.code, result.stderr).toBe(0);
    const checked = [userSettings(sandbox), path.join(sandbox.project, ".claude", "settings.json"), path.join(sandbox.project, ".claude", "settings.local.json")];
    expect(result.stdout).toContain(`no Claude Code plugin iris-mcp@iris-mcp is enabled (checked ${checked.join(", ")}); installing the skills and the rule\n`);
    expect(exists(sandbox, RULE_PATH)).toBe(true);
    expect(exists(sandbox, SKILL_FILE)).toBe(true);
  });

  it("another client's route is not asked: no report line", async () => {
    const sandbox = makeSandbox();
    const result = await run(sandbox, ["skills", "install", "--client", "codex", "--yes"]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).not.toContain("Claude Code plugin");
  });
});

describe("plugin enabled", () => {
  it("user settings true: only the rule is installed, and the report names the user file", async () => {
    const sandbox = makeSandbox();
    writeProjectFile(sandbox.home, ".claude/settings.json", ENABLED);
    const result = await install(sandbox);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Claude Code plugin iris-mcp@iris-mcp is enabled in ${userSettings(sandbox)}; installing only the rule`);
    expect(exists(sandbox, RULE_PATH)).toBe(true);
    expect(exists(sandbox, ".claude/skills")).toBe(false);
    const manifest = JSON.parse(readProjectFile(sandbox.project, MANIFEST_PATH).toString("utf8")) as { files: Array<{ path: string }> };
    expect(manifest.files.map((file) => file.path)).toEqual([RULE_PATH]);
  });

  it("project scope: .claude/settings.json true, nothing else, is rule only", async () => {
    const sandbox = makeSandbox();
    writeProjectFile(sandbox.project, ".claude/settings.json", ENABLED);
    const result = await install(sandbox);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(`is enabled in ${path.join(sandbox.project, ".claude", "settings.json")}`);
    expect(exists(sandbox, RULE_PATH)).toBe(true);
    expect(exists(sandbox, ".claude/skills")).toBe(false);
  });

  it("local override: user true, .claude/settings.local.json false installs the skills and the rule", async () => {
    const sandbox = makeSandbox();
    writeProjectFile(sandbox.home, ".claude/settings.json", ENABLED);
    writeProjectFile(sandbox.project, ".claude/settings.local.json", DISABLED);
    const result = await install(sandbox);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(`is set to false in ${path.join(sandbox.project, ".claude", "settings.local.json")}; installing the skills and the rule`);
    expect(exists(sandbox, RULE_PATH)).toBe(true);
    expect(exists(sandbox, SKILL_FILE)).toBe(true);
  });

  it("config dir moved: CLAUDE_CONFIG_DIR/settings.json true is rule only, and ~/.claude is not read", async () => {
    const sandbox = makeSandbox();
    const configDir = path.join(sandbox.root, "claude-config");
    writeProjectFile(configDir, "settings.json", ENABLED);
    writeProjectFile(sandbox.home, ".claude/settings.json", DISABLED);
    const result = await install(sandbox, [], { CLAUDE_CONFIG_DIR: configDir });
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(`is enabled in ${path.join(configDir, "settings.json")}`);
    expect(result.stdout).not.toContain(path.join(sandbox.home, ".claude"));
    expect(exists(sandbox, RULE_PATH)).toBe(true);
    expect(exists(sandbox, ".claude/skills")).toBe(false);
  });

  it("--dry-run shows the rule-only plan and writes nothing", async () => {
    const sandbox = makeSandbox();
    writeProjectFile(sandbox.home, ".claude/settings.json", ENABLED);
    const before = treeSnapshot(sandbox.root);
    const result = await run(sandbox, ["skills", "install", "--client", "claude-code", "--dry-run"]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^ {2}create +\.claude\/rules\//m);
    expect(result.stdout).not.toMatch(/^ {2}create +\.claude\/skills\//m);
    expect(treeSnapshot(sandbox.root)).toEqual(before);
  });

  it("--json carries the detection", async () => {
    const sandbox = makeSandbox();
    writeProjectFile(sandbox.home, ".claude/settings.json", ENABLED);
    const result = await run(sandbox, ["skills", "install", "--client", "claude-code", "--dry-run", "--json"]);
    expect(result.code, result.stderr).toBe(0);
    const envelope = JSON.parse(result.stdout) as { data: { plugin: { id: string; enabled: boolean; decidedBy: string } } };
    expect(envelope.data.plugin).toMatchObject({ id: "iris-mcp@iris-mcp", enabled: true, decidedBy: userSettings(sandbox) });
  });
});

describe("an unreadable settings file", () => {
  it("prints a [WARN] line that names it, and the install goes on", async () => {
    const sandbox = makeSandbox();
    writeProjectFile(sandbox.project, ".claude/settings.local.json", "{ not json");
    const result = await install(sandbox);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toMatch(new RegExp(`^\\[WARN\\] .*settings\\.local\\.json is not valid JSON`, "m"));
    expect(exists(sandbox, SKILL_FILE)).toBe(true);
  });
});

describe("the plugin is added after the skills were installed", () => {
  it("removes the skill files the installer owns, and keeps the rule", async () => {
    const sandbox = makeSandbox();
    expect((await install(sandbox)).code).toBe(0);
    expect(exists(sandbox, SKILL_FILE)).toBe(true);
    writeProjectFile(sandbox.home, ".claude/settings.json", ENABLED);
    const result = await install(sandbox);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^ {2}remove +\.claude\/skills\//m);
    expect(exists(sandbox, SKILL_FILE)).toBe(false);
    expect(exists(sandbox, RULE_PATH)).toBe(true);
  });

  it("a skill file you changed is kept, under the existing manifest rule, until --include-modified", async () => {
    const sandbox = makeSandbox();
    expect((await install(sandbox)).code).toBe(0);
    writeProjectFile(sandbox.project, SKILL_FILE, "my edit\n");
    writeProjectFile(sandbox.home, ".claude/settings.json", ENABLED);
    const kept = await install(sandbox);
    expect(kept.code, kept.stderr).toBe(0);
    expect(kept.stdout).toMatch(/^ {2}keep +\.claude\/skills\/iris-mcp-objectscript-sql\/SKILL\.md/m);
    expect(readProjectFile(sandbox.project, SKILL_FILE).toString("utf8")).toBe("my edit\n");
    const forced = await install(sandbox, ["--include-modified"]);
    expect(forced.code, forced.stderr).toBe(0);
    expect(exists(sandbox, SKILL_FILE)).toBe(false);
  });

  it("a second rule-only install changes nothing and says the plugin brings the skills", async () => {
    const sandbox = makeSandbox();
    writeProjectFile(sandbox.home, ".claude/settings.json", ENABLED);
    expect((await install(sandbox)).code).toBe(0);
    const again = await install(sandbox);
    expect(again.code, again.stderr).toBe(0);
    expect(again.stdout).toContain("Nothing to change for Claude Code: the rule is already installed, and the plugin brings the skills.");
  });
});

describe("uninstall does not ask about the plugin", () => {
  it("removes what the installer owns and prints no detection line", async () => {
    const sandbox = makeSandbox();
    writeProjectFile(sandbox.home, ".claude/settings.json", ENABLED);
    expect((await install(sandbox)).code).toBe(0);
    const result = await run(sandbox, ["skills", "uninstall", "--client", "claude-code", "--yes"]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).not.toContain("Claude Code plugin");
    expect(exists(sandbox, RULE_PATH)).toBe(false);
  });
});
