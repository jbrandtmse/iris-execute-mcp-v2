/**
 * Story 42.9 QA (DW-706) - the `claude-code-plugin-duplicates` doctor finding, through the BUILT bin on real files.
 *
 * The implement stage tested the check with an in-memory file system. These rows put the files Claude Code writes on a real disk and
 * run the shipped bin as a child process (scratch HOME, scratch CLAUDE_CONFIG_DIR inside it; never ~/.claude):
 *
 * - `settings.json` / `.claude/settings.json` / `.claude/settings.local.json` carry `enabledPlugins` next to the other keys Claude Code
 *   keeps there (another plugin, `extraKnownMarketplaces`, `permissions`), in canonical, BOM and minified forms;
 * - the user file `$CLAUDE_CONFIG_DIR/.claude.json` (where Claude Code keeps it when the variable is set; `~/.claude.json` otherwise, a row
 *   below) carries the shape `claude mcp add` writes (`type: "stdio"`, `command`, `args`, `env`) beside `numStartups` and a
 *   `projects` map, and `.mcp.json` the project shape;
 * - an entry written by the clone-and-build install (`node .../dist/index.js`) under the canonical name is a duplicate too;
 * - the exit code is 1 with a finding and 0 without, on the same sandbox with only the plugin flag changed (so the flag is what moves it).
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BIN = path.join(PACKAGE_ROOT, "dist", "cli", "clients-cli.js");
const T = 120_000;

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) rmSync(created.pop() as string, { recursive: true, force: true });
});

/** The connection variables doctor wants resolvable, so that the only possible finding is the one under test. */
const IRIS_ENV = { IRIS_HOST: "h", IRIS_PORT: "1", IRIS_USERNAME: "u", IRIS_NAMESPACE: "N", IRIS_HTTPS: "false", IRIS_PASSWORD: "p" };

interface Finding {
  check: string;
  client: string;
  scope: string;
  path: string | null;
  entry?: string;
  detail: string;
}

interface Sandbox {
  root: string;
  home: string;
  config: string;
  project: string;
  write: (file: string, text: string) => void;
  doctor: (opts?: { cwd?: string; env?: Record<string, string>; noConfigDir?: boolean }) => { status: number | null; findings: Finding[]; stdout: string };
}

function makeSandbox(): Sandbox {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "qa-42-9-doctor-")));
  created.push(root);
  const home = path.join(root, "home");
  const config = path.join(home, ".claude");
  const project = path.join(home, "proj");
  mkdirSync(config, { recursive: true });
  mkdirSync(project, { recursive: true });
  const write = (file: string, text: string): void => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  const doctor: Sandbox["doctor"] = (opts = {}) => {
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "",
      SystemRoot: process.env.SystemRoot ?? "",
      TMPDIR: process.env.TMPDIR ?? "",
      HOME: home,
      USERPROFILE: home,
      APPDATA: path.join(home, "AppData", "Roaming"),
      CLAUDE_CONFIG_DIR: config,
      ...IRIS_ENV,
      ...(opts.env ?? {}),
    };
    if (opts.noConfigDir === true) delete env.CLAUDE_CONFIG_DIR;
    const result = spawnSync(process.execPath, [BIN, "doctor", "--json"], {
      cwd: opts.cwd ?? project,
      env,
      encoding: "utf8",
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    const envelope = JSON.parse(result.stdout.trim().split("\n").pop() as string) as { data: { findings: Finding[] } };
    return {
      status: result.status,
      stdout: result.stdout,
      findings: envelope.data.findings.filter((finding) => finding.check === "claude-code-plugin-duplicates"),
    };
  };
  return { root, home, config, project, write, doctor };
}

/** What `claude mcp add --scope user iris-dev-mcp -- npx -y @iris-mcp/dev@1` writes into the user file, beside Claude Code's own keys. */
const CLAUDE_JSON = (servers: Record<string, unknown>, projects: Record<string, unknown> = {}): string =>
  JSON.stringify({ numStartups: 41, installMethod: "native", autoUpdates: true, projects, mcpServers: servers }, null, 2);

const NPX_ENTRY = { type: "stdio", command: "npx", args: ["-y", "@iris-mcp/dev@1"], env: {} };
const CLONE_ENTRY = { type: "stdio", command: "node", args: ["/Users/someone/git/iris-execute-mcp-v2/packages/iris-dev-mcp/dist/index.js"], env: {} };

