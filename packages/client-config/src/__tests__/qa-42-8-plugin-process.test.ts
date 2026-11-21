/**
 * Story 42.8 QA (DW-625; Rules #22, #58, #59) - the Claude Code plugin detection through the BUILT bin, as a real child process.
 *
 * `claude-plugin-detect.test.ts` and `skills-cli-plugin.test.ts` inject the environment, the home and the file system, so a bin whose `main`
 * did not hand the real `process.env` and `os.homedir()` to the detector would stay green. Here the child's environment is built from
 * scratch (a temp HOME, a scratch `CLAUDE_CONFIG_DIR` that is set only where a row says so), and the real `~/.claude/settings.json` of
 * the developer is fingerprinted before and after (it is never read by the child, because HOME is the sandbox, and it is never written).
 *
 * Fixture diversity (Rule #58): the same `enabledPlugins` entry is written compact, with 2 spaces, 4 spaces and tabs, with CRLF line
 * endings, behind a byte order mark, as JSONC with comments and a trailing comma, and among other keys. The precedence is then
 * swept over all 27 combinations of user, project and local (true, false, absent) against an oracle written independently of the detector.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { makeSandbox, removeSandboxes, writeProjectFile, type Sandbox } from "./pack-test-helpers.js";
import { assertBinFresh, BIN, type RunResult } from "./qa-41-6-helpers.js";

beforeAll(assertBinFresh);
afterEach(removeSandboxes);

const T = 180_000;
const KEY = "iris-mcp@iris-mcp";
const RULE = ".claude/rules/iris-mcp-objectscript-pre-write.md";
const BOM = "﻿";

/** The same entry in the shapes a settings file really comes in. */
const SHAPES: Array<[string, (value: boolean) => string]> = [
  ["compact, one line, no newline", (value) => `{"enabledPlugins":{"${KEY}":${value}}}`],
  ["2 spaces, LF", (value) => `${JSON.stringify({ enabledPlugins: { [KEY]: value } }, null, 2)}\n`],
  ["4 spaces, LF", (value) => `${JSON.stringify({ enabledPlugins: { [KEY]: value } }, null, 4)}\n`],
  ["tabs, LF", (value) => `${JSON.stringify({ enabledPlugins: { [KEY]: value } }, null, "\t")}\n`],
  ["2 spaces, CRLF", (value) => `${JSON.stringify({ enabledPlugins: { [KEY]: value } }, null, 2).replaceAll("\n", "\r\n")}\r\n`],
  ["byte order mark, 4 spaces, CRLF", (value) => `${BOM}${JSON.stringify({ enabledPlugins: { [KEY]: value } }, null, 4).replaceAll("\n", "\r\n")}\r\n`],
  ["JSONC: a CRLF line comment, a block comment and a trailing comma", (value) => `// user settings\r\n{\r\n  /* plugins */\r\n  "enabledPlugins": { "${KEY}": ${value}, },\r\n}\r\n`],
  ["among other keys and other plugins, compact", (value) => `{"model":"opus","enabledPlugins":{"other@market":${!value},"${KEY}":${value},"x@y":true},"hooks":{}}`],
];

const settingsPaths = (sandbox: Sandbox, configDir: string | undefined): { user: string; project: string; local: string } => ({
  user: configDir === undefined ? path.join(sandbox.home, ".claude", "settings.json") : path.join(configDir, "settings.json"),
  // The child resolves its working directory (macOS: /var is /private/var), so the project paths it prints are real paths; HOME and CLAUDE_CONFIG_DIR are used as given.
  project: path.join(realpathSync(sandbox.project), ".claude", "settings.json"),
  local: path.join(realpathSync(sandbox.project), ".claude", "settings.local.json"),
});

const put = (file: string, text: string): void => writeProjectFile(path.dirname(file), path.basename(file), text);

/** Run the built bin with a from-scratch environment; `CLAUDE_CONFIG_DIR` is set only when `configDir` is given. */
function runSkills(sandbox: Sandbox, configDir: string | undefined, extra: string[] = ["--dry-run"]): RunResult {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    TMPDIR: process.env.TMPDIR ?? "",
    HOME: sandbox.home,
    USERPROFILE: sandbox.home,
    APPDATA: path.join(sandbox.home, "AppData", "Roaming"),
    ...(configDir === undefined ? {} : { CLAUDE_CONFIG_DIR: configDir }),
  };
  const result = spawnSync(process.execPath, [BIN, "skills", "install", "--client", "claude-code", "--yes", ...extra], { cwd: sandbox.project, env, encoding: "utf8", input: "", timeout: 90_000 });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const plansSkills = (out: string): boolean => /^ {2}create +\.claude\/skills\//m.test(out);