/** A settings file as Claude Code keeps it: `enabledPlugins` among other keys, including another plugin. */
const SETTINGS = (flag: boolean | undefined, form: "canonical" | "bom-crlf" | "minified" = "canonical"): string => {
  const enabledPlugins: Record<string, boolean> = { "other-tools@some-marketplace": true };
  if (flag !== undefined) enabledPlugins["iris-mcp@iris-mcp"] = flag;
  const doc = {
    permissions: { allow: ["Bash(git status)"] },
    extraKnownMarketplaces: { "iris-mcp": { source: { source: "github", repo: "jbrandtmse/iris-execute-mcp-v2" } } },
    enabledPlugins,
  };
  if (form === "minified") return JSON.stringify(doc);
  const pretty = JSON.stringify(doc, null, form === "bom-crlf" ? 4 : 2);
  return form === "bom-crlf" ? `\uFEFF${pretty.replace(/\n/g, "\r\n")}\r\n` : `${pretty}\n`;
};

describe("DW-706 QA: doctor flags iris-*-mcp entries while the plugin is enabled (the built bin, real files)", () => {
  for (const form of ["canonical", "bom-crlf", "minified"] as const) {
    it(`user settings (${form}) enable the plugin and the user file holds the 'claude mcp add' entry: one finding, exit 1; flip the flag to false and it is gone, exit 0`, () => {
      const s = makeSandbox();
      s.write(path.join(s.config, ".claude.json"), CLAUDE_JSON({ "iris-dev-mcp": NPX_ENTRY, github: { type: "http", url: "https://example.invalid/mcp" } }));
      s.write(path.join(s.config, "settings.json"), SETTINGS(true, form));
      const on = s.doctor();
      expect(on.status, on.stdout).toBe(1);
      expect(on.findings).toHaveLength(1);
      expect(on.findings[0]).toMatchObject({ client: "claude-code", scope: "user", path: path.join(s.config, ".claude.json"), entry: "iris-dev-mcp" });
      expect(on.findings[0]?.detail).toBe(
        `iris-dev-mcp is also served by the Claude Code plugin iris-mcp (enabled in ${path.join(s.config, "settings.json")}): every tool appears twice. ` +
          `Remove it: npx -y -p @iris-mcp/client-config@1 iris-mcp-clients remove --client claude-code --server iris-dev-mcp --scope user`,
      );

      s.write(path.join(s.config, "settings.json"), SETTINGS(false, form));
      const off = s.doctor();
      expect(off.findings).toEqual([]);
      expect(off.status, off.stdout).toBe(0);
    }, T);
  }

  it("an entry the clone-and-build install wrote (node .../dist/index.js) under the canonical name is a duplicate too", () => {
    const s = makeSandbox();
    s.write(path.join(s.config, ".claude.json"), CLAUDE_JSON({ "iris-admin-mcp": CLONE_ENTRY }));
    s.write(path.join(s.config, "settings.json"), SETTINGS(true));
    const result = s.doctor();
    expect(result.status, result.stdout).toBe(1);
    expect(result.findings.map((finding) => finding.entry)).toEqual(["iris-admin-mcp"]);
  }, T);

  it("the project's .mcp.json holds iris-ops-mcp and the PROJECT settings enable the plugin: the finding names claude-code/project and --scope project", () => {
    const s = makeSandbox();
    s.write(path.join(s.config, ".claude.json"), CLAUDE_JSON({}));
    s.write(path.join(s.project, ".mcp.json"), JSON.stringify({ mcpServers: { "iris-ops-mcp": { command: "npx", args: ["-y", "@iris-mcp/ops@1"] } } }, null, 2));
    s.write(path.join(s.project, ".claude", "settings.json"), SETTINGS(true));
    const result = s.doctor();
    expect(result.status, result.stdout).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ scope: "project", path: path.join(s.project, ".mcp.json"), entry: "iris-ops-mcp" });
    expect(result.findings[0]?.detail).toContain(`(enabled in ${path.join(s.project, ".claude", "settings.json")})`);
    expect(result.findings[0]?.detail).toContain("--server iris-ops-mcp --scope project");
  }, T);

  it("precedence on disk: project settings true over user false is a duplicate; local false over project true is not", () => {
    const s = makeSandbox();
    s.write(path.join(s.config, ".claude.json"), CLAUDE_JSON({ "iris-data-mcp": NPX_ENTRY }));
    s.write(path.join(s.config, "settings.json"), SETTINGS(false));
    s.write(path.join(s.project, ".claude", "settings.json"), SETTINGS(true));
    expect(s.doctor().findings).toHaveLength(1);

    s.write(path.join(s.project, ".claude", "settings.local.json"), SETTINGS(false));
    const off = s.doctor();
    expect(off.findings).toEqual([]);
    expect(off.status, off.stdout).toBe(0);
  }, T);

  it("the plugin key absent (another plugin enabled, extraKnownMarketplaces present): no finding", () => {
    const s = makeSandbox();
    s.write(path.join(s.config, ".claude.json"), CLAUDE_JSON({ "iris-dev-mcp": NPX_ENTRY }));
    s.write(path.join(s.config, "settings.json"), SETTINGS(undefined));
    const result = s.doctor();
    expect(result.findings).toEqual([]);
    expect(result.status, result.stdout).toBe(0);
  }, T);

  it("the local scope is not read: an entry only in the projects map of the user file (the shape `claude mcp add --scope local` writes) is not reported", () => {
    const s = makeSandbox();
    s.write(path.join(s.config, ".claude.json"), CLAUDE_JSON({}, { [s.project]: { allowedTools: [], mcpServers: { "iris-dev-mcp": NPX_ENTRY } } }));
    s.write(path.join(s.config, "settings.json"), SETTINGS(true));
    const result = s.doctor();
    expect(result.findings).toEqual([]);
    expect(result.status, result.stdout).toBe(0);
  }, T);

  it("a settings file with a foreign non-JSON byte sequence never crashes doctor (no finding, doctor still answers)", () => {
    const s = makeSandbox();
    s.write(path.join(s.config, ".claude.json"), CLAUDE_JSON({ "iris-dev-mcp": NPX_ENTRY }));
    s.write(path.join(s.config, "settings.json"), "{ \"enabledPlugins\": { \"iris-mcp@iris-mcp\": tru");
    const result = s.doctor();
    expect(result.findings).toEqual([]);
  }, T);

  it("run from a project directory outside the home directory the plugin finding still fires for the user scope (cwd is irrelevant to user files)", () => {
    const s = makeSandbox();
    const elsewhere = path.join(s.root, "elsewhere");
    mkdirSync(elsewhere);
    s.write(path.join(s.config, ".claude.json"), CLAUDE_JSON({ "iris-interop-mcp": NPX_ENTRY }));
    s.write(path.join(s.config, "settings.json"), SETTINGS(true));
    const result = s.doctor({ cwd: elsewhere });
    expect(result.status, result.stdout).toBe(1);
    expect(result.findings.map((finding) => `${finding.scope}/${finding.entry}`)).toEqual(["user/iris-interop-mcp"]);
  }, T);

  it("CLAUDE_CONFIG_DIR set: the entries are read from $CLAUDE_CONFIG_DIR/.claude.json, and an entry only in ~/.claude.json (which Claude Code then ignores) is not reported", () => {
    const s = makeSandbox();
    s.write(path.join(s.home, ".claude.json"), CLAUDE_JSON({ "iris-dev-mcp": NPX_ENTRY }));
    s.write(path.join(s.config, ".claude.json"), CLAUDE_JSON({ "iris-ops-mcp": NPX_ENTRY }));
    s.write(path.join(s.config, "settings.json"), SETTINGS(true));
    const result = s.doctor();
    expect(result.status, result.stdout).toBe(1);
    expect(result.findings.map((finding) => `${finding.path}:${finding.entry}`)).toEqual([`${path.join(s.config, ".claude.json")}:iris-ops-mcp`]);
  }, T);

  it("CLAUDE_CONFIG_DIR unset: the default layout, ~/.claude/settings.json and ~/.claude.json", () => {
    const s = makeSandbox();
    s.write(path.join(s.home, ".claude.json"), CLAUDE_JSON({ "iris-dev-mcp": NPX_ENTRY }));
    s.write(path.join(s.home, ".claude", "settings.json"), SETTINGS(true));
    const result = s.doctor({ noConfigDir: true });
    expect(result.status, result.stdout).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ scope: "user", path: path.join(s.home, ".claude.json"), entry: "iris-dev-mcp" });
    expect(result.findings[0]?.detail).toContain(`(enabled in ${path.join(s.home, ".claude", "settings.json")})`);
  }, T);
});