const plansRule = (out: string): boolean => /^ {2}create +\.claude\/rules\//m.test(out);

/** The real `~/.claude/settings.json`, as size and mtime, or `absent`: read by stat only, never opened. */
function realSettingsFingerprint(): string {
  const real = path.join(homedir(), ".claude", "settings.json");
  if (!existsSync(real)) return "absent";
  const stat = statSync(real);
  return `${stat.size}|${stat.mtimeMs}`;
}

describe("the built bin reads the real environment: one entry, many file shapes", () => {
  it.each(SHAPES.map((shape) => [shape[0], shape[1]] as const))("user settings, %s, true: the plan is the rule alone, and the decider is named", (_name, shape) => {
    const sandbox = makeSandbox();
    const { user } = settingsPaths(sandbox, undefined);
    put(user, shape(true));
    const result = runSkills(sandbox, undefined);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Claude Code plugin ${KEY} is enabled in ${user}; installing only the rule`);
    expect(plansRule(result.stdout)).toBe(true);
    expect(plansSkills(result.stdout)).toBe(false);
    expect(result.stdout).not.toContain("[WARN]");
  }, T);

  it.each(SHAPES.map((shape) => [shape[0], shape[1]] as const))("local settings, %s, false over a user true: the plan has the skills and the rule", (_name, shape) => {
    const sandbox = makeSandbox();
    const paths = settingsPaths(sandbox, undefined);
    put(paths.user, shape(true));
    put(paths.local, shape(false));
    const result = runSkills(sandbox, undefined);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`is set to false in ${paths.local}; installing the skills and the rule`);
    expect(plansSkills(result.stdout)).toBe(true);
    expect(plansRule(result.stdout)).toBe(true);
  }, T);
});

describe("the precedence local > project > user, over every combination, through the built bin", () => {
  type Value = boolean | undefined;
  const VALUES: Value[] = [true, false, undefined];
  const label = (value: Value): string => (value === undefined ? "absent" : String(value));
  /** The oracle: Claude Code's own precedence for a key, the highest settings file that holds it. */
  const winner = (user: Value, project: Value, local: Value): { enabled: boolean; file: "user" | "project" | "local" | null } => {
    if (local !== undefined) return { enabled: local, file: "local" };
    if (project !== undefined) return { enabled: project, file: "project" };
    if (user !== undefined) return { enabled: user, file: "user" };
    return { enabled: false, file: null };
  };
  const combinations = VALUES.flatMap((user) => VALUES.flatMap((project) => VALUES.map((local) => [user, project, local] as const)));

  it.each(combinations.map((combo) => [`user ${label(combo[0])}, project ${label(combo[1])}, local ${label(combo[2])}`, combo] as const))("%s", (_name, [user, project, local]) => {
    const sandbox = makeSandbox();
    const paths = settingsPaths(sandbox, undefined);
    const shape = SHAPES[2]?.[1] as (value: boolean) => string;
    if (user !== undefined) put(paths.user, shape(user));
    if (project !== undefined) put(paths.project, shape(project));
    if (local !== undefined) put(paths.local, shape(local));
    const expected = winner(user, project, local);
    const result = runSkills(sandbox, undefined);
    expect(result.status, result.stderr).toBe(0);
    expect(plansSkills(result.stdout), "the skills are planned unless the plugin is enabled").toBe(!expected.enabled);
    expect(plansRule(result.stdout), "the rule is always planned").toBe(true);
    if (expected.file === null) expect(result.stdout).toContain(`no Claude Code plugin ${KEY} is enabled (checked ${paths.user}, ${paths.project}, ${paths.local})`);
    else expect(result.stdout).toContain(`in ${paths[expected.file]};`);
  }, T);
});

describe("CLAUDE_CONFIG_DIR moves the user file, and the home's ~/.claude is then never the decider", () => {
  it("the moved file decides, and a decoy in ~/.claude holding the opposite value is not read", () => {
    const before = realSettingsFingerprint();
    for (const [moved, decoy] of [[true, false], [false, true]] as const) {
      const sandbox = makeSandbox();
      const configDir = path.join(sandbox.root, "claude-config");
      mkdirSync(configDir);
      const paths = settingsPaths(sandbox, configDir);
      put(paths.user, SHAPES[0]?.[1](moved) as string);
      put(path.join(sandbox.home, ".claude", "settings.json"), SHAPES[0]?.[1](decoy) as string);
      const result = runSkills(sandbox, configDir);
      expect(result.status, result.stderr).toBe(0);
      expect(plansSkills(result.stdout), `moved ${moved}`).toBe(!moved);
      expect(result.stdout).toContain(`in ${paths.user};`);
      expect(result.stdout).not.toContain(path.join(sandbox.home, ".claude"));
    }
    expect(realSettingsFingerprint(), "the developer's real ~/.claude/settings.json was not touched").toBe(before);
  }, T);

  it("a ~/.claude/settings.json that says true is ignored when CLAUDE_CONFIG_DIR points at a directory with no settings: the skills are planned", () => {
    const sandbox = makeSandbox();
    const configDir = path.join(sandbox.root, "empty-config");
    mkdirSync(configDir);
    put(path.join(sandbox.home, ".claude", "settings.json"), SHAPES[1]?.[1](true) as string);
    const result = runSkills(sandbox, configDir);
    expect(result.status, result.stderr).toBe(0);
    expect(plansSkills(result.stdout)).toBe(true);
    expect(result.stdout).toContain(`no Claude Code plugin ${KEY} is enabled (checked ${path.join(configDir, "settings.json")}`);
  }, T);

  it("an empty CLAUDE_CONFIG_DIR counts as unset: the home's ~/.claude/settings.json decides", () => {
    const sandbox = makeSandbox();
    put(path.join(sandbox.home, ".claude", "settings.json"), SHAPES[0]?.[1](true) as string);
    const result = runSkills(sandbox, "");
    expect(result.status, result.stderr).toBe(0);
    expect(plansSkills(result.stdout)).toBe(false);
    expect(result.stdout).toContain(`in ${path.join(sandbox.home, ".claude", "settings.json")};`);
  }, T);
});

describe("files that cannot decide: a [WARN] or nothing, never a refusal, never a crash", () => {
  it("a malformed local file warns by name, is read as no entry, and the user's true still decides (rule only)", () => {
    const sandbox = makeSandbox();
    const paths = settingsPaths(sandbox, undefined);
    put(paths.user, SHAPES[0]?.[1](true) as string);
    put(paths.local, `{"enabledPlugins":{"${KEY}":false`);
    const result = runSkills(sandbox, undefined);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(new RegExp(`^\\[WARN\\] ${paths.local.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")} is not valid JSON`, "m"));
    expect(plansSkills(result.stdout)).toBe(false);
  }, T);

  it("an empty file and a BOM-only file are absent with no warning, and a directory named settings.json is no entry", () => {
    const sandbox = makeSandbox();
    const paths = settingsPaths(sandbox, undefined);
    put(paths.user, SHAPES[0]?.[1](true) as string);
    put(paths.project, "");
    put(paths.local, `${BOM}\r\n`);
    const absent = runSkills(sandbox, undefined);
    expect(absent.status, absent.stderr).toBe(0);
    expect(absent.stdout).not.toContain("[WARN]");
    expect(plansSkills(absent.stdout)).toBe(false);

    const other = makeSandbox();
    mkdirSync(settingsPaths(other, undefined).project, { recursive: true });
    const directory = runSkills(other, undefined);
    expect(directory.status, directory.stderr).toBe(0);
    expect(directory.stdout).not.toContain("[WARN]");
    expect(plansSkills(directory.stdout)).toBe(true);
  }, T);

  it("a value that is not a boolean warns and does not decide, so the skills are planned", () => {
    const sandbox = makeSandbox();
    put(settingsPaths(sandbox, undefined).project, `{"enabledPlugins":{"${KEY}":"true"}}`);
    const result = runSkills(sandbox, undefined);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("to a value that is not true or false");
    expect(plansSkills(result.stdout)).toBe(true);
  }, T);
});

describe("an install (not a dry run) with the plugin enabled writes only the rule, to the project", () => {
  it("only .claude/rules/iris-mcp-objectscript-pre-write.md exists afterwards, with the manifest, and no .claude/skills", () => {
    const sandbox = makeSandbox();
    put(settingsPaths(sandbox, undefined).user, SHAPES[4]?.[1](true) as string);
    const result = runSkills(sandbox, undefined, []);
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(existsSync(path.join(sandbox.project, ...RULE.split("/")))).toBe(true);
    expect(existsSync(path.join(sandbox.project, ".claude", "skills"))).toBe(false);
  }, T);
});
